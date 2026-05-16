// Visual + behavioral check for deck builder + pile peek modal.

import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push("[err] " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("[ce] " + m.text()); });

await page.goto("http://localhost:5173?simple");
await page.waitForFunction(() => window.__sensen != null);
await page.click("button:has-text('2D Simple')");

// Open the deck builder
await page.click("button:has-text('デッキ編集')");
await page.waitForTimeout(400);
await page.screenshot({ path: "/tmp/deck-1-builder.png" });
console.log("→ /tmp/deck-1-builder.png (deck builder)");

// Verify both columns present
const hasCatalogue = await page.locator("text=カード一覧 (クリックで追加)").count();
const hasCurrent = await page.locator("text=現在のデッキ").count();
console.log(`catalogue column: ${hasCatalogue}, current-deck column: ${hasCurrent}`);

// Save (with default deck) and go back
await page.click("button:has-text('保存')");
await page.waitForTimeout(300);

// Start an offline match and exercise the pile peek
await page.click("button:has-text('Practice (offline)')");
await page.waitForTimeout(600);
// Click the deck pile button (山札)
const pileBtn = page.locator("button[title='クリックで中身を見る']").first();
await pileBtn.click();
await page.waitForTimeout(300);
await page.screenshot({ path: "/tmp/deck-2-peek.png" });
console.log("→ /tmp/deck-2-peek.png (pile peek modal)");

const peekTitle = await page.locator("text=/(自分|相手)の(山札|捨札)/").count();
console.log(`peek modal title visible: ${peekTitle > 0}`);

// Close by clicking the X
await page.click("button:has-text('✕')");
await page.waitForTimeout(200);
const stillVisible = await page.locator("text=/(自分|相手)の(山札|捨札)/").count();
console.log(`after close: peek title visible: ${stillVisible} (should be 0)`);

if (errs.length) { console.log("\nERRORS:"); errs.forEach((e) => console.log("  " + e)); process.exit(1); }
const ok = hasCatalogue > 0 && hasCurrent > 0 && peekTitle > 0 && stillVisible === 0;
console.log(ok ? "\n✓ deck + peek flows work" : "\n✗ broken");
await browser.close();
process.exit(ok ? 0 : 1);
