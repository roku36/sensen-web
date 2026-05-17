// Visually verify the unified scrollable timeline + draw timer + history:
//   - 3 queued cards, then wait > 3s for first to resolve
//   - resolved chip appears LEFT of NOW (dimmed, "発動済")
//   - hand still has the next-card countdown slot
//   - wheel-scroll updates scrollLeft on the inner container
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
await page.selectOption("select", "passive"); // disable AI so screenshot is stable
await page.click("button:has-text('CPU と対戦')");
await page.waitForTimeout(600);

// Queue 3 cards from the human side.
await page.keyboard.press("1");
await page.waitForTimeout(120);
await page.keyboard.press("2");
await page.waitForTimeout(120);
await page.keyboard.press("3");
await page.waitForTimeout(300);

await page.screenshot({ path: "/tmp/timeline-queued.png" });
console.log("saved /tmp/timeline-queued.png");

// Wait for first card to resolve (3+ sec).
await wait(3500);

const state = await page.evaluate(() => {
  const g = window.__sensen.getState();
  return {
    p0: {
      hand: g.players[0].hand.length,
      queue: g.players[0].queue.map((q) => ({ id: q.cardId, dur: q.duration })),
      resolved: g.players[0].resolvedCards.length,
      nextDrawAt: g.players[0].nextDrawAt,
    },
    frame: g.frame,
    nowSec: g.frame / 60,
  };
});
console.log("after 3.5s:", JSON.stringify(state, null, 2));

await page.screenshot({ path: "/tmp/timeline-resolved.png" });
console.log("saved /tmp/timeline-resolved.png");

// Wheel scroll test: simulate a wheel event on the scrollWrap.
const scrollResult = await page.evaluate(async () => {
  const all = Array.from(document.querySelectorAll("div"));
  const sw = all.find((d) => getComputedStyle(d).overflowX === "auto");
  if (!sw) return { found: false };
  const before = sw.scrollLeft;
  const ev = new WheelEvent("wheel", { deltaY: 200, bubbles: true, cancelable: true });
  sw.dispatchEvent(ev);
  await new Promise((r) => setTimeout(r, 50));
  const after = sw.scrollLeft;
  return {
    found: true,
    before, after, scrollWidth: sw.scrollWidth, clientWidth: sw.clientWidth,
    canScroll: sw.scrollWidth > sw.clientWidth,
  };
});
console.log("wheel scroll:", scrollResult);

await browser.close();
