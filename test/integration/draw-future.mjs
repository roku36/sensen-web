import { chromium } from "playwright";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));

await page.goto("http://localhost:5173?simple");
await page.waitForFunction(() => window.__sensen != null);
await page.click("button:has-text('2D Simple')");
await page.selectOption("select", "passive");
await page.click("button:has-text('CPU と対戦')");
await wait(400);

// Force a clean hand of 6 strikes (no Bludgeon).
await page.evaluate(() => {
  const g = window.__sensen.getState();
  g.players[0].hand = [1, 1, 1, 1, 1, 1];
  g.players[0].queue = [];
  g.players[0].reservations = [];
});
await wait(150);

const drawBtnText = async () => {
  const btn = await page.locator('button:has-text("ドロー")').first();
  return (await btn.textContent()).trim().replace(/\s+/g, " ");
};

const state = async () => page.evaluate(() => {
  const g = window.__sensen.getState();
  const p = g.players[0];
  return {
    q: p.queue.map(q => q.kind==="card" ? `c${q.cardId}` : `D${q.drawSlots?.length}(filled=${q.drawFilledCount})`).join(","),
    r: p.reservations.map(r => r.kind==="card" ? `c${r.slotIndex}:${p.hand[r.slotIndex]}` : "Draw").join(","),
  };
});

console.log("init:", await state(), "/ drawBtn:", await drawBtnText());

// Click slots 0, 1, 2 (Strikes). They should sit in reservations (no eager-fire, no heavy ahead).
const SLOT = (i) => 1 << (i + 1);
await page.evaluate((f) => window.__sensen.pushInput(f), SLOT(0));
await wait(80);
await page.evaluate((f) => window.__sensen.pushInput(f), SLOT(1));
await wait(80);
await page.evaluate((f) => window.__sensen.pushInput(f), SLOT(2));
await wait(80);
console.log("after 3 clicks:", await state(), "/ drawBtn:", await drawBtnText());

// Now click the Draw button — should reserve a 3-card Draw (because 3 slots will free).
await page.locator('button:has-text("ドロー")').first().click();
await wait(80);
console.log("after Draw click:", await state(), "/ drawBtn:", await drawBtnText());

await page.screenshot({ path: "/tmp/draw-future.png" });
await browser.close();
