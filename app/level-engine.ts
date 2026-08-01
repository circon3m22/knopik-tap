export const LEVEL_THRESHOLDS = [
  0,
  1_000,
  5_000,
  10_000,
  20_000,
  35_000,
  55_000,
  80_000,
  110_000,
  150_000,
  200_000,
] as const;

export const MAX_LEVEL = LEVEL_THRESHOLDS.length - 1;

export interface LevelState {
  level: number;
  progressCoins: number;
  lifetimeCoins: number;
}

export interface AddLevelCoinsResult {
  state: LevelState;
  levelsGained: number;
  progressRatio: number;
  coinsToNext: number;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function safeInteger(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value)));
}

function safeSum(left: number, right: number): number {
  return left >= Number.MAX_SAFE_INTEGER - right
    ? Number.MAX_SAFE_INTEGER
    : left + right;
}

export function levelThreshold(level: number): number {
  const safeLevel = Math.min(MAX_LEVEL, Math.max(0, Math.floor(level)));
  return LEVEL_THRESHOLDS[safeLevel];
}

export function nextLevelThreshold(level: number): number {
  const safeLevel = Math.min(MAX_LEVEL, Math.max(0, Math.floor(level)));
  return safeLevel >= MAX_LEVEL
    ? LEVEL_THRESHOLDS[MAX_LEVEL]
    : LEVEL_THRESHOLDS[safeLevel + 1];
}

export function levelProgressDetails(state: LevelState) {
  if (state.level >= MAX_LEVEL) return { progressRatio: 1, coinsToNext: 0 };
  const span = nextLevelThreshold(state.level) - levelThreshold(state.level);
  return {
    progressRatio: Math.min(1, state.progressCoins / span),
    coinsToNext: Math.max(0, span - state.progressCoins),
  };
}

function levelForLifetime(lifetimeCoins: number): number {
  let level = 0;
  for (let index = 1; index < LEVEL_THRESHOLDS.length; index += 1) {
    if (lifetimeCoins < LEVEL_THRESHOLDS[index]) break;
    level = index;
  }
  return level;
}

/** Returns a multiplier from 1.00 at level 0 to 1.45 at level 10. */
export function levelMultiplier(level: number): number {
  const safeLevel = Number.isFinite(level)
    ? Math.min(MAX_LEVEL, Math.max(0, Math.floor(level)))
    : 0;
  return Number((1 + safeLevel * 0.045).toFixed(3));
}

export function sanitizeLevelState(value: unknown): LevelState {
  const input = isRecord(value) ? value : {};
  const persistedLevel = Math.min(MAX_LEVEL, safeInteger(input.level));
  const span = nextLevelThreshold(persistedLevel) - levelThreshold(persistedLevel);
  const persistedProgress = persistedLevel >= MAX_LEVEL
    ? 0
    : Math.min(Math.max(0, span - 1), safeInteger(input.progressCoins));
  const minimumLifetime = levelThreshold(persistedLevel) + persistedProgress;
  const lifetimeCoins = Math.max(safeInteger(input.lifetimeCoins), minimumLifetime);
  const level = Math.max(persistedLevel, levelForLifetime(lifetimeCoins));
  const progressCoins = level >= MAX_LEVEL
    ? 0
    : Math.min(
        nextLevelThreshold(level) - levelThreshold(level) - 1,
        lifetimeCoins - levelThreshold(level),
      );
  return { level, progressCoins, lifetimeCoins };
}

export function addLevelCoins(value: unknown, earned: number): AddLevelCoinsResult {
  const current = sanitizeLevelState(value);
  const lifetimeCoins = safeSum(current.lifetimeCoins, safeInteger(earned));
  const level = levelForLifetime(lifetimeCoins);
  const progressCoins = level >= MAX_LEVEL
    ? 0
    : lifetimeCoins - levelThreshold(level);
  const state = { level, progressCoins, lifetimeCoins };
  return {
    state,
    levelsGained: Math.max(0, level - current.level),
    ...levelProgressDetails(state),
  };
}
