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

const state = async () => page.evaluate(() => {
  const g = window.__sensen.getState();
  const p = g.players[0];
  let remSec = 0;
  if (p.queue.length > 0) {
    remSec = Math.max(0, p.queue[0].duration - (g.frame/60 - p.castStartedAt));
    for (let i = 1; i < p.queue.length; i++) remSec += p.queue[i].duration;
  }
  return {
    chain: Math.ceil(remSec / 3) + "閃",
    q: p.queue.map(q => q.kind==="card" ? `c${q.cardId}` : "D").join(","),
    r: p.reservations.map(r => r.kind==="card" ? `S${r.slotIndex}:${p.hand[r.slotIndex]}` : "D").join(","),
  };
});

// ============================================================================
// USER's spec scenario: [S, S, S, B(prereq=2閃)] with chain=Sa(1閃)
// Expected:
//   Sa drain (1閃) → S2 fires ALONE → queue=[S2]
//   S2 drain (2閃) → ATOMIC: S3, S4, B all fire → queue=[S3, S4, B]
//   Then queue plays out S3, S4, B sequentially.
// ============================================================================
console.log("=== USER's SPEC: [S, S, S, B(prereq=2閃)] with chain=Sa(1閃) ===");
await page.evaluate(() => {
  const g = window.__sensen.getState();
  g.players[0].hand = [1, 1, 1, 1, 1, 23]; // Strikes + Bludgeon
  g.players[0].queue = [
    { kind: "card", cardId: 1, duration: 3, blockApplied: true }, // Sa, fresh
  ];
  g.players[0].castStartedAt = g.frame / 60;
  g.players[0].reservations = [];
});
await wait(100);
console.log("init:", await state());

const SLOT = (i) => 1 << (i + 1);
await page.evaluate((f) => window.__sensen.pushInput(f), SLOT(0)); await wait(50);
await page.evaluate((f) => window.__sensen.pushInput(f), SLOT(1)); await wait(50);
await page.evaluate((f) => window.__sensen.pushInput(f), SLOT(2)); await wait(50);
await page.evaluate((f) => window.__sensen.pushInput(f), SLOT(5)); await wait(50);
console.log("after [S,S,S,B] clicks:", await state(), "← all 4 in reservation, queue unchanged");

await wait(3000); // 1閃 → Sa drain
console.log("+1閃 (Sa drained, S2 alone):", await state(), "← queue=[S2]");

await wait(3000); // 2閃 → S2 drain
console.log("+2閃 (S2 drained, ATOMIC S3+S4+B):", await state(), "← queue=[S3, S4, B]");

await browser.close();
