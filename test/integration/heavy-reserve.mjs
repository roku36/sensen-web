import { chromium } from "playwright";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));

await page.goto("http://localhost:5173?simple");
await page.waitForFunction(() => window.__sensen != null);
await page.selectOption("select", "passive");  // passive AI so we can study reliably
await page.click("button:has-text('CPU と対戦')");
await wait(500);

// Force a known hand for player 0.
await page.evaluate(() => {
  const sess = window.__sensen;
  const g = sess.getState();
  // P0 hand: Strike, Strike, Strike, Bludgeon, Strike, (any)
  // CardIds: Strike=1, Bludgeon=23
  g.players[0].hand = [1, 1, 1, 23, 1, null];
  g.players[0].queue = [];
  g.players[0].reservations = [];
});
await wait(200);

// Now click cards in order: Strike(0), Strike(1), Strike(2), Bludgeon(3).
const log = async (label) => {
  const s = await page.evaluate(() => {
    const g = window.__sensen.getState();
    const p = g.players[0];
    return {
      frame: g.frame,
      queue: p.queue.map((q) => q.kind === "card" ? `c${q.cardId}` : `D${q.drawSlots?.length}`).join(","),
      reservations: p.reservations.map((r) => r.kind === "card" ? `c${r.slotIndex}(card=${p.hand[r.slotIndex]})` : "Draw").join(","),
      hand: p.hand.join(","),
    };
  });
  console.log(label, JSON.stringify(s));
};

await log("init");

// Flags: INPUT_DRAW=1, INPUT_CARD_N = 1<<N.  Slot 0 → 1<<1 = 2.
const SLOT = (i) => 1 << (i + 1);

// Click slot 0 (Strike)
await page.evaluate((f) => window.__sensen.pushInput(f), SLOT(0));
await wait(50); await log("click S0");

await page.evaluate((f) => window.__sensen.pushInput(f), SLOT(1));
await wait(50); await log("click S1");

await page.evaluate((f) => window.__sensen.pushInput(f), SLOT(2));
await wait(50); await log("click S2");

await page.evaluate((f) => window.__sensen.pushInput(f), SLOT(3));  // Bludgeon
await wait(50); await log("click Bludgeon");

// Now drain and see what plays.
for (let i = 0; i < 20; i++) {
  await wait(200);
  if (i % 3 === 0) await log(`tick ${i}`);
}
await page.screenshot({ path: "/tmp/heavy-reserve.png" });
await browser.close();
