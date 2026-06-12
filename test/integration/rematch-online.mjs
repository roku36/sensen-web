// Two REAL P2P matches back-to-back: open 2 browsers, connect via matchbox,
// finish match #1 with forceVictory, click rematch on both, verify they
// re-pair and a fresh match starts. This is the actual reproduction of
// "rematch sometimes hangs".

import { chromium } from "playwright";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(label) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 700 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`[${label} err] ${e.message}`));
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error") console.log(`[${label} console.err] ${t}`);
  });
  await page.goto("http://localhost:5173?simple");
  await page.waitForFunction(() => window.__sensen != null);
  await page.fill("input[placeholder='matchbox signaling URL']", "ws://localhost:3536/sensen?next=2").catch(() => {});
  return { browser, page };
}

async function startOnlineMatch({ A, B }) {
  await Promise.all([
    A.page.click("button:has-text('Find Match (online)')"),
    B.page.click("button:has-text('Find Match (online)')"),
  ]);
  await Promise.all([
    A.page.waitForFunction(() => window.__sensen.getState() != null, null, { timeout: 15000 }),
    B.page.waitForFunction(() => window.__sensen.getState() != null, null, { timeout: 15000 }),
  ]);
}

async function getFrame(p) { return p.evaluate(() => window.__sensen.getState()?.frame ?? -1); }

(async () => {
  const A = await open("A");
  const B = await open("B");
  console.log("→ match #1: connecting…");
  try { await startOnlineMatch({ A, B }); } catch (e) {
    console.log("✗ failed to enter match #1:", e.message);
    const sA = await A.page.evaluate(() => useStoreSnapshot()).catch(() => null);
    const lA = await A.page.evaluate(() => window.__sensen?.getLog?.()).catch(() => null);
    const lB = await B.page.evaluate(() => window.__sensen?.getLog?.()).catch(() => null);
    console.log("A screen=", await A.page.evaluate(() => window.__sensen?.getScreen?.()), "log:", lA?.slice(-8));
    console.log("B screen=", await B.page.evaluate(() => window.__sensen?.getScreen?.()), "log:", lB?.slice(-8));
    process.exit(1);
  }
  const f1A = await getFrame(A.page); const f1B = await getFrame(B.page);
  console.log(`✓ match #1 in gameplay  A.frame=${f1A} B.frame=${f1B}`);

  // End the match. Both peers locally force opponent HP=0 so each side's
  // sim independently reaches a terminal result (forceVictory only mutates
  // local state — there's no concede signal in the wire protocol).
  await Promise.all([
    A.page.evaluate(() => window.__sensen.forceVictory()),
    B.page.evaluate(() => window.__sensen.forceVictory()),
  ]);
  await wait(500);
  const rA = await A.page.evaluate(() => window.__sensen.getState()?.result);
  const rB = await B.page.evaluate(() => window.__sensen.getState()?.result);
  console.log(`✓ result A=${rA} B=${rB}`);

  // Both click "次のマッチへ" simultaneously.
  console.log("→ rematch: clicking on both peers");
  await Promise.all([
    A.page.click("button:has-text('次のマッチへ')"),
    B.page.click("button:has-text('次のマッチへ')"),
  ]);

  // Both should re-enter gameplay.
  try {
    await Promise.all([
      A.page.waitForFunction(() => window.__sensen.getState() != null && window.__sensen.getState().result === 0, null, { timeout: 20000 }),
      B.page.waitForFunction(() => window.__sensen.getState() != null && window.__sensen.getState().result === 0, null, { timeout: 20000 }),
    ]);
  } catch (e) {
    console.log("✗ rematch did NOT enter gameplay within 20s");
    const lA = await A.page.evaluate(() => window.__sensen.getLog?.());
    const lB = await B.page.evaluate(() => window.__sensen.getLog?.());
    console.log("A log:", lA?.slice(-6));
    console.log("B log:", lB?.slice(-6));
    process.exit(1);
  }
  const f2A = await getFrame(A.page); const f2B = await getFrame(B.page);
  console.log(`✓ match #2 in gameplay  A.frame=${f2A} B.frame=${f2B}`);

  await A.browser.close();
  await B.browser.close();
  console.log("\n✓✓✓ back-to-back online rematch works");
})().catch((e) => { console.error("HARNESS ERR:", e.message); process.exit(1); });
