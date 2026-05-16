// Headless simulation CLI.
//
//   npx tsx scripts/sim.ts --p0 greedyAttack --p1 random --n 1000
//
// Outputs a JSON summary to stdout and (optionally) a per-match log file.

import { writeFileSync } from "node:fs";
import { createTestDeck } from "../src/sim/cards";
import { runBatch } from "../src/ai/harness";
import { policies, PolicyFactory } from "../src/ai/policy";
import { aggregate } from "../src/ai/balance";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const p0Name = arg("p0", "heuristic");
const p1Name = arg("p1", "random");
const n = parseInt(arg("n", "200"), 10);
const out = arg("out", "");

const p0Fact = (policies as Record<string, PolicyFactory>)[p0Name];
const p1Fact = (policies as Record<string, PolicyFactory>)[p1Name];
if (!p0Fact) { console.error(`unknown policy: ${p0Name}`); process.exit(1); }
if (!p1Fact) { console.error(`unknown policy: ${p1Name}`); process.exit(1); }

const deck = createTestDeck();

const result = runBatch(n, (seed) => ({
  matchSeed: seed,
  deckP0: deck, deckP1: deck,
  policyP0: p0Fact(Number(seed) + 1),
  policyP1: p1Fact(Number(seed) + 2),
}));

console.log(`# ${p0Name} vs ${p1Name} (${n} matches, ${result.summary.durationMs}ms)\n`);
console.log(`p0 wins:   ${result.summary.p0wins} (${pct(result.summary.p0wins, n)})`);
console.log(`p1 wins:   ${result.summary.p1wins} (${pct(result.summary.p1wins, n)})`);
console.log(`draws:     ${result.summary.draws}`);
console.log(`timeouts:  ${result.summary.timeouts}`);
console.log(`avg frames: ${result.summary.avgFrames.toFixed(0)} (~${(result.summary.avgFrames / 60).toFixed(1)}s)`);
console.log(`avg dmg by p0: ${result.summary.avgDamageInflictedP0.toFixed(1)}`);
console.log(`avg dmg by p1: ${result.summary.avgDamageInflictedP1.toFixed(1)}`);
console.log(`throughput: ${(n / (result.summary.durationMs / 1000)).toFixed(0)} matches/sec`);

const stats = aggregate(result.matches);
console.log(`\n# top 10 cards by play count`);
for (const s of stats.slice(0, 10)) {
  console.log(`  ${s.name.padEnd(12)}  plays=${String(s.plays).padStart(4)}  picks=${(s.pickRate * 100).toFixed(2)}%  wr=${(s.winRate * 100).toFixed(1)}%`);
}

if (out) {
  writeFileSync(out, JSON.stringify({ summary: result.summary, stats }, null, 2));
  console.log(`\nwrote ${out}`);
}

function pct(a: number, b: number) { return `${((a / b) * 100).toFixed(1)}%`; }
