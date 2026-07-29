"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { RealtimePostgresChangesPayload, User } from "@supabase/supabase-js";
import {
  SAVE_KEY,
  createDefaultSave,
  sanitizeSave,
  type SaveData,
} from "./game-logic";
import {
  getSupabaseClient,
  isSupabaseConfigured,
  usernameToEmail,
} from "./supabase-client";

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
  updated_at: string;
};

export type CloudAccount = {
  userId: string;
  username: string;
  isAdmin: boolean;
};

type CloudGameSession = {
  account: CloudAccount;
  initialSave: SaveData;
  gameKey: string;
  saveProgress: (save: SaveData) => void;
};

type CloudAccountGateProps = {
  children: (session: CloudGameSession) => ReactNode;
};

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
    // Cloud persistence still works if browser storage is unavailable.
  }
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Не удалось выполнить запрос. Попробуй ещё раз.";
}

export function CloudAccountGate({ children }: CloudAccountGateProps) {
  const configured = isSupabaseConfigured();
  const sourceId = CLOUD_SOURCE_ID;
  const [authLoading, setAuthLoading] = useState(configured);
  const [user, setUser] = useState<User | null>(null);
  const [account, setAccount] = useState<CloudAccount | null>(null);
  const [initialSave, setInitialSave] = useState<SaveData | null>(null);
  const [gameRevision, setGameRevision] = useState(0);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginPending, setLoginPending] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [accountMessage, setAccountMessage] = useState("");
  const [accountPending, setAccountPending] = useState(false);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [grantUserId, setGrantUserId] = useState("");
  const [grantAmount, setGrantAmount] = useState("1000");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSaveRef = useRef<SaveData | null>(null);
  const cloudRevisionRef = useRef(0);

  useEffect(() => {
    if (!configured) return;
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
        setAccount(null);
        setInitialSave(null);
        setAccountOpen(false);
      }
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [configured]);

  useEffect(() => {
    if (!user) return;
    const supabase = getSupabaseClient();
    let active = true;

    async function loadCloudAccount() {
      setAuthLoading(true);
      const [{ data: profile, error: profileError }, { data: cloudSave, error: saveError }] =
        await Promise.all([
          supabase
            .from("profiles")
            .select("id, username, is_admin")
            .eq("id", user!.id)
            .single<ProfileRow>(),
          supabase
            .from("game_saves")
            .select("user_id, save, revision, source_id, updated_at")
            .eq("user_id", user!.id)
            .maybeSingle<GameSaveRow>(),
        ]);

      if (!active) return;
      if (profileError) {
        setLoginError("Профиль игрока не настроен. Обратись к администратору.");
        await supabase.auth.signOut();
        setAuthLoading(false);
        return;
      }
      if (saveError) {
        setLoginError("Не удалось загрузить облачный прогресс.");
        setAuthLoading(false);
        return;
      }

      const localSave = readLocalSave();
      const loadedSave = cloudSave ? sanitizeSave(cloudSave.save) : localSave;
      if (!cloudSave) {
        const { data: inserted, error } = await supabase
          .from("game_saves")
          .insert({ user_id: user!.id, save: loadedSave, source_id: sourceId })
          .select("user_id, save, revision, source_id, updated_at")
          .single<GameSaveRow>();
        if (error) {
          setLoginError("Не удалось создать облачное сохранение.");
          setAuthLoading(false);
          return;
        }
        cloudRevisionRef.current = inserted.revision;
      } else {
        cloudRevisionRef.current = cloudSave.revision;
      }

      writeLocalSave(loadedSave);
      setAccount({
        userId: profile.id,
        username: profile.username,
        isAdmin: profile.is_admin,
      });
      setInitialSave(loadedSave);
      setGameRevision((current) => current + 1);
      setAuthLoading(false);
    }

    void loadCloudAccount();
    return () => {
      active = false;
    };
  }, [sourceId, user]);

  useEffect(() => {
    if (!account) return;
    const supabase = getSupabaseClient();
    const channel = supabase
      .channel(`knopik-save-${account.userId}`)
      .on<GameSaveRow>(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "game_saves",
          filter: `user_id=eq.${account.userId}`,
        },
        (payload: RealtimePostgresChangesPayload<GameSaveRow>) => {
          const remote = payload.new as GameSaveRow;
          if (!remote.save || remote.source_id === sourceId) return;
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
          latestSaveRef.current = null;
          cloudRevisionRef.current = remote.revision;
          const nextSave = sanitizeSave(remote.save);
          writeLocalSave(nextSave);
          setInitialSave(nextSave);
          setGameRevision((current) => current + 1);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [account, sourceId]);

  useEffect(() => {
    if (!account?.isAdmin || !accountOpen) return;
    const supabase = getSupabaseClient();
    void supabase
      .from("profiles")
      .select("id, username, is_admin")
      .neq("id", account.userId)
      .order("username")
      .then(({ data }) => {
        const nextProfiles = (data ?? []) as ProfileRow[];
        setProfiles(nextProfiles);
        setGrantUserId((current) => current || nextProfiles[0]?.id || "");
      });
  }, [account, accountOpen]);

  const saveProgress = useCallback(
    (save: SaveData) => {
      if (!account) return;
      latestSaveRef.current = sanitizeSave(save);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const latest = latestSaveRef.current;
        if (!latest) return;
        const expectedRevision = cloudRevisionRef.current;
        void getSupabaseClient()
          .rpc("save_game_progress", {
            new_save: latest,
            expected_revision: expectedRevision,
            save_source_id: sourceId,
          })
          .then(({ data, error }) => {
            if (error) {
              console.error("Cloud save failed", error.message);
              return;
            }
            const remote = data as GameSaveRow;
            cloudRevisionRef.current = remote.revision;
            if (remote.source_id !== sourceId) {
              const nextSave = sanitizeSave(remote.save);
              writeLocalSave(nextSave);
              setInitialSave(nextSave);
              setGameRevision((current) => current + 1);
            }
          });
      }, 900);
    },
    [account, sourceId],
  );

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

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAccountPending(true);
    setAccountMessage("");
    const { error } = await getSupabaseClient().auth.updateUser({
      password: newPassword,
    });
    setAccountMessage(error ? errorText(error) : "Пароль изменён.");
    if (!error) setNewPassword("");
    setAccountPending(false);
  }

  async function grantCoins(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number.parseInt(grantAmount, 10);
    if (!grantUserId || !Number.isSafeInteger(amount) || amount < 1) {
      setAccountMessage("Выбери игрока и укажи положительную сумму.");
      return;
    }
    setAccountPending(true);
    setAccountMessage("");
    const { error } = await getSupabaseClient().rpc("admin_grant_coins", {
      target_user_id: grantUserId,
      coin_amount: amount,
    });
    setAccountMessage(
      error ? errorText(error) : `Начислено ${amount.toLocaleString("ru-RU")} монет.`,
    );
    setAccountPending(false);
  }

  if (!configured) {
    return (
      <main className="auth-screen">
        <section className="auth-card" role="alert">
          <p className="auth-kicker">KNOPIK TAP</p>
          <h1>Подключение почти готово</h1>
          <p>Для входа нужен публичный ключ нового проекта Supabase.</p>
        </section>
      </main>
    );
  }

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
          <p>Прогресс и баланс будут доступны на любом устройстве.</p>
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

  return (
    <>
      {/* eslint-disable-next-line react-hooks/refs */}
      {children({
        account,
        initialSave,
        gameKey: `${account.userId}:${gameRevision}`,
        saveProgress,
      })}
      <button
        className="account-pill"
        type="button"
        onClick={() => setAccountOpen(true)}
        aria-label="Открыть личный кабинет"
      >
        {account.username.slice(0, 1).toUpperCase()}
      </button>
      {accountOpen && (
        <div className="account-backdrop" onPointerDown={(event) => {
          if (event.target === event.currentTarget) setAccountOpen(false);
        }}>
          <section className="account-sheet" aria-labelledby="account-title">
            <header>
              <div>
                <small>ЛИЧНЫЙ КАБИНЕТ</small>
                <h2 id="account-title">{account.username}</h2>
              </div>
              <button type="button" onClick={() => setAccountOpen(false)} aria-label="Закрыть">×</button>
            </header>
            <p className="cloud-status"><span /> Прогресс синхронизируется с облаком</p>
            <form className="account-form" onSubmit={changePassword}>
              <label>
                <span>Новый пароль</span>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.currentTarget.value)}
                  autoComplete="new-password"
                  required
                />
              </label>
              <button type="submit" disabled={accountPending}>ИЗМЕНИТЬ ПАРОЛЬ</button>
            </form>
            {account.isAdmin && (
              <form className="account-form admin-form" onSubmit={grantCoins}>
                <h3>Начислить монеты</h3>
                <label>
                  <span>Игрок</span>
                  <select value={grantUserId} onChange={(event) => setGrantUserId(event.currentTarget.value)} required>
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>{profile.username}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Сумма</span>
                  <input
                    type="number"
                    min="1"
                    max="1000000000"
                    step="1"
                    value={grantAmount}
                    onChange={(event) => setGrantAmount(event.currentTarget.value)}
                    required
                  />
                </label>
                <button type="submit" disabled={accountPending || profiles.length === 0}>НАЧИСЛИТЬ</button>
              </form>
            )}
            {accountMessage && <p className="account-message" role="status">{accountMessage}</p>}
            <button className="sign-out-button" type="button" onClick={() => void getSupabaseClient().auth.signOut()}>
              ВЫЙТИ ИЗ АККАУНТА
            </button>
          </section>
        </div>
      )}
    </>
  );
}
