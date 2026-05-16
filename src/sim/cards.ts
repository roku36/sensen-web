// Card system. Numbers tuned for the new HP=80 scale.
//
// Damage roughly maps Slay-the-Spire turn values to "damage per cast" in
// real-time. Slay's "Strike: 6 damage" stays 6 here. Block values likewise.
// Vulnerable/Weak are now SECONDS — short so you have to commit to a
// follow-up to capitalize, not free 3-turn debuffs.

export const enum CardType {
  Attack = 0,
  Skill = 1,
  Power = 2,
  Status = 3,
}

export const enum CardId {
  Unknown = 0,
  // Attacks 1-99
  Strike = 1, Bash = 2, Anger = 3, Cleave = 4, Clothesline = 5,
  Headbutt = 6, IronWave = 7, PommelStrike = 8, SwordBoomerang = 9,
  ThunderClap = 10, TwinStrike = 11, WildStrike = 12, BodySlam = 13,
  Carnage = 14, Dropkick = 15, Hemokinesis = 16, Pummel = 17,
  Rampage = 18, RecklessCharge = 19, SearingBlow = 20, Uppercut = 21,
  Whirlwind = 22, Bludgeon = 23, Feed = 24, FiendFire = 25,
  Immolate = 26, Reaper = 27,
  // Skills 100-199
  Defend = 100, Armaments = 101, Flex = 102, Havoc = 103, ShrugItOff = 104,
  TrueGrit = 105, Warcry = 106, BattleTrance = 107, Bloodletting = 108,
  BurningPact = 109, Disarm = 110, Entrench = 111, FlameBarrier = 112,
  GhostlyArmor = 113, InfernalBlade = 114, Intimidate = 115, PowerThrough = 116,
  Rage = 117, SecondWind = 118, SeeingRed = 119, Sentinel = 120,
  Shockwave = 121, SpotWeakness = 122, DoubleTap = 123, Exhume = 124,
  Impervious = 125, LimitBreak = 126, Offering = 127,
  // Powers 200-299
  Combust = 200, DarkEmbrace = 201, Evolve = 202, FeelNoPain = 203,
  FireBreathing = 204, Inflame = 205, Metallicize = 206, Rupture = 207,
  Barricade = 208, Berserk = 209, Brutality = 210, Corruption = 211,
  DemonForm = 212, Juggernaut = 213,
  // Status 300-399
  Dazed = 300, Wound = 301, Burn = 302, Slimed = 303, Void = 304,
}

export type CardEffect =
  | { kind: "Damage"; amount: number; pierceBlock?: number }  // pierceBlock 0..1: fraction that ignores block
  | { kind: "MultiHit"; damage: number; hits: number; pierceBlock?: number }
  | { kind: "Heal"; amount: number }
  | { kind: "Draw"; count: number }
  | { kind: "Block"; amount: number }
  | { kind: "Thorns"; amount: number }
  | { kind: "Strength"; amount: number }
  | { kind: "Vulnerable"; duration: number }
  | { kind: "SelfVulnerable"; duration: number }
  | { kind: "Weak"; duration: number }
  | { kind: "Accelerate"; bonusRate: number; duration: number }
  | { kind: "BodySlam" }
  | { kind: "Bloodletting"; amount: number }
  | { kind: "DoubleBlock" }
  | { kind: "DoubleStrength" }
  | { kind: "Rage"; blockPerAttack: number }
  | { kind: "Metallicize"; blockPerSecond: number }
  | { kind: "Combust"; selfDmgPerSec: number; enemyDmgPerSec: number }
  | { kind: "DemonForm"; strengthPerSecond: number }
  | { kind: "Barricade" }
  | { kind: "Juggernaut"; damageOnBlock: number }
  | { kind: "DarkEmbrace"; draw: number }
  | { kind: "Evolve"; draw: number }
  | { kind: "FeelNoPain"; block: number }
  | { kind: "FireBreathing"; damage: number }
  | { kind: "Rupture"; strength: number }
  | { kind: "Corruption" }
  | { kind: "Brutality"; selfDmgPerSec: number; draw: number; drawInterval: number }
  | { kind: "Exhaust" }
  | { kind: "AddStatus"; cardId: CardId }
  | { kind: "Combo"; effects: CardEffect[] };

