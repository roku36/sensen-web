// Input bitflags. Bits 0..10 are immediate-play (Draw + 10 cards).
// Bits 11..17 are RESERVATION inputs (set the auto-play target).
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

// Reservation inputs.
export const INPUT_RESERVE_DRAW = 1 << 11;
export const INPUT_RESERVE_CARD_1 = 1 << 12;
export const INPUT_RESERVE_CARD_2 = 1 << 13;
export const INPUT_RESERVE_CARD_3 = 1 << 14;
export const INPUT_RESERVE_CARD_4 = 1 << 15;
export const INPUT_RESERVE_CARD_5 = 1 << 16;
export const INPUT_RESERVE_CARD_6 = 1 << 17;

export const cardFlag = (handIndex: number): number | null =>
  handIndex < 10 && handIndex >= 0 ? 1 << (handIndex + 1) : null;

export const reserveCardFlag = (handIndex: number): number | null =>
  handIndex >= 0 && handIndex < 6 ? 1 << (handIndex + 12) : null;

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
};

export const flagsFromKey = (key: string): number => KEY_TO_FLAG[key] ?? 0;
