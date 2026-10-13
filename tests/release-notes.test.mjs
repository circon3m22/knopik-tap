import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { GAME_VERSION, RELEASES, releaseSeenKey, releasesSince } from "../app/release-notes.js";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const packageLock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const serviceWorker = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

test("release versions match project and lockfile", () => {
  assert.equal(packageJson.version, GAME_VERSION);
  assert.equal(packageLock.version, GAME_VERSION);
  assert.equal(packageLock.packages[""].version, GAME_VERSION);
  assert.equal(RELEASES[0].version, GAME_VERSION);
  assert.ok(serviceWorker.includes(`knopik-tap-release-${GAME_VERSION}`), "Refresh PWA cache for each release");
});

test("release journal has distinct versions and concise notes", () => {
  const seen = new Set();
  for (const [index, release] of RELEASES.entries()) {
    if (index > 0) {
      const newer = RELEASES[index - 1].version.split(".").map(Number);
      const older = release.version.split(".").map(Number);
      const ordered = newer[0] > older[0] || (newer[0] === older[0] && (newer[1] > older[1] || (newer[1] === older[1] && newer[2] > older[2])));
      assert.ok(ordered, "Keep releases newest first");
    }
    assert.match(release.version, /^\d+\.\d+\.\d+$/);
    assert.match(release.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(!seen.has(release.version), "A version should appear only once");
    seen.add(release.version);
    assert.ok(release.title.trim());
    assert.ok(release.changes.length > 0 && release.changes.length <= 8);
    assert.ok(release.changes.every((note) => note.trim().length > 0 && note.length <= 110));
  }
});

test("seen current version is not announced again", () => {
  assert.deepEqual(releasesSince(GAME_VERSION), []);
});

test("new or unknown version sees most recent release only", () => {
  assert.deepEqual(releasesSince(null), [RELEASES[0]]);
  assert.deepEqual(releasesSince("0.1.0"), [RELEASES[0]]);
  assert.deepEqual(releasesSince("unknown"), [RELEASES[0]]);
});

test("returning players can see all newer releases without repeating older ones", () => {
  if (RELEASES.length > 1) {
    assert.deepEqual(releasesSince(RELEASES[1].version), [RELEASES[0]]);
    assert.deepEqual(releasesSince(RELEASES.at(-1).version), RELEASES.slice(0, -1));
  }
});

test("seen-version key is isolated by account", () => {
  assert.notEqual(releaseSeenKey("player-a"), releaseSeenKey("player-b"));
  assert.match(releaseSeenKey("player-a"), /player-a$/);
});
