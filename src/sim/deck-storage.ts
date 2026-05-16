// Persistence for the player's deck AND their current win streak.
//
// Both are namespaced by a per-tab token (held in sessionStorage) so opening
// two tabs in the same browser gives you two independent profiles — useful for
// local two-player testing. sessionStorage is per-tab and survives reload but
// dies on tab close, so a re-opened tab starts fresh from defaults. Real
// users on a single tab keep their deck and streak across reloads.

import { CardId, createTestDeck } from "./cards";

const TAB_KEY = "sensen.tabId";

function getTabId(): string {
  if (typeof window === "undefined") return "ssr";
  let t = sessionStorage.getItem(TAB_KEY);
  if (!t) {
    t = Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem(TAB_KEY, t);
  }
  return t;
}

const deckKey = () => `sensen.deck.v1.${getTabId()}`;
const streakKey = () => `sensen.streak.v1.${getTabId()}`;

export const MIN_DECK_SIZE = 10;
export const MAX_DECK_SIZE = 30;

// ── Deck ──

export function loadDeck(): CardId[] {
  if (typeof window === "undefined") return createTestDeck();
  try {
    const raw = localStorage.getItem(deckKey());
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
  localStorage.setItem(deckKey(), JSON.stringify(deck));
}

export function resetDeck() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(deckKey());
}

// Append a single card (used by post-victory draft).
export function addCardToDeck(cardId: CardId) {
  const d = loadDeck();
  d.push(cardId);
  saveDeck(d);
}

// ── Win streak ──

export function loadStreak(): number {
  if (typeof window === "undefined") return 0;
  const raw = localStorage.getItem(streakKey());
  return raw ? Math.max(0, parseInt(raw, 10) || 0) : 0;
}

export function saveStreak(n: number) {
  if (typeof window === "undefined") return;
  localStorage.setItem(streakKey(), String(Math.max(0, n)));
}

export function bumpStreak(): number {
  const n = loadStreak() + 1;
  saveStreak(n);
  return n;
}

export function resetStreak() {
  saveStreak(0);
}

// On loss the user wanted everything zeroed out — deck and streak both.
export function resetProfile() {
  resetDeck();
  resetStreak();
}

// ── Streak → matchbox topic bucket ──
//
// Matchbox doesn't do skill-based matchmaking; it just FIFO-pairs peers in
// the same room (= URL path). To get "play against someone with a similar
// streak" we map the streak to a discrete bucket and inject it into the
// topic. Two peers in the same bucket land in the same room.
export function streakBucket(streak: number): string {
  if (streak <= 0) return "0";
  if (streak <= 2) return "1to2";
  if (streak <= 5) return "3to5";
  if (streak <= 10) return "6to10";
  if (streak <= 20) return "11to20";
  return "21up";
}

// Given a base matchbox URL (with path that becomes the room topic), return
// the URL with the streak bucket appended to the path.
export function urlForStreak(baseUrl: string, streak: number): string {
  try {
    const u = new URL(baseUrl);
    const bucket = streakBucket(streak);
    u.pathname = `${u.pathname.replace(/\/+$/, "")}-streak-${bucket}`;
    return u.toString();
  } catch {
    return baseUrl; // bad URL — let the caller fail downstream with a clearer error
  }
}
