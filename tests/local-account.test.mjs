import assert from "node:assert/strict";
import test from "node:test";

/** Минимальный localStorage, чтобы модуль работал вне браузера. */
function installStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => void store.set(key, String(value)),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  };
  return store;
}

const store = installStorage();

const {
  LOCAL_PASSWORD,
  LOCAL_USERNAME,
  disableLocalMode,
  enableLocalMode,
  isLocalCredentials,
  isLocalModeActive,
  matchesLocalCredentials,
  readLocalDifficulty,
  readLocalGameSave,
  readLocalPromoCodes,
  sanitizeLocalPromoCodes,
  writeLocalDifficulty,
  writeLocalGameSave,
  writeLocalPassword,
  writeLocalPromoCodes,
} = await import("../app/local-account.ts");

const { createDefaultSave } = await import("../app/game-logic.ts");
const { DEFAULT_DIFFICULTY } = await import("../app/difficulty-engine.ts");

test("логин wolf с паролем 123456 открывает локальный режим", () => {
  assert.equal(LOCAL_USERNAME, "wolf");
  assert.equal(LOCAL_PASSWORD, "123456");
  assert.equal(matchesLocalCredentials("wolf", "123456"), true);
  // Регистр логина и пробелы не мешают входу.
  assert.equal(matchesLocalCredentials("WOLF", "123456"), true);
  assert.equal(matchesLocalCredentials("  wolf  ", "123456"), true);
});

test("другие пары логин/пароль в локальный режим не пускают", () => {
  assert.equal(matchesLocalCredentials("wolf", "654321"), false);
  assert.equal(matchesLocalCredentials("kamrad", "123456"), false);
  assert.equal(matchesLocalCredentials("wolf1", "123456"), false);
  assert.equal(matchesLocalCredentials("", ""), false);
});

test("изменённый локальный пароль работает вместе с базовым", () => {
  store.clear();
  assert.equal(isLocalCredentials("wolf", "secret123"), false);
  writeLocalPassword("secret123");
  assert.equal(isLocalCredentials("wolf", "secret123"), true);
  // Базовый пароль остаётся запасным входом.
  assert.equal(isLocalCredentials("wolf", "123456"), true);
  assert.equal(isLocalCredentials("wolf", "other"), false);
  store.clear();
});

test("флаг локального режима переживает перезапуск и снимается при выходе", () => {
  store.clear();
  assert.equal(isLocalModeActive(), false);
  enableLocalMode();
  assert.equal(isLocalModeActive(), true);
  disableLocalMode();
  assert.equal(isLocalModeActive(), false);
});

test("локальное сохранение читается и пишется без облака", () => {
  store.clear();
  assert.deepEqual(readLocalGameSave(), createDefaultSave());

  const save = { ...createDefaultSave(), walletCoins: 4_200, level: 3 };
  writeLocalGameSave(save);
  const restored = readLocalGameSave();
  assert.equal(restored.walletCoins, 4_200);
  assert.equal(restored.level, 3);

  // Битые данные не ломают запуск игры.
  localStorage.setItem("knopik-tap:save:local-w", "{ not json");
  assert.deepEqual(readLocalGameSave(), createDefaultSave());
});

test("локальная сложность хранится в пределах 0-100", () => {
  store.clear();
  assert.equal(readLocalDifficulty(), DEFAULT_DIFFICULTY);
  assert.equal(writeLocalDifficulty(72), 72);
  assert.equal(readLocalDifficulty(), 72);
  assert.equal(writeLocalDifficulty(999), 100);
  assert.equal(writeLocalDifficulty(-10), 0);
});

test("локальные промокоды сохраняются и отсеивают мусор", () => {
  store.clear();
  assert.deepEqual(readLocalPromoCodes(), []);

  const codes = [
    {
      id: "a",
      code: "KNOPIK100",
      amount: 100,
      createdAt: new Date(0).toISOString(),
      redeemed: false,
      redeemedAt: null,
    },
  ];
  writeLocalPromoCodes(codes);
  assert.deepEqual(readLocalPromoCodes(), codes);

  assert.deepEqual(sanitizeLocalPromoCodes("nope"), []);
  assert.deepEqual(sanitizeLocalPromoCodes([{ code: "X", amount: 0 }]), []);
  assert.deepEqual(sanitizeLocalPromoCodes([{ code: 5, amount: 10 }]), []);
  assert.equal(sanitizeLocalPromoCodes([{ code: "OK", amount: 10 }]).length, 1);
});
