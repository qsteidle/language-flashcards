import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveDeck,
  exportJSON,
  importJSON,
  putAudio,
  putImage,
  getAudio,
  getImage,
  _resetForTests,
} from '../../src/storage.js';
import { createDeck, createCard } from '../../src/deck.js';

async function freshDb() {
  // Wipe the fake DB between tests for isolation.
  _resetForTests();
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase('language-flashcards');
    req.onsuccess = resolve;
    req.onerror = () => reject(req.error);
    req.onblocked = resolve;
  });
}

beforeEach(freshDb);

describe('schema round-trip', () => {
  it('importJSON(exportJSON(deck)) yields a deep-equal deck', async () => {
    const deck = createDeck();
    deck.cards.push(
      createCard({ word: 'el perro', definition: 'the dog', pos: 'noun', synonyms: ['el can'] }, 0),
      createCard({ word: 'correr', definition: 'to run', pos: 'verb' }, 0)
    );
    await saveDeck(deck);

    const exported = await exportJSON(deck);
    expect(exported.schemaVersion).toBe(1); // schema version present on export

    await freshDb(); // import into a clean store
    const { deck: restored } = await importJSON(exported, { mode: 'replace' });

    expect(restored).toEqual(deck);
  });

  it('round-trips media (audio + image) losslessly', async () => {
    const audioBytes = new Uint8Array([1, 2, 3, 4, 5, 250, 251, 252]);
    const imageBytes = new Uint8Array([9, 8, 7, 6, 0, 255, 128]);
    const audioBlob = new Blob([audioBytes], { type: 'audio/mp4' });
    const imageBlob = new Blob([imageBytes], { type: 'image/png' });

    const deck = createDeck();
    const card = createCard({ word: 'el pájaro', definition: 'the bird' }, 0);
    card.audioId = 'aud-1';
    card.imageId = 'img-1';
    deck.cards.push(card);

    await saveDeck(deck);
    await putAudio('aud-1', audioBlob);
    await putImage('img-1', imageBlob);

    const exported = await exportJSON(deck);
    expect(exported.media.audio['aud-1'].type).toBe('audio/mp4');
    expect(exported.media.images['img-1'].type).toBe('image/png');

    await freshDb();
    await importJSON(exported, { mode: 'replace' });

    const aud = await getAudio('aud-1');
    const img = await getImage('img-1');
    expect(aud.type).toBe('audio/mp4');
    expect(img.type).toBe('image/png');
    expect(new Uint8Array(await aud.blob.arrayBuffer())).toEqual(audioBytes);
    expect(new Uint8Array(await img.blob.arrayBuffer())).toEqual(imageBytes);
  });

  it('rejects a file with the wrong schema version', async () => {
    await expect(importJSON({ schemaVersion: 999, meta: {}, cards: [] })).rejects.toThrow(
      /schemaVersion/i
    );
  });

  it('merge mode appends new cards without duplicating by id', async () => {
    const deck = createDeck();
    const a = createCard({ word: 'a', definition: '1' }, 0);
    deck.cards.push(a);
    await saveDeck(deck);

    const incoming = createDeck();
    const b = createCard({ word: 'b', definition: '2' }, 0);
    incoming.cards.push(a, b); // 'a' duplicates an existing id
    const exported = await exportJSON(incoming);

    const { deck: merged } = await importJSON(exported, { mode: 'merge' });
    const ids = merged.cards.map((c) => c.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids)).toEqual(new Set([a.id, b.id]));
  });
});
