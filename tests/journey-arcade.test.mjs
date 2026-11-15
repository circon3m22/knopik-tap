import test from "node:test";
import assert from "node:assert/strict";
import {
  SAVE_VERSION,
  createDefaultSave,
  sanitizeSave,
} from "../app/game-logic.ts";
import {
  ADVENTURE_STEPS,
  adventureThreshold,
  adventureLevel,
  sanitizeAdventure,
  stepProgress,
  claimAdventureStep,
} from "../app/adventure-engine.ts";
import {
  ARCADE_GAMES,
  casinoBet,
  casinoPayout,
  flipCoin,
  rollDice,
  towerPick,
  settleCasino,
  timingPosition,
  timingHit,
  memoryPattern,
  TOWER_MULTIPLIERS,
} from "../app/arcade-engine.ts";

test("v15 migrates without changing money, inventory, clothing, legacy level or settings", () => {
  const old = {
    ...createDefaultSave(),
    version: 15,
    walletCoins: 45231,
    vaultCoins: 8317,
    colaCount: 8,
    pitbullCount: 3,
    teaCount: 7,
    level: 6,
    levelCoins: 50,
    totalTaps: 1800,
    hatOwned: true,
    hatLevel: 3,
    commonCases: 4,
    questIndex: 3,
    tutorialSeen: true,
  };
  delete old.adventure;
  const migrated = sanitizeSave(old);
  assert.equal(migrated.version, SAVE_VERSION);
  for (const key of Object.keys(old).filter((key) => key !== "version"))
    assert.deepEqual(migrated[key], old[key], key);
  assert.ok(adventureLevel(migrated.adventure.xp).level >= old.level + 1);
  assert.equal(migrated.adventure.claimedSteps, 0);
});

test("new progression and legacy data survive repeated save/load", () => {
  const save = createDefaultSave();
  save.walletCoins = 100;
  save.adventure = {
    ...save.adventure,
    xp: 1224,
    claimedSteps: 9,
    timingWins: 4,
    memoryWins: 3,
    casinoPlays: 5,
  };
  assert.deepEqual(
    sanitizeSave(sanitizeSave(JSON.parse(JSON.stringify(save)))),
    save,
  );
});

test("malformed progress is bounded, integral and never NaN", () => {
  const p = sanitizeAdventure({
    xp: NaN,
    claimedSteps: Infinity,
    timingWins: -1,
    memoryWins: "8",
    practicePlays: 2.9,
    casinoPlays: Number.MAX_VALUE,
  });
  assert.equal(p.xp, 0);
  assert.equal(p.claimedSteps, 0);
  assert.equal(p.timingWins, 0);
  assert.equal(p.memoryWins, 0);
  assert.equal(p.practicePlays, 2);
  assert.equal(p.casinoPlays, Number.MAX_SAFE_INTEGER);
  assert.equal(sanitizeAdventure({ claimedSteps: 999 }).claimedSteps, 24);
});

test("30 XP levels have strictly ordered thresholds and exact boundaries", () => {
  assert.equal(adventureLevel(0).level, 1);
  for (let level = 2; level <= 30; level++) {
    assert.ok(adventureThreshold(level) > adventureThreshold(level - 1));
    assert.equal(
      adventureLevel(adventureThreshold(level) - 1).level,
      level - 1,
    );
    assert.equal(adventureLevel(adventureThreshold(level)).level, level);
    assert.equal(
      adventureLevel(adventureThreshold(level)).ratio,
      level === 30 ? 1 : 0,
    );
  }
  assert.equal(adventureLevel(Number.MAX_SAFE_INTEGER).level, 30);
  assert.equal(adventureLevel(Number.MAX_SAFE_INTEGER).remaining, 0);
});

test("progression cannot skip a requirement or pay an old checkpoint twice", () => {
  const p = sanitizeAdventure(undefined);
  assert.equal(
    claimAdventureStep(p, { totalTaps: 19, vaultCoins: 0 }, 0),
    null,
  );
  const claim = claimAdventureStep(p, { totalTaps: 20, vaultCoins: 0 }, 0);
  assert.equal(claim.progress.claimedSteps, 1);
  assert.equal(claim.progress.xp, 50);
  assert.equal(claim.coins, 100);
  assert.equal(
    claimAdventureStep(
      claim.progress,
      { totalTaps: 9999, vaultCoins: 9999 },
      0,
    ),
    null,
  );
  assert.equal(
    claimAdventureStep(
      claim.progress,
      { totalTaps: 9999, vaultCoins: 9999 },
      1,
    ),
    null,
  );
});

test("the entire 24-step path is finishable without any casino play or win", () => {
  let p = sanitizeAdventure({
    practicePlays: 20,
    timingWins: 12,
    memoryWins: 12,
  });
  let cases = 0,
    coins = 0;
  for (let index = 0; index < 24; index++) {
    const result = claimAdventureStep(
      p,
      { totalTaps: 2000, vaultCoins: 2500 },
      index,
    );
    assert.ok(result, ADVENTURE_STEPS[index].title);
    p = result.progress;
    coins += result.coins;
    if (result.chapterComplete) cases++;
  }
  assert.equal(p.claimedSteps, 24);
  assert.equal(p.casinoPlays, 0);
  assert.equal(cases, 4);
  assert.equal(coins, 6000);
  assert.equal(
    claimAdventureStep(p, { totalTaps: 9999, vaultCoins: 9999 }, 24),
    null,
  );
});

