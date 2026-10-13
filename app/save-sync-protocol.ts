import { sanitizeSave, type SaveData } from "./game-logic";

export type UnsyncedSave = {
  save: SaveData;
  baseRevision: number;
  savedAt: number;
};

export type CloudSaveDecision = "cloud" | "recover-local" | "conflict";

export function savesMatch(left: unknown, right: unknown): boolean {
  return JSON.stringify(sanitizeSave(left)) === JSON.stringify(sanitizeSave(right));
}

/** Never silently upload a local state based on a stale cloud revision. */
export function chooseCloudSave(
  currentCloud: unknown,
  currentRevision: number,
  pending: UnsyncedSave | null,
): CloudSaveDecision {
  if (!pending || savesMatch(pending.save, currentCloud)) return "cloud";
  return pending.baseRevision === currentRevision ? "recover-local" : "conflict";
}

/** An RPC can return the current row after a conflict; the returned row isn't necessarily ours. */
export function isCommittedSave(
  remote: { revision: number; source_id: string | null; save: unknown },
  expectedRevision: number,
  sourceId: string,
  submittedSave: unknown,
): boolean {
  return Number(remote.revision) === expectedRevision + 1 &&
    remote.source_id === sourceId &&
    savesMatch(remote.save, submittedSave);
}
