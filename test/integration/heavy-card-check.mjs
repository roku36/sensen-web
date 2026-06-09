import { chromium } from "playwright";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));

await page.goto("http://localhost:5175?simple");
await page.waitForFunction(() => window.__sensen != null);
await page.click("button:has-text('2D Simple')");
await page.selectOption("select", "lv3");
await page.click("button:has-text('CPU と対戦')");
await wait(800);

// Force ourselves a known hand: a Bludgeon and 2 Strikes.
// We can't, but we can sample over time to check predictability.
// Just take 4 screenshots at frames F, F+6, F+12, F+18 and verify nothing crashes.
for (let i = 0; i < 4; i++) {
  await page.screenshot({ path: `/tmp/heavy-card-${i}.png`, fullPage: false });
  await wait(150);
}

// Also sample CPU reservation state to ensure no flickering.
const samples = [];
for (let i = 0; i < 30; i++) {
  const s = await page.evaluate(() => {
    const g = window.__sensen.getState();
    return {
      f: g.frame,
      oppResv: g.players[1].reservations.map((r) => r.kind === "card" ? `c${r.slotIndex}` : "draw").join(","),
      oppQueue: g.players[1].queue.map((q) => q.kind === "card" ? `Q${q.cardId}` : "Qdraw").join(","),
    };
  });
  samples.push(s);
  await wait(33);
}
const unique = new Set(samples.map((s) => s.oppResv));
console.log(`unique reservation states across 30 samples: ${unique.size}`);
console.log("sample tail:", samples.slice(-5));

await browser.close();
