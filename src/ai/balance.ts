// Cross-batch aggregations: per-card statistics across many matches.
//
// Pick rate    = times the card was played / total plays
// Win rate     = (times played by winning side) / (times played overall)
// Avg per match = times card was played per match
// Cost-eff     = avg damage (or block) per cost, for attack/skill cards
//
// These let us spot dead cards (low pick rate), overpowered cards
// (high win rate), and inefficient cards (poor damage/cost).

import { allCards, CardEffect, CardId, CardType, getCardDef } from "../sim/cards";
import { MatchResult } from "./harness";

export interface CardStats {
  id: CardId;
  name: string;
  type: CardType;
  cost: number;
  plays: number;
  playsByWinner: number;
  pickRate: number;       // plays / total plays across all matches
  winRate: number;        // playsByWinner / plays  (null when plays==0)
  playsPerMatch: number;  // plays / matchCount
  // For attack cards: average expected damage if used (no opp modifiers).
  // For skill cards: declared block (etc).
  baseValue: number;
}

export function aggregate(matches: MatchResult[]): CardStats[] {
  const totals = new Map<CardId, { plays: number; playsByWinner: number }>();
  let totalPlays = 0;
  for (const m of matches) {
    for (const p of m.plays) {
      const t = totals.get(p.c) ?? { plays: 0, playsByWinner: 0 };
      t.plays++;
      totalPlays++;
      if ((m.winner === 0 && p.s === 0) || (m.winner === 1 && p.s === 1)) t.playsByWinner++;
      totals.set(p.c, t);
    }
  }
  const out: CardStats[] = [];
  for (const def of allCards()) {
    const t = totals.get(def.id) ?? { plays: 0, playsByWinner: 0 };
    out.push({
      id: def.id,
      name: def.name,
      type: def.cardType,
      cost: def.cost,
      plays: t.plays,
      playsByWinner: t.playsByWinner,
      pickRate: totalPlays > 0 ? t.plays / totalPlays : 0,
      winRate: t.plays > 0 ? t.playsByWinner / t.plays : 0,
      playsPerMatch: t.plays / Math.max(1, matches.length),
      baseValue: declaredValue(def.effect),
    });
  }
  return out.sort((a, b) => b.plays - a.plays);
}

function declaredValue(e: CardEffect): number {
  switch (e.kind) {
    case "Damage": return e.amount;
    case "MultiHit": return e.damage * e.hits;
    case "Block": return e.amount;
    case "Heal": return e.amount;
    case "Thorns": return e.amount;
    case "Combo": return e.effects.reduce((s, x) => s + declaredValue(x), 0);
    default: return 0;
  }
}

export function statsToMarkdown(stats: CardStats[], header: string): string {
  const typeLabel = (t: CardType) =>
    t === CardType.Attack ? "攻撃" : t === CardType.Skill ? "技" : t === CardType.Power ? "パワー" : "状態";
  const rows = stats.map((s) => {
    const wr = s.plays > 0 ? `${(s.winRate * 100).toFixed(1)}%` : "—";
    const pr = `${(s.pickRate * 100).toFixed(2)}%`;
    const ppm = s.playsPerMatch.toFixed(2);
    return `| ${s.id} | ${s.name} | ${typeLabel(s.type)} | ${s.cost} | ${s.plays} | ${ppm} | ${pr} | ${wr} | ${s.baseValue} |`;
  });
  return [
    `# ${header}`,
    "",
    `| ID | Name | Type | Cost | Plays | Per match | Pick rate | Win rate | Base value |`,
    `|----|------|------|------|-------|-----------|-----------|----------|------------|`,
    ...rows,
  ].join("\n");
}
