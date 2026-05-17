// Visually verify:
//   - resolved chip stays LEFT of NOW dimmed
//   - next-card slot has a stable fill bar that doesn't reset on play
//   - native scrollbar is hidden
//   - wheel scroll direction is inverted (deltaY > 0 → scrollLeft decreases)
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
await page.waitForTimeout(600);

// Capture the draw-timer values at t≈0 (only initial draw happened).
const tInitial = await page.evaluate(() => {
  const g = window.__sensen.getState();
  return {
    hand: g.players[0].hand.length,
    nextDrawAt: g.players[0].nextDrawAt,
    drawTimerTotal: g.players[0].drawTimerTotal,
    now: g.frame / 60,
  };
});
console.log("initial:", tInitial);

// Wait 2s, then play a card, then immediately check that drawTimerTotal
// hasn't changed (only nextDrawAt would shift if a draw fires).
await wait(2000);
await page.keyboard.press("1");
await page.waitForTimeout(80);

const tAfterPlay = await page.evaluate(() => {
  const g = window.__sensen.getState();
  return {
    hand: g.players[0].hand.length,
    nextDrawAt: g.players[0].nextDrawAt,
    drawTimerTotal: g.players[0].drawTimerTotal,
    now: g.frame / 60,
    queue: g.players[0].queue.length,
  };
});
console.log("after play:", tAfterPlay);
console.log("drawTimerTotal unchanged on play?", tInitial.drawTimerTotal === tAfterPlay.drawTimerTotal);
console.log("nextDrawAt unchanged on play?", tInitial.nextDrawAt === tAfterPlay.nextDrawAt);

// Queue 2 more for visual.
await page.keyboard.press("2");
await page.waitForTimeout(120);
await page.keyboard.press("3");
await page.waitForTimeout(300);
await wait(3500);
await page.screenshot({ path: "/tmp/tl-state.png" });

// Hidden scrollbar check.
const scrollbarHidden = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll("div"));
  const sw = all.find((d) => getComputedStyle(d).overflowX === "auto");
  if (!sw) return { ok: false };
  // Force a scroll then check the offset/client width parity (no chrome).
  const cs = getComputedStyle(sw);
  return {
    ok: true,
    className: sw.className,
    scrollbarWidth: cs.scrollbarWidth,
    msOverflowStyle: cs.msOverflowStyle,
    offsetHeight: sw.offsetHeight,
    clientHeight: sw.clientHeight,
    horizontalScrollbarHeight: sw.offsetHeight - sw.clientHeight, // 0 if hidden
  };
});
console.log("scrollbar:", scrollbarHidden);

// Wheel direction test: deltaY > 0 should DECREASE scrollLeft.
const wheelTest = await page.evaluate(async () => {
  const all = Array.from(document.querySelectorAll("div"));
  const sw = all.find((d) => getComputedStyle(d).overflowX === "auto");
  if (!sw) return { found: false };
  // Set a known scroll start (middle).
  sw.scrollLeft = 100;
  await new Promise((r) => setTimeout(r, 50));
  const before = sw.scrollLeft;
  const ev = new WheelEvent("wheel", { deltaY: 80, bubbles: true, cancelable: true });
  sw.dispatchEvent(ev);
  await new Promise((r) => setTimeout(r, 50));
  const after = sw.scrollLeft;
  return { before, after, delta: after - before };
});
console.log("wheel test:", wheelTest);

await browser.close();
