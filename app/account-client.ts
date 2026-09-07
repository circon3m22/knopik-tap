import { sanitizeSave, type SaveData } from './game-logic.ts';
export const ACCOUNT_ENDPOINT = 'https://uxxzvjwsexdoqcevzipu.supabase.co/functions/v1/knopik-account';
export const SESSION_KEY = 'knopik-tap:arcade:session';
export const accountSaveKey = (id: string) => `knopik-tap:arcade:save:${id}`;
export type Account = { userId: string; username: string; isAdmin: boolean };
export type SessionData = { account: Account; save: SaveData; revision: number; savedAt: string; difficulty: number; token?: string };
export class AccountError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
export async function accountRequest<T>(action: string, payload: object = {}, token = '', keepalive = false): Promise<T> {
  let response: Response;
  try {
    response = await fetch(ACCOUNT_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'x-knopik-session': token } : {}) }, body: JSON.stringify({ action, payload }), signal: AbortSignal.timeout(15000), cache: 'no-store', keepalive });
  } catch { throw new AccountError('Нет связи с сервером. Проверь интернет и повтори.', 0); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new AccountError(data.error || 'Не удалось выполнить запрос. Повтори ещё раз.', response.status);
  return data as T;
}
/** One in-flight save and optimistic revisions prevent overwriting another device. */
export class ProgressQueue {
  revision: number;
  private current: SaveData;
  private version = 0;
  private acknowledged = 0;
  private pending: Promise<void> | null = null;
  private request: (payload: { save: SaveData; revision: number }) => Promise<{ revision: number }>;
  private status: (value: 'saved' | 'saving' | 'error', message?: string) => void;
  private persist: (save: SaveData, revision: number, dirty: boolean) => void;
  constructor(session: SessionData,
    request: (payload: { save: SaveData; revision: number }) => Promise<{ revision: number }>,
    status: (value: 'saved' | 'saving' | 'error', message?: string) => void,
    persist: (save: SaveData, revision: number, dirty: boolean) => void,
  ) { this.revision = session.revision; this.current = sanitizeSave(session.save); this.request = request; this.status = status; this.persist = persist; }
  get save() { return this.current; }
  get dirty() { return this.version > this.acknowledged; }
  update(save: SaveData) {
    this.current = sanitizeSave(save); this.version++;
    this.persist(this.current, this.revision, true); this.status('saving');
  }
  flush(): Promise<void> {
    if (this.pending) return this.pending;
    if (!this.dirty) return Promise.resolve();
    this.pending = this.run().finally(() => { this.pending = null; });
    return this.pending;
  }
  private async run() {
    try {
      while (this.dirty) {
        const version = this.version;
        const result = await this.request({ save: this.current, revision: this.revision });
        this.revision = result.revision; this.acknowledged = version;
        this.persist(this.current, this.revision, this.dirty);
      }
      this.status('saved');
    } catch (error) {
      this.status('error', error instanceof Error ? error.message : 'Не удалось сохранить прогресс.'); throw error;
    }
  }
  accept(save: SaveData, revision: number) {
    this.current = sanitizeSave(save); this.revision = revision; this.acknowledged = this.version;
    this.persist(this.current, this.revision, false); this.status('saved');
  }
}
