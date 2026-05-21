// Card system. Cast-time model (閃 units):
//   cost              — cast time in 閃 (integer). 1 = baseline; 2 = heavy.
//                       999 = unplayable status junk.
//   prereqQueueTime?  — if set, the player must already have at least this
//                       many 閃 of remaining cast-time queued before they
//                       can queue this card. Used for "finisher" cards so
//                       big effects require visible setup the opponent can
//                       read and counter-play against.

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
  Counter = 128, ToxicSpray = 129,
  // Heavy attack tier (3閃 cost, prereq 2+ 閃). All reveal-tagged so the
  // opponent can plan around them.
  Bloodbath = 130,        // 40 dmg, prereq 2閃
  ToxicDose = 131,        // poison 10 + 6 dmg, prereq 1閃
  SacredStrike = 132,     // 25 dmg + heal 10, prereq 2閃
  ArcLightning = 133,     // 6 dmg × 4, prereq 1閃
  SiegeBreaker = 134,     // 40 dmg, 50% pierce, prereq 3閃
  // Powers 200-299
  Combust = 200, DarkEmbrace = 201, Evolve = 202, FeelNoPain = 203,
  FireBreathing = 204, Inflame = 205, Metallicize = 206, Rupture = 207,
  Barricade = 208, Berserk = 209, Brutality = 210, Corruption = 211,
  DemonForm = 212, Juggernaut = 213,
  // Status 300-399
  Dazed = 300, Wound = 301, Burn = 302, Slimed = 303, Void = 304,
}

export type CardEffect =
  | { kind: "Damage"; amount: number; pierceBlock?: number }
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
  // Apply N stacks of Poison to the target. Poison ticks 1 HP per stack
  // per 閃 (ignoring block), then decrements by 1 each tick.
  | { kind: "Poison"; amount: number }
  // Counter: while this card is the QUEUE HEAD (currently casting), any
  // attack damage dealt to the player is reflected back to the attacker
  // at 2× the original amount. The card itself has no on-resolve effect.
  | { kind: "Counter" }
  | { kind: "Combo"; effects: CardEffect[] };

export interface CardDef {
  id: CardId;
  name: string;
  description: string;
  cardType: CardType;
  /** Cast time in 閃 (integer). ≥ 1 for playable; 999 = status junk. */
  cost: number;
  /** Required already-queued cast time in 閃 before this card can be queued. */
  prereqQueueTime?: number;
  effect: CardEffect;
  /** Cards that exhaust on play (don't return to discard). */
  exhausts?: boolean;
  /** [開示] characteristic — this card is shown face-up in the opponent's
   *  hand. Powerful or signature cards usually carry this so the opponent
   *  can read and prepare for the threat. */
  reveal?: boolean;
}

const REG: Map<CardId, CardDef> = new Map();
const def = (d: CardDef) => REG.set(d.id, d);

