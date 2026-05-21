// Verify: left-click toggles, forced reservation auto-appends to manual list.
import { chromium } from "playwright";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("[ce]", m.text()); });

await page.goto("http://localhost:5173?simple");
await page.waitForFunction(() => window.__sensen != null);
await page.click("button:has-text('2D Simple')");
await page.selectOption("select", "passive");
await page.click("button:has-text('CPU と対戦')");
await page.waitForTimeout(500);

// At frame 0 the forced default auto-appended a draw reservation.
const t0 = await page.evaluate(() => ({
  reservations: window.__sensen.getState().players[0].reservations,
}));
console.log("frame 0 (forced default auto-appended):", JSON.stringify(t0));

// Click 3 cards → 3 reservations appended after the draw.
await page.keyboard.press("1"); await page.waitForTimeout(80);
await page.keyboard.press("2"); await page.waitForTimeout(80);
await page.keyboard.press("3"); await page.waitForTimeout(150);
const t1 = await page.evaluate(() => ({
  reservations: window.__sensen.getState().players[0].reservations,
}));
console.log("after 3 left-clicks:", JSON.stringify(t1));

// LEFT-click slot 1 again → should TOGGLE (cascade-release from #2).
await page.keyboard.press("2"); await page.waitForTimeout(150);
const t2 = await page.evaluate(() => ({
  reservations: window.__sensen.getState().players[0].reservations,
}));
console.log("after left-click slot 1 (toggle):", JSON.stringify(t2));

await page.screenshot({ path: "/tmp/cancel-verified.png" });
await browser.close();
