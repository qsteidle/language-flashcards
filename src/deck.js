// Deck-level operations. Pure, storage-agnostic so the core can be unit-tested
// without IndexedDB. The app layer wires these to persistence and the UI.

import { newCardStats, review, dueCards, shuffle, RATINGS } from './scheduler.js';

export const SCHEMA_VERSION = 1;

// Most cards a single study session will present. Extra due cards stay due and
// come up in the next session.
export const SESSION_LIMIT = 20;

const COMMON_POS = Object.freeze([
  'noun',
  'verb',
  'adjective',
  'adverb',
  'pronoun',
  'preposition',
  'conjunction',
  'interjection',
  'article',
  'phrase',
  'other',
]);

export { COMMON_POS };

function nowIso() {
  return new Date().toISOString();
}

function uuid() {
  // Available in modern browsers and Node 24.
  return crypto.randomUUID();
}

/** A brand-new, empty deck. */
export function createDeck() {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      sessionCounter: 0,
      createdAt: nowIso(),
      lastExportedAt: null,
    },
    cards: [],
  };
}

/**
 * Build a card record from editor fields. New cards are due in the next
 * started session (dueAtSession = current sessionCounter; startSession bumps
 * the counter, so the card qualifies).
 */
export function createCard(fields, sessionCounter = 0) {
  return {
    id: uuid(),
    word: fields.word ?? '',
    definition: fields.definition ?? '',
    pos: fields.pos ?? 'other',
    example: fields.example ?? '',
    note: fields.note ?? '',
    synonyms: Array.isArray(fields.synonyms) ? fields.synonyms.slice() : [],
    seeAlso: Array.isArray(fields.seeAlso) ? fields.seeAlso.slice() : [],
    imageId: fields.imageId ?? null,
    audioId: fields.audioId ?? null,
    archived: false,
    stats: newCardStats(sessionCounter),
  };
}

export function findCard(deck, cardId) {
  return deck.cards.find((c) => c.id === cardId) || null;
}

// Leading Spanish articles to ignore when alphabetizing (nouns carry these;
// verbs and adjectives don't, so they sort by their own first letter).
const LEADING_ARTICLE = /^(el|la|los|las|un|una|unos|unas)\s+/i;

/** Sort key for a card's word: lowercased, with any leading article stripped. */
export function cardSortKey(card) {
  return (card.word || '').trim().replace(LEADING_ARTICLE, '').toLowerCase();
}

/** Cards sorted alphabetically by word, ignoring leading articles (es locale). */
export function sortCardsByWord(cards) {
  return cards
    .slice()
    .sort((a, b) => cardSortKey(a).localeCompare(cardSortKey(b), 'es', { sensitivity: 'base' }));
}

/**
 * Start a study session: increment the session counter, then build the due
 * queue from non-archived, due cards (shuffled). Returns the queue of ids.
 *
 * Note: it is the *session counter*, not wall-clock time, that makes cards due.
 */
export function startSession(deck, rng = Math.random, limit = SESSION_LIMIT) {
  deck.meta.sessionCounter += 1;
  const due = dueCards(deck.cards, deck.meta.sessionCounter);
  return shuffle(due, rng)
    .slice(0, limit)
    .map((c) => c.id);
}

/**
 * Apply a rating to a card. Mutates the card's stats with the honest scheduler
 * output and applies the auto-archive threshold. Returns details for the UI.
 *
 * @returns {{ card: object, autoArchived: boolean }}
 */
export function reviewCard(deck, cardId, rating, { autoArchiveEnabled = true } = {}) {
  const card = findCard(deck, cardId);
  if (!card) throw new Error(`card not found: ${cardId}`);

  const { stats, autoArchive } = review(card.stats, rating, deck.meta.sessionCounter);
  card.stats = stats;

  let autoArchived = false;
  if (autoArchive && autoArchiveEnabled && !card.archived) {
    card.archived = true;
    autoArchived = true;
  }

  return { card, autoArchived };
}

export function setArchived(deck, cardId, archived) {
  const card = findCard(deck, cardId);
  if (card) card.archived = archived;
  return card;
}

export function deleteCard(deck, cardId) {
  const idx = deck.cards.findIndex((c) => c.id === cardId);
  if (idx === -1) return null;
  return deck.cards.splice(idx, 1)[0];
}

/** Counts used by the session summary — honest tallies only. */
export function emptyTally() {
  return { [RATINGS.NO]: 0, [RATINGS.HARD]: 0, [RATINGS.MEDIUM]: 0, [RATINGS.EASY]: 0 };
}