// === 攻撃 (Attacks) — baseline cast 3s; finishers 5-6s with prereq ===
def({ id: CardId.Strike,        name: "打撃",         description: "6ダメージ。",                                         cardType: CardType.Attack, cost: 1, effect: { kind: "Damage", amount: 6 } });
def({ id: CardId.Bash,          name: "強打",         description: "8ダメージ。相手に脆弱を3秒。",                       cardType: CardType.Attack, cost: 1, effect: { kind: "Combo", effects: [{ kind: "Damage", amount: 8 }, { kind: "Vulnerable", duration: 3 }] } });
def({ id: CardId.Anger,         name: "怒り",         description: "6ダメージ。",                                         cardType: CardType.Attack, cost: 1, effect: { kind: "Damage", amount: 6 } });
def({ id: CardId.Cleave,        name: "薙ぎ払い",     description: "8ダメージ。",                                         cardType: CardType.Attack, cost: 1, effect: { kind: "Damage", amount: 8 } });
def({ id: CardId.Clothesline,   name: "ラリアット",   description: "12ダメージ。相手に弱体を3秒。",                       cardType: CardType.Attack, cost: 1, effect: { kind: "Combo", effects: [{ kind: "Damage", amount: 12 }, { kind: "Weak", duration: 3 }] } });
def({ id: CardId.Headbutt,      name: "頭突き",       description: "9ダメージ。",                                         cardType: CardType.Attack, cost: 1, effect: { kind: "Damage", amount: 9 } });
def({ id: CardId.IronWave,      name: "鉄の波動",     description: "5ダメージ + ブロック5。攻防一体。",                  cardType: CardType.Attack, cost: 1, effect: { kind: "Combo", effects: [{ kind: "Damage", amount: 5 }, { kind: "Block", amount: 5 }] } });
def({ id: CardId.PommelStrike,  name: "柄打ち",       description: "9ダメージ。1枚追加ドロー。",                          cardType: CardType.Attack, cost: 1, effect: { kind: "Combo", effects: [{ kind: "Damage", amount: 9 }, { kind: "Draw", count: 1 }] } });
def({ id: CardId.SwordBoomerang,name: "剣のブーメラン",description: "3ダメージを3回。",                                    cardType: CardType.Attack, cost: 1, effect: { kind: "MultiHit", damage: 3, hits: 3 } });
def({ id: CardId.ThunderClap,   name: "雷鳴の拍手",   description: "4ダメージ。相手に脆弱を2秒。",                       cardType: CardType.Attack, cost: 1, effect: { kind: "Combo", effects: [{ kind: "Damage", amount: 4 }, { kind: "Vulnerable", duration: 2 }] } });
def({ id: CardId.TwinStrike,    name: "二連撃",       description: "5ダメージを2回。",                                    cardType: CardType.Attack, cost: 1, effect: { kind: "MultiHit", damage: 5, hits: 2 } });
def({ id: CardId.WildStrike,    name: "蛮撃",         description: "12ダメージ。山札に「傷」を1枚追加。",                cardType: CardType.Attack, cost: 1, effect: { kind: "Combo", effects: [{ kind: "Damage", amount: 12 }, { kind: "AddStatus", cardId: CardId.Wound }] } });
def({ id: CardId.BodySlam,      name: "体当たり",     description: "現在のブロック値と同じダメージ。",                   cardType: CardType.Attack, cost: 1, effect: { kind: "BodySlam" } });
// Carnage: heavy finisher, needs setup
def({ id: CardId.Carnage,       name: "殺戮",         description: "25ダメージ。キューに4秒以上積まれている必要あり。1試合に1回限り。[開示]", cardType: CardType.Attack, cost: 2, prereqQueueTime: 1, effect: { kind: "Damage", amount: 25 }, exhausts: true, reveal: true });
def({ id: CardId.Dropkick,      name: "ドロップキック",description: "5ダメージ。1枚追加ドロー。",                          cardType: CardType.Attack, cost: 1, effect: { kind: "Combo", effects: [{ kind: "Damage", amount: 5 }, { kind: "Draw", count: 1 }] } });
def({ id: CardId.Hemokinesis,   name: "血操術",       description: "自分が2ダメージ。相手に15ダメージ。",                cardType: CardType.Attack, cost: 1, effect: { kind: "Combo", effects: [{ kind: "Bloodletting", amount: -2 }, { kind: "Damage", amount: 15 }] } });
def({ id: CardId.Pummel,        name: "連打",         description: "2ダメージを4回。",                                    cardType: CardType.Attack, cost: 1, effect: { kind: "MultiHit", damage: 2, hits: 4 } });
def({ id: CardId.Rampage,       name: "猛攻",         description: "8ダメージ。",                                         cardType: CardType.Attack, cost: 1, effect: { kind: "Damage", amount: 8 } });
def({ id: CardId.RecklessCharge,name: "無謀な突進",   description: "7ダメージ。山札に「傷」を1枚追加。",                  cardType: CardType.Attack, cost: 1, effect: { kind: "Combo", effects: [{ kind: "Damage", amount: 7 }, { kind: "AddStatus", cardId: CardId.Wound }] } });
def({ id: CardId.SearingBlow,   name: "灼熱の一撃",   description: "12ダメージ。",                                        cardType: CardType.Attack, cost: 1, effect: { kind: "Damage", amount: 12 } });
def({ id: CardId.Uppercut,      name: "アッパーカット",description: "13ダメージ。弱体2秒+脆弱2秒。",                      cardType: CardType.Attack, cost: 1, effect: { kind: "Combo", effects: [{ kind: "Damage", amount: 13 }, { kind: "Weak", duration: 2 }, { kind: "Vulnerable", duration: 2 }] } });
def({ id: CardId.Whirlwind,     name: "旋風",         description: "5ダメージを3回。",                                    cardType: CardType.Attack, cost: 1, effect: { kind: "MultiHit", damage: 5, hits: 3 } });
// Bludgeon: signature finisher
def({ id: CardId.Bludgeon,      name: "重撃",         description: "32ダメージ。キューに6秒以上積まれている必要あり。[開示]",  cardType: CardType.Attack, cost: 2, prereqQueueTime: 2, effect: { kind: "Damage", amount: 32 }, reveal: true });
def({ id: CardId.Feed,          name: "捕食",         description: "10ダメージ + 3回復。1試合に1回限り。",                cardType: CardType.Attack, cost: 1, effect: { kind: "Combo", effects: [{ kind: "Damage", amount: 10 }, { kind: "Heal", amount: 3 }] }, exhausts: true });
def({ id: CardId.FiendFire,     name: "鬼火",         description: "28ダメージ。半分はブロック貫通。キューに5秒以上必要。1回限り。[開示]", cardType: CardType.Attack, cost: 2, prereqQueueTime: 2, effect: { kind: "Damage", amount: 28, pierceBlock: 0.5 }, exhausts: true, reveal: true });
def({ id: CardId.Immolate,      name: "焼却",         description: "21ダメージ。捨て札に「火傷」を追加。キューに4秒以上必要。[開示]", cardType: CardType.Attack, cost: 2, prereqQueueTime: 1, effect: { kind: "Combo", effects: [{ kind: "Damage", amount: 21 }, { kind: "AddStatus", cardId: CardId.Burn }] }, reveal: true });
def({ id: CardId.Reaper,        name: "死神",         description: "8ダメージ(ブロック貫通)+ 6回復。",                    cardType: CardType.Attack, cost: 1, effect: { kind: "Combo", effects: [{ kind: "Damage", amount: 8, pierceBlock: 1 }, { kind: "Heal", amount: 6 }] } });