test("step progress uses the appropriate account metric", () => {
  const p = sanitizeAdventure({
    claimedSteps: 2,
    timingWins: 0,
    memoryWins: 10,
  });
  assert.equal(stepProgress(p, { totalTaps: 9999, vaultCoins: 9999 }), 0);
  assert.equal(
    stepProgress({ ...p, timingWins: 3 }, { totalTaps: 0, vaultCoins: 0 }),
    1,
  );
});

test("the catalog retains all three old games and adds two skill and three casino games", () => {
  assert.equal(ARCADE_GAMES.length, 8);
  assert.equal(new Set(ARCADE_GAMES.map((g) => g.id)).size, 8);
  for (const id of ["roulette", "slots", "mines"])
    assert.equal(ARCADE_GAMES.find((g) => g.id === id).unlock, 0);
  assert.equal(ARCADE_GAMES.filter((g) => g.category === "skill").length, 2);
  for (const game of ARCADE_GAMES) assert.ok(game.rules.length > 50);
});

test("casino stakes handle empty, fractional and invalid input without overdrafts", () => {
  assert.equal(casinoBet(0, 10), 0);
  assert.equal(casinoBet(-100, 10), 0);
  assert.equal(casinoBet(51, 100), 51);
  assert.equal(casinoBet(51, 12.9), 12);
  assert.equal(casinoBet(51, NaN), 1);
  assert.equal(casinoBet(51, Infinity), 1);
  assert.equal(casinoBet(NaN, 10), 0);
});

test("coin and dice cover exactly the declared equiprobable outcomes", () => {
  assert.deepEqual(
    flipCoin(0, () => 0),
    { face: 0, won: true },
  );
  assert.deepEqual(
    flipCoin(0, () => 0.5),
    { face: 1, won: false },
  );
  for (let n = 1; n <= 6; n++) {
    assert.equal(rollDice(n <= 3 ? 0 : 1, () => (n - 0.5) / 6).won, true);
    assert.equal(rollDice(n <= 3 ? 1 : 0, () => (n - 0.5) / 6).face, n);
    assert.equal(rollDice(n <= 3 ? 1 : 0, () => (n - 0.5) / 6).won, false);
  }
  assert.equal(flipCoin(1, () => 1).face, 1);
  assert.equal(rollDice(1, () => 1).face, 6);
});

test("tower has exactly two safe choices, one trap per floor and bounded payouts", () => {
  for (let danger = 0; danger < 3; danger++) {
    const outcomes = [0, 1, 2].map((tile) =>
      towerPick(tile, () => (danger + 0.5) / 3),
    );
    assert.equal(outcomes.filter((o) => o.safe).length, 2);
    assert.equal(outcomes[danger].safe, false);
  }
  assert.equal(towerPick(9, () => 0).safe, false);
  assert.equal(casinoPayout(100, TOWER_MULTIPLIERS[4]), 708);
});

test("casino payout ledger rejects repeated, missing or stale result callbacks", () => {
  const round = { id: 7, kind: "coin", bet: 100, settled: false };
  const result = settleCasino(round, 7, 400, 190);
  assert.equal(result.balance, 590);
  assert.equal(result.paid, 190);
  assert.equal(result.round.settled, true);
  assert.equal(settleCasino(result.round, 7, result.balance, 190), null);
  assert.equal(settleCasino(round, 6, 400, 190), null);
  assert.equal(settleCasino(null, 7, 400, 190), null);
});

test("settlement bounds excessive rewards and handles loss without refund", () => {
  const round = { id: 9, kind: "dice", bet: 100, settled: false };
  assert.equal(settleCasino(round, 9, 400, Number.MAX_SAFE_INTEGER).paid, 190);
  assert.equal(settleCasino(round, 9, 400, 0).balance, 400);
  assert.equal(settleCasino(round, 9, 400, NaN).balance, 400);
  assert.equal(
    settleCasino(round, 9, Number.MAX_SAFE_INTEGER, 190).balance,
    Number.MAX_SAFE_INTEGER,
  );
});

test("timing animation and hit window agree at both turns and exact boundaries", () => {
  assert.equal(timingPosition(0), 0);
  assert.equal(timingPosition(400), 0.5);
  assert.equal(timingPosition(800), 1);
  assert.equal(timingPosition(1200), 0.5);
  assert.equal(timingPosition(1600), 0);
  assert.equal(timingHit(0.36), true);
  assert.equal(timingHit(0.64), true);
  assert.equal(timingHit(0.359), false);
  assert.equal(timingHit(NaN), false);
});

test("memory patterns stay within four accessible tiles with a repeatable RNG", () => {
  let n = 0;
  assert.deepEqual(
    memoryPattern(() => n++ / 4),
    [0, 1, 2, 3],
  );
  assert.deepEqual(
    memoryPattern(() => 1),
    [3, 3, 3, 3],
  );
});
