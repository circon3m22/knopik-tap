import {
  DEFAULT_DIFFICULTY,
  difficultyRiskChance,
} from "./difficulty-engine.ts";

export const RISK_OPTIONS = [
  { chance: 10, multiplier: 6 },
  { chance: 20, multiplier: 3.6 },
  { chance: 30, multiplier: 2.65 },
  { chance: 40, multiplier: 2.1 },
  { chance: 50, multiplier: 1.75 },
  { chance: 60, multiplier: 1.5 },
  { chance: 70, multiplier: 1.35 },
  { chance: 80, multiplier: 1.2 },
  { chance: 90, multiplier: 1.08 },
] as const;

export type RiskChance = (typeof RISK_OPTIONS)[number]["chance"];

export type RiskOutcome = {
  chance: RiskChance;
  multiplier: number;
  bet: number;
  payout: number;
  finalAngle: number;
  won: boolean;
};

export function riskMultiplier(chance: number): number {
  return RISK_OPTIONS.find((option) => option.chance === chance)?.multiplier ?? 0;
}

export function createRiskOutcome(
  chance: RiskChance,
  bet: number,
  random: () => number = Math.random,
  difficulty: number = DEFAULT_DIFFICULTY,
): RiskOutcome {
  const safeBet = Math.max(0, Math.floor(Number.isFinite(bet) ? bet : 0));
  const multiplier = riskMultiplier(chance);
  const winningDegrees = chance * 3.6;
  const effectiveChance = difficultyRiskChance(chance, difficulty);
  const won =
    Math.min(0.999999999, Math.max(0, random())) < effectiveChance / 100;
  const angleRoll = Math.min(0.999999999, Math.max(0, random()));
  const selectedSector = won ? winningDegrees : 360 - winningDegrees;
  const padding = Math.min(5, Math.max(1.5, selectedSector * 0.12));
  const sectorStart = won ? 0 : winningDegrees;
  const usableDegrees = Math.max(0.5, selectedSector - padding * 2);
  const finalAngle = sectorStart + padding + angleRoll * usableDegrees;

  return {
    chance,
    multiplier,
    bet: safeBet,
    payout: won ? Math.round(safeBet * multiplier) : 0,
    finalAngle,
    won: finalAngle < winningDegrees,
  };
}