// === 技 (Skills) ===
def({ id: CardId.Defend,        name: "防御",         description: "ブロック5。",                                          cardType: CardType.Skill,  cost: 1, effect: { kind: "Block", amount: 5 } });
def({ id: CardId.Armaments,     name: "武装",         description: "ブロック5。",                                          cardType: CardType.Skill,  cost: 1, effect: { kind: "Block", amount: 5 } });
def({ id: CardId.Flex,          name: "誇示",         description: "筋力+2。",                                            cardType: CardType.Skill,  cost: 1, effect: { kind: "Strength", amount: 2 } });
def({ id: CardId.Havoc,         name: "撹乱",         description: "1枚追加ドロー。",                                      cardType: CardType.Skill,  cost: 1, effect: { kind: "Draw", count: 1 } });
def({ id: CardId.ShrugItOff,    name: "受け流し",     description: "ブロック8 + 1枚追加ドロー。",                          cardType: CardType.Skill,  cost: 1, effect: { kind: "Combo", effects: [{ kind: "Block", amount: 8 }, { kind: "Draw", count: 1 }] } });
def({ id: CardId.TrueGrit,      name: "不屈",         description: "ブロック7。",                                          cardType: CardType.Skill,  cost: 1, effect: { kind: "Block", amount: 7 } });
def({ id: CardId.Warcry,        name: "鬨の声",       description: "2枚追加ドロー。1試合に1回限り。",                     cardType: CardType.Skill,  cost: 1, effect: { kind: "Draw", count: 2 }, exhausts: true });
def({ id: CardId.BattleTrance,  name: "戦闘トランス", description: "3枚追加ドロー。",                                      cardType: CardType.Skill,  cost: 1, effect: { kind: "Draw", count: 3 } });
def({ id: CardId.Bloodletting,  name: "瀉血",         description: "自分が3ダメージ。",                                   cardType: CardType.Skill,  cost: 1, effect: { kind: "Bloodletting", amount: -3 } });
def({ id: CardId.BurningPact,   name: "焦熱の契約",   description: "2枚追加ドロー。",                                      cardType: CardType.Skill,  cost: 1, effect: { kind: "Draw", count: 2 } });
def({ id: CardId.Disarm,        name: "武装解除",     description: "相手に弱体を4秒。1試合に1回限り。",                  cardType: CardType.Skill,  cost: 1, effect: { kind: "Weak", duration: 4 }, exhausts: true });
def({ id: CardId.Entrench,      name: "塹壕",         description: "現在のブロックを2倍にする。",                         cardType: CardType.Skill,  cost: 1, effect: { kind: "DoubleBlock" } });
def({ id: CardId.FlameBarrier,  name: "炎の障壁",     description: "ブロック12 + 棘4。",                                  cardType: CardType.Skill,  cost: 1, effect: { kind: "Combo", effects: [{ kind: "Block", amount: 12 }, { kind: "Thorns", amount: 4 }] } });
def({ id: CardId.GhostlyArmor,  name: "幽霊鎧",       description: "ブロック10。1試合に1回限り。",                        cardType: CardType.Skill,  cost: 1, effect: { kind: "Block", amount: 10 }, exhausts: true });
def({ id: CardId.InfernalBlade, name: "地獄の刃",     description: "2枚追加ドロー。1試合に1回限り。",                     cardType: CardType.Skill,  cost: 1, effect: { kind: "Draw", count: 2 }, exhausts: true });
def({ id: CardId.Intimidate,    name: "威嚇",         description: "相手に弱体を2秒。",                                   cardType: CardType.Skill,  cost: 1, effect: { kind: "Weak", duration: 2 } });
def({ id: CardId.PowerThrough,  name: "底力",         description: "ブロック15。手札に「傷」を2枚追加。",                cardType: CardType.Skill,  cost: 1, effect: { kind: "Combo", effects: [{ kind: "Block", amount: 15 }, { kind: "AddStatus", cardId: CardId.Wound }, { kind: "AddStatus", cardId: CardId.Wound }] } });
def({ id: CardId.Rage,          name: "激昂",         description: "10秒間、攻撃完了ごとにブロック+3。",                  cardType: CardType.Skill,  cost: 1, effect: { kind: "Rage", blockPerAttack: 3 } });
def({ id: CardId.SecondWind,    name: "再起",         description: "ブロック20。1試合に1回限り。",                        cardType: CardType.Skill,  cost: 1, effect: { kind: "Block", amount: 20 }, exhausts: true });
def({ id: CardId.SeeingRed,     name: "赤を見る",     description: "現在無効 (要再設計)。",                              cardType: CardType.Skill,  cost: 1, effect: { kind: "Accelerate", bonusRate: 1.5, duration: 4 } });
def({ id: CardId.Sentinel,      name: "歩哨",         description: "ブロック5。",                                          cardType: CardType.Skill,  cost: 1, effect: { kind: "Block", amount: 5 } });
def({ id: CardId.Shockwave,     name: "衝撃波",       description: "相手に弱体3秒+脆弱3秒。1試合に1回限り。",            cardType: CardType.Skill,  cost: 1, effect: { kind: "Combo", effects: [{ kind: "Weak", duration: 3 }, { kind: "Vulnerable", duration: 3 }] }, exhausts: true });
def({ id: CardId.SpotWeakness,  name: "弱点看破",     description: "筋力+3。",                                            cardType: CardType.Skill,  cost: 1, effect: { kind: "Strength", amount: 3 } });
def({ id: CardId.DoubleTap,     name: "二段撃ち",     description: "1枚追加ドロー。",                                      cardType: CardType.Skill,  cost: 1, effect: { kind: "Draw", count: 1 } });
def({ id: CardId.Exhume,        name: "発掘",         description: "2枚追加ドロー。1試合に1回限り。",                     cardType: CardType.Skill,  cost: 1, effect: { kind: "Draw", count: 2 }, exhausts: true });
def({ id: CardId.Impervious,    name: "鉄壁",         description: "ブロック30。キューに4秒以上必要。1試合に1回限り。",  cardType: CardType.Skill,  cost: 2, prereqQueueTime: 1, effect: { kind: "Block", amount: 30 }, exhausts: true });
def({ id: CardId.LimitBreak,    name: "限界突破",     description: "現在の筋力を2倍。1試合に1回限り。",                  cardType: CardType.Skill,  cost: 1, effect: { kind: "DoubleStrength" }, exhausts: true });
def({ id: CardId.Offering,      name: "供物",         description: "自分が6ダメージ。3枚追加ドロー。1試合に1回限り。",   cardType: CardType.Skill,  cost: 1, effect: { kind: "Combo", effects: [{ kind: "Bloodletting", amount: -6 }, { kind: "Draw", count: 3 }] }, exhausts: true });
def({ id: CardId.Counter,       name: "カウンター",   description: "発動中、被ダメージの2倍を相手に返す。[開示]",         cardType: CardType.Skill,  cost: 2, effect: { kind: "Counter" }, reveal: true });
def({ id: CardId.ToxicSpray,    name: "毒液",         description: "相手に毒6。",                                          cardType: CardType.Skill,  cost: 1, effect: { kind: "Poison", amount: 6 } });

