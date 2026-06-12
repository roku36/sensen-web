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

// 3. Prediction responds to a click within a frame or two.
const before = await page.evaluate(() => {
  const g = window.__sensen.getState();
  return g.players[0].reservations.length;
});
// Click the first clickable hand card.
const clicked = await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")].filter(
    (b) => !b.disabled && b.querySelector("div") && b.textContent.includes("閃"),
  );
  if (btns.length === 0) return false;
  btns[0].click();
  return true;
});
await wait(150);
const after = await page.evaluate(() => {
  const g = window.__sensen.getState();
  return g.players[0].reservations.length;
});
console.log(`reservation click: clicked=${clicked} before=${before} after=${after}`);

await page.screenshot({ path: "/tmp/perf-check.png" });
await browser.close();
