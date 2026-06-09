// E2E: lab pair comparison — run lv3 vs lv2 (100 matches) and check the
// pair stats line renders with a win rate.
import { chromium } from "playwright";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));

await page.goto("http://localhost:5175?simple");
await page.waitForFunction(() => window.__sensen != null);
await page.click("button:has-text('AI 検証ラボ')");
await page.waitForSelector("text=ペア比較");

// Select lv3 vs lv2 and run.
const selects = page.locator("select");
await selects.nth(0).selectOption("lv3");
await selects.nth(1).selectOption("lv2");
await page.locator("button:has-text('100戦実行')").last().click();
await page.waitForFunction(
  () => /lv3 視点 · \d+勝 \d+敗 \d+分 \/ \d+戦/.test(document.body.innerText),
  null, { timeout: 180_000 },
);
const stats = await page.evaluate(() =>
  document.body.innerText.match(/(\d+\.\d)%\s*lv3 視点 · (\d+)勝 (\d+)敗 (\d+)分 \/ (\d+)戦/)?.slice(1) ?? null);
console.log("lv3 vs lv2 pair:", stats);
await page.screenshot({ path: "/tmp/lab-pair.png" });
await browser.close();
console.log(stats && stats[4] === "100" ? "ALL OK" : "SOMETHING FAILED");
