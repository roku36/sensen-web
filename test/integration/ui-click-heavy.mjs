import { chromium } from "playwright";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));

await page.goto("http://localhost:5173?simple");
await page.waitForFunction(() => window.__sensen != null);
await page.selectOption("select", "passive");
await page.click("button:has-text('CPU と対戦')");
await wait(400);

// Force hand: [Strike, Strike, Bludgeon, Strike, Strike, null]
await page.evaluate(() => {
  const g = window.__sensen.getState();
  g.players[0].hand = [1, 1, 23, 1, 1, null];
  g.players[0].queue = [];
  g.players[0].reservations = [];
});
await wait(150);

const state = async () => page.evaluate(() => {
  const g = window.__sensen.getState();
  const p = g.players[0];
  return {
    q: p.queue.map(q => q.kind==="card" ? `c${q.cardId}` : `D${q.drawSlots?.length}`).join(","),
    r: p.reservations.map(r => r.kind==="card" ? `c${r.slotIndex}:${p.hand[r.slotIndex]}` : "D").join(","),
    h: p.hand.join(","),
  };
});

console.log("init:", await state());

// Get the 5 hand card buttons (self hand).
const handCards = await page.$$('button[style*="card"]');
console.log(`found ${handCards.length} card buttons`);

// Actually find them by hand row - cards have specific structure.
// Look for buttons that contain "閃" (cost label).
const cardButtons = await page.locator('button').filter({ hasText: /^[0-9]閃/ }).all();
// hand buttons are in the BOTTOM area
const buttonInfo = [];
for (const btn of cardButtons) {
  const box = await btn.boundingBox();
  const text = await btn.textContent();
  if (box && box.y > 500) {
    buttonInfo.push({ y: box.y, x: box.x, text: text.slice(0, 30), btn });
  }
}
buttonInfo.sort((a,b) => a.x - b.x);
console.log("self hand:", buttonInfo.map(b => b.text));

// Click Slot 0 (Strike), Slot 1 (Strike), then Slot 2 (Bludgeon).
const isDisabled = async (btn) => btn.evaluate(b => b.disabled || b.getAttribute("aria-disabled") === "true");

for (let i = 0; i < 3; i++) {
  const btn = buttonInfo[i].btn;
  console.log(`slot ${i} disabled? ${await isDisabled(btn)}`);
  await btn.click();
  await wait(80);
  console.log(`after click slot ${i}:`, await state());
}

await page.screenshot({ path: "/tmp/ui-click.png" });
await browser.close();
