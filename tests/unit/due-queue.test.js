import { describe, it, expect } from 'vitest';
import { createDeck, createCard, startSession } from '../../src/deck.js';
import { dueCards, isDue } from '../../src/scheduler.js';

function cardWith(props) {
  const c = createCard({ word: 'x', definition: 'y' }, 0);
  Object.assign(c, props.card || {});
  if (props.stats) Object.assign(c.stats, props.stats);
  return c;
}

describe('due-queue filter', () => {
  it('includes only non-archived cards whose dueAtSession <= sessionCounter', () => {
    const dueNow = cardWith({ stats: { dueAtSession: 2 } });
    const future = cardWith({ stats: { dueAtSession: 5 } });
    const archivedDue = cardWith({ card: { archived: true }, stats: { dueAtSession: 0 } });
    const cards = [dueNow, future, archivedDue];

    const queue = dueCards(cards, 2);
    const ids = queue.map((c) => c.id);

    expect(ids).toContain(dueNow.id);
    expect(ids).not.toContain(future.id); // 5 > 2
    expect(ids).not.toContain(archivedDue.id); // archived never enters
  });

  it('archived cards are never due regardless of counter', () => {
    const c = cardWith({ card: { archived: true }, stats: { dueAtSession: 0 } });
    expect(isDue(c, 999)).toBe(false);
  });

  it('startSession bumps the counter and returns due ids', () => {
    const deck = createDeck();
    const a = createCard({ word: 'a', definition: '1' }, deck.meta.sessionCounter); // due at 0
    const b = createCard({ word: 'b', definition: '2' }, deck.meta.sessionCounter);
    deck.cards.push(a, b);

    const queue = startSession(deck, () => 0); // deterministic shuffle
    expect(deck.meta.sessionCounter).toBe(1);
    expect(queue.sort()).toEqual([a.id, b.id].sort());
  });
});
