// The random-input soak (D61): our own seeded PRNG, never the cart's, so the
// same soak runs on every machine.

/** @param {number} seed */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @type {Arcade.Button[][]} */
const DIRS = [[], ["up"], ["down"], ["left"], ["right"], ["up", "left"], ["up", "right"], ["down", "left"], ["down", "right"]];
/** @type {Arcade.Button[]} */
const FACE = ["a", "b", "x", "y", "start"];

/**
 * A soak input script covering `frames` frames: both players, random
 * directions and face buttons held for 2-30 frames at a time.
 * @param {number} frames
 * @param {number} seed
 * @returns {Arcade.InputStep[]}
 */
export function soakScript(frames, seed) {
  const r = mulberry32(seed);
  const pick = () => {
    const held = [...DIRS[Math.floor(r() * DIRS.length)]];
    for (const b of FACE) if (r() < (b === "start" ? 0.04 : 0.25)) held.push(b);
    return held;
  };
  /** @type {Arcade.InputStep[]} */
  const steps = [];
  let left = frames;
  while (left > 0) {
    const n = Math.min(left, 2 + Math.floor(r() * 29));
    steps.push({ frames: n, p1: pick(), p2: pick() });
    left -= n;
  }
  return steps;
}

/**
 * @param {number[]} times milliseconds per frame
 * @param {number} budgetMs
 */
export function frameStats(times, budgetMs) {
  const s = [...times].sort((a, b) => a - b);
  const q = (/** @type {number} */ p) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0);
  const r3 = (/** @type {number} */ v) => Math.round(v * 1000) / 1000;
  return {
    frames: s.length,
    meanMs: r3(s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0),
    p50Ms: r3(q(0.5)),
    p95Ms: r3(q(0.95)),
    maxMs: r3(s.length ? s[s.length - 1] : 0),
    budgetMs,
  };
}
