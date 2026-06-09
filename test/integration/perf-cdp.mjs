// Measure main-thread script time during 4s of gameplay via CDP metrics.
// Run twice (before/after the prediction-memo fix) to compare.
import { chromium } from "playwright";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function measureOnce() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("http://localhost:5175?simple");
  await page.waitForFunction(() => window.__sensen != null);
  await page.click("button:has-text('2D Simple')");
  await page.selectOption("select", "heuristic");
  await page.click("button:has-text('CPU と対戦')");
  await wait(2000); // warm up, let combat develop

  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable");
  const m1 = await cdp.send("Performance.getMetrics");
  await wait(4000);
  const m2 = await cdp.send("Performance.getMetrics");
  const get = (m, name) => m.metrics.find((x) => x.name === name)?.value ?? 0;
  const script = get(m2, "ScriptDuration") - get(m1, "ScriptDuration");
  const layout = get(m2, "LayoutDuration") - get(m1, "LayoutDuration");
  const recalc = get(m2, "RecalcStyleDuration") - get(m1, "RecalcStyleDuration");
  const task = get(m2, "TaskDuration") - get(m1, "TaskDuration");
  await browser.close();
  return { script, layout, recalc, task };
}

const runs = [];
for (let i = 0; i < 3; i++) runs.push(await measureOnce());
const avg = (k) => (runs.reduce((a, r) => a + r[k], 0) / runs.length * 1000).toFixed(0);
console.log(`over 4s of gameplay (avg of 3 runs):`);
console.log(`  script: ${avg("script")}ms  layout: ${avg("layout")}ms  styleRecalc: ${avg("recalc")}ms  totalTask: ${avg("task")}ms`);
