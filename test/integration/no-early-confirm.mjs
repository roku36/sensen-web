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
  let rem = 0;
  if (p.queue.length > 0) {
    rem = Math.max(0, p.queue[0].duration - (g.frame/60 - p.castStartedAt));
    for (let i = 1; i < p.queue.length; i++) rem += p.queue[i].duration;
  }
  return {
    chain: (rem/3).toFixed(2) + "閃",
    q: p.queue.map(q => q.kind==="card" ? `c${q.cardId}` : "D").join(","),
    r: p.reservations.map(r => r.kind==="card" ? `S${r.slotIndex}:${p.hand[r.slotIndex]}` : "D").join(","),
  };
});

// CRITICAL TEST: chain=4閃 in queue, reserve [S, S, B(prereq=2閃)].
// Bug to verify: clicking B should NOT confirm S, S immediately.
console.log("=== chain 4閃 + reserve [S, S, B(prereq=2閃)] ===");
await page.evaluate(() => {
  const g = window.__sensen.getState();
  g.players[0].hand = [1, 1, 1, 1, 1, 23]; // 5 Strikes + Bludgeon
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
await page.evaluate((f) => window.__sensen.pushInput(f), SLOT(0)); // S0
await wait(50);
console.log("after S0 click:", await state(), "← S0 should be in reservation, queue unchanged");

await page.evaluate((f) => window.__sensen.pushInput(f), SLOT(1)); // S1
await wait(50);
console.log("after S1 click:", await state());

await page.evaluate((f) => window.__sensen.pushInput(f), SLOT(5)); // Bludgeon (prereq=2閃)
await wait(50);
console.log("after B click:", await state(), "← CRITICAL: queue MUST be unchanged (4 strikes), reservation=[S0, S1, B]");

// Drain. trigger = max(0, 6 - 6) = 0. Wait until chain = 0 (4閃 drain).
console.log("\n-- waiting for chain to drain --");
for (let i = 1; i <= 5; i++) {
  await wait(1000);
  console.log(`+${i}s:`, await state());
}

await browser.close();
