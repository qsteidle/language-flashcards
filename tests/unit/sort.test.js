import { describe, it, expect } from 'vitest';
import { createCard, sortCardsByWord, cardSortKey } from '../../src/deck.js';

function card(word, pos = 'noun') {
  return createCard({ word, definition: 'x', pos }, 0);
}

describe('alphabetize cards by word, ignoring leading articles', () => {
  it('strips leading el/la/los/las for the sort key', () => {
    expect(cardSortKey(card('el perro'))).toBe('perro');
    expect(cardSortKey(card('la casa'))).toBe('casa');
    expect(cardSortKey(card('los gatos'))).toBe('gatos');
    expect(cardSortKey(card('las mesas'))).toBe('mesas');
  });

  it('leaves verbs and adjectives unchanged', () => {
    expect(cardSortKey(card('correr', 'verb'))).toBe('correr');
    expect(cardSortKey(card('alto', 'adjective'))).toBe('alto');
  });

  it('orders by the article-stripped word', () => {
    const cards = [
      card('el perro'),
      card('correr', 'verb'),
      card('la casa'),
      card('alto', 'adjective'),
    ];
    const sorted = sortCardsByWord(cards).map((c) => c.word);
    // alto, casa(la), correr, perro(el)
    expect(sorted).toEqual(['alto', 'la casa', 'correr', 'el perro']);
  });

  it('does not mutate the input array', () => {
    const cards = [card('el perro'), card('la casa')];
    const before = cards.map((c) => c.word);
    sortCardsByWord(cards);
    expect(cards.map((c) => c.word)).toEqual(before);
  });
});
