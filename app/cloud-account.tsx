'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { sanitizeSave, type SaveData } from './game-logic';
import { accountRequest, AccountError, ProgressQueue, SESSION_KEY, accountSaveKey, type Account, type SessionData } from './account-client';
export type CloudAccount = Account;
export type CloudSyncState = 'saved' | 'saving' | 'error';
export type PromoCode = { id: string; code: string; amount: number; createdAt: string; redeemed: boolean; redeemedAt: string | null };
export type PromoResult = { message: string; amount?: number };
export type CloudGameSession = {
  account: Account; initialSave: SaveData; gameKey: string; syncState: CloudSyncState; syncError: string;
  difficulty: number; promoCodes: PromoCode[]; saveProgress: (save: SaveData) => void;
  retrySave: () => Promise<void>; refreshPromoCodes: () => Promise<void>; updateDifficulty: (value: number) => Promise<string>;
  createPromoCode: (code: string, amount: number) => Promise<string>; redeemPromoCode: (code: string) => Promise<PromoResult>;
  signOut: () => Promise<void>;
};
const errorText = (e: unknown) => e instanceof Error ? e.message : 'Не удалось выполнить запрос.';
export function CloudAccountGate({ children, onBootReady }: { children: (session: CloudGameSession) => ReactNode; onBootReady?: () => void }) {
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [visiblePassword, setVisiblePassword] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [syncState, setSyncState] = useState<CloudSyncState>('saved');
  const [syncError, setSyncError] = useState('');
  const [gameRevision, setGameRevision] = useState(0);
  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
  const token = useRef('');
  const queue = useRef<ProgressQueue | null>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const live = useRef(true);
  const loginLock = useRef(false);
  const operationLock = useRef(false);
  const accept = useCallback((data: SessionData, sessionToken: string) => {
    if (!['Bober', 'Bobur'].includes(data.account.username) || data.account.isAdmin !== (data.account.username === 'Bobur')) throw new AccountError('Этот аккаунт больше не используется.', 401);
    token.current = sessionToken;
    try { localStorage.setItem(SESSION_KEY, sessionToken); } catch { /* In-memory session remains usable. */ }
    const progress = new ProgressQueue(data, payload => accountRequest('save', payload, sessionToken, true), (status, message) => {
      if (live.current) { setSyncState(status); setSyncError(message ?? ''); }
    }, (save, revision, dirty) => {
      try { localStorage.setItem(accountSaveKey(data.account.userId), JSON.stringify({ save, revision, dirty })); } catch { /* Cloud saves work without local storage. */ }
    });
    try {
      const saved = JSON.parse(localStorage.getItem(accountSaveKey(data.account.userId)) || 'null');
      if (saved?.dirty && saved.revision === data.revision) { progress.update(saved.save); data = { ...data, save: progress.save }; }
    } catch { /* Ignore malformed local copies. */ }
    queue.current = progress; setSession({ ...data, save: sanitizeSave(data.save) });
    setGameRevision(v => v + 1); setPassword(''); setError('');
  }, []);
  useEffect(() => {
    live.current = true; let active = true; let restoredToken = '';
    try {
      restoredToken = localStorage.getItem(SESSION_KEY) || '';
      for (const key of Object.keys(localStorage)) if (key.startsWith('knopik-tap:save') || key === 'sb-uxxzvjwsexdoqcevzipu-auth-token') localStorage.removeItem(key);
    } catch { /* Storage is optional. */ }
    void (restoredToken ? accountRequest<SessionData>('session', {}, restoredToken) : Promise.resolve(null)).then(data => {
      if (active && data) accept(data, restoredToken);
    }).catch(e => {
      if (!active) return; setError(errorText(e));
      if (e instanceof AccountError && e.status === 401) try { localStorage.removeItem(SESSION_KEY); } catch { /* No persistent token. */ }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; live.current = false; };
  }, [accept]);
  useEffect(() => { if (!loading) onBootReady?.(); }, [loading, onBootReady]);
  useEffect(() => {
    const flush = () => { void queue.current?.flush().catch(() => {}); };
    const visibility = () => { if (document.visibilityState === 'hidden') flush(); };
    const interval = setInterval(flush, 2000);
    window.addEventListener('online', flush); window.addEventListener('pagehide', flush); document.addEventListener('visibilitychange', visibility);
    return () => { clearInterval(interval); window.removeEventListener('online', flush); window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  const saveProgress = useCallback((save: SaveData) => { queue.current?.update(save); }, []);
  const retrySave = useCallback(async () => { await queue.current?.flush(); }, []);
  const refreshPromoCodes = useCallback(async () => {
    const result = await accountRequest<{ codes: PromoCode[] }>('promo_list', {}, token.current); setPromoCodes(result.codes);
  }, []);
  const updateDifficulty = useCallback(async (difficulty: number) => {
    const result = await accountRequest<{ difficulty: number }>('difficulty', { difficulty }, token.current);
    setSession(s => s && ({ ...s, difficulty: result.difficulty })); return 'Сложность сохранена.';
  }, []);
  const createPromoCode = useCallback(async (code: string, amount: number) => {
    await accountRequest('promo_create', { code, amount }, token.current); await refreshPromoCodes(); return 'Промокод создан.';
  }, [refreshPromoCodes]);
  const redeemPromoCode = useCallback(async (code: string) => {
    if (operationLock.current) throw new Error('Дождись завершения предыдущего запроса.');
    operationLock.current = true;
    try {
      await queue.current?.flush();
      const result = await accountRequest<{ save: SaveData; revision: number; amount: number }>('promo_redeem', { code }, token.current);
      queue.current?.accept(result.save, result.revision);
      setSession(s => s && ({ ...s, save: sanitizeSave(result.save), revision: result.revision }));
      setGameRevision(v => v + 1); return { message: 'Промокод активирован.', amount: result.amount };
    } finally { operationLock.current = false; }
  }, []);
  const signOut = useCallback(async () => {
    await queue.current?.flush(); await accountRequest('logout', {}, token.current);
    token.current = ''; queue.current = null;
    try { localStorage.removeItem(SESSION_KEY); } catch { /* In-memory session is cleared. */ }
    setSession(null); setPromoCodes([]); setSyncError(''); setSyncState('saved');
  }, []);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (loginLock.current) return;
    loginLock.current = true; setPending(true); setError('');
    try {
      const result = await accountRequest<SessionData>('login', { username: username.trim(), password });
      if (!result.token) throw new Error('Не удалось открыть сессию. Повтори вход.');
      accept(result, result.token);
    } catch (e) { setError(errorText(e)); passwordInput.current?.focus(); }
    finally { loginLock.current = false; setPending(false); }
  }
  if (loading) return <main className="login-screen"><div className="loading-mark" role="status"><span className="brand">knopik<span>tap</span><i /></span><div className="loading-track" /><p>Загружаем игру…</p></div></main>;
  if (!session) return <main className="login-screen">
    <div className="login-wordmark"><span className="brand">knopik<span>tap</span><i /></span><span className="eyebrow">МАЛЕНЬКИЙ ПЁС. БОЛЬШАЯ ИГРА.</span></div>
    <div className="login-layout">
      <div className="login-art" aria-hidden="true"><span className="login-orbit" /><img src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/icon-512-v2.png`} alt="" /><span className="login-art-label"><i /> Кнопик ждёт тебя</span></div>
      <form className="login-card" onSubmit={login} aria-busy={pending}>
        <span className="eyebrow">ДОБРО ПОЖАЛОВАТЬ</span><h1>Снова вместе.</h1><p>Войди, чтобы играть и сохранять прогресс.</p>
        <label htmlFor="username">Логин</label><input id="username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={e => setUsername(e.target.value)} placeholder="Введи логин" required maxLength={32} aria-invalid={Boolean(error)} aria-describedby={error ? 'login-error' : undefined} />
        <label htmlFor="password">Пароль</label><div className="password-field"><input ref={passwordInput} id="password" name="password" type={visiblePassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Введи пароль" required maxLength={72} aria-invalid={Boolean(error)} aria-describedby={error ? 'login-error' : undefined} /><button type="button" aria-label={visiblePassword ? 'Скрыть пароль' : 'Показать пароль'} aria-pressed={visiblePassword} onClick={() => setVisiblePassword(v => !v)}>{visiblePassword ? 'Скрыть' : 'Показать'}</button></div>
        <div className="form-error" id="login-error" role="alert">{error}</div>
        <button className="primary login-submit" disabled={pending}>{pending ? 'Входим…' : 'Войти в игру'}<span aria-hidden="true">↗</span></button>
        <div className="login-note"><span aria-hidden="true">✓</span> Прогресс сохраняется автоматически</div>
      </form>
    </div><p className="login-footer">KNOPIK TAP <span>Играй в своём ритме.</span></p>
  </main>;
  // The render prop receives event callbacks; none of these read refs during rendering.
  // eslint-disable-next-line react-hooks/refs
  return children({ account: session.account, initialSave: session.save, gameKey: `${session.account.userId}:${gameRevision}`, syncState, syncError, difficulty: session.difficulty, promoCodes, saveProgress, retrySave, refreshPromoCodes, updateDifficulty, createPromoCode, redeemPromoCode, signOut });
}
