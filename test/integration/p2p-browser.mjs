// Real browser P2P test.
//
// Launches TWO Chromium contexts, navigates each to http://localhost:5173,
// has both join the live matchbox-server room, then plays cards in both
// tabs and verifies the live game state (HP / Block / deck order / RNG)
// matches between the two browsers — i.e. genuine end-to-end WebRTC
// rollback consistency.

import { chromium } from "playwright";

const ORIGIN = "http://localhost:5173";
const SIGNAL = "ws://localhost:3536/sensen?next=2";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function openPeer(browser, label) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log(`[${label} ERR]`, msg.text());
  });
  page.on("pageerror", (e) => console.log(`[${label} PAGE-ERR]`, e.message));
  await page.goto(ORIGIN);
  await page.waitForFunction(() => window.__sensen != null, null, { timeout: 5000 });

  // Set the signal URL (already pre-filled but make sure) and click Find Match.
  await page.fill('input[placeholder="matchbox signaling URL"]', SIGNAL);
  await page.click('button:has-text("Find Match (online)")');
  return { ctx, page };
}

async function getState(page) {
  return page.evaluate(() => {
    const s = window.__sensen.getState();
    if (!s) return null;
    const fmt = (p) => ({
      hp: Math.round(p.hp * 100) / 100,
      block: Math.round(p.block * 100) / 100,
      thorns: Math.round(p.thorns * 100) / 100,
      cost: Math.round(p.cost * 100) / 100,
      strength: p.strength,
      vuln: Math.round(p.vulnerableSecs * 100) / 100,
      weak: Math.round(p.weakSecs * 100) / 100,
      hand: p.hand,
      deck: p.deck,
      discard: p.discard,
      rng: p.rng.state.toString(16),
    });
    return {
      frame: s.frame,
      result: s.result,
      matchSeed: s.matchSeed.toString(16),
      p0: fmt(s.players[0]),
      p1: fmt(s.players[1]),
      localPlayer: window.__sensen.getLocalPlayer(),
      screen: window.__sensen.getScreen(),
      desync: window.__sensen.getDesync(),
    };
  });
}

function diffStates(a, b) {
  const issues = [];
  if (a.matchSeed !== b.matchSeed) issues.push(`matchSeed: ${a.matchSeed} vs ${b.matchSeed}`);
  for (const side of ["p0", "p1"]) {
    for (const k of ["hp", "block", "thorns", "strength", "vuln", "weak"]) {
      if (a[side][k] !== b[side][k]) issues.push(`${side}.${k}: A=${a[side][k]} B=${b[side][k]}`);
    }
    for (const k of ["hand", "deck", "discard"]) {
      const av = a[side][k].join(","), bv = b[side][k].join(",");
      if (av !== bv) issues.push(`${side}.${k}: A=[${av}] B=[${bv}]`);
    }
    if (a[side].rng !== b[side].rng) issues.push(`${side}.rng: A=${a[side].rng} B=${b[side].rng}`);
  }
  return issues;
}