export interface CardDef {
  id: CardId;
  name: string;
  cardType: CardType;
  cost: number;
  effect: CardEffect;
  /** chargeAttack=true: requires energy ≥ MAX_COST and consumes ALL of it. */
  chargeAttack?: boolean;
  /** Cards that exhaust on play (don't return to discard). */
  exhausts?: boolean;
}

const REG: Map<CardId, CardDef> = new Map();
const def = (d: CardDef) => REG.set(d.id, d);

// === Attacks ===
def({ id: CardId.Strike,        name: "Strike",          cardType: CardType.Attack, cost: 1.0, effect: { kind: "Damage", amount: 6 } });
def({ id: CardId.Bash,          name: "Bash",            cardType: CardType.Attack, cost: 2.0, effect: { kind: "Combo", effects: [{ kind: "Damage", amount: 8 }, { kind: "Vulnerable", duration: 3 }] } });
def({ id: CardId.Anger,         name: "Anger",           cardType: CardType.Attack, cost: 0.5, effect: { kind: "Damage", amount: 6 } });
def({ id: CardId.Cleave,        name: "Cleave",          cardType: CardType.Attack, cost: 1.0, effect: { kind: "Damage", amount: 8 } });
def({ id: CardId.Clothesline,   name: "Clothesline",     cardType: CardType.Attack, cost: 2.0, effect: { kind: "Combo", effects: [{ kind: "Damage", amount: 12 }, { kind: "Weak", duration: 3 }] } });
def({ id: CardId.Headbutt,      name: "Headbutt",        cardType: CardType.Attack, cost: 1.0, effect: { kind: "Damage", amount: 9 } });
def({ id: CardId.IronWave,      name: "Iron Wave",       cardType: CardType.Attack, cost: 1.0, effect: { kind: "Combo", effects: [{ kind: "Damage", amount: 5 }, { kind: "Block", amount: 5 }] } });
def({ id: CardId.PommelStrike,  name: "Pommel Strike",   cardType: CardType.Attack, cost: 1.0, effect: { kind: "Combo", effects: [{ kind: "Damage", amount: 9 }, { kind: "Draw", count: 1 }] } });
def({ id: CardId.SwordBoomerang,name: "Sword Boomerang", cardType: CardType.Attack, cost: 1.0, effect: { kind: "MultiHit", damage: 3, hits: 3 } });
def({ id: CardId.ThunderClap,   name: "Thunder Clap",    cardType: CardType.Attack, cost: 1.0, effect: { kind: "Combo", effects: [{ kind: "Damage", amount: 4 }, { kind: "Vulnerable", duration: 2 }] } });
def({ id: CardId.TwinStrike,    name: "Twin Strike",     cardType: CardType.Attack, cost: 1.0, effect: { kind: "MultiHit", damage: 5, hits: 2 } });
def({ id: CardId.WildStrike,    name: "Wild Strike",     cardType: CardType.Attack, cost: 1.0, effect: { kind: "Combo", effects: [{ kind: "Damage", amount: 12 }, { kind: "AddStatus", cardId: CardId.Wound }] } });
def({ id: CardId.BodySlam,      name: "Body Slam",       cardType: CardType.Attack, cost: 1.0, effect: { kind: "BodySlam" } });
def({ id: CardId.Carnage,       name: "Carnage",         cardType: CardType.Attack, cost: 2.0, effect: { kind: "Damage", amount: 20 }, exhausts: true });
def({ id: CardId.Dropkick,      name: "Dropkick",        cardType: CardType.Attack, cost: 1.0, effect: { kind: "Combo", effects: [{ kind: "Damage", amount: 5 }, { kind: "Draw", count: 1 }, { kind: "Accelerate", bonusRate: 0.5, duration: 2 }] } });
def({ id: CardId.Hemokinesis,   name: "Hemokinesis",     cardType: CardType.Attack, cost: 1.0, effect: { kind: "Combo", effects: [{ kind: "Bloodletting", amount: -2 }, { kind: "Damage", amount: 15 }] } });
def({ id: CardId.Pummel,        name: "Pummel",          cardType: CardType.Attack, cost: 1.0, effect: { kind: "MultiHit", damage: 2, hits: 4 } });
def({ id: CardId.Rampage,       name: "Rampage",         cardType: CardType.Attack, cost: 1.0, effect: { kind: "Damage", amount: 8 } });
def({ id: CardId.RecklessCharge,name: "Reckless Charge", cardType: CardType.Attack, cost: 0.5, effect: { kind: "Combo", effects: [{ kind: "Damage", amount: 7 }, { kind: "AddStatus", cardId: CardId.Wound }] } });
def({ id: CardId.SearingBlow,   name: "Searing Blow",    cardType: CardType.Attack, cost: 2.0, effect: { kind: "Damage", amount: 12 } });
def({ id: CardId.Uppercut,      name: "Uppercut",        cardType: CardType.Attack, cost: 2.0, effect: { kind: "Combo", effects: [{ kind: "Damage", amount: 13 }, { kind: "Weak", duration: 2 }, { kind: "Vulnerable", duration: 2 }] } });
def({ id: CardId.Whirlwind,     name: "Whirlwind",       cardType: CardType.Attack, cost: 3.0, effect: { kind: "MultiHit", damage: 5, hits: 3 } });
// Bludgeon: classic finisher. Now a charge attack — requires full energy and drains it.
def({ id: CardId.Bludgeon,      name: "Bludgeon",        cardType: CardType.Attack, cost: 5.0, effect: { kind: "Damage", amount: 32 }, chargeAttack: true });
def({ id: CardId.Feed,          name: "Feed",            cardType: CardType.Attack, cost: 1.0, effect: { kind: "Combo", effects: [{ kind: "Damage", amount: 10 }, { kind: "Heal", amount: 3 }] }, exhausts: true });
def({ id: CardId.FiendFire,     name: "Fiend Fire",      cardType: CardType.Attack, cost: 2.0, effect: { kind: "Damage", amount: 28, pierceBlock: 0.5 }, exhausts: true });
def({ id: CardId.Immolate,      name: "Immolate",        cardType: CardType.Attack, cost: 2.0, effect: { kind: "Combo", effects: [{ kind: "Damage", amount: 21 }, { kind: "AddStatus", cardId: CardId.Burn }] } });
def({ id: CardId.Reaper,        name: "Reaper",          cardType: CardType.Attack, cost: 2.0, effect: { kind: "Combo", effects: [{ kind: "Damage", amount: 4, pierceBlock: 1 }, { kind: "Heal", amount: 4 }] } });

