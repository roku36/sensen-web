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

const state = async () => page.evaluate(() => {
  const g = window.__sensen.getState();
  const p = g.players[0];
  let r = 0;
  if (p.queue.length > 0) {
    r = Math.max(0, p.queue[0].duration - (g.frame/60 - p.castStartedAt));
    for (let i = 1; i < p.queue.length; i++) r += p.queue[i].duration;
  }
  return {
    chain: (r/3).toFixed(2) + "閃",
    q: p.queue.map(q => q.kind==="card" ? `c${q.cardId}` : "D").join(","),
    r: p.reservations.map(r => r.kind==="card" ? `S${r.slotIndex}:${p.hand[r.slotIndex]}` : "D").join(","),
  };
});

// User's exact example: chain 4閃 + reserve SiegeBreaker(prereq=3閃)
console.log("=== USER's example: chain 4閃 + B(prereq=3閃) → fire at 1閃 ===");
await page.evaluate(() => {
  const g = window.__sensen.getState();
  g.players[0].hand = [1, 1, 1, 1, null, 134]; // 4 Strikes + SiegeBreaker
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
await page.evaluate(() => window.__sensen.pushInput(64)); // SB (slot 5)
await wait(50);
console.log("click SB:", await state());
await wait(3000);
console.log("+1閃: SHOULD have fired (chain reached 3閃 = prereq):", await state());

// Order preservation test
console.log("\n=== ORDER preservation: [S5, SB] reserved ===");
await page.evaluate(() => {
  const g = window.__sensen.getState();
  g.players[0].hand = [1, 1, 1, 1, 1, 134];
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
const SLOT = (i) => 1 << (i + 1);
await page.evaluate((f) => window.__sensen.pushInput(f), SLOT(4)); // S5 first
await wait(50);
await page.evaluate((f) => window.__sensen.pushInput(f), SLOT(5)); // SB second
await wait(50);
console.log("click [S5, SB]:", await state(), "← both wait");
// trigger = max(0, 9 - 3) = 6sec. From 12sec, drain 6sec = 2閃.
await wait(6500); // 2閃 + buffer
console.log("+2閃: atomic fires S5 THEN SB (in order):", await state());

await browser.close();
