import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeSave } from "../app/game-logic.ts";
import {
  FATIGUE_DURATION_MS,
  calculateFatigueRatio,
  calculateTapLimit,
  calculateUltraTapCoins,
  chooseUltraTapOverheatDeadline,
  chooseUltraTapTwoSecondReward,
  isUltraTapOverheated,
} from "../app/tempo-engine.ts";
import {
  addLevelCoins,
  levelMultiplier,
} from "../app/level-engine.ts";
import { createRiskOutcome, riskMultiplier } from "../app/risk-engine.ts";
import {
  DEFAULT_DIFFICULTY,
  clampDifficulty,
  difficultyDuration,
  difficultyFatigueMultiplier,
  difficultyLuckMultiplier,
  difficultyPatienceMultiplier,
  difficultyRewardMultiplier,
  difficultyRiskChance,
  difficultyTiredChanceMultiplier,
  difficultyTiredSnapMultiplier,
  difficultyUltraDeadlineMultiplier,
} from "../app/difficulty-engine.ts";
import {
  createMinePickOutcome,
  createSlotOutcome,
  minePayout,
  mineSafeChance,
  resolveMiniGameBet,
} from "../app/mini-game-engine.ts";

test("tap limit rewards speed and keeps requested ranges", () => {
  assert.equal(calculateTapLimit(1_000, 0, () => 0), 4);
  assert.equal(calculateTapLimit(1_000, 0, () => 0.999), 7);
  assert.equal(calculateTapLimit(1_300, 0, () => 0), 2);
  assert.equal(calculateTapLimit(1_300, 0, () => 0.999), 4);
  assert.equal(calculateTapLimit(500, 0, () => 0), 15);
  assert.equal(calculateTapLimit(500, 0, () => 0.999), 32);
  assert.equal(calculateTapLimit(150, 0, () => 0), 25);
  assert.equal(calculateTapLimit(150, 0, () => 0.999), 50);
});

test("post-ultra fatigue starts at 10-20 and fades after 90 seconds", () => {
  assert.equal(calculateTapLimit(150, 1, () => 0), 10);
  assert.equal(calculateTapLimit(150, 1, () => 0.999), 20);
  assert.equal(calculateFatigueRatio(0), 1);
  assert.equal(calculateFatigueRatio(FATIGUE_DURATION_MS), 0);
});

test("ultra tap averages 300, caps at 500, and burns after the deadline", () => {
  assert.equal(calculateUltraTapCoins(1_999), 0);
  assert.equal(calculateUltraTapCoins(2_000, 3_000, 200), 200);
  assert.equal(calculateUltraTapCoins(2_000, 3_000, 400), 400);
  assert.equal(calculateUltraTapCoins(2_000, 3_000), 300);
  assert.equal(calculateUltraTapCoins(3_000, 3_000, 200), 250);
  assert.equal(calculateUltraTapCoins(10_000, 10_000, 400), 500);
  assert.equal(calculateUltraTapCoins(3_001, 3_000), 0);
  assert.equal(isUltraTapOverheated(3_000, 3_000), false);
  assert.equal(isUltraTapOverheated(3_001, 3_000), true);
  assert.equal(chooseUltraTapOverheatDeadline(() => 0), 2_100);
  assert.ok(chooseUltraTapOverheatDeadline(() => 0.999) > 8_000);
  assert.equal(chooseUltraTapTwoSecondReward(() => 0), 200);
  assert.equal(chooseUltraTapTwoSecondReward(() => 0.999), 400);
});

test("levels advance every 100 earned coins and cap at ten", () => {
  const first = addLevelCoins(
    { level: 1, progressCoins: 95, lifetimeCoins: 95 },
    10,
  );
  assert.equal(first.state.level, 2);
  assert.equal(first.state.progressCoins, 5);
  const maximum = addLevelCoins(first.state, 10_000);
  assert.equal(maximum.state.level, 10);
  assert.equal(maximum.progressRatio, 1);
  assert.equal(levelMultiplier(1), 1);
  assert.equal(levelMultiplier(10), 1.45);
});

test("corrupted saves recover without unsafe values", () => {
  const saved = sanitizeSave({
    version: 5,
    vaultCoins: -10,
    ultraFatigueUntil: Number.NaN,
    tutorialSeen: "yes",
    settings: { sound: "loud", vibration: false },
    bestStreak: Number.NaN,
    level: 999,
    levelCoins: Number.NaN,
  });
  assert.equal(saved.vaultCoins, 0);
  assert.equal(saved.ultraFatigueUntil, 0);
  assert.equal(saved.tutorialSeen, false);
  assert.equal(saved.settings.sound, true);
  assert.equal(saved.settings.vibration, false);
  assert.equal(saved.bestStreak, 0);
  assert.equal(saved.level, 10);
  assert.equal(saved.levelCoins, 0);
});

