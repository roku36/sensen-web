// Verify the post-match panel appears and the rematch button starts a new
// game without bouncing through the title screen.

import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push("[err] " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("[ce] " + m.text()); });

await page.goto("http://localhost:5173?simple");
await page.waitForFunction(() => window.__sensen != null);
await page.click("button:has-text('2D Simple')");
await page.click("button:has-text('Practice (offline)')");
await page.waitForTimeout(500);

const beforeFrame = await page.evaluate(() => window.__sensen.getState()?.frame);
console.log(`match started, frame=${beforeFrame}`);

// Force opponent to 0 HP — sim will detect death next tick.
await page.evaluate(() => window.__sensen.forceVictory());
await page.waitForTimeout(300);

const result = await page.evaluate(() => window.__sensen.getState()?.result);
console.log(`game result after kill: ${result}`);
await page.screenshot({ path: "/tmp/sensen-result.png" });
console.log("→ /tmp/sensen-result.png");

const panelVisible = await page.locator("text=勝利").count();
console.log(`'勝利' label present: ${panelVisible > 0}`);
const rematchBtn = await page.locator("button:has-text('もう一度')").count();
console.log(`rematch button present: ${rematchBtn > 0}`);

// Click the offline rematch button.
await page.click("button:has-text('もう一度')");
await page.waitForTimeout(500);

const afterFrame = await page.evaluate(() => window.__sensen.getState()?.frame);
const afterResult = await page.evaluate(() => window.__sensen.getState()?.result);
const afterHp = await page.evaluate(() => window.__sensen.getState()?.players[1].hp);
console.log(`after rematch: frame=${afterFrame} result=${afterResult} oppHp=${afterHp}`);

if (afterFrame >= beforeFrame) {
  // It should reset close to 0.
  console.log(`✗ frame did not reset (was ${beforeFrame}, after ${afterFrame})`);
}
if (afterResult !== 0) console.log(`✗ result not cleared: ${afterResult}`);
if (afterHp !== 80) console.log(`✗ opp HP not restored: ${afterHp}`);

if (errs.length) { console.log("\nERRORS:"); errs.forEach((e) => console.log("  " + e)); process.exit(1); }
const ok = afterFrame < 60 && afterResult === 0 && afterHp === 80 && panelVisible > 0 && rematchBtn > 0;
console.log(ok ? "\n✓ rematch flow works" : "\n✗ rematch flow broken");
await browser.close();
process.exit(ok ? 0 : 1);
