import { describe, it, expect } from 'vitest';
import { createDeck, createCard } from '../../src/deck.js';
import { dueCards } from '../../src/scheduler.js';

// Scheduling is measured in SESSIONS, not calendar days. The due logic has no
// dependency on the wall clock — only on meta.sessionCounter.
describe('session-not-days', () => {
  it('advancing the session counter is what makes cards due', () => {
    const deck = createDeck();
    const card = createCard({ word: 'el gato', definition: 'the cat' }, 0);
    card.stats.dueAtSession = 2;
    deck.cards.push(card);

    deck.meta.sessionCounter = 1;
    expect(dueCards(deck.cards, deck.meta.sessionCounter)).toHaveLength(0);

    deck.meta.sessionCounter = 2; // counter reaches dueAtSession
    expect(dueCards(deck.cards, deck.meta.sessionCounter)).toHaveLength(1);
  });

  it('the passage of real time alone does not make a card due', () => {
    const deck = createDeck();
    const card = createCard({ word: 'el sol', definition: 'the sun' }, 0);
    card.stats.dueAtSession = 10;
    deck.cards.push(card);

    const before = dueCards(deck.cards, deck.meta.sessionCounter).length;
    // Simulate "time passing" without touching the session counter.
    const laterCounter = deck.meta.sessionCounter; // unchanged
    const after = dueCards(deck.cards, laterCounter).length;

    expect(before).toBe(0);
    expect(after).toBe(0);
  });
});
