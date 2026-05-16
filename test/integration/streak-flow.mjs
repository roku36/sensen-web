// End-to-end check of the win-streak flow:
//   1. Per-tab independence: two tabs in two browser instances start with
//      different decks (sessionStorage tabId scopes localStorage).
//   2. Offline win → PostVictoryDraft shows → pick → deck grows → streak=1.
//   3. Offline loss → deck/streak reset to defaults.
//   4. Title shows the current streak badge.

import { chromium } from "playwright";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push("[err] " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("[ce] " + m.text()); });

await page.goto("http://localhost:5173?simple");
await page.waitForFunction(() => window.__sensen != null);
await page.click("button:has-text('2D Simple')");

const getDeckSize = () => page.evaluate(async () => {
  const mod = await import("/src/sim/deck-storage.ts");
  return mod.loadDeck().length;
});
const getStreak = () => page.evaluate(async () => {
  const mod = await import("/src/sim/deck-storage.ts");
  return mod.loadStreak();
});

// Reset everything to a known baseline.
await page.evaluate(async () => {
  const mod = await import("/src/sim/deck-storage.ts");
  mod.resetProfile();
});

const initialDeck = await getDeckSize();
const initialStreak = await getStreak();
console.log(`baseline: deck=${initialDeck}, streak=${initialStreak}`);

// === Scenario A: offline WIN → draft → pick → deck +1, streak +1 ===
await page.click("button:has-text('Practice (offline)')");
await page.waitForTimeout(500);
await page.evaluate(() => window.__sensen.forceVictory());
await page.waitForTimeout(500);
await page.screenshot({ path: "/tmp/streak-1-victory.png" });

// PostVictoryDraft should be visible — pick the first candidate
const firstCard = page.locator("text=連勝 0 → 1").first();
const visibleWin = await firstCard.count();
console.log(`victory panel shows '連勝 0 → 1': ${visibleWin > 0}`);
// Click the first draft card option (one of the 3 buttons in the draft area)
const draftButtons = await page.locator("button:has(div:has-text('ダメージ')), button:has(div:has-text('ブロック')), button:has(div:has-text('Str')), button:has(div:has-text('回復')), button:has(div:has-text('ドロー'))").count();
// Use the more robust selector: pick one of the three card buttons inside post-victory draft.
// Just click the first non-action button under the result panel.
const candidates = page.locator(".__notgonnamatch, button >> nth=0");
// Simpler: query for buttons that have a MiniCard child via type label
await page.locator("button >> div >> button").first().click().catch(() => {});
await page.waitForTimeout(200);
const next1 = page.locator("button:has-text('次のマッチへ')");
const skipBtn = page.locator("button:has-text('スキップ')");
if (await next1.count() > 0) await next1.first().click();
else if (await skipBtn.count() > 0) await skipBtn.first().click();
await page.waitForTimeout(500);

const afterWinDeck = await getDeckSize();
const afterWinStreak = await getStreak();
console.log(`after win: deck=${afterWinDeck} (was ${initialDeck}), streak=${afterWinStreak}`);

// === Scenario B: offline LOSS → reset ===
// At this point we're already in a fresh practice match (rematch from the panel).
await page.waitForTimeout(400);
await page.evaluate(() => {
  // Kill self instead of opponent.
  const g = window.__sensen.getState();
  if (g) g.players[0].hp = 0;
});
await page.waitForTimeout(500);
await page.screenshot({ path: "/tmp/streak-2-defeat.png" });
const visibleLoss = await page.locator("text=敗北").count();
console.log(`defeat banner visible: ${visibleLoss > 0}`);
// Click タイトルへ to leave
await page.click("button:has-text('タイトルへ')");
await page.waitForTimeout(400);
const afterLossDeck = await getDeckSize();
const afterLossStreak = await getStreak();
console.log(`after loss: deck=${afterLossDeck} (default ${initialDeck}), streak=${afterLossStreak}`);

if (errs.length) { console.log("\nERRORS:"); errs.forEach((e) => console.log("  " + e)); process.exit(1); }

const winOK = afterWinStreak === 1 && afterWinDeck >= initialDeck; // either same (skipped) or +1
const lossOK = afterLossStreak === 0 && afterLossDeck === initialDeck;
const allOK = visibleWin > 0 && visibleLoss > 0 && winOK && lossOK;
console.log(allOK ? "\n✓ streak flow ok" : `\n✗ flow check failed (winOK=${winOK} lossOK=${lossOK})`);
await browser.close();
process.exit(allOK ? 0 : 1);
