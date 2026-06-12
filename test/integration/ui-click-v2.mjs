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

// Force a clean hand with Bludgeon at slot 2.
await page.evaluate(() => {
  const g = window.__sensen.getState();
  g.players[0].hand = [1, 1, 23, 1, 1, 1];
  g.players[0].queue = [];
  g.players[0].reservations = [];
});
await wait(150);

// Identify hand buttons by their bounding box (y > 500) and sort by X.
const allButtons = await page.locator('button').all();
const handBtns = [];
for (const b of allButtons) {
  const box = await b.boundingBox();
  const text = (await b.textContent()) || "";
  if (box && box.y > 500 && box.y < 800 && text.includes("閃") && !text.includes("ドロー")) {
    handBtns.push({ x: box.x, y: box.y, w: box.width, text: text.slice(0, 40), btn: b });
  }
}
handBtns.sort((a,b) => a.x - b.x);
console.log("hand buttons:");
handBtns.forEach((b, i) => console.log(`  [${i}] x=${b.x} y=${b.y} w=${b.w} : ${b.text}`));

const state = async () => page.evaluate(() => {
  const g = window.__sensen.getState();
  const p = g.players[0];
  return {
    q: p.queue.map(q => q.kind==="card" ? `c${q.cardId}` : `D${q.drawSlots?.length}`).join(","),
    r: p.reservations.map(r => r.kind==="card" ? `c${r.slotIndex}:${p.hand[r.slotIndex]}` : "D").join(","),
    h: p.hand.join(","),
  };
});

// Click via centroid + force.
const clickAt = async (b) => {
  const cx = b.x + b.w/2, cy = b.y + 80;  // upper portion of card, away from cost text
  await page.mouse.click(cx, cy);
};

console.log("before:", await state());
await clickAt(handBtns[0]); await wait(80);
console.log("after click[0]:", await state());
await clickAt(handBtns[1]); await wait(80);
console.log("after click[1]:", await state());
await clickAt(handBtns[2]); await wait(80);
console.log("after click[2] (Bludgeon):", await state());

await page.screenshot({ path: "/tmp/ui-click-v2.png" });
await browser.close();
