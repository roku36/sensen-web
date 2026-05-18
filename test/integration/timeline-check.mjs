// v7: verify past block area is STABLE (uses blockHistory, not current value).
//   - Queue defends, take screenshot
//   - Wait, queue MORE defends, take another screenshot
//   - The PAST portion of the block trajectory should look identical in both
//     (only the future portion differs).
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
await page.waitForTimeout(400);

// Press a couple of cards to seed activity
await page.keyboard.press("1"); await page.waitForTimeout(150);
await page.keyboard.press("2"); await page.waitForTimeout(150);

// Wait for some history to accumulate
await wait(4000);
await page.screenshot({ path: "/tmp/v7-a.png" });

// Queue more activity to alter the future
await page.keyboard.press("3"); await page.waitForTimeout(100);
await page.keyboard.press("4"); await page.waitForTimeout(100);
await page.keyboard.press("5"); await page.waitForTimeout(300);

await page.screenshot({ path: "/tmp/v7-b.png" });

const debug = await page.evaluate(() => {
  const g = window.__sensen.getState();
  return {
    p0Block: g.players[0].block,
    p1Block: g.players[1].block,
    p0History: g.players[0].blockHistory,
    p1History: g.players[1].blockHistory,
    nowSec: g.frame / 60,
  };
});
console.log("debug:", JSON.stringify(debug, null, 2));

await browser.close();
