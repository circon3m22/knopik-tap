export const DEFAULT_DIFFICULTY = 50;
export const MIN_DIFFICULTY = 0;
export const MAX_DIFFICULTY = 100;
export const BALANCE_DIFFICULTY_THRESHOLD = 10_000;

function finiteOr(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

export function clampDifficulty(value: number): number {
  return Math.round(
    Math.min(
      MAX_DIFFICULTY,
      Math.max(MIN_DIFFICULTY, finiteOr(value, DEFAULT_DIFFICULTY)),
    ),
  );
}

/**
 * Active balances above 10,000 make every hidden system rapidly harsher.
 * Twenty thousand remains the healthy upper edge; above it the effective
 * difficulty approaches the maximum.
 */
export function difficultyWithBalancePenalty(
  configuredDifficulty: number,
  activeBalance: number,
): number {
  const balance = Math.max(0, finiteOr(activeBalance, 0));
  if (balance <= BALANCE_DIFFICULTY_THRESHOLD) {
    return clampDifficulty(configuredDifficulty);
  }
  const growth = Math.min(
    30,
    ((balance - BALANCE_DIFFICULTY_THRESHOLD) / 10_000) * 30,
  );
  return clampDifficulty(configuredDifficulty + 20 + growth);
}

function difficultyCurve(
  difficulty: number,
  easyValue: number,
  standardValue: number,
  hardValue: number,
) {
  const normalized = clampDifficulty(difficulty);
  if (normalized === DEFAULT_DIFFICULTY) return standardValue;
  if (normalized < DEFAULT_DIFFICULTY) {
    const ratio = normalized / DEFAULT_DIFFICULTY;
    return easyValue + (standardValue - easyValue) * ratio;
  }
  const ratio = (normalized - DEFAULT_DIFFICULTY) / DEFAULT_DIFFICULTY;
  return standardValue + (hardValue - standardValue) * ratio;
}

/** Hidden scale for all earned tap and ultra-tap coins. */
export function difficultyRewardMultiplier(difficulty: number): number {
  return difficultyCurve(difficulty, 1.35, 1, 0.65);
}

/** More patience on easy, less patience on hard. */
export function difficultyPatienceMultiplier(difficulty: number): number {
  return difficultyCurve(difficulty, 1.55, 1, 0.65);
}

/** Scales the chance of entering the tired mood after a normal tap. */
export function difficultyTiredChanceMultiplier(difficulty: number): number {
  return difficultyCurve(difficulty, 0.25, 1, 2.5);
}

/** Scales the chance of an immediate bite while already tired. */
export function difficultyTiredSnapMultiplier(difficulty: number): number {
  return difficultyCurve(difficulty, 0.35, 1, 2.1);
}

/** Scales rare positive rolls such as the five-coin last tap. */
export function difficultyLuckMultiplier(difficulty: number): number {
  return difficultyCurve(difficulty, 1.8, 1, 0.5);
}

/** Scales post-action fatigue and recovery windows. */
export function difficultyFatigueMultiplier(difficulty: number): number {
  return difficultyCurve(difficulty, 0.55, 1, 1.65);
}

/** Scales the hidden safe window of ultra tap. */
export function difficultyUltraDeadlineMultiplier(difficulty: number): number {
  return difficultyCurve(difficulty, 1.4, 1, 0.82);
}

/** Hidden chance that a valid ultra run is doomed: 0% / 20% / 92%. */
export function difficultyUltraFailureChance(difficulty: number): number {
  return difficultyCurve(difficulty, 0, 0.2, 0.92);
}

export function difficultyDuration(baseMs: number, difficulty: number): number {
  return Math.round(Math.max(1, baseMs) * difficultyFatigueMultiplier(difficulty));
}

/**
 * The current game already has an invisible +8 point wheel bonus. Difficulty
 * 50 preserves it exactly; easy/hard add or remove up to another 15 points.
 */
export function difficultyRiskChance(
  displayedChance: number,
  difficulty: number,
): number {
  const normalized = clampDifficulty(difficulty);
  if (normalized === MIN_DIFFICULTY) return 100;
  if (normalized === MAX_DIFFICULTY) return 0;
  const adjustment = (DEFAULT_DIFFICULTY - normalized) * 0.3;
  return Math.min(98, Math.max(1, displayedChance + 8 + adjustment));
}