// === 重カード追加 (3閃 cost, prereq付き、全て[開示]) ===
def({ id: CardId.Bloodbath,     name: "血の宴",       description: "40ダメージ。キューに6秒以上積まれている必要あり。[開示]", cardType: CardType.Attack, cost: 3, prereqQueueTime: 2, effect: { kind: "Damage", amount: 40 }, reveal: true });
def({ id: CardId.ToxicDose,    name: "毒の盃",        description: "相手に毒10 + 6ダメージ。キューに3秒以上必要。[開示]", cardType: CardType.Attack, cost: 3, prereqQueueTime: 1, effect: { kind: "Combo", effects: [{ kind: "Damage", amount: 6 }, { kind: "Poison", amount: 10 }] }, reveal: true });
def({ id: CardId.SacredStrike,  name: "聖戦",         description: "25ダメージ + 自分10回復。キューに6秒以上必要。[開示]", cardType: CardType.Attack, cost: 3, prereqQueueTime: 2, effect: { kind: "Combo", effects: [{ kind: "Damage", amount: 25 }, { kind: "Heal", amount: 10 }] }, reveal: true });
def({ id: CardId.ArcLightning,  name: "雷光乱舞",     description: "6ダメージを4回。キューに3秒以上必要。[開示]",        cardType: CardType.Attack, cost: 3, prereqQueueTime: 1, effect: { kind: "MultiHit", damage: 6, hits: 4 }, reveal: true });
def({ id: CardId.SiegeBreaker,  name: "破城",         description: "40ダメージ。半分はブロック貫通。キューに9秒以上必要。[開示]", cardType: CardType.Attack, cost: 3, prereqQueueTime: 3, effect: { kind: "Damage", amount: 40, pierceBlock: 0.5 }, reveal: true });

