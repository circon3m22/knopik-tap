export const MAX_LEVEL = 10;
export const COINS_PER_LEVEL = 100;

export interface LevelState {
  level: number;
  /** Coins earned toward the next level in the current run. */
  progressCoins: number;
  /** All valid earned coins, including coins from runs that were later lost. */
  lifetimeCoins: number;
}

export interface AddLevelCoinsResult {
  state: LevelState;
  levelsGained: number;
  progressRatio: number;
  coinsToNext: number;
}

type UnknownRecord = Record<string, unknown>;

const MAX_RUN_PROGRESSION = (MAX_LEVEL - 1) * COINS_PER_LEVEL;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function safeInteger(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value)));
}

function safeSum(left: number, right: number): number {
  if (left >= Number.MAX_SAFE_INTEGER - right) {
    return Number.MAX_SAFE_INTEGER;
  }

  return left + right;
}

function runProgressionCoins(state: LevelState): number {
  if (state.level >= MAX_LEVEL) {
    return MAX_RUN_PROGRESSION;
  }

  return (state.level - 1) * COINS_PER_LEVEL + state.progressCoins;
}

function progressDetails(state: LevelState): Pick<
  AddLevelCoinsResult,
  "progressRatio" | "coinsToNext"
> {
  if (state.level >= MAX_LEVEL) {
    return { progressRatio: 1, coinsToNext: 0 };
  }

  return {
    progressRatio: state.progressCoins / COINS_PER_LEVEL,
    coinsToNext: COINS_PER_LEVEL - state.progressCoins,
  };
}

/** Returns a multiplier from 1.00 at level 1 to 1.45 at level 10. */
export function levelMultiplier(level: number): number {
  const safeLevel = Number.isFinite(level)
    ? Math.min(MAX_LEVEL, Math.max(1, Math.floor(level)))
    : 1;

  return Number((1 + (safeLevel - 1) * 0.05).toFixed(2));
}

/**
 * Cleans persisted level data. At maximum level the progress bar is treated as
 * complete; at other levels progress is always kept below the next threshold.
 */
export function sanitizeLevelState(value: unknown): LevelState {
  const input = isRecord(value) ? value : {};
  const level = Math.min(MAX_LEVEL, Math.max(1, safeInteger(input.level, 1)));
  const progressCoins =
    level >= MAX_LEVEL
      ? COINS_PER_LEVEL
      : Math.min(COINS_PER_LEVEL - 1, safeInteger(input.progressCoins));
  const currentRunCoins =
    level >= MAX_LEVEL
      ? MAX_RUN_PROGRESSION
      : (level - 1) * COINS_PER_LEVEL + progressCoins;

  return {
    level,
    progressCoins,
    lifetimeCoins: Math.max(safeInteger(input.lifetimeCoins), currentRunCoins),
  };
}

/** Adds real earned coins and advances through as many level thresholds as needed. */
export function addLevelCoins(
  value: unknown,
  earned: number,
): AddLevelCoinsResult {
  const current = sanitizeLevelState(value);
  const validEarned = safeInteger(earned);
  const lifetimeCoins = safeSum(current.lifetimeCoins, validEarned);
  const nextRunCoins = Math.min(
    MAX_RUN_PROGRESSION,
    safeSum(runProgressionCoins(current), validEarned),
  );
  const level = Math.min(
    MAX_LEVEL,
    Math.floor(nextRunCoins / COINS_PER_LEVEL) + 1,
  );
  const progressCoins =
    level >= MAX_LEVEL ? COINS_PER_LEVEL : nextRunCoins % COINS_PER_LEVEL;
  const state: LevelState = { level, progressCoins, lifetimeCoins };

  return {
    state,
    levelsGained: Math.max(0, level - current.level),
    ...progressDetails(state),
  };
}
