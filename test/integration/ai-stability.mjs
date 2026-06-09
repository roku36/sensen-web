// Verify the CPU's reservation list no longer changes every frame
// (the toggle-oscillation bug).
import { chromium } from "playwright";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));

await page.goto("http://localhost:5173?simple");
await page.waitForFunction(() => window.__sensen != null);
await page.click("button:has-text('2D Simple')");
// Heuristic AI vs human
await page.selectOption("select", "lv3");
await page.click("button:has-text('CPU と対戦')");
await page.waitForTimeout(800);

// Sample the opponent's (side 1) reservation list 30 times over 1 second.
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

// Count unique reservation states.
const unique = new Set(samples.map((s) => s.oppResv));
console.log("opp reservation states across 30 samples:");
for (const s of samples.slice(0, 10)) console.log(" ", s);
console.log(`... unique reservation states: ${unique.size}`);
if (unique.size > 5) {
  console.log("FLICKER: opp reservation list changes often!");
} else {
  console.log("STABLE: opp reservations don't oscillate.");
}

await page.screenshot({ path: "/tmp/ai-stability.png" });
await browser.close();
