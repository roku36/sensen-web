// Persistence for the player's deck. Stored in localStorage as a JSON array
// of CardId numbers. Both peers in an online match must have the same deck —
// for now we just send our local saved deck, both ends use it (the InitOptions
// passes deckP0/deckP1 separately so we can support asymmetric decks later
// without protocol changes).

import { CardId, createTestDeck } from "./cards";

const KEY = "sensen.deck.v1";

export const MIN_DECK_SIZE = 10;
export const MAX_DECK_SIZE = 30;

export function loadDeck(): CardId[] {
  if (typeof window === "undefined") return createTestDeck();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return createTestDeck();
    const arr = JSON.parse(raw) as number[];
    if (!Array.isArray(arr) || arr.length < 1) return createTestDeck();
    return arr.map((n) => n as CardId);
  } catch {
    return createTestDeck();
  }
}

export function saveDeck(deck: CardId[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(deck));
}

export function resetDeck() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
}
