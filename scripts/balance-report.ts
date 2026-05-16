// Balance report. Runs every policy pair-up with N matches each, aggregates
// per-card stats across ALL matches, and writes a markdown report.
//
//   npx tsx scripts/balance-report.ts --n 500 --out balance-report.md

import { writeFileSync } from "node:fs";
import { createTestDeck } from "../src/sim/cards";
import { MatchResult, runBatch } from "../src/ai/harness";
import { aggregate, statsToMarkdown } from "../src/ai/balance";
import { policies, PolicyFactory } from "../src/ai/policy";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const N = parseInt(arg("n", "200"), 10);
const OUT = arg("out", "balance-report.md");

// Policy pool — include all interesting non-passive policies.
const pool: [string, PolicyFactory][] = [
  ["random", policies.random],
  ["greedyAttack", policies.greedyAttack],
  ["greedyDefense", policies.greedyDefense],
  ["heuristic", policies.heuristic],
];

const deck = createTestDeck();

const t0 = Date.now();
const allMatches: MatchResult[] = [];
const pairResults: { p0: string; p1: string; p0wins: number; p1wins: number; n: number }[] = [];

for (const [n0, f0] of pool) {
  for (const [n1, f1] of pool) {
    const r = runBatch(N, (seed) => ({
      matchSeed: seed,
      deckP0: deck, deckP1: deck,
      policyP0: f0(Number(seed) + 1),
      policyP1: f1(Number(seed) + 2),
    }));
    allMatches.push(...r.matches);
    pairResults.push({ p0: n0, p1: n1, p0wins: r.summary.p0wins, p1wins: r.summary.p1wins, n: N });
  }
}
const elapsed = Date.now() - t0;

// Build markdown.
const lines: string[] = [];
lines.push(`# Sensen バランスレポート`);
lines.push("");
lines.push(`生成: ${new Date().toISOString()}`);
lines.push(`合計マッチ数: ${allMatches.length}  (${pool.length * pool.length} ペア × ${N})`);
lines.push(`所要時間: ${elapsed}ms  (${(allMatches.length / (elapsed / 1000)).toFixed(0)} matches/sec)`);
lines.push("");

lines.push(`## ポリシー対戦表 (p0勝率)`);
lines.push("");
lines.push(`| p0 \\ p1 | ${pool.map(([n]) => n).join(" | ")} |`);
lines.push(`|---|${pool.map(() => "---").join("|")}|`);
for (const [n0] of pool) {
  const row: string[] = [n0];
  for (const [n1] of pool) {
    const r = pairResults.find((x) => x.p0 === n0 && x.p1 === n1)!;
    row.push(`${((r.p0wins / r.n) * 100).toFixed(0)}%`);
  }
  lines.push(`| ${row.join(" | ")} |`);
}
lines.push("");

const stats = aggregate(allMatches);
lines.push(statsToMarkdown(stats, "カード別統計 (全試合まとめ)"));

writeFileSync(OUT, lines.join("\n"));
console.log(`wrote ${OUT}`);
console.log(`ran ${allMatches.length} matches in ${elapsed}ms (${(allMatches.length / (elapsed / 1000)).toFixed(0)} matches/sec)`);
