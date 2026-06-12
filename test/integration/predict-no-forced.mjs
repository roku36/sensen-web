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

// Hand of Strikes only. After current Strike drains, sim would auto-fire
// leftmost — but predict should NOT include that.
await page.evaluate(() => {
  const g = window.__sensen.getState();
  g.players[0].hand = [1, 1, 1, 1, 1, 1];
  g.players[0].queue = [];
  g.players[0].reservations = [];
});
await wait(150);

// Take a screenshot. The opp side: AI is passive so opp has no plan; the
// graph for opp should be FLAT after current queue drains (no auto-fires
// projected). Self side: only the auto-fired Strike's effect should appear,
// nothing beyond.
await page.screenshot({ path: "/tmp/predict-clean.png" });
console.log("captured /tmp/predict-clean.png");

await browser.close();