test("legacy purchased safes merge into the free vault", () => {
  const saved = sanitizeSave({
    version: 4,
    walletCoins: 999,
    safes: [{ stored: 100 }, { stored: 200 }, { stored: -50 }],
  });
  assert.equal(saved.vaultCoins, 300);
  assert.equal(saved.walletCoins, 0);
});

test("risk inventory and active balance migrate safely", () => {
  const saved = sanitizeSave({
    version: 7,
    vaultCoins: 240,
    walletCoins: 850,
    foodCount: 4,
    hatOwned: true,
    hatEquipped: true,
    riskFatigueUntil: 12345,
    riskSpins: 7,
    riskWins: 3,
    riskLosses: 4,
    lastRiskBet: 500,
    lastRiskChance: 70,
  });
  assert.equal(saved.walletCoins, 850);
  assert.equal(saved.foodCount, 4);
  assert.equal(saved.hatEquipped, true);
  assert.equal(saved.riskWins, 3);
  assert.equal(saved.lastRiskChance, 70);
});

test("pitbull inventory and suliman mode persist safely", () => {
  const saved = sanitizeSave({
    version: 9,
    walletCoins: 500,
    drinkCount: 3,
    pitbullCount: 4,
    settings: { sound: true, vibration: false, suliman: true },
  });
  assert.equal(saved.pitbullCount, 4);
  assert.equal(saved.settings.suliman, true);

  const legacy = sanitizeSave({
    version: 8,
    pitbullCount: 9,
    settings: { sound: true, vibration: true },
  });
  assert.equal(legacy.pitbullCount, 0);
  assert.equal(legacy.settings.suliman, false);
  assert.equal(saved.settings.yellow, false);
  assert.equal(saved.mohawkOwned, false);
});

test("mohawk ownership and fatigue-free mode persist in version ten", () => {
  const saved = sanitizeSave({
    version: 10,
    walletCoins: 2_500,
    hatOwned: true,
    hatEquipped: true,
    mohawkOwned: true,
    mohawkEquipped: true,
    settings: { sound: true, vibration: true, suliman: false, yellow: true },
  });
  assert.equal(saved.mohawkOwned, true);
  assert.equal(saved.mohawkEquipped, true);
  assert.equal(saved.hatEquipped, false);
  assert.equal(saved.settings.yellow, true);
  assert.equal(saved.hasbulaRedeemed, false);
});

test("one-time promo redemption persists in version eleven", () => {
  const saved = sanitizeSave({
    version: 11,
    hasbulaRedeemed: true,
    settings: { sound: true, vibration: true, suliman: false, yellow: false },
  });
  assert.equal(saved.hasbulaRedeemed, true);
});

test("new drink inventories and mini-game stats persist in version twelve", () => {
  const saved = sanitizeSave({
    version: 12,
    walletCoins: 900,
    colaCount: 14,
    teaCount: 3,
    slotPlays: 8,
    slotWins: 4,
    minePlays: 7,
    mineWins: 5,
    mineLosses: 2,
  });
  assert.equal(saved.version, 12);
  assert.equal(saved.colaCount, 10);
  assert.equal(saved.teaCount, 3);
  assert.equal(saved.slotPlays, 8);
  assert.equal(saved.slotWins, 4);
  assert.equal(saved.minePlays, 7);
  assert.equal(saved.mineWins, 5);
  assert.equal(saved.mineLosses, 2);

  const legacy = sanitizeSave({ version: 11, colaCount: 9, teaCount: 9 });
  assert.equal(legacy.colaCount, 0);
  assert.equal(legacy.teaCount, 0);
});

test("risk wheel resolves payout and final angle from the configured chance", () => {
  const win = createRiskOutcome(20, 1_000, (() => {
    const rolls = [0.1, 0.5];
    return () => rolls.shift() ?? 0;
  })());
  assert.equal(win.won, true);
  assert.equal(win.payout, 3_600);
  assert.ok(win.finalAngle < 72);

  const loss = createRiskOutcome(90, 1_000, (() => {
    const rolls = [0.99, 0.5];
    return () => rolls.shift() ?? 0;
  })());
  assert.equal(loss.won, false);
  assert.equal(loss.payout, 0);
  assert.ok(loss.finalAngle >= 324);
  assert.equal(riskMultiplier(50), 1.75);

  const boostedWin = createRiskOutcome(50, 100, (() => {
    const rolls = [0.56, 0.5];
    return () => rolls.shift() ?? 0;
  })());
  assert.equal(boostedWin.chance, 50);
  assert.equal(boostedWin.won, true);
  assert.equal(boostedWin.payout, 175);
});

