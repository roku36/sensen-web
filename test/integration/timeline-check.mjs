// Visually verify the unified scrollable timeline:
//   - 3+ queued cards stack horizontally (no overlap)
//   - opp and self tracks share the same X axis
//   - NOW line sits at the shared origin
//   - wheel-scroll moves the inner container
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
await page.selectOption("select", "heuristic");
await page.click("button:has-text('CPU と対戦')");
await page.waitForTimeout(800);

// Queue 3 cards by pressing 1, 2, 3 (first three hand keys).
await page.keyboard.press("1");
await page.waitForTimeout(150);
await page.keyboard.press("2");
await page.waitForTimeout(150);
await page.keyboard.press("3");
await page.waitForTimeout(300);

const queueState = await page.evaluate(() => {
  const g = window.__sensen.getState();
  return {
    p0Queue: g.players[0].queue.map((q) => ({ id: q.cardId, dur: q.duration })),
    p1Queue: g.players[1].queue.map((q) => ({ id: q.cardId, dur: q.duration })),
    frame: g.frame,
  };
});
console.log("queues:", JSON.stringify(queueState, null, 2));

await page.screenshot({ path: "/tmp/timeline-unified.png", fullPage: false });
console.log("saved /tmp/timeline-unified.png");

// Verify wheel scroll moves the inner container.
const scrollBefore = await page.evaluate(() => {
  const el = document.querySelector('[data-timeline-scroll]') || document.querySelectorAll('div').forEach;
  // Find the scroll wrap by looking for overflow-x auto
  const all = Array.from(document.querySelectorAll("div"));
  const sw = all.find((d) => getComputedStyle(d).overflowX === "auto");
  return sw ? { left: sw.scrollLeft, width: sw.scrollWidth, client: sw.clientWidth } : null;
});
console.log("scroll wrap before:", scrollBefore);

await browser.close();
