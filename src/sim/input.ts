// Input bitflags - mirrors src/input.rs exactly.
export const INPUT_DRAW = 1 << 0;
export const INPUT_CARD_1 = 1 << 1;
export const INPUT_CARD_2 = 1 << 2;
export const INPUT_CARD_3 = 1 << 3;
export const INPUT_CARD_4 = 1 << 4;
export const INPUT_CARD_5 = 1 << 5;
export const INPUT_CARD_6 = 1 << 6;
export const INPUT_CARD_7 = 1 << 7;
export const INPUT_CARD_8 = 1 << 8;
export const INPUT_CARD_9 = 1 << 9;
export const INPUT_CARD_10 = 1 << 10;
// Draft picks (Z/X/C). Active only when an offer is on screen.
export const INPUT_PICK_1 = 1 << 11;
export const INPUT_PICK_2 = 1 << 12;
export const INPUT_PICK_3 = 1 << 13;

export const cardFlag = (handIndex: number): number | null =>
  handIndex < 10 && handIndex >= 0 ? 1 << (handIndex + 1) : null;

export const handIndexFromFlag = (flag: number): number | null => {
  for (let i = 0; i < 10; i++) {
    if ((flag & (1 << (i + 1))) !== 0) return i;
  }
  return null;
};

const KEY_TO_FLAG: Record<string, number> = {
  d: INPUT_DRAW, D: INPUT_DRAW,
  "1": INPUT_CARD_1, "2": INPUT_CARD_2, "3": INPUT_CARD_3, "4": INPUT_CARD_4, "5": INPUT_CARD_5,
  "6": INPUT_CARD_6, "7": INPUT_CARD_7, "8": INPUT_CARD_8, "9": INPUT_CARD_9, "0": INPUT_CARD_10,
  z: INPUT_PICK_1, Z: INPUT_PICK_1,
  x: INPUT_PICK_2, X: INPUT_PICK_2,
  c: INPUT_PICK_3, C: INPUT_PICK_3,
};

export const flagsFromKey = (key: string): number => KEY_TO_FLAG[key] ?? 0;
