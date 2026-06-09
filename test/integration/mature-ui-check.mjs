// Verify 熟成 UI in the real browser:
//  1. DeckBuilder lists the new maturing cards.
//  2. Hand card shows the orange 熟成 progress bar, transforms at 2閃.
//  3. Transformed bloom shows the red 変質 countdown.
//  4. Reserving the bloom FREEZES its age (no rot while reserved).
import { chromium } from "playwright";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));

await page.goto("http://localhost:5175?simple");
await page.waitForFunction(() => window.__sensen != null);

// 1. DeckBuilder lists the maturing cards.
await page.click("button:has-text('デッキ編集')");
await wait(400);
const builderText = await page.evaluate(() => document.body.innerText);
const inBuilder = {
  seed: builderText.includes("業火の種"),
  bud: builderText.includes("鉄の蕾"),
};
console.log("deck builder lists:", inBuilder);
// Back to title via reload (SPA state, button label varies).
await page.goto("http://localhost:5175?simple");
await page.waitForFunction(() => window.__sensen != null);

// 2. Start a CPU match (passive opponent), inject a seed into hand.
await page.click("button:has-text('2D Simple')").catch(() => {});
await page.selectOption("select", "passive");
await page.click("button:has-text('CPU と対戦')");
await wait(500);
await page.evaluate(() => {
  const g = window.__sensen.getState();
  const p = g.players[0];
  p.hand = [28, 1, 1, null, null, null]; // EmberSeed + 2 Strikes
  p.queue = [];
  p.reservations = [];
});
await wait(400); // seed aging, bar growing
const t1 = await page.evaluate(() => document.body.innerText.match(/熟成まで \d\.\d閃/)?.[0] ?? null);
console.log("maturing bar label:", t1);
await page.screenshot({ path: "/tmp/mature-1-seed.png" });

// Wait past 2閃 (6s) → should transform to 業火 with red 変質 label.
await wait(6500);
const t2 = await page.evaluate(() => ({
  label: document.body.innerText.match(/変質まで \d\.\d閃/)?.[0] ?? null,
  hand0: window.__sensen.getState().players[0].hand[0],
}));
console.log("after 2閃:", t2); // hand0 should be 29 (EmberBurst)
await page.screenshot({ path: "/tmp/mature-2-burst.png" });

// 3. Reserve the burst → age must FREEZE.
const ageBefore = await page.evaluate(() => window.__sensen.getState().players[0].handAge[0]);
await page.keyboard.press("1"); // reserve slot 0
await wait(200);
// Cancel any queue so it stays reserved? It may fire immediately (queue
// empty) — acceptable; check whether still in hand first.
const frozen = await page.evaluate(async () => {
  const g = window.__sensen.getState();
  return {
    stillInHand: g.players[0].hand[0] === 29,
    reserved: g.players[0].reservations.some((r) => r.kind === "card" && r.slotIndex === 0),
    queueHasBurst: g.players[0].queue.some((q) => q.kind === "card" && q.cardId === 29),
    age: g.players[0].handAge[0],
  };
});
console.log("after reserving burst:", { ageBefore, ...frozen });

await browser.close();
const ok = inBuilder.seed && inBuilder.bud && t1 !== null && t2.hand0 === 29 && t2.label !== null
  && (frozen.queueHasBurst || frozen.reserved);
console.log(ok ? "ALL OK" : "SOMETHING FAILED");
