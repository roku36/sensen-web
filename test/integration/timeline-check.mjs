// Verify v4 layout:
//   - Draw becomes a queue entry (visible as a blue chip in the queue)
//   - Pressing Draw queues an N-second entry; pending slots show countdown
//   - Block band in the middle of the timeline with predicted trajectory
//   - Defense card queued → block bumps UP at its resolve time (predicted)
//   - Attack queued against us → block drops at its resolve time (predicted)
import { chromium } from "playwright";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("[ce]", m.text()); });

await page.goto("http://localhost:5173?simple");
await page.waitForFunction(() => window.__sensen != null);
await page.click("button:has-text('2D Simple')");
await page.selectOption("select", "passive");
await page.click("button:has-text('CPU と対戦')");
await page.waitForTimeout(500);

await page.screenshot({ path: "/tmp/v4-initial.png" });

// Play 2 cards to create empty slots.
await page.keyboard.press("1"); await page.waitForTimeout(120);
await page.keyboard.press("2"); await page.waitForTimeout(200);

// Press Draw — should append a queue entry of N seconds (3 empties → 3s).
await page.keyboard.press("d"); await page.waitForTimeout(300);

const afterDraw = await page.evaluate(() => {
  const g = window.__sensen.getState();
  return {
    hand: g.players[0].hand,
    queue: g.players[0].queue.map((q) => q.kind === "draw"
      ? { kind: "draw", duration: q.duration, slots: q.drawSlots, filled: q.drawFilledCount }
      : { kind: "card", cardId: q.cardId, duration: q.duration }),
    block: g.players[0].block,
    nowSec: g.frame / 60,
  };
});
console.log("after Draw press:", JSON.stringify(afterDraw, null, 2));

await page.screenshot({ path: "/tmp/v4-draw-queued.png" });

// Wait so the queue chips visibly progress + first slot fills.
await wait(2500);
const mid = await page.evaluate(() => {
  const g = window.__sensen.getState();
  return {
    hand: g.players[0].hand,
    queueLen: g.players[0].queue.length,
    drawEntry: g.players[0].queue.find((q) => q.kind === "draw"),
  };
});
console.log("mid-draw (2.5s in):", JSON.stringify(mid, null, 2));
await page.screenshot({ path: "/tmp/v4-draw-progress.png" });

// Wait for full completion
await wait(1500);
const after = await page.evaluate(() => {
  const g = window.__sensen.getState();
  return { hand: g.players[0].hand, queueLen: g.players[0].queue.length };
});
console.log("after full draw:", JSON.stringify(after, null, 2));
await page.screenshot({ path: "/tmp/v4-draw-done.png" });

await browser.close();
