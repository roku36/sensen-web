// v9 visual: ghost reservation chips appear in queue area
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

// Click 3 cards left-to-right to fill reservation list (1 fires immediately,
// rest become ghost chips).
await page.keyboard.press("1"); await page.waitForTimeout(120);
await page.keyboard.press("2"); await page.waitForTimeout(120);
await page.keyboard.press("3"); await page.waitForTimeout(300);

const state = await page.evaluate(() => {
  const g = window.__sensen.getState();
  return {
    queue: g.players[0].queue.map((q) => q.kind === "card"
      ? { kind: "card", cardId: q.cardId, dur: q.duration }
      : { kind: "draw", slots: q.drawSlots, dur: q.duration }),
    reservations: g.players[0].reservations,
    hand: g.players[0].hand,
  };
});
console.log("after 3 left-clicks:", JSON.stringify(state, null, 2));

await page.screenshot({ path: "/tmp/v9-ghosts.png" });
console.log("saved /tmp/v9-ghosts.png");

// Now Space to clear
await page.keyboard.press(" ");
await page.waitForTimeout(150);
const cleared = await page.evaluate(() => ({
  reservations: window.__sensen.getState().players[0].reservations,
}));
console.log("after space:", cleared);

await page.screenshot({ path: "/tmp/v9-cleared.png" });
await browser.close();
