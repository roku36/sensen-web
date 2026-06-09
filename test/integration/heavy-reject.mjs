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
await wait(500);

await page.evaluate(() => {
  const g = window.__sensen.getState();
  // Hand: [Strike, Strike, Bludgeon, Strike, null, null]
  g.players[0].hand = [1, 1, 23, 1, null, null];
  g.players[0].queue = [];
  g.players[0].reservations = [];
});
await wait(150);

const log = async (label) => {
  const s = await page.evaluate(() => {
    const g = window.__sensen.getState();
    const p = g.players[0];
    return {
      f: g.frame,
      q: p.queue.map((q) => q.kind === "card" ? `c${q.cardId}` : `D${q.drawSlots?.length}`).join(","),
      r: p.reservations.map((r) => r.kind === "card" ? `c${r.slotIndex}:${p.hand[r.slotIndex]}` : "D").join(","),
      h: p.hand.join(","),
    };
  });
  console.log(label, JSON.stringify(s));
};

await log("init");

// Just click Bludgeon (slot 2) without any setup — should be REJECTED.
const SLOT = (i) => 1 << (i + 1);
await page.evaluate((f) => window.__sensen.pushInput(f), SLOT(2));
await wait(50); await log("click Bludgeon only");

// Now click 2 Strikes then Bludgeon — should fire all 3.
await page.evaluate((f) => window.__sensen.pushInput(f), SLOT(0));
await wait(50); await log("click S0");
await page.evaluate((f) => window.__sensen.pushInput(f), SLOT(1));
await wait(50); await log("click S1");
await page.evaluate((f) => window.__sensen.pushInput(f), SLOT(2));
await wait(50); await log("click Bludgeon (with stack)");

await browser.close();
