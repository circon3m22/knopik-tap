import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseCloudSave,
  isCommittedSave,
  savesMatch,
} from "../app/save-sync-protocol.ts";

const cloud = {
  version: 15, walletCoins: 100, vaultCoins: 500, totalTaps: 80, level: 2,
};
const local = {
  version: 15, walletCoins: 250, vaultCoins: 700, totalTaps: 90, level: 2,
};

test("clean logins always load the authoritative cloud record", () => {
  assert.equal(chooseCloudSave(cloud, 7, null), "cloud");
});

test("a pending local save from the same cloud revision is recoverable", () => {
  assert.equal(chooseCloudSave(cloud, 7, { save: local, baseRevision: 7, savedAt: 1 }), "recover-local");
});

test("stale offline progress must never overwrite a newer cloud revision", () => {
  assert.equal(chooseCloudSave(cloud, 8, { save: local, baseRevision: 7, savedAt: 1 }), "conflict");
});

test("already-uploaded local state is not a conflict even with an older base revision", () => {
  assert.equal(chooseCloudSave(cloud, 8, { save: cloud, baseRevision: 7, savedAt: 1 }), "cloud");
  assert.equal(savesMatch(cloud, { ...cloud }), true);
});

test("successful remote acknowledgement requires correct revision, source, and payload", () => {
  assert.equal(isCommittedSave({ revision: 8, source_id: "tab1", save: local }, 7, "tab1", local), true);
  assert.equal(isCommittedSave({ revision: 9, source_id: "tab1", save: local }, 7, "tab1", local), false);
  assert.equal(isCommittedSave({ revision: 8, source_id: "tab2", save: local }, 7, "tab1", local), false);
  assert.equal(isCommittedSave({ revision: 8, source_id: "tab1", save: cloud }, 7, "tab1", local), false);
});

test("a lost HTTP response that committed once can be safely recognized on retry", () => {
  assert.equal(isCommittedSave({ revision: 8, source_id: "device-1", save: local }, 7, "device-1", local), true);
});
