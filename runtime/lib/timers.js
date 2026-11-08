// @ts-check
// Timers counted in frames (60 per second), never wall time. Each timer is a
// plain object kept in the cart's state and ticked once per update.

/** Counts down `len` frames. `left` is frames to go; `done` is set when a one-shot timer finishes. */
/** @typedef {{ len: number, left: number, loop: boolean, done: boolean }} Timer */

/** Auto-repeat for a held button: fires on the press, then after `delay` frames, then every `rate` frames. */
/** @typedef {{ delay: number, rate: number, held: number }} Repeat */

/**
 * Seconds to frames (60 per second), rounded to a whole frame.
 * @param {number} s
 */
export function seconds(s) {
  return Math.round(s * 60);
}

/**
 * A timer that fires after `frames` frames (at least 1). With `loop` true it
 * fires every `frames` frames, forever; otherwise once.
 * @param {number} frames
 * @param {boolean} [loop]
 * @returns {Timer}
 */
export function timer(frames, loop = false) {
  const len = Math.max(1, Math.round(frames));
  return { len, left: len, loop, done: false };
}

/**
 * Advance the timer one frame. Returns true on the frame it fires. A looping
 * timer starts over; a one-shot timer sets `done` and stays done.
 * @param {Timer} t
 */
export function tick(t) {
  if (t.done) return false;
  t.left -= 1;
  if (t.left > 0) return false;
  if (t.loop) t.left = t.len;
  else { t.left = 0; t.done = true; }
  return true;
}

/**
 * Start the timer over, optionally with a new length (e.g. a faster fall speed).
 * @param {Timer} t
 * @param {number} [frames]
 */
export function restart(t, frames = t.len) {
  t.len = Math.max(1, Math.round(frames));
  t.left = t.len;
  t.done = false;
}

/**
 * How far through its current run the timer is, from 0 (just started) to 1 (fired).
 * Handy for animations: a flash, a fade, a growing bar.
 * @param {Timer} t
 */
export function progress(t) {
  return (t.len - t.left) / t.len;
}

/**
 * True once every `n` frames of the console clock (`g.frame`), shifted by
 * `offset`. For things that don't need their own timer, such as blinking text.
 * @param {Arcade.G} g
 * @param {number} n
 * @param {number} [offset]
 */
export function every(g, n, offset = 0) {
  const k = Math.max(1, Math.round(n));
  return (((g.frame - offset) % k) + k) % k === 0;
}

/**
 * An auto-repeat for a held button or direction: `delay` frames before the
 * first repeat (default 12), then one every `rate` frames (default 4).
 * @param {number} [delay]
 * @param {number} [rate]
 * @returns {Repeat}
 */
export function repeat(delay = 12, rate = 4) {
  return { delay: Math.max(1, delay), rate: Math.max(1, rate), held: 0 };
}

/**
 * Feed the repeat whether its button is down this frame (e.g. `g.btn("left")`).
 * Returns true on the frame it's pressed, then again after `delay` frames, then
 * every `rate` frames while it stays down. Letting go resets it.
 * @param {Repeat} r
 * @param {boolean} down
 */
export function repeatTick(r, down) {
  if (!down) { r.held = 0; return false; }
  r.held += 1;
  if (r.held === 1) return true;
  const after = r.held - 1 - r.delay;
  return after >= 0 && after % r.rate === 0;
}
