/**
 * Shared mobile thermal budget. Gameplay and rewards are NEVER throttled:
 * only short-lived cosmetic feedback and the rate of save serialization.
 */
export const MOBILE_SOUND_INTERVAL_MS = 70;
export const MOBILE_HAPTIC_INTERVAL_MS = 95;
export const MOBILE_PARTICLE_INTERVAL_MS = 100;
export const MOBILE_VISIBLE_PARTICLES = 5;
export const DESKTOP_VISIBLE_PARTICLES = 9;
export const PROGRESS_SNAPSHOT_INTERVAL_MS = 700;

export function shouldEmitFeedback(
  now: number,
  lastEmittedAt: number,
  intervalMs: number,
): boolean {
  return Number.isFinite(now) &&
    (!Number.isFinite(lastEmittedAt) || now < lastEmittedAt ||
      now - lastEmittedAt >= intervalMs);
}

/**
 * Limits the number of visual particles even during extremely fast taps.
 * The actual coin accounting is separate and is never affected.
 */
export function appendVisualParticle<T>(
  current: readonly T[],
  next: T,
  limit: number,
): T[] {
  const capacity = Math.max(1, Math.floor(limit));
  return [...current.slice(-(capacity - 1)), next];
}
