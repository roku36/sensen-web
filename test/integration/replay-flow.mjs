// Verify replay record + play. Run an offline match, sample mid-match state,
// fetch the replay JSON, load it into a fresh page and seek to the same
// frame — state must reconstruct exactly. (We sample mid-match because
// forceVictory mutates state directly and is not an input — a pure input
// replay can't reproduce a manually-set HP.)

import { chromium } from "playwright";
import { writeFileSync, readFileSync } from "node:fs";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push("[err] " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("[ce] " + m.text()); });

await page.goto("http://localhost:5173?simple");
await page.waitForFunction(() => window.__sensen != null);
await page.click("button:has-text('Practice (offline)')");
await page.waitForTimeout(500);

await page.keyboard.press("1");
await page.waitForTimeout(250);
await page.keyboard.press("2");
await page.waitForTimeout(250);
await page.keyboard.press("d");
await page.waitForTimeout(250);
await page.keyboard.press("3");
await page.waitForTimeout(500);

const liveAt = await page.evaluate(() => {
  const g = window.__sensen.getState();
  return {
    frame: g.frame,
    p0hp: g.players[0].hp, p1hp: g.players[1].hp,
    p0block: g.players[0].block, p1block: g.players[1].block,
    p0deck: g.players[0].deck.length, p0hand: g.players[0].hand.length, p0disc: g.players[0].discard.length,
  };
});
console.log("live sample:", liveAt);

const replayJson = await page.evaluate(() => window.__sensen.buildReplay());
if (!replayJson) { console.log("✗ no replay"); process.exit(1); }
console.log(`replay: frames=${replayJson.finalFrame}, inputs=${replayJson.inputs.length}`);

const replayPath = "/tmp/sensen-test-replay.json";
writeFileSync(replayPath, JSON.stringify(replayJson));

const page2 = await ctx.newPage();
await page2.goto("http://localhost:5173?simple");
await page2.waitForFunction(() => window.__sensen != null);
const replayText = readFileSync(replayPath, "utf8");
const reconstructed = await page2.evaluate(async (args) => {
  const { decodeReplay } = await import("/src/replay/format.ts");
  const { ReplayEngine } = await import("/src/replay/engine.ts");
  const r = decodeReplay(args.text);
  const e = new ReplayEngine(r);
  const s = e.seek(args.targetFrame);
  return {
    frame: s.frame,
    p0hp: s.players[0].hp, p1hp: s.players[1].hp,
    p0block: s.players[0].block, p1block: s.players[1].block,
    p0deck: s.players[0].deck.length, p0hand: s.players[0].hand.length, p0disc: s.players[0].discard.length,
  };
}, { text: replayText, targetFrame: liveAt.frame });
console.log("replay seek-to-sample:", reconstructed);

await page.screenshot({ path: "/tmp/sensen-replay-recorded.png" });
await page2.screenshot({ path: "/tmp/sensen-replay-loaded.png" });

const close = (a, b) => Math.abs(a - b) < 0.01;
const match =
  reconstructed.frame === liveAt.frame &&
  close(reconstructed.p0hp, liveAt.p0hp) &&
  close(reconstructed.p1hp, liveAt.p1hp) &&
  close(reconstructed.p0block, liveAt.p0block) &&
  close(reconstructed.p1block, liveAt.p1block) &&
  reconstructed.p0deck === liveAt.p0deck &&
  reconstructed.p0hand === liveAt.p0hand &&
  reconstructed.p0disc === liveAt.p0disc;
console.log(match ? "\n✓ replay matches live state at sampled frame" : "\n✗ MISMATCH");

if (errs.length) { console.log("\nERRORS:"); errs.forEach((e) => console.log("  " + e)); }
await browser.close();
process.exit(match ? 0 : 1);
