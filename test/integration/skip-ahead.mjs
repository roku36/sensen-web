import { chromium } from "playwright";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));

await page.goto("http://localhost:5173?simple");
await page.waitForFunction(() => window.__sensen != null);
await page.click("button:has-text('2D Simple')");
await page.selectOption("select", "passive");
await page.click("button:has-text('CPU と対戦')");
await wait(400);

// USER's exact scenario: stack 4閃 in queue + reserve heavy with prereq 3閃.
// SiegeBreaker = id 134, prereq=3閃, cost=3閃.
await page.evaluate(() => {
  const g = window.__sensen.getState();
  g.players[0].hand = [1, 1, 1, 1, null, 134];
  // Pre-load queue with 4 fresh strikes = 4閃 chain.
  g.players[0].queue = [
    { kind: "card", cardId: 1, duration: 3, blockApplied: true },
    { kind: "card", cardId: 1, duration: 3, blockApplied: false },
    { kind: "card", cardId: 1, duration: 3, blockApplied: false },
    { kind: "card", cardId: 1, duration: 3, blockApplied: false },
  ];
  g.players[0].castStartedAt = g.frame / 60;
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
    chain: r.toFixed(2) + "s = " + (r/3).toFixed(2) + "閃",
    q: p.queue.map(q => q.kind==="card" ? `c${q.cardId}` : "D").join(","),
    r: p.reservations.map(r => r.kind==="card" ? `S${r.slotIndex}:${p.hand[r.slotIndex]}` : "D").join(","),
  };
});

console.log("=== Test A: only reserve heavy (chain=4閃, prereq=3閃) ===");
console.log("init:", await state());
await page.evaluate(() => window.__sensen.pushInput(64)); // click SiegeBreaker slot 5
await wait(50);
console.log("click SB:", await state(), "← SB should be in reservation, NOT queue");

await wait(3000); // 1閃
console.log("+1閃:", await state(), "← SB should now be in queue");

console.log("\n=== Test B: Bludgeon mid-reservation (chain=4閃, reserve [Strike, B]) ===");
await page.evaluate(() => {
  const g = window.__sensen.getState();
  g.players[0].hand = [1, 1, 1, 1, 1, 23];  // 5 Strikes + Bludgeon
  g.players[0].queue = [
    { kind: "card", cardId: 1, duration: 3, blockApplied: true },
    { kind: "card", cardId: 1, duration: 3, blockApplied: false },
    { kind: "card", cardId: 1, duration: 3, blockApplied: false },
    { kind: "card", cardId: 1, duration: 3, blockApplied: false },
  ];
  g.players[0].castStartedAt = g.frame / 60;
  g.players[0].reservations = [];
});
await wait(100);
console.log("init:", await state());

const SLOT = (i) => 1 << (i + 1);
await page.evaluate((f) => window.__sensen.pushInput(f), SLOT(0)); // Strike to reservation
await wait(50);
await page.evaluate((f) => window.__sensen.pushInput(f), SLOT(5)); // Bludgeon (prereq=2閃=6sec)
await wait(50);
console.log("after [S, B] click:", await state(), "← S sits in reservation, B sits in reservation");

await wait(3000); // 1閃 (chain drains from 4閃 to 3閃)
console.log("+1閃 (chain=3閃, Bludgeon prereq=2閃 not yet matched):", await state());

await wait(3000); // 2閃 (chain=2閃 = Bludgeon prereq)
console.log("+2閃 (chain=2閃, Bludgeon window catches):", await state(), "← Bludgeon SHOULD have fired");

await browser.close();
