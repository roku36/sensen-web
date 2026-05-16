import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push("[err] " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("[console.error] " + m.text()); });

await page.goto("http://localhost:5173?simple");
await page.waitForFunction(() => window.__sensen != null);
await page.click("button:has-text('2D Simple')").catch(() => {});
await page.click("button:has-text('Practice (offline)')");
await page.waitForTimeout(800);
await page.screenshot({ path: "/tmp/sensen-simple-1.png" });

// Press 1, 2, draw a few times
await page.keyboard.press("1");
await page.waitForTimeout(300);
await page.keyboard.press("1"); // combo
await page.waitForTimeout(300);
await page.keyboard.press("d");
await page.waitForTimeout(800);
await page.keyboard.press("2");
await page.waitForTimeout(800);
await page.screenshot({ path: "/tmp/sensen-simple-2.png" });

const state = await page.evaluate(() => window.__sensen.getState());
console.log("game state:", {
  frame: state.frame,
  p0: { hp: state.players[0].hp, cost: state.players[0].cost.toFixed(2), block: state.players[0].block.toFixed(2), hand: state.players[0].hand.length, lastCard: state.players[0].lastPlayedCard },
  p1: { hp: state.players[1].hp, cost: state.players[1].cost.toFixed(2), block: state.players[1].block.toFixed(2), hand: state.players[1].hand.length },
});

if (errs.length) { console.log("\nERRORS:"); errs.forEach((e) => console.log("  " + e)); process.exit(1); }
console.log("\n✓ no errors, screenshots: /tmp/sensen-simple-1.png /tmp/sensen-simple-2.png");
await browser.close();
