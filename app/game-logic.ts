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

export type SafeSize = "small" | "medium" | "large";

export type OwnedSafe = {
  id: string;
  size: SafeSize;
  capacity: number;
  stored: number;
  purchasedAt: number;
};

export type SaveData = {
  version: 4;
  walletCoins: number;
  safes: OwnedSafe[];
  settings: GameSettings;
  tutorialSeen: boolean;
  bestStreak: number;
  totalTaps: number;
  totalBites: number;
  ultraFatigueUntil: number;
  level: number;
  levelCoins: number;
};

export const SAFE_CATALOG = [
  { size: "small", name: "Малый", capacity: 100, price: 100 },
  { size: "medium", name: "Средний", capacity: 200, price: 200 },
  { size: "large", name: "Большой", capacity: 500, price: 500 },
] as const;

export const SAVE_KEY = "knopik-tap:save";
export const SAVE_VERSION = 4 as const;

export function createDefaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    walletCoins: 0,
    safes: [],
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

function sanitizeSafes(value: unknown): OwnedSafe[] {
  if (!Array.isArray(value)) return [];

  return value.slice(0, 500).flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<OwnedSafe>;
    const definition = SAFE_CATALOG.find(
      (entry) => entry.size === candidate.size,
    );
    if (!definition) return [];

    return [
      {
        id:
          typeof candidate.id === "string" && candidate.id.length > 0
            ? candidate.id
            : `restored-${index}`,
        size: definition.size,
        capacity: definition.capacity,
        stored: Math.min(definition.capacity, safeInteger(candidate.stored)),
        purchasedAt: safeInteger(candidate.purchasedAt),
      },
    ];
  });
}

export function sanitizeSave(value: unknown): SaveData {
  if (!value || typeof value !== "object") return createDefaultSave();

  const candidate = value as Partial<SaveData> & {
    version?: unknown;
    bankCoins?: unknown;
    sound?: unknown;
    vibration?: unknown;
  };
  const settings =
    candidate.settings && typeof candidate.settings === "object"
      ? candidate.settings
      : { sound: candidate.sound, vibration: candidate.vibration };

  return {
    version: SAVE_VERSION,
    walletCoins:
      candidate.version === 2 ||
      candidate.version === 3 ||
      candidate.version === 4
        ? safeInteger(candidate.walletCoins)
        : safeInteger(candidate.bankCoins),
    safes:
      candidate.version === 2 ||
      candidate.version === 3 ||
      candidate.version === 4
        ? sanitizeSafes(candidate.safes)
        : [],
    settings: {
      sound:
        typeof settings.sound === "boolean" ? settings.sound : true,
      vibration:
        typeof settings.vibration === "boolean" ? settings.vibration : true,
    },
    tutorialSeen:
      candidate.version === 4 &&
      typeof candidate.tutorialSeen === "boolean"
        ? candidate.tutorialSeen
        : false,
    bestStreak: safeInteger(candidate.bestStreak),
    totalTaps: safeInteger(candidate.totalTaps),
    totalBites: safeInteger(candidate.totalBites),
    ultraFatigueUntil:
      candidate.version === 3 || candidate.version === 4
        ? safeInteger(candidate.ultraFatigueUntil)
        : 0,
    level:
      candidate.version === 4
        ? Math.min(10, Math.max(1, safeInteger(candidate.level)))
        : 1,
    levelCoins:
      candidate.version === 4
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
