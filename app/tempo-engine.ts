export type TapTempo = "slow" | "steady" | "fast";

export type RandomSource = () => number;

export const TEMPO_WINDOW_SIZE = 8;
export const FAST_TAP_INTERVAL_MS = 220;
export const SLOW_TAP_INTERVAL_MS = 850;
export const DEFAULT_TAP_INTERVAL_MS = 600;

export const SLOW_TAP_LIMIT_MIN = 5;
export const SLOW_TAP_LIMIT_MAX = 15;
export const FAST_TAP_LIMIT_MIN = 30;
export const FAST_TAP_LIMIT_MAX = 100;

export const FATIGUE_DURATION_MS = 90_000;
export const FATIGUE_TAP_LIMIT_MIN = 10;
export const FATIGUE_TAP_LIMIT_MAX = 20;

export const ULTRA_TAP_MIN_HOLD_MS = 2_000;
export const ULTRA_TAP_MAX_HOLD_MS = 15_000;
export const ULTRA_TAP_MAX_COINS = 1_000;

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  const safeMinimum = finiteOr(minimum, 0);
  const safeMaximum = Math.max(safeMinimum, finiteOr(maximum, safeMinimum));
  return Math.min(
    safeMaximum,
    Math.max(safeMinimum, finiteOr(value, safeMinimum)),
  );
}

function normalizedRandom(random: RandomSource): number {
  const value = finiteOr(random(), 0.5);
  return clamp(value, 0, 0.999999999);
}

function interpolate(from: number, to: number, ratio: number): number {
  return from + (to - from) * clamp(ratio, 0, 1);
}

/**
 * Returns the average of the newest valid tap intervals. Empty/invalid input
 * intentionally falls back to a neutral tempo instead of producing NaN.
 */
export function rollingAverageTapInterval(
  intervalsMs: readonly number[],
  windowSize: number = TEMPO_WINDOW_SIZE,
): number {
  const size = Math.max(1, Math.floor(finiteOr(windowSize, TEMPO_WINDOW_SIZE)));
  const validIntervals = intervalsMs
    .filter((interval) => Number.isFinite(interval) && interval >= 0)
    .slice(-size);

  if (validIntervals.length === 0) return DEFAULT_TAP_INTERVAL_MS;

  return (
    validIntervals.reduce((total, interval) => total + interval, 0) /
    validIntervals.length
  );
}

/** Keeps a bounded rolling interval history for the next tempo calculation. */
export function appendTapInterval(
  intervalsMs: readonly number[],
  intervalMs: number,
  windowSize: number = TEMPO_WINDOW_SIZE,
): number[] {
  const size = Math.max(1, Math.floor(finiteOr(windowSize, TEMPO_WINDOW_SIZE)));
  const nextInterval = Math.max(0, finiteOr(intervalMs, DEFAULT_TAP_INTERVAL_MS));
  return [...intervalsMs, nextInterval].slice(-size);
}

export function classifyTapTempo(averageIntervalMs: number): TapTempo {
  const interval = Math.max(
    0,
    finiteOr(averageIntervalMs, DEFAULT_TAP_INTERVAL_MS),
  );

  if (interval <= FAST_TAP_INTERVAL_MS) return "fast";
  if (interval >= SLOW_TAP_INTERVAL_MS) return "slow";
  return "steady";
}

/**
 * 0 means slow (850ms or more between taps), 1 means fast (220ms or less).
 */
export function calculateTempoRatio(averageIntervalMs: number): number {
  const interval = Math.max(
    0,
    finiteOr(averageIntervalMs, DEFAULT_TAP_INTERVAL_MS),
  );
  const intervalSpan = SLOW_TAP_INTERVAL_MS - FAST_TAP_INTERVAL_MS;
  return clamp((SLOW_TAP_INTERVAL_MS - interval) / intervalSpan, 0, 1);
}

/**
 * Picks the next tension threshold. At normal stamina it ranges from 5-15 for
 * slow tapping to 30-100 for fast tapping. A fatigue ratio of 1 forces the
 * post-ultra 10-20 range; as it decays to 0, normal tempo sensitivity returns.
 */
export function calculateTapLimit(
  averageIntervalMs: number,
  fatigueRemainingRatio: number,
  random: RandomSource = Math.random,
): number {
  const tempoRatio = calculateTempoRatio(averageIntervalMs);
  const fatigue = clamp(fatigueRemainingRatio, 0, 1);

  const normalMinimum = interpolate(
    SLOW_TAP_LIMIT_MIN,
    FAST_TAP_LIMIT_MIN,
    tempoRatio,
  );
  const normalMaximum = interpolate(
    SLOW_TAP_LIMIT_MAX,
    FAST_TAP_LIMIT_MAX,
    tempoRatio,
  );
  const minimum = interpolate(
    normalMinimum,
    FATIGUE_TAP_LIMIT_MIN,
    fatigue,
  );
  const maximum = interpolate(
    normalMaximum,
    FATIGUE_TAP_LIMIT_MAX,
    fatigue,
  );
  const lower = Math.min(minimum, maximum);
  const upper = Math.max(minimum, maximum);

  return Math.round(interpolate(lower, upper, normalizedRandom(random)));
}

/** Returns 1 immediately after ultra tap and linearly reaches 0 after 90s. */
export function calculateFatigueRatio(
  elapsedSinceUltraMs: number,
  durationMs: number = FATIGUE_DURATION_MS,
): number {
  const elapsed = Math.max(0, finiteOr(elapsedSinceUltraMs, 0));
  const duration = Math.max(1, finiteOr(durationMs, FATIGUE_DURATION_MS));
  return clamp(1 - elapsed / duration, 0, 1);
}

/** Exactly 15s is still safe; any positive overrun burns the ultra reward. */
export function isUltraTapOverheated(holdDurationMs: number): boolean {
  const duration = Math.max(0, finiteOr(holdDurationMs, 0));
  return duration > ULTRA_TAP_MAX_HOLD_MS;
}

/**
 * Resolves the reward at release. Releasing before 2s or after overheating
 * yields zero; the valid window grows linearly to exactly 1000 coins at 15s.
 */
export function calculateUltraTapCoins(holdDurationMs: number): number {
  const duration = Math.max(0, finiteOr(holdDurationMs, 0));
  if (
    duration < ULTRA_TAP_MIN_HOLD_MS ||
    isUltraTapOverheated(duration)
  ) {
    return 0;
  }

  return Math.min(
    ULTRA_TAP_MAX_COINS,
    Math.floor(
      (duration / ULTRA_TAP_MAX_HOLD_MS) * ULTRA_TAP_MAX_COINS,
    ),
  );
}