// === パワー (Powers — 永続効果、長キャスト) ===
def({ id: CardId.Combust,       name: "燃焼",         description: "毎秒、自分0.5・相手2.5ダメージ。",                    cardType: CardType.Power,  cost: 1, effect: { kind: "Combust", selfDmgPerSec: 0.5, enemyDmgPerSec: 2.5 } });
def({ id: CardId.DarkEmbrace,   name: "闇の抱擁",     description: "カードが除外されるたびに1枚ドロー。キューに5秒以上必要。", cardType: CardType.Power,  cost: 2, prereqQueueTime: 2, effect: { kind: "DarkEmbrace", draw: 1 } });
def({ id: CardId.Evolve,        name: "進化",         description: "状態カードを引くたびに1枚ドロー。",                  cardType: CardType.Power,  cost: 1, effect: { kind: "Evolve", draw: 1 } });
def({ id: CardId.FeelNoPain,    name: "痛覚遮断",     description: "カードが除外されるたびにブロック+3。",                cardType: CardType.Power,  cost: 1, effect: { kind: "FeelNoPain", block: 3 } });
def({ id: CardId.FireBreathing, name: "火炎放射",     description: "状態カード引きで相手に6ダメージ。",                   cardType: CardType.Power,  cost: 1, effect: { kind: "FireBreathing", damage: 6 } });
def({ id: CardId.Inflame,       name: "炎上",         description: "筋力+2(永続)。",                                      cardType: CardType.Power,  cost: 1, effect: { kind: "Strength", amount: 2 } });
def({ id: CardId.Metallicize,   name: "金属化",       description: "毎秒ブロック+3。",                                    cardType: CardType.Power,  cost: 1, effect: { kind: "Metallicize", blockPerSecond: 3 } });
def({ id: CardId.Rupture,       name: "破裂",         description: "自傷ダメージを受けるたびに筋力+1。",                 cardType: CardType.Power,  cost: 1, effect: { kind: "Rupture", strength: 1 } });
def({ id: CardId.Barricade,     name: "防壁",         description: "ブロックが減少しなくなる。キューに6秒以上必要。[開示]", cardType: CardType.Power,  cost: 2, prereqQueueTime: 2, effect: { kind: "Barricade" }, reveal: true });
def({ id: CardId.Berserk,       name: "狂戦士",       description: "自分に脆弱2秒。",                                    cardType: CardType.Power,  cost: 1, effect: { kind: "SelfVulnerable", duration: 2 } });
def({ id: CardId.Brutality,     name: "残虐",         description: "毎秒自分0.5ダメージ。3秒ごとに1枚ドロー。",          cardType: CardType.Power,  cost: 1, effect: { kind: "Brutality", selfDmgPerSec: 0.5, draw: 1, drawInterval: 3 } });
def({ id: CardId.Corruption,    name: "腐敗",         description: "スキルが0秒キャスト・除外。キューに6秒以上必要。[開示]", cardType: CardType.Power,  cost: 2, prereqQueueTime: 2, effect: { kind: "Corruption" }, reveal: true });
def({ id: CardId.DemonForm,     name: "悪魔の姿",     description: "毎秒、筋力+0.4。キューに6秒以上必要。[開示]",       cardType: CardType.Power,  cost: 2, prereqQueueTime: 2, effect: { kind: "DemonForm", strengthPerSecond: 0.4 }, reveal: true });
def({ id: CardId.Juggernaut,    name: "巨獣",         description: "ブロック獲得時に5ダメージ。キューに5秒以上必要。",    cardType: CardType.Power,  cost: 2, prereqQueueTime: 2, effect: { kind: "Juggernaut", damageOnBlock: 5 } });

// === 状態カード (Status) ===
def({ id: CardId.Dazed,  name: "幻惑", description: "プレイ不可。手札を圧迫する。",                              cardType: CardType.Status, cost: 999, effect: { kind: "Exhaust" }, exhausts: true });
def({ id: CardId.Wound,  name: "傷",   description: "プレイ不可。",                                              cardType: CardType.Status, cost: 999, effect: { kind: "Exhaust" }, exhausts: true });
def({ id: CardId.Burn,   name: "火傷", description: "プレイすると自分が2ダメージ。",                            cardType: CardType.Status, cost: 999, effect: { kind: "Bloodletting", amount: -2 }, exhausts: true });
def({ id: CardId.Slimed, name: "粘液", description: "コスト3で何も起こらず除外される。",                        cardType: CardType.Status, cost: 1,   effect: { kind: "Exhaust" }, exhausts: true });
def({ id: CardId.Void,   name: "虚無", description: "プレイ不可。",                                              cardType: CardType.Status, cost: 999, effect: { kind: "Exhaust" }, exhausts: true });

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
    CardId.Inflame, CardId.Bludgeon,  // include a finisher so prereq feature is exercised
  ];
}
