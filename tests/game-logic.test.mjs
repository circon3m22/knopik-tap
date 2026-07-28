import assert from "node:assert/strict";
import test from "node:test";
import {
  createPatience,
  pickBasePatience,
  recoveryBonus,
  sanitizeSave,
  tapFatigue,
} from "../app/game-logic.ts";

function sequence(...values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

test("weighted threshold buckets keep their promised ranges", () => {
  assert.ok(pickBasePatience(sequence(0.01, 0.5)) >= 5);
  assert.ok(pickBasePatience(sequence(0.2, 0.5)) <= 50);
  assert.ok(pickBasePatience(sequence(0.8, 0.5)) >= 51);
  assert.ok(pickBasePatience(sequence(0.98, 0.5)) >= 81);
});

test("longer rest gives a strictly stronger patience bonus", () => {
  const random = () => 0.5;
  const bonuses = [
    recoveryBonus(500, random),
    recoveryBonus(2_500, random),
    recoveryBonus(5_000, random),
    recoveryBonus(8_000, random),
    recoveryBonus(12_000, random),
  ];
  assert.deepEqual([...bonuses].sort((a, b) => a - b), bonuses);
  assert.ok(createPatience(12_000, sequence(0.2, 0.5, 0.5)) > 10);
});

test("tap fatigue stays small and variable", () => {
  assert.equal(tapFatigue(() => 0), 0.92);
  assert.ok(tapFatigue(() => 0.999) < 1.1);
});

test("corrupted saves recover without unsafe values", () => {
  const saved = sanitizeSave({
    bankCoins: -10,
    tutorialSeen: "yes",
    settings: { sound: "loud", vibration: false },
    bestStreak: Number.NaN,
  });
  assert.equal(saved.bankCoins, 0);
  assert.equal(saved.tutorialSeen, false);
  assert.equal(saved.settings.sound, true);
  assert.equal(saved.settings.vibration, false);
  assert.equal(saved.bestStreak, 0);
});