// === Skills ===
def({ id: CardId.Defend,        name: "Defend",          cardType: CardType.Skill,  cost: 1.0, effect: { kind: "Block", amount: 5 } });
def({ id: CardId.Armaments,     name: "Armaments",       cardType: CardType.Skill,  cost: 1.0, effect: { kind: "Block", amount: 5 } });
def({ id: CardId.Flex,          name: "Flex",            cardType: CardType.Skill,  cost: 0.5, effect: { kind: "Strength", amount: 2 } });
def({ id: CardId.Havoc,         name: "Havoc",           cardType: CardType.Skill,  cost: 1.0, effect: { kind: "Draw", count: 1 } });
def({ id: CardId.ShrugItOff,    name: "Shrug It Off",    cardType: CardType.Skill,  cost: 1.0, effect: { kind: "Combo", effects: [{ kind: "Block", amount: 8 }, { kind: "Draw", count: 1 }] } });
def({ id: CardId.TrueGrit,      name: "True Grit",       cardType: CardType.Skill,  cost: 1.0, effect: { kind: "Block", amount: 7 } });
def({ id: CardId.Warcry,        name: "Warcry",          cardType: CardType.Skill,  cost: 0.5, effect: { kind: "Draw", count: 2 }, exhausts: true });
def({ id: CardId.BattleTrance,  name: "Battle Trance",   cardType: CardType.Skill,  cost: 0.5, effect: { kind: "Draw", count: 3 } });
def({ id: CardId.Bloodletting,  name: "Bloodletting",    cardType: CardType.Skill,  cost: 0.5, effect: { kind: "Combo", effects: [{ kind: "Bloodletting", amount: -3 }, { kind: "Accelerate", bonusRate: 1, duration: 5 }] } });
def({ id: CardId.BurningPact,   name: "Burning Pact",    cardType: CardType.Skill,  cost: 1.0, effect: { kind: "Draw", count: 2 } });
def({ id: CardId.Disarm,        name: "Disarm",          cardType: CardType.Skill,  cost: 1.0, effect: { kind: "Weak", duration: 4 }, exhausts: true });
def({ id: CardId.Entrench,      name: "Entrench",        cardType: CardType.Skill,  cost: 2.0, effect: { kind: "DoubleBlock" } });
def({ id: CardId.FlameBarrier,  name: "Flame Barrier",   cardType: CardType.Skill,  cost: 2.0, effect: { kind: "Combo", effects: [{ kind: "Block", amount: 12 }, { kind: "Thorns", amount: 4 }] } });
def({ id: CardId.GhostlyArmor,  name: "Ghostly Armor",   cardType: CardType.Skill,  cost: 1.0, effect: { kind: "Block", amount: 10 }, exhausts: true });
def({ id: CardId.InfernalBlade, name: "Infernal Blade",  cardType: CardType.Skill,  cost: 1.0, effect: { kind: "Draw", count: 2 }, exhausts: true });
def({ id: CardId.Intimidate,    name: "Intimidate",      cardType: CardType.Skill,  cost: 0.5, effect: { kind: "Weak", duration: 2 } });
def({ id: CardId.PowerThrough,  name: "Power Through",   cardType: CardType.Skill,  cost: 1.0, effect: { kind: "Combo", effects: [{ kind: "Block", amount: 15 }, { kind: "AddStatus", cardId: CardId.Wound }, { kind: "AddStatus", cardId: CardId.Wound }] } });
def({ id: CardId.Rage,          name: "Rage",            cardType: CardType.Skill,  cost: 0.5, effect: { kind: "Rage", blockPerAttack: 3 } });
def({ id: CardId.SecondWind,    name: "Second Wind",     cardType: CardType.Skill,  cost: 1.0, effect: { kind: "Block", amount: 20 }, exhausts: true });
def({ id: CardId.SeeingRed,     name: "Seeing Red",      cardType: CardType.Skill,  cost: 1.0, effect: { kind: "Accelerate", bonusRate: 1.5, duration: 4 } });
def({ id: CardId.Sentinel,      name: "Sentinel",        cardType: CardType.Skill,  cost: 1.0, effect: { kind: "Block", amount: 5 } });
def({ id: CardId.Shockwave,     name: "Shockwave",       cardType: CardType.Skill,  cost: 2.0, effect: { kind: "Combo", effects: [{ kind: "Weak", duration: 3 }, { kind: "Vulnerable", duration: 3 }] }, exhausts: true });
def({ id: CardId.SpotWeakness,  name: "Spot Weakness",   cardType: CardType.Skill,  cost: 1.0, effect: { kind: "Strength", amount: 3 } });
def({ id: CardId.DoubleTap,     name: "Double Tap",      cardType: CardType.Skill,  cost: 1.0, effect: { kind: "Draw", count: 1 } });
def({ id: CardId.Exhume,        name: "Exhume",          cardType: CardType.Skill,  cost: 1.0, effect: { kind: "Draw", count: 2 }, exhausts: true });
def({ id: CardId.Impervious,    name: "Impervious",      cardType: CardType.Skill,  cost: 2.0, effect: { kind: "Block", amount: 30 }, exhausts: true });
def({ id: CardId.LimitBreak,    name: "Limit Break",     cardType: CardType.Skill,  cost: 1.0, effect: { kind: "DoubleStrength" }, exhausts: true });
def({ id: CardId.Offering,      name: "Offering",        cardType: CardType.Skill,  cost: 0.5, effect: { kind: "Combo", effects: [{ kind: "Bloodletting", amount: -6 }, { kind: "Accelerate", bonusRate: 2, duration: 5 }, { kind: "Draw", count: 3 }] }, exhausts: true });

