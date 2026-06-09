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
await wait(2500);  // let combat develop

// Check that BlockChangeLabels/PoisonChangeLabels/PierceMarks SVG elements exist.
const counts = await page.evaluate(() => {
  const svgs = document.querySelectorAll("svg");
  let texts = 0, lines = 0;
  for (const s of svgs) {
    texts += s.querySelectorAll("text").length;
    lines += s.querySelectorAll("line").length;
  }
  return { texts, lines, svgCount: svgs.length };
});
console.log("svg elements:", counts);

// Sample at 4 frames to check stability across frames.
for (let i = 0; i < 4; i++) {
  await page.screenshot({ path: `/tmp/render-${i}.png`, fullPage: false });
  await wait(200);
}

// Sample CPU reservation state stability.
const samples = [];
for (let i = 0; i < 30; i++) {
  const s = await page.evaluate(() => {
    const g = window.__sensen.getState();
    return g.players[1].reservations.map((r) => r.kind === "card" ? `c${r.slotIndex}` : "draw").join(",");
  });
  samples.push(s);
  await wait(33);
}
console.log(`opp reservation stability over 30 samples: ${new Set(samples).size} unique states`);

await browser.close();
