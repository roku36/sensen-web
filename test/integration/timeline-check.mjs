// v5 visual check:
//   - 閃 displayed everywhere
//   - block: toward-center geometry, exponential narrowing
//   - second player (handle 1) gets +3 block, 0.5閃 offset
//   - opp queue hidden from p1 until they act
//   - default reservation auto-fires (Draw or leftmost playable)
//   - right-click sets card reservation, shows "予約中" badge
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

// Capture initial state: p1 should have +3 block, 0.5閃 offset.
const initial = await page.evaluate(() => {
  const g = window.__sensen.getState();
  return {
    p0: { block: g.players[0].block, castStartedAt: g.players[0].castStartedAt, openedAt: g.players[0].openedAt, reservation: g.players[0].reservation },
    p1: { block: g.players[1].block, castStartedAt: g.players[1].castStartedAt, openedAt: g.players[1].openedAt, reservation: g.players[1].reservation },
    localPlayer: window.__sensen.getState && (window.__sensen.localPlayer ?? "unknown"),
  };
});
console.log("initial:", JSON.stringify(initial, null, 2));

await page.screenshot({ path: "/tmp/v5-initial.png" });

// Press a card (slot 0). Default reservation should fire Draw afterwards.
await page.keyboard.press("1");
await page.waitForTimeout(200);
await page.screenshot({ path: "/tmp/v5-after-play.png" });

const afterPlay = await page.evaluate(() => {
  const g = window.__sensen.getState();
  return {
    queue: g.players[0].queue.map((q) => q.kind === "draw"
      ? { kind: "draw", drawSlots: q.drawSlots, duration: q.duration }
      : { kind: "card", cardId: q.cardId, duration: q.duration }),
    reservation: g.players[0].reservation,
    openedAt: g.players[0].openedAt,
  };
});
console.log("after play 1:", JSON.stringify(afterPlay, null, 2));

// Wait for card to resolve, then reservation auto-fires Draw.
await wait(3500);
const afterResolve = await page.evaluate(() => {
  const g = window.__sensen.getState();
  return {
    queueLen: g.players[0].queue.length,
    queueKinds: g.players[0].queue.map((q) => q.kind),
    hand: g.players[0].hand,
    block: g.players[1].block,
  };
});
console.log("after Strike resolves + auto-Draw fires:", JSON.stringify(afterResolve, null, 2));
await page.screenshot({ path: "/tmp/v5-after-resolve.png" });

// Right-click a card to manually reserve it.
const cardButtons = await page.$$("button[disabled='false'], button:not([disabled])");
// Find a card-shaped button (160px wide-ish — easier: find by text containing 閃)
await wait(500);
const reservedSetup = await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll("button"));
  const card = buttons.find((b) => b.textContent && b.textContent.includes("閃") && b.textContent.includes("攻撃"));
  if (!card) return { found: false };
  const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  card.dispatchEvent(ev);
  return { found: true, text: card.textContent?.slice(0, 30) };
});
console.log("right-click setup:", reservedSetup);
await wait(200);
const reservedState = await page.evaluate(() => {
  const g = window.__sensen.getState();
  return { reservation: g.players[0].reservation };
});
console.log("after right-click:", reservedState);

await page.screenshot({ path: "/tmp/v5-reserved.png" });
await browser.close();
