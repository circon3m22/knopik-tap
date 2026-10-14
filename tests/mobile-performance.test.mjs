import assert from "node:assert/strict";
import test from "node:test";
import {
  appendVisualParticle,
  shouldEmitFeedback,
  MOBILE_SOUND_INTERVAL_MS,
  MOBILE_PARTICLE_INTERVAL_MS,
  MOBILE_VISIBLE_PARTICLES,
  PROGRESS_SNAPSHOT_INTERVAL_MS,
} from "../app/mobile-performance-policy.ts";

test("visual and audio throttling never changes the gameplay reward count", () => {
  let lastSound = Number.NEGATIVE_INFINITY;
  let lastEffect = Number.NEGATIVE_INFINITY;
  let audio = 0;
  let effects = 0;
  let rewards = 0;
  let particles = [];
  for (let ms = 0; ms < 1000; ms += 20) {
    rewards += 3;
    if (shouldEmitFeedback(ms, lastSound, MOBILE_SOUND_INTERVAL_MS)) {
      lastSound = ms; audio++;
    }
    if (shouldEmitFeedback(ms, lastEffect, MOBILE_PARTICLE_INTERVAL_MS)) {
      lastEffect = ms; effects++;
      particles = appendVisualParticle(particles, { at: ms }, MOBILE_VISIBLE_PARTICLES);
    }
  }
  assert.equal(rewards, 150);
  assert.ok(audio < 20, "far fewer Web Audio nodes than taps");
  assert.ok(effects <= 10, "bounded animation starts each second");
  assert.ok(particles.length <= MOBILE_VISIBLE_PARTICLES);
});

test("feedback triggers after clock reset, ignores invalid timestamps", () => {
  assert.equal(shouldEmitFeedback(100, Number.NEGATIVE_INFINITY, 70), true);
  assert.equal(shouldEmitFeedback(120, 100, 70), false);
  assert.equal(shouldEmitFeedback(180, 100, 70), true);
  assert.equal(shouldEmitFeedback(10, 200, 70), true);
  assert.equal(shouldEmitFeedback(NaN, 100, 70), false);
});

test("snapshot interval is short enough to protect progress during continuous taps", () => {
  assert.ok(PROGRESS_SNAPSHOT_INTERVAL_MS >= 500);
  assert.ok(PROGRESS_SNAPSHOT_INTERVAL_MS <= 1000);
});

test("bounded particle pool does not mutate previous React state", () => {
  const old = Object.freeze([{ id: 1 }, { id: 2 }, { id: 3 }]);
  const next = appendVisualParticle(old, { id: 4 }, 3);
  assert.deepEqual(old, [{ id: 1 }, { id: 2 }, { id: 3 }]);
  assert.deepEqual(next, [{ id: 2 }, { id: 3 }, { id: 4 }]);
});
