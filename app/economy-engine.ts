import { clampDifficulty, difficultyWithBalancePenalty, difficultyRewardMultiplier } from "./difficulty-engine";
export type EconomyConfig = { difficulty: number; wealthImpact: number; rewardMultiplier: number; minWinChance: number };
export const DEFAULT_ECONOMY_CONFIG: EconomyConfig = { difficulty: 50, wealthImpact: 1, rewardMultiplier: 1, minWinChance: 5 };
const finite = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
export function normalizeEconomyConfig(input: Partial<EconomyConfig> | null | undefined): EconomyConfig {
  return {
    difficulty: clampDifficulty(finite(input?.difficulty, 50)),
    wealthImpact: Math.round(Math.min(3, Math.max(0, finite(input?.wealthImpact, 1))) * 100) / 100,
    rewardMultiplier: Math.round(Math.min(3, Math.max(0.25, finite(input?.rewardMultiplier, 1))) * 100) / 100,
    minWinChance: Math.round(Math.min(25, Math.max(1, finite(input?.minWinChance, 5)))),
  };
}
export function economyDifficulty(config: EconomyConfig, walletCoins: number): number {
  const original = difficultyWithBalancePenalty(config.difficulty, walletCoins);
  return clampDifficulty(config.difficulty + (original - config.difficulty) * config.wealthImpact);
}
export function economyTapMultiplier(config: EconomyConfig, effectiveDifficulty: number): number {
  return config.rewardMultiplier * difficultyRewardMultiplier(effectiveDifficulty);
}
export function economyWinChance(chance: number, config: EconomyConfig): number {
  return Math.min(100, Math.max(config.minWinChance, chance));
}
export function economyPayout(payout: number, config: EconomyConfig): number {
  return Math.max(0, Math.floor(payout * config.rewardMultiplier));
}
