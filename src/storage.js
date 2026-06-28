// Storage layer.
//
// Primary store is IndexedDB:
//   - 'deck'   : single record (key 'main') holding meta + cards (light records)
//   - 'audio'  : { id, blob, type } keyed by uuid
//   - 'images' : { id, blob, type } keyed by uuid
//
// localStorage is used ONLY for tiny things (prefs); never for cards or media.
// The JSON export inlines media as base64 so the backup file is self-contained.

import { blobToBase64, base64ToBlob } from './serialize.js';
import { SCHEMA_VERSION, createDeck } from './deck.js';

const DB_NAME = 'language-flashcards';
const DB_VERSION = 1;
const DECK_KEY = 'main';

export class QuotaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QuotaError';
  }
}

let dbPromise = null;
let dbConn = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('deck')) db.createObjectStore('deck');
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('images'))
        db.createObjectStore('images', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      dbConn = req.result;
      resolve(dbConn);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export function closeDB() {
  if (dbConn) {
    dbConn.close();
    dbConn = null;
  }
  dbPromise = null;
}

// Test seam: close and forget the cached connection (used by unit tests so a
// subsequent deleteDatabase is not blocked by an open handle).
export function _resetForTests() {
  closeDB();
}

function isQuotaError(err) {
  return (
    err &&
    (err.name === 'QuotaExceededError' ||
      err.code === 22 ||
      /quota/i.test(err.message || '') ||
      /quota/i.test(err.name || ''))
  );
}

function tx(db, stores, mode) {
  return db.transaction(stores, mode);
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      const err = request.error;
      reject(isQuotaError(err) ? new QuotaError(err.message || 'Storage quota exceeded') : err);
    };
  });
}

function txDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => {
      const err = transaction.error;
      reject(isQuotaError(err) ? new QuotaError(err.message || 'Storage quota exceeded') : err);
    };
    transaction.onerror = () => {
      const err = transaction.error;
      reject(isQuotaError(err) ? new QuotaError(err.message || 'Storage quota exceeded') : err);
    };
  });
}

// ---------- Deck ----------

export async function saveDeck(deck) {
  const db = await openDB();
  const t = tx(db, ['deck'], 'readwrite');
  t.objectStore('deck').put(deck, DECK_KEY);
  await txDone(t);
  return deck;
}

export async function loadDeck() {
  const db = await openDB();
  const t = tx(db, ['deck'], 'readonly');
  const deck = await reqToPromise(t.objectStore('deck').get(DECK_KEY));
  return deck || null;
}

/** Load the deck, creating and persisting a fresh one on first run. */
export async function loadOrCreateDeck() {
  const existing = await loadDeck();
  if (existing) return existing;
  const fresh = createDeck();
  await saveDeck(fresh);
  return fresh;
}

// ---------- Media ----------

async function putMedia(storeName, id, blob) {
  const db = await openDB();
  const t = tx(db, [storeName], 'readwrite');
  t.objectStore(storeName).put({ id, blob, type: blob.type });
  await txDone(t);
  return id;
}

async function getMedia(storeName, id) {
  if (!id) return null;
  const db = await openDB();
  const t = tx(db, [storeName], 'readonly');
  const rec = await reqToPromise(t.objectStore(storeName).get(id));
  return rec || null;
}

async function deleteMedia(storeName, id) {
  if (!id) return;
  const db = await openDB();
  const t = tx(db, [storeName], 'readwrite');
  t.objectStore(storeName).delete(id);
  await txDone(t);
}

export const putAudio = (id, blob) => putMedia('audio', id, blob);
export const getAudio = (id) => getMedia('audio', id);
export const deleteAudio = (id) => deleteMedia('audio', id);

export const putImage = (id, blob) => putMedia('images', id, blob);
export const getImage = (id) => getMedia('images', id);
export const deleteImage = (id) => deleteMedia('images', id);

// ---------- Export / Import ----------

/**
 * Produce a self-contained export object: the deck plus all referenced media
 * inlined as base64. Returned as a plain object; the caller stringifies it.
 */
export async function exportJSON(deck) {
  const media = { audio: {}, images: {} };

  for (const card of deck.cards) {
    if (card.audioId && !media.audio[card.audioId]) {
      const rec = await getAudio(card.audioId);
      if (rec) media.audio[card.audioId] = { type: rec.type, data: await blobToBase64(rec.blob) };
    }
    if (card.imageId && !media.images[card.imageId]) {
      const rec = await getImage(card.imageId);
      if (rec) media.images[card.imageId] = { type: rec.type, data: await blobToBase64(rec.blob) };
    }
  }

  return {
    schemaVersion: deck.schemaVersion ?? SCHEMA_VERSION,
    meta: { ...deck.meta },
    cards: deck.cards.map((c) => ({ ...c, stats: { ...c.stats } })),
    media,
  };
}

export function validateExport(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Not a valid backup file.');
  if (obj.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported schemaVersion: ${obj.schemaVersion} (this app supports ${SCHEMA_VERSION}).`
    );
  }
  if (!obj.meta || typeof obj.meta !== 'object') throw new Error('Backup is missing meta.');
  if (!Array.isArray(obj.cards)) throw new Error('Backup is missing the cards array.');
  return true;
}

/**
 * Import an export object. mode 'replace' wipes the current deck and media;
 * mode 'merge' keeps existing cards and appends imported ones (by id).
 *
 * @returns {{ deck: object, imported: number }}
 */
export async function importJSON(obj, { mode = 'replace' } = {}) {
  validateExport(obj);

  // Decode and store media first so card references resolve.
  const media = obj.media || { audio: {}, images: {} };
  for (const [id, { type, data }] of Object.entries(media.audio || {})) {
    await putAudio(id, base64ToBlob(data, type));
  }
  for (const [id, { type, data }] of Object.entries(media.images || {})) {
    await putImage(id, base64ToBlob(data, type));
  }

  let deck;
  if (mode === 'merge') {
    deck = (await loadDeck()) || createDeck();
    const existingIds = new Set(deck.cards.map((c) => c.id));
    const incoming = obj.cards.filter((c) => !existingIds.has(c.id));
    deck.cards.push(...incoming);
    // Advance the session counter so imported due cards behave sanely.
    deck.meta.sessionCounter = Math.max(deck.meta.sessionCounter, obj.meta.sessionCounter || 0);
  } else {
    deck = {
      schemaVersion: SCHEMA_VERSION,
      meta: { ...obj.meta },
      cards: obj.cards.map((c) => ({ ...c, stats: { ...c.stats } })),
    };
  }

  await saveDeck(deck);
  return { deck, imported: mode === 'merge' ? deck.cards.length : obj.cards.length };
}

// ---------- Persistence & quota readout ----------

export async function requestPersist() {
  if (navigator.storage && navigator.storage.persist) {
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }
  return false;
}

export async function getEstimate() {
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      return { usage, quota };
    } catch {
      return { usage: 0, quota: 0 };
    }
  }
  return { usage: 0, quota: 0 };
}
