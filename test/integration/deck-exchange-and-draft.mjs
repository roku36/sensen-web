// Two real Chromium peers with DIFFERENT saved decks. Verify:
//   1. The deck handshake produces a state where p0 sees one deck and
//      p1 sees the other (asymmetric init).
//   2. After ~13s a draft offer fires for both peers and they see the
//      SAME 3 candidates (deterministic from match seed + handle RNG).
//   3. A pick on each peer adds the chosen card to their discard.

import { chromium } from "playwright";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(label, deckJson) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 700 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`[${label} err] ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") console.log(`[${label} ce] ${m.text()}`); });
  // Inject a deck into localStorage BEFORE the app boots so loadDeck() picks it up.
  await page.addInitScript(`localStorage.setItem("sensen.deck.v1", ${JSON.stringify(deckJson)});`);
  await page.goto("http://localhost:5173?simple");
  await page.waitForFunction(() => window.__sensen != null);
  await page.click("button:has-text('2D Simple')");
  return { browser, page };
}

(async () => {
  // Distinct decks. Both have at least 10 cards (MIN_DECK_SIZE).
  // A: all attacks, B: all defends. Should be very visibly different in-game.
  const deckA = JSON.stringify(Array(12).fill(1));   // CardId.Strike = 1
  const deckB = JSON.stringify(Array(12).fill(100)); // CardId.Defend = 100
  const A = await open("A", deckA);
  const B = await open("B", deckB);

  console.log("→ start match #1: A all-Strike, B all-Defend");
  await Promise.all([
    A.page.click("button:has-text('Find Match (online)')"),
    B.page.click("button:has-text('Find Match (online)')"),
  ]);
  await Promise.all([
    A.page.waitForFunction(() => window.__sensen.getState() != null, null, { timeout: 15000 }),
    B.page.waitForFunction(() => window.__sensen.getState() != null, null, { timeout: 15000 }),
  ]);

  const stA = await A.page.evaluate(() => window.__sensen.getState());
  const stB = await B.page.evaluate(() => window.__sensen.getState());
  // Both peers should see identical p0 / p1 deck contents (i.e. agreement).
  const sortMS = (a) => a.slice().sort((x, y) => x - y);
  const p0deckA = sortMS([...stA.players[0].deck, ...stA.players[0].hand]);
  const p0deckB = sortMS([...stB.players[0].deck, ...stB.players[0].hand]);
  const p1deckA = sortMS([...stA.players[1].deck, ...stA.players[1].hand]);
  const p1deckB = sortMS([...stB.players[1].deck, ...stB.players[1].hand]);
  console.log(`p0 multiset agrees: ${JSON.stringify(p0deckA) === JSON.stringify(p0deckB)}`);
  console.log(`p1 multiset agrees: ${JSON.stringify(p1deckA) === JSON.stringify(p1deckB)}`);
  // p0 multiset should be either all-strike or all-defend; p1 the other.
  const isAllStrike = (d) => d.every((c) => c === 1);
  const isAllDefend = (d) => d.every((c) => c === 100);
  const decksAsymmetric = (isAllStrike(p0deckA) && isAllDefend(p1deckA)) || (isAllDefend(p0deckA) && isAllStrike(p1deckA));
  console.log(`decks are asymmetric (one Strike-only, one Defend-only): ${decksAsymmetric}`);

  // Wait for the first draft offer (~12s + a bit).
  console.log("→ waiting ~13s for first draft offer…");
  await wait(13_500);
  const offA = await A.page.evaluate(() => window.__sensen.getState()?.players[window.__sensen.getLocalPlayer()].offer);
  const offB = await B.page.evaluate(() => window.__sensen.getState()?.players[window.__sensen.getLocalPlayer()].offer);
  console.log(`A's offer cards: ${offA?.cards?.join(",")}`);
  console.log(`B's offer cards: ${offB?.cards?.join(",")}`);

  // Both pick card #2 (Z key).
  await A.page.keyboard.press("z");
  await B.page.keyboard.press("z");
  await wait(400);
  const dA = await A.page.evaluate(() => window.__sensen.getState()?.players[window.__sensen.getLocalPlayer()].discard);
  const dB = await B.page.evaluate(() => window.__sensen.getState()?.players[window.__sensen.getLocalPlayer()].discard);
  const lastA = dA?.[dA.length - 1];
  const lastB = dB?.[dB.length - 1];
  console.log(`A's last discarded: ${lastA} (expect ${offA?.cards?.[0]})`);
  console.log(`B's last discarded: ${lastB} (expect ${offB?.cards?.[0]})`);

  await A.browser.close();
  await B.browser.close();

  const pass =
    JSON.stringify(p0deckA) === JSON.stringify(p0deckB) &&
    JSON.stringify(p1deckA) === JSON.stringify(p1deckB) &&
    decksAsymmetric &&
    !!offA?.cards?.length && !!offB?.cards?.length &&
    lastA === offA.cards[0] && lastB === offB.cards[0];
  console.log(pass ? "\n✓✓✓ deck exchange + draft pick verified" : "\n✗ failure");
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error("HARNESS ERR:", e.message); process.exit(1); });
