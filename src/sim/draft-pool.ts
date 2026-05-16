// Curated reward pool for mid-match drafts. We deliberately exclude:
//  - Status cards (junk, only ever added by other cards)
//  - Cost-X charge attacks (would be confusing as a one-off reward)
//  - Cards that mostly add status to your OWN deck (PowerThrough etc.)
//
// Categories are roughly balanced so an average draft offers a mix of
// damage / defense / utility, with rare powers showing up sometimes.

import { CardId } from "./cards";

export const DRAFT_POOL: readonly CardId[] = [
  // Attacks
  CardId.Anger, CardId.Cleave, CardId.Headbutt, CardId.IronWave,
  CardId.PommelStrike, CardId.SwordBoomerang, CardId.ThunderClap,
  CardId.TwinStrike, CardId.BodySlam, CardId.Dropkick, CardId.Hemokinesis,
  CardId.Pummel, CardId.SearingBlow, CardId.Uppercut, CardId.Whirlwind,
  CardId.Bludgeon, CardId.Feed, CardId.Reaper, CardId.Carnage,
  CardId.FiendFire, CardId.Immolate, CardId.Clothesline,

  // Skills
  CardId.Armaments, CardId.Flex, CardId.ShrugItOff, CardId.TrueGrit,
  CardId.Warcry, CardId.BattleTrance, CardId.Bloodletting, CardId.BurningPact,
  CardId.Disarm, CardId.Entrench, CardId.FlameBarrier, CardId.GhostlyArmor,
  CardId.InfernalBlade, CardId.Intimidate, CardId.Rage, CardId.SecondWind,
  CardId.SeeingRed, CardId.Shockwave, CardId.SpotWeakness, CardId.Exhume,
  CardId.Impervious, CardId.LimitBreak, CardId.Offering,

  // Powers (rarer because they're transformative)
  CardId.Combust, CardId.DarkEmbrace, CardId.Evolve, CardId.FeelNoPain,
  CardId.FireBreathing, CardId.Inflame, CardId.Metallicize, CardId.Rupture,
  CardId.Berserk, CardId.Brutality, CardId.Juggernaut,
];
