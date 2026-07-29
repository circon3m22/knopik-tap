export type TapTempo = "slow" | "steady" | "fast";

export type RandomSource = () => number;

export const TEMPO_WINDOW_SIZE = 8;
export const FAST_TAP_INTERVAL_MS = 500;
export const SLOW_TAP_INTERVAL_MS = 1_000;
export const DEFAULT_TAP_INTERVAL_MS = 700;

export const VERY_SLOW_TAP_INTERVAL_MS = 1_200;
export const VERY_FAST_TAP_INTERVAL_MS = 300;

export const VERY_SLOW_TAP_LIMIT_MIN = 3;
export const VERY_SLOW_TAP_LIMIT_MAX = 5;
export const SLOW_TAP_LIMIT_MIN = 5;
export const SLOW_TAP_LIMIT_MAX = 10;
export const TWO_PER_SECOND_TAP_LIMIT_MIN = 20;
export const TWO_PER_SECOND_TAP_LIMIT_MAX = 45;
export const FAST_TAP_LIMIT_MIN = 35;
export const FAST_TAP_LIMIT_MAX = 70;

export const FATIGUE_DURATION_MS = 90_000;
export const FATIGUE_TAP_LIMIT_MIN = 10;
export const FATIGUE_TAP_LIMIT_MAX = 20;

export const ULTRA_TAP_MIN_HOLD_MS = 2_000;
export const ULTRA_TAP_OVERHEAT_MIN_MS = 2_100;
export const ULTRA_TAP_COMMON_MAX_MS = 5_000;
export const ULTRA_TAP_RARE_MAX_MS = 8_000;
export const ULTRA_TAP_MAX_HOLD_MS = 10_000;
export const ULTRA_TAP_DEFAULT_DEADLINE_MS = 3_000;
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
  let value = 0.5;

  try {
    value = finiteOr(typeof random === "function" ? random() : 0.5, 0.5);
  } catch {
    value = 0.5;
  }

  return clamp(value, 0, 0.999999999);
}

function interpolate(from: number, to: number, ratio: number): number {
  return from + (to - from) * clamp(ratio, 0, 1);
}

/** A continuous ease curve keeps the difficulty from jumping at anchor points. */
function smoothStep(ratio: number): number {
  const progress = clamp(ratio, 0, 1);
  return progress * progress * (3 - 2 * progress);
}

/**
 * Returns the average of the newest valid tap intervals. Empty/invalid input
 * intentionally falls back to a neutral tempo instead of producing NaN.
 */
