import {
  DEFAULT_DIFFICULTY,
  clampDifficulty,
  difficultyLuckMultiplier,
} from "./difficulty-engine.ts";

export const SLOT_SYMBOLS = ["cherry", "lemon", "seven", "star", "diamond"] as const;
export type SlotSymbol = (typeof SLOT_SYMBOLS)[number];
export type SlotTier = "jackpot" | "triple" | "pair" | "loss";

export const SLOT_SYMBOL_LABELS: Record<SlotSymbol, string> = {
  cherry: "ВИШНЯ",
  lemon: "ЛИМОН",
  seven: "СЕМЬ",
  star: "ЗВЕЗДА",
  diamond: "АЛМАЗ",
};

export type SlotOutcome = {
  reels: [SlotSymbol, SlotSymbol, SlotSymbol];
  tier: SlotTier;
  multiplier: number;
  payout: number;
};

/** Without the mohawk every mini-game is all-in; the mohawk unlocks bet choice. */
export function resolveMiniGameBet(
  balance: number,
  requestedBet: number,
  canChooseBet: boolean,
): number {
  const safeBalance = Math.max(0, Math.floor(Number.isFinite(balance) ? balance : 0));
  if (!canChooseBet || safeBalance === 0) return safeBalance;
  const safeRequest = Math.max(1, Math.floor(Number.isFinite(requestedBet) ? requestedBet : 1));
  return Math.min(safeBalance, safeRequest);
}

export const MINE_MULTIPLIERS = [
  1.18, 1.47, 1.84, 2.3, 2.87, 3.59, 4.49, 5.61, 7.01, 8.76,
] as const;

function unit(random: () => number) {
  return Math.min(0.999999999, Math.max(0, random()));
}

function pickSymbol(
  random: () => number,
  symbols: readonly SlotSymbol[] = SLOT_SYMBOLS,
): SlotSymbol {
  return symbols[Math.floor(unit(random) * symbols.length)] ?? "cherry";
}

function shuffledTriple(
  values: [SlotSymbol, SlotSymbol, SlotSymbol],
  random: () => number,
): [SlotSymbol, SlotSymbol, SlotSymbol] {
  const copy = [...values] as [SlotSymbol, SlotSymbol, SlotSymbol];
  const swap = Math.floor(unit(random) * 3);
  [copy[swap], copy[2]] = [copy[2], copy[swap]];
  return copy;
}

/** Hidden difficulty changes actual slot odds; difficulty 50 is the base table. */
export function createSlotOutcome(
  bet: number,
  difficulty: number = DEFAULT_DIFFICULTY,
  random: () => number = Math.random,
): SlotOutcome {
  const safeBet = Math.max(0, Math.floor(Number.isFinite(bet) ? bet : 0));
  const luck = difficultyLuckMultiplier(difficulty);
  const jackpotChance = 0.015 * luck;
  const tripleChance = 0.06 * luck;
  const pairChance = 0.43 * luck;
  const roll = unit(random);

  let reels: [SlotSymbol, SlotSymbol, SlotSymbol];
  let tier: SlotTier;
  let multiplier: number;

  if (roll < jackpotChance) {
    reels = ["diamond", "diamond", "diamond"];
    tier = "jackpot";
    multiplier = 6;
  } else if (roll < jackpotChance + tripleChance) {
    const symbol = pickSymbol(random, ["cherry", "lemon", "seven", "star"]);
    reels = [symbol, symbol, symbol];
    tier = "triple";
    multiplier = symbol === "seven" ? 4 : 3.2;
  } else if (roll < jackpotChance + tripleChance + pairChance) {
    const pair = pickSymbol(random);
    const others = SLOT_SYMBOLS.filter((symbol) => symbol !== pair);
    const third = pickSymbol(random, others);
    reels = shuffledTriple([pair, pair, third], random);
    tier = "pair";
    multiplier = 1.35;
  } else {
    const first = pickSymbol(random);
    const second = pickSymbol(random, SLOT_SYMBOLS.filter((symbol) => symbol !== first));
    const third = pickSymbol(
      random,
      SLOT_SYMBOLS.filter((symbol) => symbol !== first && symbol !== second),
    );
    reels = shuffledTriple([first, second, third], random);
    tier = "loss";
    multiplier = 0;
  }

  return {
    reels,
    tier,
    multiplier,
    payout: multiplier > 0 ? Math.floor(safeBet * multiplier) : 0,
  };
}

/** The five buttons stay visually identical while the real safe chance is hidden. */
export function mineSafeChance(difficulty: number = DEFAULT_DIFFICULTY): number {
  return Math.min(0.95, Math.max(0.65, 0.8 + (50 - clampDifficulty(difficulty)) * 0.003));
}

export type MinePickOutcome = {
  safe: boolean;
  mineIndex: number;
};

export function createMinePickOutcome(
  selectedIndex: number,
  difficulty: number = DEFAULT_DIFFICULTY,
  random: () => number = Math.random,
): MinePickOutcome {
  const selected = Math.min(4, Math.max(0, Math.floor(selectedIndex)));
  const safe = unit(random) < mineSafeChance(difficulty);
  if (!safe) return { safe: false, mineIndex: selected };

  const safeMineIndexes = [0, 1, 2, 3, 4].filter((index) => index !== selected);
  const mineIndex = safeMineIndexes[Math.floor(unit(random) * safeMineIndexes.length)] ?? 0;
  return { safe: true, mineIndex };
}

export function minePayout(bet: number, completedRounds: number): number {
  const safeBet = Math.max(0, Math.floor(Number.isFinite(bet) ? bet : 0));
  const index = Math.min(MINE_MULTIPLIERS.length - 1, Math.max(0, completedRounds - 1));
  return completedRounds > 0 ? Math.floor(safeBet * MINE_MULTIPLIERS[index]) : safeBet;
}
