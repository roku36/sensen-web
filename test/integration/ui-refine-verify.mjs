// Verify the UI refinements:
//  1. Opponent's reservation ghosts are NOT rendered (予約はローカル).
//  2. 確定 markers appear for heavy-card / atomic-batch reservations.
//  3. Row tags 相手/自分, 第N閃 counter, controls hint exist.
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
await wait(1500); // let the CPU reserve things

// 1+3. Static checks.
const checks = await page.evaluate(() => {
  const text = document.body.innerText;
  const g = window.__sensen.getState();
  // Opp (p1) almost certainly has reservations by now (heuristic AI).
  const oppResCount = g.players[1].reservations.length;
  // Ghost chips are the dashed boxes with a 予約 label; count per row is
  // hard from DOM, so count total 予約 chips and compare with MY count.
  const myResCount = g.players[0].reservations.length;
  const ghostChips = [...document.querySelectorAll("div")].filter(
    (d) => d.childElementCount <= 3 && /予約 ·/.test(d.innerText) && d.innerText.length < 30,
  ).length;
  return {
    oppResCount, myResCount, ghostChips,
    hasRowTags: text.includes("相手") && text.includes("自分"),
    hasSenCounter: /第\d+閃/.test(text),
    hasFrameDebug: /frame \d+ · 2D/.test(text),
    hasHint: text.includes("右クリック"),
  };
});
console.log("static:", checks);

// 2. Heavy scenario: seed hand, build plan [S,S,S,B(prereq2)] → 確定 marker.
await page.evaluate(() => {
  const g = window.__sensen.getState();
  const p = g.players[0];
  p.hand = [1, 1, 1, 23, null, null]; // Strike×3 + Bludgeon
  p.queue = [];
  p.reservations = [];
  p.castStartedAt = g.frame / 60;
});
await wait(100);
// Click S1 (fires to queue), S2, S3 (reservations), then Bludgeon.
for (const key of ["1", "2", "3", "4"]) {
  await page.keyboard.press(key);
  await wait(60);
}
await wait(300);
const heavy = await page.evaluate(() => {
  const text = document.body.innerText;
  const g = window.__sensen.getState();
  return {
    reservations: g.players[0].reservations.length,
    queueCards: g.players[0].queue.filter((q) => q.kind === "card").length,
    hasConfirmMarker: text.includes("確定"),
  };
});
console.log("heavy scenario:", heavy);
await page.screenshot({ path: "/tmp/ui-refined.png" });
await browser.close();
