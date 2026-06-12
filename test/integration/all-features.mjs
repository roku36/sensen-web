// Visual smoke: gain labels, predict-grid stability, beginner button,
// revealed cards in opp hand, heavy card variety.
import { chromium } from "playwright";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("[ce]", m.text()); });

await page.goto("http://localhost:5173?simple");
await page.waitForFunction(() => window.__sensen != null);
await page.selectOption("select", "passive");
// Enable beginner mode via checkbox
await page.check("input[type='checkbox'] >> nth=1");
await page.click("button:has-text('CPU と対戦')");
await page.waitForTimeout(400);

// Verify initial state: beginner mode means sim is frozen at frame 0.
let s = await page.evaluate(() => ({
  frame: window.__sensen.getState().frame,
  isFrozen: typeof window.__sensen.advance === "function",
}));
console.log("at start:", s);

// Press the "次の閃" advance button
await wait(200);
const btnInfo = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll("button"));
  const adv = all.find((b) => /次の閃/.test(b.textContent ?? ""));
  if (!adv) return { found: false };
  adv.click();
  return { found: true, text: adv.textContent };
});
console.log("advance button:", btnInfo);
await wait(300);

const afterAdvance = await page.evaluate(() => ({
  frame: window.__sensen.getState().frame,
  block: window.__sensen.getState().players[0].block,
}));
console.log("after +1閃 click:", afterAdvance);

await page.screenshot({ path: "/tmp/beginner-mode.png" });
await browser.close();
