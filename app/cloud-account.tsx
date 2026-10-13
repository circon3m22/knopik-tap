"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import {
  SAVE_KEY,
  sanitizeSave,
  type SaveData,
} from "./game-logic";
import { getSupabaseClient, usernameToEmail } from "./supabase-client";
import { chooseCloudSave, isCommittedSave, savesMatch, type UnsyncedSave } from "./save-sync-protocol";
import {
  DEFAULT_DIFFICULTY,
  clampDifficulty,
} from "./difficulty-engine";

type ProfileRow = {
  id: string;
  username: string;
  is_admin: boolean;
};

type GameSaveRow = {
  user_id: string;
  save: unknown;
  revision: number;
  source_id: string | null;
};

type PromoCodeRow = {
  id: string;
  code: string;
  amount: number;
  created_at: string;
  redeemed_by: string | null;
  redeemed_at: string | null;
};

type GameConfigRow = {
  difficulty: number;
};

export type CloudAccount = {
  userId: string;
  username: string;
  isAdmin: boolean;
};

export type CloudSyncState = "saved" | "saving" | "error" | "conflict";

export type PromoCode = {
  id: string;
  code: string;
  amount: number;
  createdAt: string;
  redeemed: boolean;
  redeemedAt: string | null;
};

export type PromoResult = {
  message: string;
  amount?: number;
};

type CloudGameSession = {
  account: CloudAccount;
  initialSave: SaveData;
  gameKey: string;
  syncState: CloudSyncState;
  difficulty: number;
  promoCodes: PromoCode[];
  saveProgress: (save: SaveData) => void;
  retrySave: () => Promise<boolean>;
  refreshPromoCodes: () => Promise<void>;
  updateDifficulty: (difficulty: number) => Promise<string>;
  createPromoCode: (code: string, amount: number) => Promise<string>;
  redeemPromoCode: (code: string) => Promise<PromoResult>;
  signOut: () => Promise<void>;
};

type CloudAccountGateProps = {
  children: (session: CloudGameSession) => ReactNode;
};

