// Verify block prediction includes step-decay AFTER predicted gains.
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
await page.waitForTimeout(400);

// Queue a defense card if available so we can see future block gain + decay.
const handDump = await page.evaluate(() => {
  const g = window.__sensen.getState();
  return {
    hand: g.players[0].hand,
    queue: g.players[0].queue,
    p1block: g.players[1].block,
  };
});
console.log("initial hand:", JSON.stringify(handDump, null, 2));

// Try pressing each key to find a defense card
for (let i = 1; i <= 5; i++) {
  await page.keyboard.press(`${i}`);
  await page.waitForTimeout(150);
}
await wait(500);

const finalQueue = await page.evaluate(() => {
  const g = window.__sensen.getState();
  return {
    queue: g.players[0].queue.map((q) => ({
      kind: q.kind,
      cardId: q.cardId,
      slots: q.drawSlots,
      dur: q.duration,
    })),
    block: g.players[0].block,
    castStartedAt: g.players[0].castStartedAt,
    nextDecay: g.players[0].nextBlockDecayAt,
    nowSec: g.frame / 60,
  };
});
console.log("after queuing 5:", JSON.stringify(finalQueue, null, 2));

await page.screenshot({ path: "/tmp/v6-block-decay.png" });
console.log("saved /tmp/v6-block-decay.png");
await browser.close();
