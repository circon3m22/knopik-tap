/**
 * Локальный (офлайн) аккаунт.
 *
 * Вход с логином `W` и паролем `8` запускает игру полностью на устройстве:
 * Supabase не вызывается, прогресс, сложность и промокоды живут в localStorage.
 * Все игровые функции при этом остаются доступными.
 */

import { SAVE_KEY, createDefaultSave, sanitizeSave, type SaveData } from "./game-logic.ts";
import { DEFAULT_DIFFICULTY, clampDifficulty } from "./difficulty-engine.ts";

export const LOCAL_USERNAME = "W";
export const LOCAL_PASSWORD = "8";
export const LOCAL_USER_ID = "local-w";

const LOCAL_MODE_KEY = "knopik-tap:local-mode";
const LOCAL_PASSWORD_KEY = "knopik-tap:local-password";
const LOCAL_DIFFICULTY_KEY = "knopik-tap:local-difficulty";
const LOCAL_PROMO_KEY = "knopik-tap:local-promos";

export type LocalPromoCode = {
  id: string;
  code: string;
  amount: number;
  createdAt: string;
  redeemed: boolean;
  redeemedAt: string | null;
};

function storage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readRaw(key: string) {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string) {
  try {
    storage()?.setItem(key, value);
  } catch {
    // Локальный режим остаётся играбельным даже без записи в хранилище.
  }
}

function removeRaw(key: string) {
  try {
    storage()?.removeItem(key);
  } catch {
    // no-op
  }
}

/** Совпадает ли пара логин/пароль с зарезервированным локальным аккаунтом. */
export function matchesLocalCredentials(
  username: string,
  password: string,
  extraPassword: string | null = null,
): boolean {
  if (username.trim().toLowerCase() !== LOCAL_USERNAME.toLowerCase()) return false;
  if (password === LOCAL_PASSWORD) return true;
  return Boolean(extraPassword) && password === extraPassword;
}

/** Локальный пароль, заданный игроком в настройках (базовый `8` работает всегда). */
export function readLocalPassword(): string | null {
  const stored = readRaw(LOCAL_PASSWORD_KEY);
  return stored && stored.length > 0 ? stored : null;
}

export function writeLocalPassword(password: string) {
  writeRaw(LOCAL_PASSWORD_KEY, password);
}

export function isLocalCredentials(username: string, password: string): boolean {
  return matchesLocalCredentials(username, password, readLocalPassword());
}

export function isLocalModeActive(): boolean {
  return readRaw(LOCAL_MODE_KEY) === "1";
}

export function enableLocalMode() {
  writeRaw(LOCAL_MODE_KEY, "1");
}

export function disableLocalMode() {
  removeRaw(LOCAL_MODE_KEY);
}

function localSaveKey() {
  return `${SAVE_KEY}:${LOCAL_USER_ID}`;
}

export function readLocalGameSave(): SaveData {
  const raw = readRaw(localSaveKey());
  if (!raw) return createDefaultSave();
  try {
    return sanitizeSave(JSON.parse(raw));
  } catch {
    return createDefaultSave();
  }
}

export function writeLocalGameSave(save: SaveData) {
  try {
    writeRaw(localSaveKey(), JSON.stringify(save));
  } catch {
    // no-op
  }
}

export function readLocalDifficulty(): number {
  const raw = readRaw(LOCAL_DIFFICULTY_KEY);
  if (raw === null) return DEFAULT_DIFFICULTY;
  return clampDifficulty(Number(raw));
}

export function writeLocalDifficulty(difficulty: number): number {
  const normalized = clampDifficulty(difficulty);
  writeRaw(LOCAL_DIFFICULTY_KEY, String(normalized));
  return normalized;
}

/** Приводит произвольные данные из хранилища к списку промокодов. */
export function sanitizeLocalPromoCodes(value: unknown): LocalPromoCode[] {
  if (!Array.isArray(value)) return [];
  const codes: LocalPromoCode[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<LocalPromoCode>;
    if (typeof row.code !== "string" || typeof row.amount !== "number") continue;
    if (!Number.isSafeInteger(row.amount) || row.amount < 1) continue;
    codes.push({
      id: typeof row.id === "string" && row.id ? row.id : createPromoId(),
      code: row.code,
      amount: row.amount,
      createdAt:
        typeof row.createdAt === "string" ? row.createdAt : new Date(0).toISOString(),
      redeemed: Boolean(row.redeemed),
      redeemedAt: typeof row.redeemedAt === "string" ? row.redeemedAt : null,
    });
  }
  return codes;
}

export function readLocalPromoCodes(): LocalPromoCode[] {
  const raw = readRaw(LOCAL_PROMO_KEY);
  if (!raw) return [];
  try {
    return sanitizeLocalPromoCodes(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function writeLocalPromoCodes(codes: LocalPromoCode[]) {
  try {
    writeRaw(LOCAL_PROMO_KEY, JSON.stringify(codes));
  } catch {
    // no-op
  }
}

export function createPromoId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `promo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
