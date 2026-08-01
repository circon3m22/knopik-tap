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

type ProfileRow = {
  id: string;
  username: string;
  is_admin: boolean;
};

type GameSaveRow = {
  user_id: string;
  save: unknown;
};

export type CloudAccount = {
  userId: string;
  username: string;
  isAdmin: boolean;
};

export type CloudSyncState = "saved" | "saving" | "error";

type CloudGameSession = {
  account: CloudAccount;
  initialSave: SaveData;
  gameKey: string;
  syncState: CloudSyncState;
  saveProgress: (save: SaveData) => void;
  changePassword: (password: string) => Promise<string>;
  signOut: () => Promise<void>;
};

type CloudAccountGateProps = {
  children: (session: CloudGameSession) => ReactNode;
};

const SAVE_DELAY_MS = 4_000;
const CLOUD_SOURCE_ID =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `knopik-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function readLocalSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return sanitizeSave(raw ? JSON.parse(raw) : createDefaultSave());
  } catch {
    return createDefaultSave();
  }
}

function writeLocalSave(save: SaveData) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // The cloud copy remains available if local storage is unavailable.
  }
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
  const [syncState, setSyncState] = useState<CloudSyncState>("saved");
  const accountRef = useRef<CloudAccount | null>(null);
  const latestSaveRef = useRef<SaveData | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      const [{ data: profile, error: profileError }, { data: cloudSave, error: saveError }] =
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
        : readLocalSave();

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
      writeLocalSave(loadedSave);
      accountRef.current = nextAccount;
      latestSaveRef.current = loadedSave;
      setAccount(nextAccount);
      setInitialSave(loadedSave);
      setGameRevision((current) => current + 1);
      setSyncState("saved");
      setAuthLoading(false);
    }

    void loadCloudAccount();
    return () => {
      active = false;
    };
  }, [user]);

  const flushProgress = useCallback(async () => {
    const currentAccount = accountRef.current;
    const latestSave = latestSaveRef.current;
    if (!currentAccount || !latestSave) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    setSyncState("saving");
    const { error } = await getSupabaseClient()
      .from("game_saves")
      .update({
        save: latestSave,
        source_id: CLOUD_SOURCE_ID,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", currentAccount.userId);
    setSyncState(error ? "error" : "saved");
  }, []);

  const saveProgress = useCallback((save: SaveData) => {
    const nextSave = sanitizeSave(save);
    latestSaveRef.current = nextSave;
    writeLocalSave(nextSave);
    setSyncState("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void flushProgress();
    }, SAVE_DELAY_MS);
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

  const changePassword = useCallback(async (nextPassword: string) => {
    if (nextPassword.length < 6) return "Пароль должен содержать минимум 6 символов.";
    const { error } = await getSupabaseClient().auth.updateUser({
      password: nextPassword,
    });
    return error ? "Не удалось изменить пароль." : "Пароль изменён.";
  }, []);

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
          <p className="auth-kicker">KNOPIK TAP</p>
          <h1>Вход в игру</h1>
          <p>Введи логин и пароль. Прогресс загрузится из облака.</p>
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
            {loginPending ? "ВХОД..." : "ВОЙТИ"}
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
    saveProgress,
    changePassword,
    signOut,
  });
}
