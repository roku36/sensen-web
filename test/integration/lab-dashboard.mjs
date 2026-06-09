// E2E: AI lab dashboard — run 100 headless matches (lv2 vs lv1), check the
// win rate renders, jump into the ReplayViewer from a match row, and verify
// persistence across reload.
import { chromium } from "playwright";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));

await page.goto("http://localhost:5175?simple");
await page.waitForFunction(() => window.__sensen != null);
await page.click("button:has-text('AI 検証ラボ')");
await page.waitForSelector("text=AI 検証ラボ");

// Run 100 matches for lv2 (fast level).
await page.locator("button:has-text('100戦実行')").nth(1).click();
await wait(500);
await page.screenshot({ path: "/tmp/lab-running.png" });
await page.waitForFunction(() => {
  const t = document.body.innerText;
  return /\d+勝 \d+敗 \d+分 \/ \d+戦/.test(t);
}, null, { timeout: 180_000 });
const stats = await page.evaluate(() => {
  const m = document.body.innerText.match(/(\d+\.\d)%\s*(\d+)勝 (\d+)敗 (\d+)分 \/ (\d+)戦/);
  return m ? { rate: m[1], w: m[2], l: m[3], d: m[4], n: m[5] } : null;
});
console.log("lv2 vs lv1 (100 matches):", stats);
await page.screenshot({ path: "/tmp/lab-dashboard.png" });

// Jump into the replay viewer from the first match row.
await page.locator("button:has-text('リプレイを見る')").first().click();
await wait(800);
const inReplay = await page.evaluate(() => ({
  screen: window.__sensen.getScreen(),
  hasGame: window.__sensen.getState() != null,
}));
console.log("replay viewer:", inReplay);
await page.screenshot({ path: "/tmp/lab-replay.png" });

// Persistence: reload, reopen lab, history must survive.
await page.goto("http://localhost:5175?simple");
await page.waitForFunction(() => window.__sensen != null);
await page.click("button:has-text('AI 検証ラボ')");
await wait(300);
const persisted = await page.evaluate(() => {
  const m = document.body.innerText.match(/リプレイ保存 (\d+) 件/);
  return m ? Number(m[1]) : 0;
});
console.log("persisted matches after reload:", persisted);

await browser.close();
const ok = stats && Number(stats.n) === 100 && inReplay.screen === "replay" && inReplay.hasGame && persisted >= 100;
console.log(ok ? "ALL OK" : "SOMETHING FAILED");
