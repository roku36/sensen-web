// Verify the rendering-stability fix:
//  1. The game still renders (SVG trajectory, queue chips, labels).
//  2. Frame pacing: rAF deltas over 3s — count of dropped frames (>25ms).
//  3. Prediction reacts immediately to a reservation click.
import { chromium } from "playwright";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));

await page.goto("http://localhost:5175?simple");
await page.waitForFunction(() => window.__sensen != null);
await page.selectOption("select", "lv3");
await page.click("button:has-text('CPU と対戦')");
await wait(2500); // let combat develop

// 1. Render sanity.
const counts = await page.evaluate(() => {
  const svgs = document.querySelectorAll("svg");
  let texts = 0, lines = 0, polys = 0;
  for (const s of svgs) {
    texts += s.querySelectorAll("text").length;
    lines += s.querySelectorAll("line").length;
    polys += s.querySelectorAll("polygon").length;
  }
  return { texts, lines, polys, svgCount: svgs.length };
});
console.log("svg elements:", counts);

// 2. Frame pacing over 3 seconds.
const pacing = await page.evaluate(() => new Promise((resolve) => {
  const deltas = [];
  let last = performance.now();
  let n = 0;
  const tick = (t) => {
    deltas.push(t - last);
    last = t;
    if (++n < 180) requestAnimationFrame(tick);
    else {
      deltas.shift(); // first delta is warm-up
      const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
      const worst = Math.max(...deltas);
      const dropped = deltas.filter((d) => d > 25).length;
      resolve({ avgMs: avg.toFixed(2), worstMs: worst.toFixed(1), dropped, frames: deltas.length });
    }
  };
  requestAnimationFrame(tick);
}));
console.log("frame pacing:", pacing);

// 3. A card click commits an action. オートパイロット廃止後はキューが
// 空のことが多く、予約は即キューに発火する — committed (queue+res) で数える。
const committed = () => page.evaluate(() => {
  const g = window.__sensen.getState();
  const p = g.players[0];
  return p.queue.filter((q) => q.kind === "card").length
    + p.reservations.filter((r) => r.kind === "card").length;
});
const before = await committed();
// Click the first clickable hand card (hand-card class = 手札のみ確実)。
const clicked = await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button.hand-card")].filter((b) => !b.disabled);
  if (btns.length === 0) return false;
  btns[0].click();
  return true;
});
await wait(150);
const after = await committed();
console.log(`card click: clicked=${clicked} before=${before} after=${after} (committed cards)`);

await page.screenshot({ path: "/tmp/perf-check.png" });
await browser.close();
