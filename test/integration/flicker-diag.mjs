// Diagnose flicker: compare multiple consecutive screenshots to identify
// what's actually changing frame to frame.
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
await page.waitForTimeout(800);

// Queue a Defend so we have predicted block to display.
await page.keyboard.press("1"); await page.waitForTimeout(80);
await page.keyboard.press("2"); await page.waitForTimeout(80);
await page.waitForTimeout(1000); // let some predicted future stabilize

// Grab the prediction samples + capture screenshot at frame F
const cap = async (label) => {
  const data = await page.evaluate(() => {
    const g = window.__sensen.getState();
    return {
      frame: g.frame,
      p0Block: g.players[0].block,
      p1Block: g.players[1].block,
    };
  });
  await page.screenshot({ path: `/tmp/flicker-${label}.png` });
  return data;
};

const a = await cap("a"); await wait(50);
const b = await cap("b"); await wait(50);
const c = await cap("c"); await wait(50);
const d = await cap("d");

console.log("a:", a, "b:", b, "c:", c, "d:", d);
console.log("Inspect /tmp/flicker-{a,b,c,d}.png — block trajectory should scroll smoothly LEFT.");
await browser.close();
