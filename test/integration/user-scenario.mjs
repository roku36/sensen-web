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

// USER SCENARIO: queue already has 4閃 stack. Reserve heavy with prereq 3閃.
// Expected: heavy waits 1閃, then fires.
// We need a heavy with prereq 3閃. SiegeBreaker = id 134, prereq 3閃, cost 3閃.
await page.evaluate(() => {
  const g = window.__sensen.getState();
  // Hand: place SiegeBreaker (id 134, prereq=3閃 / cost=3閃) at slot 5.
  g.players[0].hand = [1, 1, 1, 1, null, 134];
  // Pre-load queue with 4 strikes = 4閃 chain = 12 sec.
  g.players[0].queue = [
    { kind: "card", cardId: 1, duration: 3, blockApplied: true },
    { kind: "card", cardId: 1, duration: 3, blockApplied: false },
    { kind: "card", cardId: 1, duration: 3, blockApplied: false },
    { kind: "card", cardId: 1, duration: 3, blockApplied: false },
  ];
  g.players[0].castStartedAt = g.frame / 60; // S1 just started, fresh chain
  g.players[0].reservations = [];
});
await wait(100);

const state = async () => page.evaluate(() => {
  const g = window.__sensen.getState();
  const p = g.players[0];
  let r = 0;
  if (p.queue.length > 0) {
    r = Math.max(0, p.queue[0].duration - (g.frame/60 - p.castStartedAt));
    for (let i = 1; i < p.queue.length; i++) r += p.queue[i].duration;
  }
  return {
    f: g.frame,
    chain_sec: r.toFixed(2),
    chain_sen: (r/3).toFixed(2),
    q: p.queue.map(q => q.kind==="card" ? `c${q.cardId}` : "D").join(","),
    r: p.reservations.map(r => r.kind==="card" ? `S${r.slotIndex}:${p.hand[r.slotIndex]}` : "D").join(","),
  };
});

console.log("init:", await state());

// Click SiegeBreaker (slot 5 = flag 1 << 6 = 64).
await page.evaluate(() => window.__sensen.pushInput(64));
await wait(50);
console.log("right after click (should: SB in reservation, queue unchanged):", await state());

// Wait 1 sec (chain should be 11sec).
await wait(1000);
console.log("+1s (chain ~11sec, SB still waiting):", await state());

// Wait 2 more sec (chain should be 9sec = 3閃). SB should fire here.
await wait(2000);
console.log("+3s = 1閃後 (SB should have CONFIRMED):", await state());

await browser.close();