// === Powers (more expensive — they're permanent) ===
def({ id: CardId.Combust,       name: "Combust",         cardType: CardType.Power,  cost: 2.0, effect: { kind: "Combust", selfDmgPerSec: 0.5, enemyDmgPerSec: 2.5 } });
def({ id: CardId.DarkEmbrace,   name: "Dark Embrace",    cardType: CardType.Power,  cost: 3.0, effect: { kind: "DarkEmbrace", draw: 1 } });
def({ id: CardId.Evolve,        name: "Evolve",          cardType: CardType.Power,  cost: 2.0, effect: { kind: "Evolve", draw: 1 } });
def({ id: CardId.FeelNoPain,    name: "Feel No Pain",    cardType: CardType.Power,  cost: 2.0, effect: { kind: "FeelNoPain", block: 3 } });
def({ id: CardId.FireBreathing, name: "Fire Breathing",  cardType: CardType.Power,  cost: 2.0, effect: { kind: "FireBreathing", damage: 6 } });
def({ id: CardId.Inflame,       name: "Inflame",         cardType: CardType.Power,  cost: 2.0, effect: { kind: "Strength", amount: 2 } });
def({ id: CardId.Metallicize,   name: "Metallicize",     cardType: CardType.Power,  cost: 2.0, effect: { kind: "Metallicize", blockPerSecond: 3 } });
def({ id: CardId.Rupture,       name: "Rupture",         cardType: CardType.Power,  cost: 2.0, effect: { kind: "Rupture", strength: 1 } });
def({ id: CardId.Barricade,     name: "Barricade",       cardType: CardType.Power,  cost: 4.0, effect: { kind: "Barricade" } });
def({ id: CardId.Berserk,       name: "Berserk",         cardType: CardType.Power,  cost: 1.0, effect: { kind: "Combo", effects: [{ kind: "SelfVulnerable", duration: 2 }, { kind: "Accelerate", bonusRate: 0.5, duration: 999 }] } });
def({ id: CardId.Brutality,     name: "Brutality",       cardType: CardType.Power,  cost: 1.0, effect: { kind: "Brutality", selfDmgPerSec: 0.5, draw: 1, drawInterval: 3 } });
def({ id: CardId.Corruption,    name: "Corruption",      cardType: CardType.Power,  cost: 4.0, effect: { kind: "Corruption" } });
def({ id: CardId.DemonForm,     name: "Demon Form",      cardType: CardType.Power,  cost: 4.0, effect: { kind: "DemonForm", strengthPerSecond: 0.4 } });
def({ id: CardId.Juggernaut,    name: "Juggernaut",      cardType: CardType.Power,  cost: 3.0, effect: { kind: "Juggernaut", damageOnBlock: 5 } });