(async () => {
  console.log("→ launching 2 browsers");
  const browser = await chromium.launch({ headless: true });

  console.log("→ opening peer A");
  const A = await openPeer(browser, "A");
  await wait(300);
  console.log("→ opening peer B");
  const B = await openPeer(browser, "B");

  console.log("→ waiting for both to enter gameplay (matchbox connect + WebRTC handshake)…");
  const enteredA = await A.page.waitForFunction(() => window.__sensen.getScreen() === "gameplay", null, { timeout: 30000 }).catch(() => null);
  const enteredB = await B.page.waitForFunction(() => window.__sensen.getScreen() === "gameplay", null, { timeout: 30000 }).catch(() => null);
  if (!enteredA || !enteredB) {
    const logA = await A.page.evaluate(() => window.__sensen.getLog());
    const logB = await B.page.evaluate(() => window.__sensen.getLog());
    console.log("[A log]\n" + logA.join("\n"));
    console.log("[B log]\n" + logB.join("\n"));
    throw new Error(`failed to enter gameplay: A=${!!enteredA} B=${!!enteredB}`);
  }
  console.log("✓ both peers in gameplay");

  // Let cost accumulate so cards become playable (~2s of sim).
  await wait(2500);

  // PEER A presses card 1, PEER B presses card 2 (different cards).
  console.log("→ A presses '1' (play hand[0]), B presses '2' (play hand[1])");
  await A.page.keyboard.press("1");
  await B.page.keyboard.press("2");
  await wait(800);

  // Heavier pattern: 30 presses each, varying timing, both peers asynchronous.
  console.log("→ heavy stress: 30 mixed presses on both peers");
  for (let i = 0; i < 30; i++) {
    await wait(400 + (i % 4) * 80);
    await A.page.keyboard.press(String((i * 3) % 9 + 1));
    if (i % 5 === 0) await A.page.keyboard.press("d");
    await wait(50 + (i % 3) * 30);
    await B.page.keyboard.press(String((i * 2 + 1) % 9 + 1));
    if (i % 7 === 0) await B.page.keyboard.press("d");
  }

  // Let everything settle (rollback + checksum exchanges).
  await wait(2500);

  const sA = await getState(A.page);
  const sB = await getState(B.page);
  console.log(`\nA: localPlayer=p${sA.localPlayer} frame=${sA.frame}`);
  console.log(`B: localPlayer=p${sB.localPlayer} frame=${sB.frame}`);
  console.log(`A.p0.hp=${sA.p0.hp} block=${sA.p0.block} | A.p1.hp=${sA.p1.hp} block=${sA.p1.block}`);
  console.log(`B.p0.hp=${sB.p0.hp} block=${sB.p0.block} | B.p1.hp=${sB.p1.hp} block=${sB.p1.block}`);
  console.log(`A.matchSeed=${sA.matchSeed}`);
  console.log(`B.matchSeed=${sB.matchSeed}`);
  console.log(`A.desync=${sA.desync}, B.desync=${sB.desync}`);

  // Wait for both peers to advance well past a target frame, then compare the
  // checksum each peer recorded for the SAME past frame. This eliminates
  // the false-positive "1-frame skew" mismatch from the live-state diff above.
  const target = Math.max(sA.frame, sB.frame) + 60;
  await A.page.waitForFunction((t) => window.__sensen.getState()?.frame >= t + 30, target, { timeout: 8000 }).catch(() => {});
  await B.page.waitForFunction((t) => window.__sensen.getState()?.frame >= t + 30, target, { timeout: 8000 }).catch(() => {});

  // Probe a series of past frames; assert checksum agreement on each.
  const frames = [target - 20, target - 10, target, target + 10];
  const cmp = await A.page.evaluate(async (fs) => {
    return fs.map((f) => ({ f, c: window.__sensen.checksumAt(f) }));
  }, frames);
  const cmpB = await B.page.evaluate(async (fs) => {
    return fs.map((f) => ({ f, c: window.__sensen.checksumAt(f) }));
  }, frames);

  console.log("\nPer-frame checksum comparison (same frame, both peers):");
  let mismatches = 0, compared = 0;
  for (let i = 0; i < frames.length; i++) {
    const a = cmp[i].c, b = cmpB[i].c;
    if (a == null || b == null) {
      console.log(`  frame ${frames[i]}: A=${a ?? "—"} B=${b ?? "—"} (skipped)`);
      continue;
    }
    compared++;
    const ok = a === b;
    if (!ok) mismatches++;
    console.log(`  frame ${frames[i]}: A=${a} B=${b}  ${ok ? "✓" : "✗"}`);
  }

  // Also do a live-state field diff for visibility (this MAY differ by 1 frame).
  const sA2 = await getState(A.page);
  const sB2 = await getState(B.page);
  console.log(`\nLive states (A.frame=${sA2.frame}, B.frame=${sB2.frame}):`);
  console.log(`  A.p0 hp=${sA2.p0.hp} block=${sA2.p0.block}  |  B.p0 hp=${sB2.p0.hp} block=${sB2.p0.block}`);
  console.log(`  A.p1 hp=${sA2.p1.hp} block=${sA2.p1.block}  |  B.p1 hp=${sB2.p1.hp} block=${sB2.p1.block}`);
  console.log(`  desync: A=${sA2.desync}, B=${sB2.desync}`);

  if (compared === 0) {
    console.log("\n✗ FAIL: no overlapping snapshot frames between peers");
    process.exit(1);
  }
  const desync = sA2.desync != null || sB2.desync != null;
  if (mismatches === 0 && !desync) {
    console.log(`\n✓✓✓ PEERS AGREE on ${compared}/${frames.length} sampled past frames — no P2P contradiction`);
    process.exit(0);
  }
  console.log(`\n✗ FAIL: ${mismatches} checksum mismatches, desync=${desync}`);
  process.exit(1);
})().catch((e) => {
  console.error("HARNESS FAIL:", e);
  process.exit(1);
});
