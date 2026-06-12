// E2E: puzzle mode — open list, start P1 (連閃の基本), play the intended
// solution (3 strikes, then advance 閃), expect the 成功 overlay.
import { chromium } from "playwright";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));

await page.goto("http://localhost:5175?simple");
await page.waitForFunction(() => window.__sensen != null);
await page.click("button:has-text('パズル')");
await page.waitForSelector("text=其の一");
await page.screenshot({ path: "/tmp/puzzle-list.png" });

await page.locator("button:has-text('挑戦する')").first().click();
await page.waitForSelector("text=経過");
await wait(300);

// Intended solution: reserve the three strikes (slots 1,2,3 → keys 2,3,4).
for (const k of ["2", "3", "4"]) { await page.keyboard.press(k); await wait(120); }
// Advance 4 閃 (3 resolves + margin). Raw mouse clicks at the button's
// center: Playwright's actionability heuristic false-positives on
// "intercepted" here even though elementFromPoint returns the button
// itself (verified), so we dispatch real pointer events directly.
for (let i = 0; i < 4; i++) {
  const rect = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("次の閃"));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!rect) break;
  await page.mouse.click(rect.x, rect.y);
  await wait(250);
}
const outcome = await page.evaluate(() => ({
  cleared: document.body.innerText.includes("成功"),
  oppHp: window.__sensen.getState()?.players[1].hp ?? null,
  result: window.__sensen.getState()?.result ?? null,
  // issue #2 regression: the ranked ResultPanel (連勝バッジ) must NOT
  // appear over a puzzle, and the streak in storage must stay untouched.
  rankedPanelLeaked: document.body.innerText.includes("連勝"),
  streakKeys: Object.keys(localStorage).filter((k) => k.includes("streak"))
    .map((k) => `${k}=${localStorage.getItem(k)}`),
}));
console.log("puzzle P1 outcome:", outcome);
await page.screenshot({ path: "/tmp/puzzle-clear.png" });
await browser.close();
console.log(outcome.cleared && outcome.result === 1 && !outcome.rankedPanelLeaked ? "ALL OK" : "SOMETHING FAILED");