export function rollingAverageTapInterval(
  intervalsMs: readonly number[],
  windowSize: number = TEMPO_WINDOW_SIZE,
): number {
  const size = Math.min(
    1_000,
    Math.max(1, Math.floor(finiteOr(windowSize, TEMPO_WINDOW_SIZE))),
  );
  const source = Array.isArray(intervalsMs) ? intervalsMs : [];
  const validIntervals = source
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
  const size = Math.min(
    1_000,
    Math.max(1, Math.floor(finiteOr(windowSize, TEMPO_WINDOW_SIZE))),
  );
  const nextInterval = Math.max(0, finiteOr(intervalMs, DEFAULT_TAP_INTERVAL_MS));
  const source = Array.isArray(intervalsMs) ? intervalsMs : [];
  return [...source, nextInterval].slice(-size);
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
 * 0 means one tap per second (or slower), 1 means two taps per second (or
 * faster). The UI can use this ratio to make slow play visibly lighter.
 */
export function calculateTempoRatio(averageIntervalMs: number): number {
  const interval = Math.max(
    0,
    finiteOr(averageIntervalMs, DEFAULT_TAP_INTERVAL_MS),
  );
  const intervalSpan = SLOW_TAP_INTERVAL_MS - FAST_TAP_INTERVAL_MS;
  return clamp((SLOW_TAP_INTERVAL_MS - interval) / intervalSpan, 0, 1);
}

type TapLimitBounds = readonly [minimum: number, maximum: number];

function interpolateBounds(
  slower: TapLimitBounds,
  faster: TapLimitBounds,
  fasterRatio: number,
): TapLimitBounds {
  const ratio = smoothStep(fasterRatio);
  return [
    interpolate(slower[0], faster[0], ratio),
    interpolate(slower[1], faster[1], ratio),
  ];
}

/**
 * Continuous hardcore difficulty curve:
 * - 1200ms+ between taps: 3-5 taps;
 * - 1000ms: 5-10 taps;
 * - 500ms (two taps/second): 20-45 taps;
 * - 300ms or faster: 35-70 taps.
 */
function calculateNormalTapLimitBounds(
  averageIntervalMs: number,
): TapLimitBounds {
  const interval = Math.max(
    0,
    finiteOr(averageIntervalMs, DEFAULT_TAP_INTERVAL_MS),
  );
  const verySlow: TapLimitBounds = [
    VERY_SLOW_TAP_LIMIT_MIN,
    VERY_SLOW_TAP_LIMIT_MAX,
  ];
  const slow: TapLimitBounds = [SLOW_TAP_LIMIT_MIN, SLOW_TAP_LIMIT_MAX];
  const twoPerSecond: TapLimitBounds = [
    TWO_PER_SECOND_TAP_LIMIT_MIN,
    TWO_PER_SECOND_TAP_LIMIT_MAX,
  ];
  const veryFast: TapLimitBounds = [FAST_TAP_LIMIT_MIN, FAST_TAP_LIMIT_MAX];

  if (interval >= VERY_SLOW_TAP_INTERVAL_MS) return verySlow;
  if (interval >= SLOW_TAP_INTERVAL_MS) {
    return interpolateBounds(
      verySlow,
      slow,
      (VERY_SLOW_TAP_INTERVAL_MS - interval) /
        (VERY_SLOW_TAP_INTERVAL_MS - SLOW_TAP_INTERVAL_MS),
    );
  }
  if (interval >= FAST_TAP_INTERVAL_MS) {
    return interpolateBounds(
      slow,
      twoPerSecond,
      (SLOW_TAP_INTERVAL_MS - interval) /
        (SLOW_TAP_INTERVAL_MS - FAST_TAP_INTERVAL_MS),
    );
  }
  if (interval > VERY_FAST_TAP_INTERVAL_MS) {
    return interpolateBounds(
      twoPerSecond,
      veryFast,
      (FAST_TAP_INTERVAL_MS - interval) /
        (FAST_TAP_INTERVAL_MS - VERY_FAST_TAP_INTERVAL_MS),
    );
  }

  return veryFast;
}

/**
 * Picks the next tension threshold from the hardcore tempo curve. A fatigue
 * ratio of 1 forces the post-ultra 10-20 range; as it decays to 0, normal
 * tempo sensitivity returns.
 */
export function calculateTapLimit(
  averageIntervalMs: number,
  fatigueRemainingRatio: number,
  random: RandomSource = Math.random,
): number {
  const [normalMinimum, normalMaximum] =
    calculateNormalTapLimitBounds(averageIntervalMs);
  const fatigue = clamp(fatigueRemainingRatio, 0, 1);
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

/** Clamps an external/loaded deadline to the supported secret deadline range. */
export function sanitizeUltraTapDeadline(deadlineMs: number): number {
  return clamp(
    finiteOr(deadlineMs, ULTRA_TAP_DEFAULT_DEADLINE_MS),
    ULTRA_TAP_OVERHEAT_MIN_MS,
    ULTRA_TAP_MAX_HOLD_MS,
  );
}

/**
 * Chooses one hidden overheat deadline using a single injected random sample.
 * 95% land in 2.1-5s (weighted toward the low end), 4% in 5-8s, and 1% in
 * 8-10s. The resulting mean is approximately three seconds.
 */
export function chooseUltraTapOverheatDeadline(
  random: RandomSource = Math.random,
): number {
  const sample = normalizedRandom(random);

  if (sample < 0.95) {
    const local = sample / 0.95;
    const weighted = Math.pow(local, 3.2);
    return Math.round(
      interpolate(
        ULTRA_TAP_OVERHEAT_MIN_MS,
        ULTRA_TAP_COMMON_MAX_MS,
        weighted,
      ),
    );
  }

  if (sample < 0.99) {
    return Math.round(
      interpolate(
        ULTRA_TAP_COMMON_MAX_MS,
        ULTRA_TAP_RARE_MAX_MS,
        (sample - 0.95) / 0.04,
      ),
    );
  }

  return Math.round(
    interpolate(
      ULTRA_TAP_RARE_MAX_MS,
      ULTRA_TAP_MAX_HOLD_MS,
      (sample - 0.99) / 0.01,
    ),
  );
}

/** Exactly at the hidden deadline is safe; any positive overrun overheats. */
export function isUltraTapOverheated(
  holdDurationMs: number,
  overheatDeadlineMs: number = ULTRA_TAP_MAX_HOLD_MS,
): boolean {
  const duration = Math.max(0, finiteOr(holdDurationMs, 0));
  const deadline = sanitizeUltraTapDeadline(overheatDeadlineMs);
  return duration > deadline;
}

/**
 * Resolves the reward against the hidden deadline. Releasing before two
 * seconds or strictly after the deadline yields zero; otherwise the reward is
 * linear and reaches exactly 1000 coins at that deadline.
 */
export function calculateUltraTapCoins(
  holdDurationMs: number,
  overheatDeadlineMs: number = ULTRA_TAP_MAX_HOLD_MS,
): number {
  const duration = Math.max(0, finiteOr(holdDurationMs, 0));
  const deadline = sanitizeUltraTapDeadline(overheatDeadlineMs);

  if (
    duration < ULTRA_TAP_MIN_HOLD_MS ||
    isUltraTapOverheated(duration, deadline)
  ) {
    return 0;
  }

  return Math.min(
    ULTRA_TAP_MAX_COINS,
    Math.floor((duration / deadline) * ULTRA_TAP_MAX_COINS),
  );
}