const SAVE_DELAY_MS = 1_200;
const SAVE_RETRY_BASE_MS = 2_000;
const SAVE_RETRY_MAX_MS = 30_000;
const MAX_PROMO_AMOUNT = 1_000_000_000;
const CLOUD_SOURCE_ID =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `knopik-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function localSaveKey(userId: string) {
  return `${SAVE_KEY}:${userId}`;
}

function pendingSaveKey(userId: string) {
  return `${SAVE_KEY}:pending:${userId}`;
}

type PendingSave = UnsyncedSave;

function readPendingSave(userId: string): PendingSave | null {
  try {
    const raw = localStorage.getItem(pendingSaveKey(userId));
    if (!raw) return null;
    const record = JSON.parse(raw) as Partial<PendingSave>;
    if (!Number.isSafeInteger(record.baseRevision) || Number(record.baseRevision) < 0 || !record.save) return null;
    return {
      save: sanitizeSave(record.save),
      baseRevision: Number(record.baseRevision),
      savedAt: Number(record.savedAt) || Date.now(),
    };
  } catch {
    return null;
  }
}

function writePendingSave(userId: string, save: SaveData, baseRevision: number) {
  try {
    localStorage.setItem(pendingSaveKey(userId), JSON.stringify({
      save,
      baseRevision,
      savedAt: Date.now(),
    } satisfies PendingSave));
  } catch {
    // Keep the best available in-memory copy and report a sync error if cloud upload fails.
  }
}

function removePendingSave(userId: string) {
  try {
    localStorage.removeItem(pendingSaveKey(userId));
  } catch { /* Storage may be disabled. */ }
}

function backupPendingSave(userId: string) {
  try {
    const raw = localStorage.getItem(pendingSaveKey(userId));
    if (raw) localStorage.setItem(`${SAVE_KEY}:conflict:${userId}:${Date.now()}`, raw);
  } catch { /* Browser may not provide persistent storage. */ }
}

function readExistingLocalSave(userId: string): SaveData | null {
  try {
    const raw = localStorage.getItem(localSaveKey(userId));
    return raw ? sanitizeSave(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeLocalSave(userId: string, save: SaveData) {
  try {
    localStorage.setItem(localSaveKey(userId), JSON.stringify(save));
  } catch {
    // The cloud copy remains available if local storage is unavailable.
  }
}

function normalizePromoCode(code: string) {
  return code.trim().toUpperCase();
}

function mapPromoCode(row: PromoCodeRow): PromoCode {
  return {
    id: row.id,
    code: row.code,
    amount: row.amount,
    createdAt: row.created_at,
    redeemed: Boolean(row.redeemed_by),
    redeemedAt: row.redeemed_at,
  };
}

export function CloudAccountGate({ children }: CloudAccountGateProps) {
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [account, setAccount] = useState<CloudAccount | null>(null);
  const [initialSave, setInitialSave] = useState<SaveData | null>(null);
  const [gameRevision, setGameRevision] = useState(0);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginPending, setLoginPending] = useState(false);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const [syncState, setSyncState] = useState<CloudSyncState>("saved");
  const [difficulty, setDifficulty] = useState(DEFAULT_DIFFICULTY);
  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
  const accountRef = useRef<CloudAccount | null>(null);
  const latestSaveRef = useRef<SaveData | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  const saveVersionRef = useRef(0);
  const flushedVersionRef = useRef(0);
  const cloudRevisionRef = useRef(0);
  const conflictRef = useRef(false);
  const flushInFlightRef = useRef<Promise<boolean> | null>(null);

  const refreshPromoCodes = useCallback(async () => {
    if (!accountRef.current?.isAdmin) return;
    const { data, error } = await getSupabaseClient()
      .from("promo_codes")
      .select("id, code, amount, created_at, redeemed_by, redeemed_at")
      .order("created_at", { ascending: false })
      .limit(200)
      .returns<PromoCodeRow[]>();
    if (!error) setPromoCodes((data ?? []).map(mapPromoCode));
  }, []);

  useEffect(() => {
    const supabase = getSupabaseClient();
    let active = true;

    void supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      setUser((current) => current?.id === data.user?.id ? current : data.user ?? null);
      setAuthLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser((current) => current?.id === session?.user?.id ? current : session?.user ?? null);
      setAuthLoading(false);
      if (!session?.user) {
        accountRef.current = null;
        setAccount(null);
        setInitialSave(null);
        setPromoCodes([]);
        setDifficulty(DEFAULT_DIFFICULTY);
      }
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    const supabase = getSupabaseClient();
    let active = true;
    const userId = user.id;

    async function loadCloudAccount() {
      setAuthLoading(true);
      setLoginError("");
      if (accountRef.current?.userId !== userId) {
        accountRef.current = null;
        setAccount(null);
        setInitialSave(null);
      }
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);

      const [
        { data: profile, error: profileError },
        { data: cloudSave, error: saveError },
        { data: gameConfig },
      ] = await Promise.all([
        supabase.from("profiles")
          .select("id, username, is_admin")
          .eq("id", userId)
          .single<ProfileRow>(),
        supabase.from("game_saves")
          .select("user_id, save, revision, source_id")
          .eq("user_id", userId)
          .maybeSingle<GameSaveRow>(),
        supabase.from("game_config")
          .select("difficulty")
          .eq("id", true)
          .maybeSingle<GameConfigRow>(),
      ]);

      if (!active) return;
      if (profileError || !profile) {
        setLoginError("Профиль игрока не найден.");
        setAuthLoading(false);
        return;
      }
      if (saveError) {
        setLoginError("Не удалось загрузить облачный прогресс. Повторите попытку, данные не сброшены.");
        setAuthLoading(false);
        return;
      }
      if (!cloudSave) {
        // Absence of a row for an existing account is NOT permission to create an empty save.
        setLoginError("В Supabase отсутствует сохранение этого аккаунта. Автоматический сброс запрещён. Обратитесь к администратору.");
        setAuthLoading(false);
        return;
      }
      if (!cloudSave.save || typeof cloudSave.save !== "object" || Array.isArray(cloudSave.save)) {
        setLoginError("Облачное сохранение повреждено. Перезапись запрещена.");
        setAuthLoading(false);
        return;
      }

      const cloudData = sanitizeSave(cloudSave.save);
      let pending = readPendingSave(userId);
      const cloudRevision = Number(cloudSave.revision);
      if (!Number.isSafeInteger(cloudRevision) || cloudRevision < 0) {
        setLoginError("Некорректная ревизия облачного сохранения.");
        setAuthLoading(false);
        return;
      }

      // Save local progress from older game versions before replacing any browser copy.
      // Legacy clients did not mark failed uploads, so a different local copy must
      // be inspected by the player rather than overwritten automatically.
      if (!pending) {
        const legacyLocal = readExistingLocalSave(userId);
        if (legacyLocal && !savesMatch(legacyLocal, cloudData)) {
          pending = {
            save: legacyLocal,
            baseRevision: cloudRevision === 0 ? 1 : cloudRevision - 1,
            savedAt: Date.now(),
          };
          writePendingSave(userId, pending.save, pending.baseRevision);
        }
      }

      const decision = chooseCloudSave(cloudData, cloudRevision, pending);
      const hasConflict = decision === "conflict";
      const needsRecovery = decision === "recover-local";
      if (pending && !hasConflict && !needsRecovery) removePendingSave(userId);

      const loadedSave = needsRecovery && pending ? pending.save : cloudData;
      const nextAccount: CloudAccount = {
        userId: profile.id,
        username: profile.username,
        isAdmin: profile.is_admin,
      };

      accountRef.current = nextAccount;
      latestSaveRef.current = loadedSave;
      cloudRevisionRef.current = cloudRevision;
      saveVersionRef.current = 0;
      flushedVersionRef.current = 0;
      conflictRef.current = hasConflict;
      retryAttemptRef.current = 0;
      writeLocalSave(userId, cloudData);
      if (needsRecovery && pending) writeLocalSave(userId, pending.save);
      setAccount(nextAccount);
      setInitialSave(loadedSave);
      setGameRevision((current) => current + 1);
      setSyncState(hasConflict ? "conflict" : needsRecovery ? "saving" : "saved");
      if (needsRecovery) {
        saveVersionRef.current = 1;
        // Resume the locally queued update only when its base revision is still current.
        queueMicrotask(() => { if (active) void flushProgressRef.current(); });
      }
      setDifficulty(clampDifficulty(gameConfig?.difficulty ?? DEFAULT_DIFFICULTY));

      if (nextAccount.isAdmin) {
        const { data: codes } = await supabase.from("promo_codes")
          .select("id, code, amount, created_at, redeemed_by, redeemed_at")
          .order("created_at", { ascending: false })
          .limit(200)
          .returns<PromoCodeRow[]>();
        if (active) setPromoCodes((codes ?? []).map(mapPromoCode));
      } else {
        setPromoCodes([]);
      }
      if (active) setAuthLoading(false);
    }

    void loadCloudAccount();
    return () => {
      active = false;
    };
  }, [user]);

  const scheduleSaveRetry = useCallback(() => {
    if (conflictRef.current || retryTimerRef.current || !accountRef.current) return;
    retryAttemptRef.current += 1;
    const delay = Math.min(
      SAVE_RETRY_MAX_MS,
      SAVE_RETRY_BASE_MS * 2 ** Math.min(5, retryAttemptRef.current - 1),
    );
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      void flushProgressRef.current();
    }, delay);
  }, []);

  const flushProgressRef = useRef<() => Promise<boolean>>(async () => false);
  const flushProgress = useCallback(async (): Promise<boolean> => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    if (flushInFlightRef.current) return flushInFlightRef.current;
    if (conflictRef.current) return false;

    const operation = (async (): Promise<boolean> => {
      while (flushedVersionRef.current < saveVersionRef.current) {
        const currentAccount = accountRef.current;
        const latestSave = latestSaveRef.current;
        const version = saveVersionRef.current;
        const expectedRevision = cloudRevisionRef.current;
        if (!currentAccount || !latestSave) return false;

        setSyncState("saving");
        const { data, error } = await getSupabaseClient().rpc("save_game_progress", {
          new_save: latestSave,
          expected_revision: expectedRevision,
          save_source_id: CLOUD_SOURCE_ID,
        });
        if (accountRef.current?.userId !== currentAccount.userId) return false;
        if (error || !data) {
          setSyncState("error");
          scheduleSaveRetry();
          return false;
        }

        const remote = data as GameSaveRow;
        const acknowledged = isCommittedSave(
          remote, expectedRevision, CLOUD_SOURCE_ID, latestSave,
        );
        if (!acknowledged) {
          // Never overwrite newer progress from another device or browser tab.
          conflictRef.current = true;
          setSyncState("conflict");
          return false;
        }
        cloudRevisionRef.current = Number(remote.revision);
        flushedVersionRef.current = version;
        retryAttemptRef.current = 0;
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
        if (version === saveVersionRef.current) {
          removePendingSave(currentAccount.userId);
        } else if (latestSaveRef.current) {
          writePendingSave(currentAccount.userId, latestSaveRef.current, cloudRevisionRef.current);
        }
      }
      setSyncState("saved");
      return true;
    })();

    flushInFlightRef.current = operation;
    try {
      return await operation;
    } finally {
      if (flushInFlightRef.current === operation) flushInFlightRef.current = null;
    }
  }, [scheduleSaveRetry]);

  flushProgressRef.current = flushProgress;

  const saveProgress = useCallback((save: SaveData) => {
    if (conflictRef.current) return;
    const currentAccount = accountRef.current;
    if (!currentAccount) return;
    const nextSave = sanitizeSave(save);
    if (latestSaveRef.current && savesMatch(nextSave, latestSaveRef.current)) return;
    latestSaveRef.current = nextSave;
    writeLocalSave(currentAccount.userId, nextSave);
    writePendingSave(currentAccount.userId, nextSave, cloudRevisionRef.current);
    saveVersionRef.current += 1;
    setSyncState("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void flushProgress();
    }, SAVE_DELAY_MS);
  }, [flushProgress]);

  const discardLocalPendingAndReload = useCallback(() => {
    const currentAccount = accountRef.current;
    if (!currentAccount) return;
    backupPendingSave(currentAccount.userId);
    removePendingSave(currentAccount.userId);
    window.location.reload();
  }, []);

  const downloadLocalPending = useCallback(() => {
    const currentAccount = accountRef.current;
    if (!currentAccount) return;
    const pending = readPendingSave(currentAccount.userId);
    if (!pending) return;
    const blob = new Blob([JSON.stringify(pending, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `knopik-${currentAccount.username}-unsynced.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  const restorePendingToCloud = useCallback(async () => {
    const currentAccount = accountRef.current;
    if (!currentAccount || recoveryPending) return;
    const pending = readPendingSave(currentAccount.userId);
    if (!pending) {
      setRecoveryError("Локальная копия не найдена.");
      return;
    }
    const confirmation = window.confirm(
      "Восстановить локальный прогресс в Supabase? Это заменит текущий облачный прогресс этого аккаунта. " +
      "Предыдущая версия останется в закрытом архиве Supabase. Сначала рекомендуется скачать локальную копию.",
    );
    if (!confirmation) return;

    setRecoveryPending(true);
    setRecoveryError("");
    try {
      const { data: row, error: readError } = await getSupabaseClient()
        .from("game_saves")
        .select("user_id, save, revision, source_id")
        .eq("user_id", currentAccount.userId)
        .single<GameSaveRow>();
      if (readError || !row) throw new Error("Не удалось проверить облачное сохранение.");
      const expectedRevision = Number(row.revision);
      const { data, error } = await getSupabaseClient().rpc("save_game_progress", {
        new_save: pending.save,
        expected_revision: expectedRevision,
        save_source_id: CLOUD_SOURCE_ID,
      });
      if (error || !data || !isCommittedSave(data as GameSaveRow, expectedRevision, CLOUD_SOURCE_ID, pending.save)) {
        throw new Error("Облачная версия успела измениться. Попробуйте ещё раз после обновления страницы.");
      }
      backupPendingSave(currentAccount.userId);
      removePendingSave(currentAccount.userId);
      writeLocalSave(currentAccount.userId, pending.save);
      window.location.reload();
    } catch (err) {
      setRecoveryError(err instanceof Error ? err.message : "Не удалось восстановить локальный прогресс.");
    } finally {
      setRecoveryPending(false);
    }
  }, [recoveryPending]);

  const createPromoCode = useCallback(async (code: string, amount: number) => {
    const currentAccount = accountRef.current;
    if (!currentAccount?.isAdmin) return "Создавать промокоды может только администратор.";

    const normalizedCode = normalizePromoCode(code);
    const normalizedAmount = Math.floor(amount);
    if (!/^[A-Z0-9_-]{3,32}$/.test(normalizedCode)) {
      return "Код: 3–32 латинских символа, цифры, _ или -.";
    }
    if (!Number.isSafeInteger(normalizedAmount) || normalizedAmount < 1 || normalizedAmount > MAX_PROMO_AMOUNT) {
      return `Сумма должна быть от 1 до ${MAX_PROMO_AMOUNT.toLocaleString("ru-RU")}.`;
    }

    const { data, error } = await getSupabaseClient()
      .from("promo_codes")
      .insert({
        code: normalizedCode,
        amount: normalizedAmount,
        created_by: currentAccount.userId,
      })
      .select("id, code, amount, created_at, redeemed_by, redeemed_at")
      .single<PromoCodeRow>();

    if (error) {
      return error.code === "23505" ? "Такой промокод уже существует." : "Не удалось создать промокод.";
    }
    setPromoCodes((current) => [mapPromoCode(data), ...current]);
    return "Промокод создан.";
  }, []);

  const updateDifficulty = useCallback(async (nextDifficulty: number) => {
    const currentAccount = accountRef.current;
    if (!currentAccount?.isAdmin) return "Менять сложность может только администратор.";
    const normalized = clampDifficulty(nextDifficulty);
    const { data, error } = await getSupabaseClient()
      .from("game_config")
      .update({
        difficulty: normalized,
        updated_by: currentAccount.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", true)
      .select("difficulty")
      .single<GameConfigRow>();
    if (error || !data) return "Не удалось сохранить сложность.";
    setDifficulty(clampDifficulty(data.difficulty));
    return "Сложность сохранена.";
  }, []);

  const redeemPromoCode = useCallback(async (code: string): Promise<PromoResult> => {
    const currentAccount = accountRef.current;
    if (!currentAccount) return { message: "Сначала войди в аккаунт." };
    if (currentAccount.isAdmin) return { message: "Промокоды предназначены для другого игрока." };

    const normalizedCode = normalizePromoCode(code);
    if (!/^[A-Z0-9_-]{3,32}$/.test(normalizedCode)) {
      return { message: "Проверь формат промокода." };
    }

    if (!await flushProgress()) return { message: "Сначала дождитесь сохранения прогресса в облако." };
    const { data, error } = await getSupabaseClient().rpc("redeem_promo_code", {
      promo_code: normalizedCode,
    });
    if (error) return { message: error.message || "Не удалось применить промокод." };

    const result = data as { amount?: unknown; save?: unknown } | null;
    const amount = typeof result?.amount === "number" ? Math.max(0, Math.floor(result.amount)) : 0;
    if (!amount || !result?.save) return { message: "Не удалось получить награду." };

    const nextSave = sanitizeSave(result.save);
    latestSaveRef.current = nextSave;
    cloudRevisionRef.current += 1; // The redeem_promo_code RPC increments revision atomically.
    writeLocalSave(currentAccount.userId, nextSave);
    removePendingSave(currentAccount.userId);
    saveVersionRef.current += 1;
    flushedVersionRef.current = saveVersionRef.current;
    setSyncState("saved");
    return { amount, message: `Начислено ${amount.toLocaleString("ru-RU")} монет.` };
  }, [flushProgress]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") void flushProgress();
    };
    const handlePageHide = () => void flushProgress();
    const handleOnline = () => { if (!conflictRef.current) void flushProgress(); };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("online", handleOnline);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("online", handleOnline);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [flushProgress]);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = usernameToEmail(username);
    if (!email) {
      setLoginError("Логин должен содержать от 3 до 32 латинских букв или цифр.");
      return;
    }
    setLoginPending(true);
    setLoginError("");
    const { error } = await getSupabaseClient().auth.signInWithPassword({
      email,
      password,
    });
    if (error) setLoginError("Неверный логин или пароль.");
    setLoginPending(false);
  }

  const signOut = useCallback(async () => {
    if (!await flushProgress()) {
      setSyncState(conflictRef.current ? "conflict" : "error");
      return; // Don't sign out while there are uncommitted changes.
    }
    await getSupabaseClient().auth.signOut();
  }, [flushProgress]);

  if (authLoading) {
    return (
      <main className="auth-screen">
        <div className="auth-loader" aria-label="Загрузка профиля" />
      </main>
    );
  }

  if (user && syncState === "conflict" && account) {
    return (
      <main className="auth-screen">
        <section className="auth-card" role="alert">
          <p className="auth-kicker">KNOPIK · ЗАЩИТА ДАННЫХ</p>
          <h1>Обнаружены два разных сохранения</h1>
          <p>На другом устройстве есть более новая облачная запись. Мы остановили сохранение, чтобы не затереть прогресс.</p>
          <p>Несохранённая копия с этого устройства сохранена отдельно.</p>
          <button type="button" onClick={downloadLocalPending}>Скачать локальную копию</button>
          <button type="button" disabled={recoveryPending} onClick={() => void restorePendingToCloud()}>
            {recoveryPending ? "Восстанавливаем…" : "Восстановить локальную копию в Supabase"}
          </button>
          <button type="button" disabled={recoveryPending} onClick={discardLocalPendingAndReload}>Продолжить с облачной версией</button>
          {recoveryError && <p className="auth-error" role="alert">{recoveryError}</p>}
          <p>Восстановление заменит текущий облачный прогресс только после вашего подтверждения. Предыдущая версия останется в закрытом архиве.</p>
        </section>
      </main>
    );
  }

  if (user && !authLoading && loginError && !account) {
    return (
      <main className="auth-screen">
        <section className="auth-card" role="alert">
          <p className="auth-kicker">KNOPIK · ОБЛАЧНЫЙ ПРОГРЕСС</p>
          <h1>Сохранение не загружено</h1>
          <p>{loginError}</p>
          <button type="button" onClick={() => window.location.reload()}>Повторить загрузку</button>
          <button type="button" onClick={() => void getSupabaseClient().auth.signOut()}>Выйти из аккаунта</button>
        </section>
      </main>
    );
  }

  if (!user || !account || !initialSave) {
    return (
      <main className="auth-screen">
        <form className="auth-card" onSubmit={submitLogin}>
          <p className="auth-kicker">KNOPIK TAP</p>
          <h1>Вход в игру</h1>
          <p>Войди в профиль — прогресс загрузится из облака.</p>
          <label>
            <span>Логин</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.currentTarget.value)}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="username"
              required
            />
          </label>
          <label>
            <span>Пароль</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {loginError && <p className="auth-error" role="alert">{loginError}</p>}
          <button type="submit" disabled={loginPending}>
            {loginPending ? "Входим…" : "Войти"}
          </button>
        </form>
      </main>
    );
  }

  return children({
    account,
    initialSave,
    gameKey: `${account.userId}:${gameRevision}`,
    syncState,
    difficulty,
    promoCodes,
    saveProgress,
    retrySave: flushProgress,
    refreshPromoCodes,
    updateDifficulty,
    createPromoCode,
    redeemPromoCode,
    signOut,
  });
}
