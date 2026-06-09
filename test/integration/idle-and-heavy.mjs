import { chromium } from "playwright";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));

await page.goto("http://localhost:5173?simple");
await page.waitForFunction(() => window.__sensen != null);
await page.click("button:has-text('2D Simple')");
await page.selectOption("select", "heuristic");
await page.click("button:has-text('CPU と対戦')");
await wait(800);

// Sample over 10 seconds to check for idle frames (queue.length === 0 AND reservations.length === 0).
let idleFrames = 0, totalFrames = 0;
const t0 = Date.now();
while (Date.now() - t0 < 10000) {
  const samples = await page.evaluate(() => {
    const g = window.__sensen.getState();
    const me = g.players[0], op = g.players[1];
    return {
      f: g.frame,
      meIdle: me.queue.length === 0 && me.reservations.length === 0,
      opIdle: op.queue.length === 0 && op.reservations.length === 0,
      meQueueLen: me.queue.length,
      meResLen: me.reservations.length,
      opQueueLen: op.queue.length,
      opResLen: op.reservations.length,
    };
  });
  totalFrames++;
  if (samples.meIdle || samples.opIdle) {
    idleFrames++;
  }
  await wait(50);
}
console.log(`samples ${totalFrames}, idle ${idleFrames} (${(100*idleFrames/totalFrames).toFixed(1)}%)`);

// Heavy card test: try to manually click a heavy card if present.
// Find heavy cards in self's hand.
const heavyInfo = await page.evaluate(() => {
  const g = window.__sensen.getState();
  const me = g.players[0];
  const cards = me.hand.map((cid, i) => ({ i, cid }));
  return { hand: cards, queue: me.queue.length, reservations: me.reservations.length };
});
console.log("self state:", heavyInfo);

await page.screenshot({ path: "/tmp/idle-check.png", fullPage: false });
await browser.close();
