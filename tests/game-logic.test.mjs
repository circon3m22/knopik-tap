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

test("ultra tap pays up to 1000 and burns after the deadline", () => {
  assert.equal(calculateUltraTapCoins(1_999), 0);
  assert.equal(calculateUltraTapCoins(2_000, 3_000, 200), 200);
  assert.equal(calculateUltraTapCoins(2_000, 3_000, 600), 600);
  assert.equal(calculateUltraTapCoins(3_000, 3_000, 200), 290);
  assert.equal(calculateUltraTapCoins(3_001, 3_000), 0);
  assert.equal(isUltraTapOverheated(3_000, 3_000), false);
  assert.equal(isUltraTapOverheated(3_001, 3_000), true);
  assert.equal(chooseUltraTapOverheatDeadline(() => 0), 2_100);
  assert.ok(chooseUltraTapOverheatDeadline(() => 0.999) > 8_000);
  assert.equal(chooseUltraTapTwoSecondReward(() => 0), 200);
  assert.equal(chooseUltraTapTwoSecondReward(() => 0.999), 600);
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
  assert.equal("walletCoins" in saved, false);
});
