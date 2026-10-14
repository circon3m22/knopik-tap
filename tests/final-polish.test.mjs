import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { SAVE_VERSION, createDefaultSave } from "../app/game-logic.ts";
import {
  hasSupportedSaveVersion,
  hasUnflushedProgress,
  shouldArmCloudSaveTimer,
} from "../app/save-queue-policy.ts";

const read = (file) => readFile(new URL(file, import.meta.url), "utf8");
const [cloud, page, audio, worker, css] = await Promise.all([
  read("../app/cloud-account.tsx"),
  read("../app/page.tsx"),
  read("../app/sound-engine.ts"),
  read("../public/sw.js"),
  read("../app/final-polish.css"),
]);

test("accepts current and legacy schema but never silently sanitizes unknown future saves", () => {
  assert.equal(hasSupportedSaveVersion(createDefaultSave()), true);
  assert.equal(hasSupportedSaveVersion({ version: 1 }), true);
  assert.equal(hasSupportedSaveVersion({ version: SAVE_VERSION + 1 }), false);
  assert.equal(hasSupportedSaveVersion({ version: 0 }), false);
  assert.equal(hasSupportedSaveVersion({}), false);
  assert.equal(hasSupportedSaveVersion([]), false);
  assert.equal(hasSupportedSaveVersion(null), false);
  assert.equal(hasSupportedSaveVersion({ version: "15" }), false);
});

test("continuous taps keep a fixed save interval instead of a trailing debounce", () => {
  let timerActive = false;
  let scheduled = 0;
  for (let ms = 0; ms <= 5_000; ms += 50) {
    if (shouldArmCloudSaveTimer(timerActive, false, false)) {
      scheduled++;
      timerActive = true;
    }
    if (ms > 0 && ms % 1_200 === 0) timerActive = false;
  }
  assert.equal(scheduled, 2);
  assert.equal(shouldArmCloudSaveTimer(false, true, false), false);
  assert.equal(shouldArmCloudSaveTimer(false, false, true), false);
  assert.equal(shouldArmCloudSaveTimer(false, false, false), true);
  assert.equal(hasUnflushedProgress(3, 4), true);
  assert.equal(hasUnflushedProgress(4, 4), false);
  assert.match(cloud, /if \(shouldArmCloudSaveTimer\(/);
  assert.match(cloud, /writes >= 1/);
  assert.match(cloud, /scheduleSaveRetry\(\)/);
});

test("lost network responses keep local copies, show error and retry instead of stalling", () => {
  assert.match(cloud, /try \{[\s\S]*?await getSupabaseClient\(\)\.rpc\("save_game_progress"/);
  assert.match(cloud, /catch \{[\s\S]*?setSyncState\("error"\);[\s\S]*?scheduleSaveRetry\(\)/);
  assert.match(cloud, /SAVE_RETRY_MAX_MS/);
  assert.match(cloud, /writePendingSave\(currentAccount\.userId, nextSave/);
  assert.match(cloud, /flushProgress\(true\)/);
  assert.match(cloud, /hasNewerLocalSave/);
  assert.match(cloud, /hasSupportedSaveVersion\(cloudSave\.save\)/);
});

test("promo code RPC serializes with ordinary writes and retains new taps", () => {
  assert.match(cloud, /promoInFlightRef\.current = true/);
  assert.match(cloud, /saveVersionRef\.current !== versionBeforeReward/);
  assert.match(cloud, /walletCoins: Math\.min\(Number\.MAX_SAFE_INTEGER, local\.walletCoins \+ amount\)/);
  assert.match(cloud, /promoInFlightRef\.current = false/);
  assert.match(cloud, /restorePendingToCloud/);
  assert.match(cloud, /isCommittedSave/);
});

test("quests cannot consume a completed reward when big-case inventory is full", () => {
  assert.match(page, /if \(!questComplete \|\| bigCases >= 99\) return/);
  assert.match(page, /disabled=\{bigCases >= 99\}/);
  assert.match(page, /Кейсы заполнены/);
});

test("service worker cleans only its own caches, not other same-origin games", () => {
  assert.match(worker, /OWN_CACHE_PREFIX/);
  assert.match(worker, /key\.startsWith\(OWN_CACHE_PREFIX\)/);
  assert.match(worker, /url\.pathname !== BASE_PATH/);
  assert.match(worker, /caches\.open\(CACHE_NAME\)/);
  assert.doesNotMatch(worker, /keys\.filter\(\(key\) => key !== CACHE_NAME\)/);
});

test("a hidden iPhone stops sound processing without changing mini-game outcomes", () => {
  assert.match(audio, /pauseInBackground\(\)/);
  assert.match(audio, /ctx\.suspend\(\)/);
  assert.match(audio, /document\.hidden/);
  assert.match(page, /soundRef\.current\?\.pauseInBackground\(\)/);
});

test("vault animation has varied transform-only coin arcs and a mobile cap", () => {
  assert.match(page, /Array\.from\(\{ length: 16 \}/);
  assert.match(page, /"--flight-mid-x"/);
  assert.match(page, /"--flight-mid-spin"/);
  assert.match(css, /@keyframes polished-coins-to-vault/);
  assert.match(css, /\.save-flight i:nth-of-type\(n \+ 13\)/);
  assert.match(css, /prefers-reduced-motion/);
});
