import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultSave, sanitizeSave } from '../app/game-logic.ts';
import { advance, bank, buy, claimMission, equip, finishSuper, mood, newGame, openCase, saveGame, startSuper, superLimit, tap, useItem } from '../app/arcade-engine.ts';
const time = 1_800_000_000_000;
const fresh = (values = {}) => newGame({ ...createDefaultSave(), ...values }, time);

test('starts neutral, becomes happy in rhythm, warns before losing only wallet coins', () => {
  let g = fresh({ vaultCoins: 500 });
  assert.equal(mood(g), 'neutral');
  for (let i = 0; i < 6; i++) g = tap(g, time + i * 300);
  assert.equal(mood(g), 'happy');
  assert.ok(g.save.walletCoins > 0);
  let warningSeen = false;
  for (let i = 1; i < 100 && mood(g) !== 'angry'; i++) {
    g = tap(g, time + 1500 + i * 100);
    warningSeen ||= mood(g) === 'warning';
  }
  assert.ok(warningSeen);
  assert.equal(mood(g), 'angry');
  assert.equal(g.save.walletCoins, 0);
  assert.equal(g.save.vaultCoins, 500);
  assert.equal(g.save.totalBites, 1);
  assert.equal(mood(advance(g, g.round.angryUntil)), 'neutral');
});
test('rapid duplicate taps cannot create extra rewards', () => {
  const g = tap(fresh(), time);
  const repeat = tap(g, time + 30);
  assert.equal(repeat.save.walletCoins, g.save.walletCoins);
  assert.equal(repeat.save.totalTaps, 1);
});
test('cooling and happiness do not depend on timer frequency or tab suspension', () => {
  let g = fresh();
  for (let i = 1; i <= 10; i++) g = tap(g, time + i * 300);
  const from = g.round.updatedAt;
  const single = advance(g, from + 6000);
  let incremental = g;
  for (let i = 1; i <= 60; i++) incremental = advance(incremental, from + i * 100);
  assert.ok(Math.abs(single.round.happiness - incremental.round.happiness) < 1e-9);
  assert.ok(Math.abs(single.round.heat - incremental.round.heat) < 1e-9);
  assert.equal(incremental.round.combo, 0);
});
test('super tap pays exactly once, cancels cleanly and overheats at the boundary', () => {
  const initial = fresh({ walletCoins: 77, vaultCoins: 500 });
  const held = startSuper(initial, time);
  const finished = finishSuper(held, time + 1200);
  assert.equal(finished.save.walletCoins, 197);
  assert.equal(finishSuper(finished, time + 1300).save.walletCoins, 197);
  assert.equal(finishSuper(held, time + 500, true).save.walletCoins, 77);
  assert.equal(mood(advance(held, time + superLimit(initial.save) - 1)), 'neutral');
  const bite = finishSuper(held, time + superLimit(initial.save));
  assert.equal(mood(bite), 'angry');
  assert.equal(bite.save.walletCoins, 0);
  assert.equal(bite.save.vaultCoins, 500);
});
test('shield protects exactly one bite and active buffs do not consume twice', () => {
  let g = fresh({ walletCoins: 1000, vitaPowerCount: 2, drinkCount: 2 });
  g = useItem(g, 'vitaPowerCount', time);
  assert.equal(useItem(g, 'vitaPowerCount', time).save.vitaPowerCount, 1);
  g = useItem(g, 'drinkCount', time);
  assert.equal(useItem(g, 'drinkCount', time + 1).save.drinkCount, 1);
  g = advance(startSuper(g, time), time + 3000);
  assert.equal(g.save.walletCoins, 1000);
  assert.equal(g.save.vitaPowerShield, false);
  g = advance(startSuper(g, time + 6000), time + 9000);
  assert.equal(g.save.walletCoins, 0);
});
test('banking is idempotent and unavailable during a charge', () => {
  const g = fresh({ walletCoins: 234, vaultCoins: 100 });
  assert.equal(bank(startSuper(g, time)).save.walletCoins, 234);
  const saved = bank(g);
  assert.equal(saved.save.vaultCoins, 334);
  assert.equal(saved.save.walletCoins, 0);
  assert.deepEqual(bank(saved).save, saved.save);
});
test('purchases spend wallet before vault and enforce inventory limits', () => {
  const g = fresh({ walletCoins: 50, vaultCoins: 150 });
  const purchased = buy(g, 'foodCount');
  assert.equal(purchased.save.walletCoins, 0);
  assert.equal(purchased.save.vaultCoins, 50);
  assert.equal(purchased.save.foodCount, 1);
  assert.deepEqual(buy(purchased, 'foodCount').save, purchased.save);
  const full = fresh({ walletCoins: 10000, foodCount: 25 });
  assert.deepEqual(buy(full, 'foodCount').save, full.save);
});
test('food cools and clothing upgrades change rewards and timing', () => {
  let g = fresh({ foodCount: 1, hatOwned: true, hatUpgradeTokens: 1, mohawkOwned: true, mohawkLevel: 3 });
  g = { ...g, round: { ...g.round, heat: 80 } };
  g = useItem(g, 'foodCount', time);
  assert.equal(g.round.heat, 0);
  assert.equal(g.save.foodCount, 0);
  g = equip(equip(g, 'hat', true), 'hat');
  // Ensure the hat is equipped regardless of the saved default.
  if (!g.save.hatEquipped) g = equip(g, 'hat');
  assert.equal(superLimit(g.save), 2900);
  const plain = tap(tap(fresh(), time), time + 300).reward;
  const styled = tap(tap(fresh({ mohawkOwned: true, mohawkEquipped: true, mohawkLevel: 3 }), time), time + 300).reward;
  assert.ok(styled > plain);
});
test('mission reward and case opening cannot be claimed twice', () => {
  let g = claimMission(fresh({ totalTaps: 50 }));
  assert.equal(g.save.commonCases, 1);
  assert.equal(g.save.questIndex, 1);
  assert.equal(claimMission(g).save.commonCases, 1);
  const opened = openCase(g, 'common', () => 0);
  assert.equal(opened.rewards.length, 3);
  assert.equal(opened.game.save.commonCases, 0);
  assert.equal(opened.game.save.walletCoins, 150);
  assert.equal(openCase(opened.game, 'common').rewards.length, 0);
});
test('case overflow converts to coins and saved mine round survives reloading', () => {
  const g = fresh({ commonCases: 1, foodCount: 25, drinkCount: 25, pitbullCount: 25, colaCount: 25, teaCount: 25, arcadeMine: { bet: 99, round: 3, previous: 2 } });
  const opened = openCase(g, 'common', () => .6).game;
  assert.ok(opened.save.walletCoins > 0);
  const restored = newGame(sanitizeSave(saveGame(opened)), time + 5000);
  assert.deepEqual(restored.save.arcadeMine, { bet: 99, round: 3, previous: 2 });
  assert.equal(restored.hold, null);
});
