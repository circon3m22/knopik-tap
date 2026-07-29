import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeSave } from "../app/game-logic.ts";
import {
  FATIGUE_DURATION_MS,
  calculateFatigueRatio,
  calculateTapLimit,
  calculateUltraTapCoins,
  isUltraTapOverheated,
} from "../app/tempo-engine.ts";

test("tap limit rewards speed and keeps requested ranges", () => {
  assert.equal(calculateTapLimit(1_000, 0, () => 0), 5);
  assert.equal(calculateTapLimit(1_000, 0, () => 0.999), 15);
  assert.equal(calculateTapLimit(150, 0, () => 0), 30);
  assert.equal(calculateTapLimit(150, 0, () => 0.999), 100);
});

test("post-ultra fatigue starts at 10-20 and fades after 90 seconds", () => {
  assert.equal(calculateTapLimit(150, 1, () => 0), 10);
  assert.equal(calculateTapLimit(150, 1, () => 0.999), 20);
  assert.equal(calculateFatigueRatio(0), 1);
  assert.equal(calculateFatigueRatio(FATIGUE_DURATION_MS), 0);
});

test("ultra tap pays up to 1000 and burns after the deadline", () => {
  assert.equal(calculateUltraTapCoins(1_999), 0);
  assert.equal(calculateUltraTapCoins(2_000), 133);
  assert.equal(calculateUltraTapCoins(15_000), 1_000);
  assert.equal(calculateUltraTapCoins(15_001), 0);
  assert.equal(isUltraTapOverheated(15_000), false);
  assert.equal(isUltraTapOverheated(15_001), true);
});

test("corrupted saves recover without unsafe values", () => {
  const saved = sanitizeSave({
    version: 3,
    walletCoins: -10,
    ultraFatigueUntil: Number.NaN,
    tutorialSeen: "yes",
    settings: { sound: "loud", vibration: false },
    bestStreak: Number.NaN,
  });
  assert.equal(saved.walletCoins, 0);
  assert.equal(saved.ultraFatigueUntil, 0);
  assert.equal(saved.tutorialSeen, false);
  assert.equal(saved.settings.sound, true);
  assert.equal(saved.settings.vibration, false);
  assert.equal(saved.bestStreak, 0);
});
