export type DogState = "calm" | "warning" | "angry" | "recovering";

export type CoinState = {
  walletCoins: number;
  streakCoins: number;
};

export type GameSettings = {
  sound: boolean;
  vibration: boolean;
};

export type GameStats = {
  bestStreak: number;
  totalTaps: number;
  totalBites: number;
};

export type SaveData = {
  version: 5;
  vaultCoins: number;
  settings: GameSettings;
  tutorialSeen: boolean;
  bestStreak: number;
  totalTaps: number;
  totalBites: number;
  ultraFatigueUntil: number;
  level: number;
  levelCoins: number;
};

export const SAVE_KEY = "knopik-tap:save";
export const SAVE_VERSION = 5 as const;

export function createDefaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    vaultCoins: 0,
    settings: { sound: true, vibration: true },
    tutorialSeen: false,
    bestStreak: 0,
    totalTaps: 0,
    totalBites: 0,
    ultraFatigueUntil: 0,
    level: 1,
    levelCoins: 0,
  };
}

function safeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value)));
}

function legacyVaultCoins(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return safeInteger(
    value.slice(0, 500).reduce((total, item) => {
      if (!item || typeof item !== "object") return total;
      return total + safeInteger((item as { stored?: unknown }).stored);
    }, 0),
  );
}

export function sanitizeSave(value: unknown): SaveData {
  if (!value || typeof value !== "object") return createDefaultSave();

  const candidate = value as Partial<SaveData> & {
    version?: unknown;
    bankCoins?: unknown;
    walletCoins?: unknown;
    safes?: unknown;
    sound?: unknown;
    vibration?: unknown;
  };
  const settings =
    candidate.settings && typeof candidate.settings === "object"
      ? candidate.settings
      : { sound: candidate.sound, vibration: candidate.vibration };

  return {
    version: SAVE_VERSION,
    vaultCoins:
      candidate.version === 5
        ? safeInteger(candidate.vaultCoins)
        : candidate.version === 2 ||
            candidate.version === 3 ||
            candidate.version === 4
          ? legacyVaultCoins(candidate.safes)
          : safeInteger(candidate.bankCoins),
    settings: {
      sound:
        typeof settings.sound === "boolean" ? settings.sound : true,
      vibration:
        typeof settings.vibration === "boolean" ? settings.vibration : true,
    },
    tutorialSeen:
      (candidate.version === 4 || candidate.version === 5) &&
      typeof candidate.tutorialSeen === "boolean"
        ? candidate.tutorialSeen
        : false,
    bestStreak: safeInteger(candidate.bestStreak),
    totalTaps: safeInteger(candidate.totalTaps),
    totalBites: safeInteger(candidate.totalBites),
    ultraFatigueUntil:
      candidate.version === 3 ||
      candidate.version === 4 ||
      candidate.version === 5
        ? safeInteger(candidate.ultraFatigueUntil)
        : 0,
    level:
      candidate.version === 4 || candidate.version === 5
        ? Math.min(10, Math.max(1, safeInteger(candidate.level)))
        : 1,
    levelCoins:
      candidate.version === 4 || candidate.version === 5
        ? Math.min(100, safeInteger(candidate.levelCoins))
        : 0,
  };
}

function randomInteger(
  minimum: number,
  maximum: number,
  random: () => number,
): number {
  const normalized = Math.min(0.999999999, Math.max(0, random()));
  return Math.floor(normalized * (maximum - minimum + 1)) + minimum;
}

export function pickBasePatience(random: () => number = Math.random): number {
  const roll = Math.min(0.999999999, Math.max(0, random()));

  if (roll < 0.08) return randomInteger(5, 9, random);
  if (roll < 0.75) return randomInteger(10, 50, random);
  if (roll < 0.95) return randomInteger(51, 80, random);
  return randomInteger(81, 100, random);
}

export function recoveryBonus(
  restMilliseconds: number,
  random: () => number = Math.random,
): number {
  const rest = Math.max(0, restMilliseconds);
  if (rest < 1_000) return 0;
  if (rest < 2_000) return randomInteger(0, 1, random);
  if (rest < 4_000) return randomInteger(2, 4, random);
  if (rest < 7_000) return randomInteger(6, 10, random);
  if (rest < 11_000) return randomInteger(12, 18, random);
  return randomInteger(20, 28, random);
}

export function createPatience(
  restMilliseconds: number,
  random: () => number = Math.random,
): number {
  return Math.min(
    128,
    pickBasePatience(random) + recoveryBonus(restMilliseconds, random),
  );
}

export function tapFatigue(random: () => number = Math.random): number {
  return 0.92 + Math.min(0.999999999, Math.max(0, random())) * 0.18;
}
