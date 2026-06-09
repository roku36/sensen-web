// Persistence for lab self-play matches (localStorage).
//
// One JSON blob keyed per browser; bounded so 100-match runs across all
// levels never blow the localStorage quota. Replays are small (sparse
// inputs only), but we still evict oldest-first past the cap.

import { LabMatch } from "./selfplay";

const KEY = "sensen.lab.matches.v1";
const MAX_STORED = 600;

export function loadLabMatches(): LabMatch[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveLabMatches(matches: LabMatch[]) {
  if (typeof window === "undefined") return;
  let trimmed = matches.slice(-MAX_STORED);
  // Quota safety: shed oldest matches until the write fits.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      localStorage.setItem(KEY, JSON.stringify(trimmed));
      return;
    } catch {
      trimmed = trimmed.slice(Math.ceil(trimmed.length / 2));
    }
  }
}

export function clearLabMatches() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
}
