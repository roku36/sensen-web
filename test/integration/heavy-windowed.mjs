import { chromium } from "playwright";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));

await page.goto("http://localhost:5173?simple");
await page.waitForFunction(() => window.__sensen != null);
await page.selectOption("select", "passive");
await page.click("button:has-text('CPU と対戦')");
await wait(400);

// User scenario: chain ~4閃 already in queue, reserve a 2閃 prereq heavy.
// Heavy should sit in reservations until chain drains to ≈2閃.
await page.evaluate(() => {
  const g = window.__sensen.getState();
  // Hand: 4 Strikes + Bludgeon + one more Strike.
  g.players[0].hand = [1, 1, 1, 1, 23, 1];
  // Pre-load queue with 4 Strikes (12sec total = 4閃 chain).
  g.players[0].queue = [
    { kind: "card", cardId: 1, duration: 3, blockApplied: true },
    { kind: "card", cardId: 1, duration: 3, blockApplied: false },
    { kind: "card", cardId: 1, duration: 3, blockApplied: false },
    { kind: "card", cardId: 1, duration: 3, blockApplied: false },
  ];
  g.players[0].castStartedAt = g.frame / 60;  // S1 just started
  g.players[0].reservations = [];
});
await wait(150);

const state = async () => page.evaluate(() => {
  const g = window.__sensen.getState();
  const p = g.players[0];
  // queueRemainingTime (seconds) — inline reimpl for the trace
  let r = 0;
  if (p.queue.length > 0) {
    r = Math.max(0, p.queue[0].duration - (g.frame/60 - p.castStartedAt));
    for (let i = 1; i < p.queue.length; i++) r += p.queue[i].duration;
  }
  return {
    f: g.frame,
    qChain: r.toFixed(2),
    q: p.queue.map(q => q.kind==="card" ? `c${q.cardId}` : `D`).join(","),
    r: p.reservations.map(r => r.kind==="card" ? `c${r.slotIndex}:${p.hand[r.slotIndex]}` : "Draw").join(","),
  };
});

console.log("init:", await state());

// Click Bludgeon (slot 4, flag = 1 << 5 = 32).
await page.evaluate(() => window.__sensen.pushInput(32));
await wait(80);
console.log("after Bludgeon click:", await state());

// Wait 2 sec (chain should drain from ~12sec to ~10sec — still above prereq).
await wait(2000);
console.log("after +2s:", await state());

// Wait until chain ≈ 6sec (drain ~6sec total = ~6sec after click).
await wait(4500);
console.log("after +6.5s:", await state());

// Wait a bit more for window catch.
await wait(500);
console.log("after +7s:", await state());

await browser.close();
