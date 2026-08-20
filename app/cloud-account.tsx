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
  createDefaultSave,
  sanitizeSave,
  type SaveData,
} from "./game-logic";
import { getSupabaseClient, usernameToEmail } from "./supabase-client";
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

export type CloudSyncState = "saved" | "saving" | "error";

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
  refreshPromoCodes: () => Promise<void>;
  updateDifficulty: (difficulty: number) => Promise<string>;
  createPromoCode: (code: string, amount: number) => Promise<string>;
  redeemPromoCode: (code: string) => Promise<PromoResult>;
  signOut: () => Promise<void>;
};

type CloudAccountGateProps = {
  children: (session: CloudGameSession) => ReactNode;
};

const SAVE_DELAY_MS = 4_000;
const MAX_PROMO_AMOUNT = 1_000_000_000;
const LOGIN_ACCOUNTS = [
  { username: "Kamrad", role: "Администратор" },
  { username: "salaga", role: "Игрок" },
] as const;
const CLOUD_SOURCE_ID =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `knopik-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function localSaveKey(userId: string) {
  return `${SAVE_KEY}:${userId}`;
}

function readLocalSave(userId: string) {
  try {
    const raw = localStorage.getItem(localSaveKey(userId));
    return sanitizeSave(raw ? JSON.parse(raw) : createDefaultSave());
  } catch {
    return createDefaultSave();
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
  const [username, setUsername] = useState<(typeof LOGIN_ACCOUNTS)[number]["username"]>("Kamrad");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginPending, setLoginPending] = useState(false);
  const [syncState, setSyncState] = useState<CloudSyncState>("saved");
  const [difficulty, setDifficulty] = useState(DEFAULT_DIFFICULTY);
  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
  const accountRef = useRef<CloudAccount | null>(null);
  const latestSaveRef = useRef<SaveData | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveVersionRef = useRef(0);
  const flushedVersionRef = useRef(0);
  const flushInFlightRef = useRef<Promise<void> | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);

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
      setUser(data.user ?? null);
      setAuthLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
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

    async function loadCloudAccount() {
      setAuthLoading(true);
      setLoginError("");
      const [
        { data: profile, error: profileError },
        { data: cloudSave, error: saveError },
        { data: gameConfig },
      ] =
        await Promise.all([
          supabase
            .from("profiles")
            .select("id, username, is_admin")
            .eq("id", user!.id)
            .single<ProfileRow>(),
          supabase
            .from("game_saves")
            .select("user_id, save")
            .eq("user_id", user!.id)
            .maybeSingle<GameSaveRow>(),
          supabase
            .from("game_config")
            .select("difficulty")
            .eq("id", true)
            .maybeSingle<GameConfigRow>(),
        ]);

      if (!active) return;
      if (profileError || !profile) {
        setLoginError("Профиль игрока не найден.");
        await supabase.auth.signOut();
        setAuthLoading(false);
        return;
      }
      if (saveError) {
        setLoginError("Не удалось загрузить сохранение.");
        setAuthLoading(false);
        return;
      }

      const loadedSave = cloudSave
        ? sanitizeSave(cloudSave.save)
        : readLocalSave(user!.id);

      if (!cloudSave) {
        const { error } = await supabase.from("game_saves").insert({
          user_id: user!.id,
          save: loadedSave,
          source_id: CLOUD_SOURCE_ID,
        });
        if (error) {
          setLoginError("Не удалось создать облачное сохранение.");
          setAuthLoading(false);
          return;
        }
      }

      const nextAccount = {
        userId: profile.id,
        username: profile.username,
        isAdmin: profile.is_admin,
      };
      writeLocalSave(user!.id, loadedSave);
      accountRef.current = nextAccount;
      latestSaveRef.current = loadedSave;
      saveVersionRef.current = 0;
      flushedVersionRef.current = 0;
      setAccount(nextAccount);
      setInitialSave(loadedSave);
      setGameRevision((current) => current + 1);
      setSyncState("saved");
      setDifficulty(clampDifficulty(gameConfig?.difficulty ?? DEFAULT_DIFFICULTY));
      if (nextAccount.isAdmin) {
        const { data: codes } = await supabase
          .from("promo_codes")
          .select("id, code, amount, created_at, redeemed_by, redeemed_at")
          .order("created_at", { ascending: false })
          .limit(200)
          .returns<PromoCodeRow[]>();
        if (active) setPromoCodes((codes ?? []).map(mapPromoCode));
      } else {
        setPromoCodes([]);
      }
      setAuthLoading(false);
    }

    void loadCloudAccount();
    return () => {
      active = false;
    };
  }, [user]);

  const flushProgress = useCallback(async (): Promise<void> => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    if (flushInFlightRef.current) return flushInFlightRef.current;

    const operation = (async () => {
      setSyncState("saving");
      while (flushedVersionRef.current < saveVersionRef.current) {
        const currentAccount = accountRef.current;
        const latestSave = latestSaveRef.current;
        const version = saveVersionRef.current;
        if (!currentAccount || !latestSave) return;
        const { data, error } = await getSupabaseClient()
          .from("game_saves")
          .update({
            save: latestSave,
            source_id: CLOUD_SOURCE_ID,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", currentAccount.userId)
          .select("user_id")
          .maybeSingle<{ user_id: string }>();
        if (error || !data) {
          setSyncState("error");
          return;
        }
        flushedVersionRef.current = version;
      }
      setSyncState("saved");
    })();
    flushInFlightRef.current = operation;
    try {
      await operation;
    } finally {
      if (flushInFlightRef.current === operation) flushInFlightRef.current = null;
    }
  }, []);

  const saveProgress = useCallback((save: SaveData) => {
    const nextSave = sanitizeSave(save);
    latestSaveRef.current = nextSave;
    const currentAccount = accountRef.current;
    if (currentAccount) writeLocalSave(currentAccount.userId, nextSave);
    saveVersionRef.current += 1;
    setSyncState("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void flushProgress();
    }, SAVE_DELAY_MS);
  }, [flushProgress]);

  const createPromoCode = useCallback(async (code: string, amount: number) => {
    const currentAccount = accountRef.current;
    if (!currentAccount?.isAdmin) return "Создавать промокоды может только Kamrad.";

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
    if (!currentAccount?.isAdmin) return "Менять сложность может только Kamrad.";
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

    await flushProgress();
    const { data, error } = await getSupabaseClient().rpc("redeem_promo_code", {
      promo_code: normalizedCode,
    });
    if (error) return { message: error.message || "Не удалось применить промокод." };

    const result = data as { amount?: unknown; save?: unknown } | null;
    const amount = typeof result?.amount === "number" ? Math.max(0, Math.floor(result.amount)) : 0;
    if (!amount || !result?.save) return { message: "Не удалось получить награду." };

    const nextSave = sanitizeSave(result.save);
    latestSaveRef.current = nextSave;
    writeLocalSave(currentAccount.userId, nextSave);
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
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [flushProgress]);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selectedAccount = LOGIN_ACCOUNTS.find(
      (account) => account.username.toLowerCase() === username.trim().toLowerCase(),
    );
    if (!selectedAccount) {
      setLoginError("Выбери один из двух профилей.");
      return;
    }
    const email = usernameToEmail(username);
    if (!email) {
      setLoginError("Логин должен содержать от 3 до 32 латинских букв или цифр.");
      return;
    }
    setLoginPending(true);
    setLoginError("");
    try {
      const { error } = await getSupabaseClient().auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setLoginError("Проверь пароль и попробуй снова.");
        passwordInputRef.current?.focus();
      }
    } catch {
      setLoginError("Не удалось подключиться. Проверь интернет и попробуй снова.");
      passwordInputRef.current?.focus();
    } finally {
      setLoginPending(false);
    }
  }

  const signOut = useCallback(async () => {
    await flushProgress();
    await getSupabaseClient().auth.signOut();
  }, [flushProgress]);

  if (authLoading) {
    return (
      <main className="auth-screen">
        <div className="auth-loader" aria-label="Загрузка профиля" />
      </main>
    );
  }

  if (!user || !account || !initialSave) {
    return (
      <main className="auth-screen">
        <form className="auth-card" onSubmit={submitLogin}>
          <div className="auth-brand" aria-label="Knopik Tap">
            <span aria-hidden="true">K</span>
            <p className="auth-kicker">KNOPIK TAP</p>
          </div>
          <h1>Выбери профиль</h1>
          <p>Прогресс загрузится из облака и сохранится автоматически.</p>
          <fieldset className="auth-profiles">
            <legend>Профиль</legend>
            {LOGIN_ACCOUNTS.map((loginAccount) => {
              const selected = loginAccount.username === username;
              return (
                <button
                  className={selected ? "is-selected" : ""}
                  type="button"
                  key={loginAccount.username}
                  aria-pressed={selected}
                  onClick={() => {
                    setUsername(loginAccount.username);
                    setPassword("");
                    setLoginError("");
                  }}
                >
                  <span aria-hidden="true">{loginAccount.username.slice(0, 1).toUpperCase()}</span>
                  <span><strong>{loginAccount.username}</strong><small>{loginAccount.role}</small></span>
                  <i aria-hidden="true" />
                </button>
              );
            })}
          </fieldset>
          <label>
            <span>Пароль</span>
            <input
              ref={passwordInputRef}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              autoComplete="current-password"
              inputMode="numeric"
              placeholder="Введите пароль"
              aria-invalid={Boolean(loginError)}
              aria-describedby={loginError ? "login-error" : undefined}
              required
            />
          </label>
          {loginError && <p className="auth-error" id="login-error" role="alert">{loginError}</p>}
          <button type="submit" disabled={loginPending}>
            {loginPending ? "Загружаем профиль…" : `Войти как ${username}`}
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
    refreshPromoCodes,
    updateDifficulty,
    createPromoCode,
    redeemPromoCode,
    signOut,
  });
}
