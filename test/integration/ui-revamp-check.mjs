// Visual check for UI improvements:
//   - opponent's hand visible as face-down backs
//   - block values in a centered "battle zone" between hands
//   - unplayable cards show a rising water fill
//   - draw is a separate button (not in the hand row)

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
await page.waitForTimeout(400);
await page.screenshot({ path: "/tmp/ui-1-fresh.png", fullPage: false });
console.log("→ /tmp/ui-1-fresh.png (initial)");

// Wait a few seconds for energy to accumulate so card fills are mid-rise.
await page.waitForTimeout(2500);
await page.screenshot({ path: "/tmp/ui-2-filling.png", fullPage: false });
console.log("→ /tmp/ui-2-filling.png (energy partially filled)");

// Play a card to put something into the block area.
// Find a defend card by label and click — but easier: press "1" or "2".
await page.keyboard.press("1");
await page.waitForTimeout(300);
await page.keyboard.press("2");
await page.waitForTimeout(300);
await page.screenshot({ path: "/tmp/ui-3-after-plays.png", fullPage: false });
console.log("→ /tmp/ui-3-after-plays.png (after card plays)");

// Check Draw is its own button (not in hand row): the hand row should not
// contain a "ドロー" label.
const drawInHand = await page.locator(".__nope, button:has-text('ドロー')").count();
const blockZone = await page.locator("text=/(自分|相手)のブロック/").count();
const oppBacks = await page.evaluate(() => {
  const divs = Array.from(document.querySelectorAll("div"));
  return divs.filter((e) => {
    const cs = getComputedStyle(e);
    return cs.background && cs.background.includes("linear-gradient") && e.offsetWidth === 50;
  }).length;
});

console.log(`draw buttons (anywhere): ${drawInHand}`);
console.log(`block-zone labels visible: ${blockZone}`);
console.log(`opponent card-backs detected (≈50px-wide): ${oppBacks}`);

if (errs.length) { console.log("\nERRORS:"); errs.forEach((e) => console.log("  " + e)); }
const ok = drawInHand >= 1 && blockZone >= 2 && oppBacks >= 3;
console.log(ok ? "\n✓ UI elements present" : "\n✗ something missing");
await browser.close();
process.exit(ok ? 0 : 1);