// === Status (junk cards — clog hand) ===
def({ id: CardId.Dazed,  name: "Dazed",  cardType: CardType.Status, cost: 999, effect: { kind: "Exhaust" }, exhausts: true });
def({ id: CardId.Wound,  name: "Wound",  cardType: CardType.Status, cost: 999, effect: { kind: "Exhaust" }, exhausts: true });
def({ id: CardId.Burn,   name: "Burn",   cardType: CardType.Status, cost: 999, effect: { kind: "Bloodletting", amount: -2 }, exhausts: true });
def({ id: CardId.Slimed, name: "Slimed", cardType: CardType.Status, cost: 1,   effect: { kind: "Exhaust" }, exhausts: true });
def({ id: CardId.Void,   name: "Void",   cardType: CardType.Status, cost: 999, effect: { kind: "Exhaust" }, exhausts: true });

export const getCardDef = (id: CardId): CardDef | undefined => REG.get(id);
export const allCards = (): CardDef[] => Array.from(REG.values());

export function createTestDeck(): CardId[] {
  return [
    CardId.Strike, CardId.Strike, CardId.Strike, CardId.Strike,
    CardId.Bash,
    CardId.Defend, CardId.Defend, CardId.Defend, CardId.Defend,
    CardId.IronWave, CardId.PommelStrike, CardId.TwinStrike, CardId.Clothesline,
    CardId.ShrugItOff, CardId.Flex,
    CardId.BodySlam, CardId.FlameBarrier, CardId.SpotWeakness,
    CardId.Inflame, CardId.Metallicize,
  ];
}
