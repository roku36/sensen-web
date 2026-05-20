// v8 visual smoke test: poison area, pierce marks, multi-reservation
//   - Queue Defend → block immediate (cast-start)
//   - Right-click 2 cards in order → numbered badges 1, 2
//   - Press space → manual reservations cleared
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

await page.screenshot({ path: "/tmp/v8-initial.png" });

// Right-click multiple cards (slots 0..2) to set up reservation list.
const slots = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll("button"));
  return all.filter((b) => /^\d閃/.test(b.textContent ?? "")).slice(0, 3).map((b) => ({
    text: b.textContent?.slice(0, 30),
    rect: b.getBoundingClientRect(),
  }));
});
console.log("found playable cards:", slots);

for (const s of slots) {
  if (!s.rect) continue;
  const x = s.rect.x + 20;
  const y = s.rect.y + 20;
  await page.mouse.click(x, y, { button: "right" });
  await page.waitForTimeout(120);
}

await page.waitForTimeout(300);
const afterReserve = await page.evaluate(() => {
  const g = window.__sensen.getState();
  return {
    reservations: g.players[0].reservations,
  };
});
console.log("after right-click reserve x3:", afterReserve);

await page.screenshot({ path: "/tmp/v8-reserved.png" });

// Press space — should clear manual reservations.
await page.keyboard.press(" ");
await page.waitForTimeout(120);
const afterSpace = await page.evaluate(() => {
  const g = window.__sensen.getState();
  return { reservations: g.players[0].reservations };
});
console.log("after space:", afterSpace);

await page.screenshot({ path: "/tmp/v8-cleared.png" });
await browser.close();