test("difficulty 50 preserves every current gameplay coefficient exactly", () => {
  assert.equal(DEFAULT_DIFFICULTY, 50);
  assert.equal(clampDifficulty(50), 50);
  assert.equal(difficultyRewardMultiplier(50), 1);
  assert.equal(difficultyPatienceMultiplier(50), 1);
  assert.equal(difficultyTiredChanceMultiplier(50), 1);
  assert.equal(difficultyTiredSnapMultiplier(50), 1);
  assert.equal(difficultyLuckMultiplier(50), 1);
  assert.equal(difficultyFatigueMultiplier(50), 1);
  assert.equal(difficultyUltraDeadlineMultiplier(50), 1);
  assert.equal(difficultyDuration(90_000, 50), 90_000);
  assert.equal(difficultyRiskChance(50, 50), 58);
});

test("hidden difficulty consistently shifts farming, patience, fatigue, and luck", () => {
  assert.ok(difficultyRewardMultiplier(0) > 1);
  assert.ok(difficultyRewardMultiplier(100) < 1);
  assert.ok(difficultyPatienceMultiplier(0) > 1);
  assert.ok(difficultyPatienceMultiplier(100) < 1);
  assert.ok(difficultyTiredChanceMultiplier(0) < 1);
  assert.ok(difficultyTiredChanceMultiplier(100) > 1);
  assert.ok(difficultyTiredSnapMultiplier(0) < 1);
  assert.ok(difficultyTiredSnapMultiplier(100) > 1);
  assert.ok(difficultyLuckMultiplier(0) > 1);
  assert.ok(difficultyLuckMultiplier(100) < 1);
  assert.ok(difficultyDuration(90_000, 0) < 90_000);
  assert.ok(difficultyDuration(90_000, 100) > 90_000);
  assert.ok(difficultyUltraDeadlineMultiplier(0) > 1);
  assert.ok(difficultyUltraDeadlineMultiplier(100) < 1);
});

test("real wheel chance changes while difficulty 50 keeps the existing +8 bonus", () => {
  const rolls = () => {
    const values = [0.7, 0.5];
    return () => values.shift() ?? 0;
  };
  const standard = createRiskOutcome(50, 100, rolls(), 50);
  const easy = createRiskOutcome(50, 100, rolls(), 0);
  const hard = createRiskOutcome(50, 100, rolls(), 100);

  assert.equal(standard.won, false);
  assert.equal(easy.won, true);
  assert.equal(hard.won, false);
  assert.equal(easy.chance, 50);
  assert.equal(easy.multiplier, 1.75);
});

test("slots resolve three reels and hide difficulty inside real odds", () => {
  const jackpot = createSlotOutcome(100, 50, () => 0);
  assert.deepEqual(jackpot.reels, ["diamond", "diamond", "diamond"]);
  assert.equal(jackpot.multiplier, 6);
  assert.equal(jackpot.payout, 600);

  const standard = createSlotOutcome(100, 50, () => 0.7);
  const easy = createSlotOutcome(100, 0, () => 0.7);
  const hard = createSlotOutcome(100, 100, () => 0.7);
  assert.equal(standard.tier, "loss");
  assert.equal(easy.tier, "pair");
  assert.equal(hard.tier, "loss");
});

test("mini-games are all-in unless the mohawk unlocks bet choice", () => {
  assert.equal(resolveMiniGameBet(875, 100, false), 875);
  assert.equal(resolveMiniGameBet(875, 100, true), 100);
  assert.equal(resolveMiniGameBet(875, 9_999, true), 875);
  assert.equal(resolveMiniGameBet(0, 100, true), 0);
});

test("five-button game supports hidden difficulty and progressive cashout", () => {
  assert.equal(mineSafeChance(50), 0.8);
  assert.equal(mineSafeChance(0), 0.95);
  assert.equal(mineSafeChance(100), 0.65);

  const standard = createMinePickOutcome(2, 50, (() => {
    const rolls = [0.79, 0];
    return () => rolls.shift() ?? 0;
  })());
  const hard = createMinePickOutcome(2, 100, () => 0.79);
  assert.equal(standard.safe, true);
  assert.notEqual(standard.mineIndex, 2);
  assert.deepEqual(hard, { safe: false, mineIndex: 2 });
  assert.equal(minePayout(1_000, 1), 1_180);
  assert.equal(minePayout(1_000, 3), 1_840);
});
