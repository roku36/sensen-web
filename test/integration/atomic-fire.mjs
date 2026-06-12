import { chromium } from "playwright";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));

await page.goto("http://localhost:5173?simple");
await page.waitForFunction(() => window.__sensen != null);
await page.selectOption("select", "passive");
await page.click("button:has-text('CPU と対戦')");
await wait(400);

const state = async () => page.evaluate(() => {
  const g = window.__sensen.getState();
  const p = g.players[0];
  let r = 0;
  if (p.queue.length > 0) {
    r = Math.max(0, p.queue[0].duration - (g.frame/60 - p.castStartedAt));
    for (let i = 1; i < p.queue.length; i++) r += p.queue[i].duration;
  }
  return {
    chain: r.toFixed(2) + "s",
    q: p.queue.map(q => q.kind==="card" ? `c${q.cardId}` : "D").join(","),
    r: p.reservations.map(r => r.kind==="card" ? `S${r.slotIndex}:${p.hand[r.slotIndex]}` : "D").join(","),
  };
});

// USER SCENARIO 1: stack 4閃 + reserve only Bludgeon(prereq=2閃)
console.log("=== Test A: stack 4閃 + reserve Bludgeon(prereq=2閃) → fire at 2閃 drain ===");
await page.evaluate(() => {
  const g = window.__sensen.getState();
  g.players[0].hand = [1, 1, 1, 1, null, 23];  // Strike×4, Bludgeon
  g.players[0].queue = [
    { kind: "card", cardId: 1, duration: 3, blockApplied: true },
    { kind: "card", cardId: 1, duration: 3, blockApplied: false },
    { kind: "card", cardId: 1, duration: 3, blockApplied: false },
    { kind: "card", cardId: 1, duration: 3, blockApplied: false },
  ];
  g.players[0].castStartedAt = g.frame / 60;
  g.players[0].reservations = [];
});
await wait(100);
console.log("init:", await state());
await page.evaluate(() => window.__sensen.pushInput(64)); // Bludgeon (slot 5)
await wait(50);
console.log("click B:", await state());
await wait(3000);
console.log("+1閃:", await state());
await wait(3000);
console.log("+2閃: (chain=2閃 = prereq) B should fire:", await state());

// USER SCENARIO 2: reserve [S, B] when chain=4閃 — order MUST be preserved.
console.log("\n=== Test B: [S5, B(prereq=2閃)] — B must NOT fire before S5 ===");
await page.evaluate(() => {
  const g = window.__sensen.getState();
  g.players[0].hand = [1, 1, 1, 1, 1, 23];
  g.players[0].queue = [
    { kind: "card", cardId: 1, duration: 3, blockApplied: true },
    { kind: "card", cardId: 1, duration: 3, blockApplied: false },
    { kind: "card", cardId: 1, duration: 3, blockApplied: false },
    { kind: "card", cardId: 1, duration: 3, blockApplied: false },
  ];
  g.players[0].castStartedAt = g.frame / 60;
  g.players[0].reservations = [];
});
await wait(100);
console.log("init:", await state());
const SLOT = (i) => 1 << (i + 1);
await page.evaluate((f) => window.__sensen.pushInput(f), SLOT(4));  // S5
await wait(50);
await page.evaluate((f) => window.__sensen.pushInput(f), SLOT(5));  // Bludgeon
await wait(50);
console.log("click [S5, B]:", await state(), "← BOTH in reservation");
// Trigger = max(0, 6 - 3) = 3sec. Wait until chain drains to 3sec.
await wait(3000); // chain ≈ 9-3 = 6 (after some Sa drain)
console.log("+1閃:", await state(), "← still waiting");
await wait(3000); // chain ≈ 3sec
console.log("+2閃: (chain=3sec = trigger) atomic fire [S5, B]:", await state());

// USER SCENARIO 3: order preservation
console.log("\n=== Test C: rapid [S, S, S, S, B] — atomic at 1閃 in original order ===");
await page.evaluate(() => {
  const g = window.__sensen.getState();
  g.players[0].hand = [1, 1, 1, 1, 1, 23];
  g.players[0].queue = [];
  g.players[0].reservations = [];
});
await wait(100);
console.log("init:", await state());
for (let i = 0; i < 5; i++) {
  await page.evaluate((f) => window.__sensen.pushInput(f), SLOT(i));
  await wait(40);
}
await page.evaluate((f) => window.__sensen.pushInput(f), SLOT(5)); // B
await wait(50);
console.log("after [S×5, B] clicks:", await state(), "← S1 fired, rest in reservation");
await wait(3000); // 1閃 drain
console.log("+1閃: atomic fire:", await state(), "← ORDER must be S2,S3,S4,S5,B");

await browser.close();
