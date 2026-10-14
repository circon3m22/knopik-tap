import { SAVE_VERSION } from "./game-logic.ts";

/** Never sanitize or upload future/unknown save schemas as an empty game. */
export function hasSupportedSaveVersion(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const version = (value as { version?: unknown }).version;
  return Number.isSafeInteger(version) && Number(version) >= 1 && Number(version) <= SAVE_VERSION;
}

/** A fixed upload cadence beats a sliding debounce during continuous tapping. */
export function shouldArmCloudSaveTimer(
  scheduled: boolean,
  retryScheduled: boolean,
  conflict: boolean,
): boolean {
  return !scheduled && !retryScheduled && !conflict;
}

/** A successful acknowledgement may still have a newer local snapshot. */
export function hasUnflushedProgress(savedVersion: number, latestVersion: number): boolean {
  return savedVersion < latestVersion;
}
