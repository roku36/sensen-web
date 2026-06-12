// Verify Japanese names render and hover tooltip appears.
import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push("[err] " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("[ce] " + m.text()); });

await page.goto("http://localhost:5173?simple");
await page.waitForFunction(() => window.__sensen != null);
await page.click("button:has-text('Practice (offline)')");
await page.waitForTimeout(800);

await page.screenshot({ path: "/tmp/sensen-jp-1.png" });
console.log("→ /tmp/sensen-jp-1.png (initial)");

// Hover over the first card to trigger the tooltip.
const firstCard = page.locator("button:has-text('打撃'), button:has-text('防御'), button:has-text('鉄の波動')").first();
const has = await firstCard.count();
if (has > 0) {
  await firstCard.hover();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/sensen-jp-2.png" });
  console.log("→ /tmp/sensen-jp-2.png (with tooltip)");
}

// Press a key to play a card and check bar updates frame-by-frame.
const baseHp = await page.evaluate(() => window.__sensen.getState()?.players[1].hp);
await page.keyboard.press("1");
await page.waitForTimeout(300);
const newHp = await page.evaluate(() => window.__sensen.getState()?.players[1].hp);
console.log(`opponent HP: ${baseHp} → ${newHp} (Δ=${(baseHp - newHp).toFixed(2)})`);

if (errs.length) { console.log("\nERRORS:"); errs.forEach((e) => console.log("  " + e)); process.exit(1); }
console.log("\n✓ no errors");
await browser.close();
