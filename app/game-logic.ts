export type DogState = "calm" | "tired" | "warning" | "angry" | "recovering";

export type CoinState = {
  walletCoins: number;
  streakCoins: number;
};

export type GameSettings = {
  sound: boolean;
  vibration: boolean;
  suliman: boolean;
  yellow: boolean;
};

export type GameStats = {
  bestStreak: number;
  totalTaps: number;
  totalBites: number;
};

export type SaveData = {
  version: 12;
  vaultCoins: number;
  walletCoins: number;
  foodCount: number;
  drinkCount: number;
  pitbullCount: number;
  colaCount: number;
  teaCount: number;
  hatOwned: boolean;
  hatEquipped: boolean;
  mohawkOwned: boolean;
  mohawkEquipped: boolean;
  hasbulaRedeemed: boolean;
  riskFatigueUntil: number;
  riskSpins: number;
  riskWins: number;
  riskLosses: number;
  slotPlays: number;
  slotWins: number;
  minePlays: number;
  mineWins: number;
  mineLosses: number;
  lastRiskBet: number;
  lastRiskChance: number;
  boostUntil: number;
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
export const SAVE_VERSION = 12 as const;

export function createDefaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    vaultCoins: 0,
    walletCoins: 0,
    foodCount: 0,
    drinkCount: 0,
    pitbullCount: 0,
    colaCount: 0,
    teaCount: 0,
    hatOwned: false,
    hatEquipped: false,
    mohawkOwned: false,
    mohawkEquipped: false,
    hasbulaRedeemed: false,
    riskFatigueUntil: 0,
    riskSpins: 0,
    riskWins: 0,
    riskLosses: 0,
    slotPlays: 0,
    slotWins: 0,
    minePlays: 0,
    mineWins: 0,
    mineLosses: 0,
    lastRiskBet: 0,
    lastRiskChance: 50,
    boostUntil: 0,
    settings: { sound: true, vibration: true, suliman: false, yellow: false },
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

function safeRiskChance(value: unknown): number {
  const chance = safeInteger(value);
  return chance >= 10 && chance <= 90 && chance % 10 === 0 ? chance : 50;
}

export function sanitizeSave(value: unknown): SaveData {
  if (!value || typeof value !== "object") return createDefaultSave();

  const candidate = value as Omit<Partial<SaveData>, "version"> & {
    version?: unknown;
    bankCoins?: unknown;
    walletCoins?: unknown;
    safes?: unknown;
    sound?: unknown;
    vibration?: unknown;
    suliman?: unknown;
    yellow?: unknown;
  };
  const settings =
    candidate.settings && typeof candidate.settings === "object"
      ? candidate.settings
      : {
          sound: candidate.sound,
          vibration: candidate.vibration,
          suliman: candidate.suliman,
          yellow: candidate.yellow,
        };
  const version = safeInteger(candidate.version);
  const isVersion = (minimum: number) =>
    version >= minimum && version <= SAVE_VERSION;

  return {
    version: SAVE_VERSION,
    vaultCoins:
      isVersion(5)
        ? safeInteger(candidate.vaultCoins)
        : version >= 2 && version <= 4
          ? legacyVaultCoins(candidate.safes)
          : safeInteger(candidate.bankCoins),
    walletCoins:
      isVersion(7)
        ? safeInteger(candidate.walletCoins)
        : 0,
    foodCount:
      isVersion(6)
        ? Math.min(10, safeInteger(candidate.foodCount))
        : 0,
    drinkCount:
      isVersion(8) ? Math.min(10, safeInteger(candidate.drinkCount)) : 0,
    pitbullCount:
      isVersion(9) ? Math.min(10, safeInteger(candidate.pitbullCount)) : 0,
    colaCount:
      isVersion(12) ? Math.min(10, safeInteger(candidate.colaCount)) : 0,
    teaCount:
      isVersion(12) ? Math.min(10, safeInteger(candidate.teaCount)) : 0,
    hatOwned:
      isVersion(6) &&
      typeof candidate.hatOwned === "boolean"
        ? candidate.hatOwned
        : false,
    hatEquipped:
      isVersion(6) &&
      candidate.hatOwned === true &&
      !(isVersion(10) && candidate.mohawkOwned === true && candidate.mohawkEquipped !== false)
        ? candidate.hatEquipped !== false
        : false,
    mohawkOwned:
      isVersion(10) && typeof candidate.mohawkOwned === "boolean"
        ? candidate.mohawkOwned
        : false,
    mohawkEquipped:
      isVersion(10) && candidate.mohawkOwned === true
        ? candidate.mohawkEquipped !== false
        : false,
    hasbulaRedeemed:
      isVersion(11) && candidate.hasbulaRedeemed === true,
    riskFatigueUntil:
      isVersion(7)
        ? safeInteger(candidate.riskFatigueUntil)
        : 0,
    riskSpins: isVersion(7) ? safeInteger(candidate.riskSpins) : 0,
    riskWins: isVersion(7) ? safeInteger(candidate.riskWins) : 0,
    riskLosses: isVersion(7) ? safeInteger(candidate.riskLosses) : 0,
    slotPlays: isVersion(12) ? safeInteger(candidate.slotPlays) : 0,
    slotWins: isVersion(12) ? safeInteger(candidate.slotWins) : 0,
    minePlays: isVersion(12) ? safeInteger(candidate.minePlays) : 0,
    mineWins: isVersion(12) ? safeInteger(candidate.mineWins) : 0,
    mineLosses: isVersion(12) ? safeInteger(candidate.mineLosses) : 0,
    lastRiskBet:
      isVersion(7) ? safeInteger(candidate.lastRiskBet) : 0,
    lastRiskChance:
      isVersion(7) ? safeRiskChance(candidate.lastRiskChance) : 50,
    boostUntil:
      isVersion(8) ? safeInteger(candidate.boostUntil) : 0,
    settings: {
      sound:
        typeof settings.sound === "boolean" ? settings.sound : true,
      vibration:
        typeof settings.vibration === "boolean" ? settings.vibration : true,
      suliman:
        typeof settings.suliman === "boolean" ? settings.suliman : false,
      yellow:
        isVersion(10) && typeof settings.yellow === "boolean"
          ? settings.yellow
          : false,
    },
    tutorialSeen:
      isVersion(4) &&
      typeof candidate.tutorialSeen === "boolean"
        ? candidate.tutorialSeen
        : false,
    bestStreak: safeInteger(candidate.bestStreak),
    totalTaps: safeInteger(candidate.totalTaps),
    totalBites: safeInteger(candidate.totalBites),
    ultraFatigueUntil:
      isVersion(3)
        ? safeInteger(candidate.ultraFatigueUntil)
        : 0,
    level:
      isVersion(4)
        ? Math.min(10, Math.max(1, safeInteger(candidate.level)))
        : 1,
    levelCoins:
      isVersion(4)
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
