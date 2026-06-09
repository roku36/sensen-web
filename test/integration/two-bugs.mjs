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
  return {
    q: p.queue.map(q => q.kind==="card" ? `c${q.cardId}` : `D${q.drawSlots?.length}`).join(","),
    r: p.reservations.map(r => r.kind==="card" ? `S${r.slotIndex}` : "D").join(","),
  };
});

// === Bug 2 (just-in-time): reserve 4 strikes (1 fires, 3 sit) + Bludgeon ===
console.log("\n=== Bug 2: just-in-time eager-fire ===");
await page.evaluate(() => {
  const g = window.__sensen.getState();
  g.players[0].hand = [1, 1, 1, 1, 23, 1];  // Strike×4, Bludgeon, Strike
  g.players[0].queue = [];
  g.players[0].reservations = [];
});
await wait(150);
console.log("init (auto-fire happens):", await state());

// Click 3 strikes to add reservations.
const SLOT = (i) => 1 << (i + 1);
for (let i = 1; i <= 3; i++) {
  await page.evaluate((f) => window.__sensen.pushInput(f), SLOT(i));
  await wait(50);
}
console.log("after 3 strike clicks:", await state());

// Click Bludgeon (slot 4).
await page.evaluate((f) => window.__sensen.pushInput(f), SLOT(4));
await wait(50);
console.log("after Bludgeon click:", await state(),
  "← only 1 strike should be added to queue (just-in-time), rest stay reserved");

// === Bug 1: Draw button clickable while drawing ===
console.log("\n=== Bug 1: Draw while drawing ===");
await page.evaluate(() => {
  const g = window.__sensen.getState();
  g.players[0].hand = [null, null, null, 1, 1, 1];  // 3 empties for drawing
  g.players[0].queue = [];
  g.players[0].reservations = [];
});
await wait(150);
console.log("init:", await state());

// Click Draw button (D key).
await page.keyboard.press("d");
await wait(80);
console.log("after Draw key (1st):", await state());

await page.keyboard.press("d");
await wait(80);
console.log("after Draw key (2nd while drawing):", await state(),
  "← should add a SECOND Draw to reservations");

await browser.close();
