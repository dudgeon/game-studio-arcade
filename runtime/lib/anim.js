// @ts-check
// Animation frames (D475): which picture to show, by time or by distance moved.
// Each returns an index 0..n-1 into the cart's own list of sprites.

const whole = (/** @type {number} */ v) => Math.max(0, Math.floor(v));

/**
 * Loop through n frames, a new one every `every` game frames. `t` is a frame count, such as `g.frame`.
 * @param {number} n @param {number} t @param {number} [every]
 */
export function loop(n, t, every = 8) {
  return n > 0 ? whole(t / every) % n : 0;
}

/**
 * Play n frames once and hold the last. `t` is frames since it started.
 * @param {number} n @param {number} t @param {number} [every]
 */
export function once(n, t, every = 8) {
  return Math.max(0, Math.min(n - 1, whole(t / every)));
}

/**
 * Has a `once` animation finished?
 * @param {number} n @param {number} t @param {number} [every]
 */
export function done(n, t, every = 8) {
  return t >= n * every;
}

/**
 * Forward through n frames and back again: 0 1 2 1 0 1 ...
 * @param {number} n @param {number} t @param {number} [every]
 */
export function pingpong(n, t, every = 8) {
  if (n < 2) return 0;
  const i = whole(t / every) % (2 * n - 2);
  return i < n ? i : 2 * n - 2 - i;
}

/**
 * Frames by distance: a new frame every `stride` pixels moved, so feet match the ground at any speed
 * and stop when the walker stops. `distance` is the total moved so far (add `Math.abs(vx)` each frame).
 * @param {number} n @param {number} distance @param {number} [stride]
 */
export function walk(n, distance, stride = 6) {
  return n > 0 ? whole(Math.abs(distance) / stride) % n : 0;
}
