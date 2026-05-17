// Visually verify the v3 layout:
//   - left info column (相手 + 自分 stacked, vertically aligned with timeline)
//   - fixed 6-slot opponent + self hands (placeholders stay put when cards leave)
//   - wide Draw button under the hand (6-card width)
//   - press Draw → pending slots show countdown
//   - playing a card during the wait does NOT add that slot to the pending fills
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

await page.screenshot({ path: "/tmp/v3-initial.png" });
console.log("saved /tmp/v3-initial.png");

const initial = await page.evaluate(() => {
  const g = window.__sensen.getState();
  return {
    p0Hand: g.players[0].hand,
    p0Pending: g.players[0].pendingDraws,
  };
});
console.log("initial p0:", JSON.stringify(initial, null, 2));

// Play 2 cards to create empty slots
await page.keyboard.press("1"); await page.waitForTimeout(120);
await page.keyboard.press("2"); await page.waitForTimeout(200);

const afterPlay = await page.evaluate(() => {
  const g = window.__sensen.getState();
  return { hand: g.players[0].hand, pending: g.players[0].pendingDraws };
});
console.log("after 2 plays:", JSON.stringify(afterPlay, null, 2));

await page.screenshot({ path: "/tmp/v3-played.png" });

// Press Draw → schedules pending refills for all empty slots
await page.keyboard.press("d");
await page.waitForTimeout(200);

const afterDraw = await page.evaluate(() => {
  const g = window.__sensen.getState();
  return {
    hand: g.players[0].hand,
    pending: g.players[0].pendingDraws,
    nowSec: g.frame / 60,
  };
});
console.log("after Draw press:", JSON.stringify(afterDraw, null, 2));

await page.screenshot({ path: "/tmp/v3-drawing.png" });
console.log("saved /tmp/v3-drawing.png");

// During wait, play another card from a different slot — that slot should NOT
// get added to pending.
await page.keyboard.press("3");
await page.waitForTimeout(200);
const duringWait = await page.evaluate(() => {
  const g = window.__sensen.getState();
  return {
    hand: g.players[0].hand,
    pending: g.players[0].pendingDraws,
    nowSec: g.frame / 60,
  };
});
console.log("during wait, played slot 3:", JSON.stringify(duringWait, null, 2));

// Wait for all pending to fill (max pending fillsAt - now).
await wait(3000);
const afterFills = await page.evaluate(() => {
  const g = window.__sensen.getState();
  return { hand: g.players[0].hand, pending: g.players[0].pendingDraws };
});
console.log("after fills:", JSON.stringify(afterFills, null, 2));

await page.screenshot({ path: "/tmp/v3-filled.png" });
await browser.close();
