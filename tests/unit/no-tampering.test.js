import { describe, it, expect } from 'vitest';
import { createDeck, createCard, startSession, reviewCard } from '../../src/deck.js';
import { RATINGS } from '../../src/scheduler.js';

// Runs a session of known ratings and asserts the resulting deck state equals
// an INDEPENDENTLY computed expectation (numbers worked out by hand from the
// documented rules). Any hidden "boost", "auto-pass", or shortcut would change
// these values and fail the test.
describe('no-tampering invariant', () => {
  it('deck state after known ratings equals hand-computed expectation', () => {
    const deck = createDeck();
    const card = createCard({ word: 'el perro', definition: 'the dog' }, deck.meta.sessionCounter);
    deck.cards.push(card);

    // Session 1
    startSession(deck); // sessionCounter -> 1
    reviewCard(deck, card.id, RATINGS.EASY); // reps1, interval1, ease2.65, due=1+1=2

    // Session 2
    startSession(deck); // -> 2
    reviewCard(deck, card.id, RATINGS.MEDIUM); // reps2, interval3, ease2.65, due=2+3=5

    // Session 3 (card due at 5, not yet — but we review it directly to lock math)
    deck.meta.sessionCounter = 5;
    reviewCard(deck, card.id, RATINGS.HARD); // reps3, interval=round(3*2.65)=8, ease=2.50, due=5+8=13

    expect(card.stats).toEqual({
      interval: 8,
      ease: 2.5,
      reps: 3,
      dueAtSession: 13,
      lastRating: RATINGS.HARD,
      reviewCount: 3,
    });
    expect(card.archived).toBe(false);
  });

  it('a lapse honestly resets — no floor on penalty is bypassed', () => {
    const deck = createDeck();
    const card = createCard({ word: 'la casa', definition: 'the house' }, 0);
    card.stats = {
      interval: 8,
      ease: 2.5,
      reps: 3,
      dueAtSession: 13,
      lastRating: 1,
      reviewCount: 3,
    };
    deck.cards.push(card);

    deck.meta.sessionCounter = 13;
    const { autoArchived } = reviewCard(deck, card.id, RATINGS.NO);

    expect(card.stats).toEqual({
      interval: 1,
      ease: 2.3, // 2.5 - 0.20
      reps: 0,
      dueAtSession: 14,
      lastRating: RATINGS.NO,
      reviewCount: 4,
    });
    expect(autoArchived).toBe(false);
  });
});
