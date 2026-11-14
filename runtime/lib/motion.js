// @ts-check
// Motion (D475): things that speed up, slow down, fall, bounce and settle, so
// nothing starts or stops in one frame. Bodies and springs are plain objects
// the cart keeps in its state; time is frames.

/** Something that moves: position, speed in pixels per frame, and a size if it has one. */
/** @typedef {{ x: number, y: number, vx: number, vy: number, w?: number, h?: number }} Body */

/** A value on a spring: `x` chases a target and overshoots a little; `v` is its speed. */
/** @typedef {{ x: number, v: number }} Spring */

/** Which side was hit on each axis: -1 left or top, 1 right or bottom, 0 nothing. */
/** @typedef {{ x: number, y: number }} Bump */

/** @typedef {"linear" | "in" | "out" | "inOut" | "back" | "bounce" | "elastic"} Ease */

/**
 * v kept between lo and hi.
 * @param {number} v @param {number} lo @param {number} hi
 */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * The value `t` of the way from a to b (t 0..1; not clamped).
 * @param {number} a @param {number} b @param {number} t
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * v moved toward target by at most `step`, never past it.
 * @param {number} v @param {number} target @param {number} step
 */
export function approach(v, target, step) {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}

/**
 * v moved `rate` of the way to target (0..1): fast at first, then gentle. Snaps when it's within 0.01.
 * @param {number} v @param {number} target @param {number} [rate]
 */
export function damp(v, target, rate = 0.15) {
  const next = v + (target - v) * rate;
  return Math.abs(target - next) < 0.01 ? target : next;
}

/**
 * An easing curve: t from 0 to 1 in, 0 to 1 out. "in" starts slow, "out" ends slow, "inOut" both,
 * "back" overshoots and settles, "bounce" lands and bounces, "elastic" wobbles. t outside 0..1 is clamped.
 * @param {number} t @param {Ease} [kind]
 */
export function ease(t, kind = "inOut") {
  t = clamp(t, 0, 1);
  switch (kind) {
    case "linear":
      return t;
    case "in":
      return t * t * t;
    case "out":
      return 1 - (1 - t) ** 3;
    case "inOut":
      return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    case "back":
      return 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
    case "bounce": {
      const n = 7.5625;
      const d = 2.75;
      if (t < 1 / d) return n * t * t;
      if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
      if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
      return n * (t -= 2.625 / d) * t + 0.984375;
    }
    case "elastic":
      return t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
    default:
      throw new Error(`motion.ease(): unknown kind "${kind}" (use linear, in, out, inOut, back, bounce, elastic)`);
  }
}

/**
 * Where something going from a to b is, `frame` frames into a move that takes `frames`.
 * @param {number} a @param {number} b @param {number} frame @param {number} frames @param {Ease} [kind]
 */
export function tween(a, b, frame, frames, kind = "inOut") {
  return lerp(a, b, ease(frames > 0 ? frame / frames : 1, kind));
}

/**
 * Run a spring one frame toward target. Stiffer is snappier; less damping wobbles longer.
 * Kick it by adding to `sp.v`. Returns the new `sp.x`.
 * @param {Spring} sp @param {number} target @param {number} [stiffness] 0..1 @param {number} [damping] 0..1
 */
export function spring(sp, target, stiffness = 0.2, damping = 0.75) {
  sp.v = (sp.v + (target - sp.x) * stiffness) * damping;
  sp.x += sp.v;
  if (Math.abs(sp.v) < 0.001 && Math.abs(target - sp.x) < 0.001) {
    sp.x = target;
    sp.v = 0;
  }
  return sp.x;
}

/**
 * A body at x, y, standing still.
 * @param {number} x @param {number} y @param {number} [w] @param {number} [h]
 * @returns {Body}
 */
export function body(x, y, w = 0, h = 0) {
  return { x, y, vx: 0, vy: 0, w, h };
}

/**
 * The stick as a direction: x and y are each -1, 0 or 1.
 * @param {Arcade.G} g @param {Arcade.Player} [p]
 */
export function stick(g, p = 1) {
  return { x: (g.btn("right", p) ? 1 : 0) - (g.btn("left", p) ? 1 : 0), y: (g.btn("down", p) ? 1 : 0) - (g.btn("up", p) ? 1 : 0) };
}

/**
 * Steer a body's speed: toward `dx * max` by `accel` a frame while pushed, and back to 0 by `friction` when not.
 * `dx` and `dy` are -1..1 (the stick); pass null to leave that axis alone, such as y under gravity.
 * @param {Body} b @param {number | null} dx @param {number | null} dy
 * @param {{ max?: number, accel?: number, friction?: number }} [o] defaults 2, 0.25, 0.2
 */
export function drive(b, dx, dy, o = {}) {
  const max = o.max ?? 2;
  const accel = o.accel ?? 0.25;
  const friction = o.friction ?? 0.2;
  if (dx !== null) b.vx = approach(b.vx, dx * max, dx !== 0 ? accel : friction);
  if (dy !== null) b.vy = approach(b.vy, dy * max, dy !== 0 ? accel : friction);
}

/**
 * Move one axis by `d`, a pixel at a time, stopping flush against what's solid. Returns true if blocked.
 * @param {Body} b @param {"x" | "y"} axis @param {number} d
 * @param {(x: number, y: number, w: number, h: number) => boolean} solid
 */
function stepAxis(b, axis, d, solid) {
  const w = b.w ?? 0;
  const h = b.h ?? 0;
  const at = (/** @type {number} */ v) => (axis === "x" ? solid(v, b.y, w, h) : solid(b.x, v, w, h));
  let left = d;
  for (let i = 0; i < 64 && left !== 0; i++) {
    const step = Math.abs(left) > 1 ? Math.sign(left) : left;
    const next = b[axis] + step;
    if (at(next)) {
      // Close the last part of a pixel, so it rests against the thing and not near it.
      const flush = step > 0 ? Math.floor(next) : Math.ceil(next);
      if ((step > 0 ? flush > b[axis] : flush < b[axis]) && !at(flush)) b[axis] = flush;
      return true;
    }
    b[axis] = next;
    left -= step;
  }
  return false;
}

/**
 * Move a body one frame: gravity pulls, then it moves by its speed. With `solid`, it stops against
 * whatever `solid(x, y, w, h)` says is in the way (or bounces off, with `bounce`), one axis at a time,
 * and the result says which sides it hit: `y === 1` is landing on something.
 * @param {Body} b
 * @param {{ gravity?: number, maxFall?: number, solid?: (x: number, y: number, w: number, h: number) => boolean, bounce?: number }} [o]
 * @returns {Bump}
 */
export function move(b, o = {}) {
  if (o.gravity) b.vy = Math.min(b.vy + o.gravity, o.maxFall ?? 8);
  const hit = { x: 0, y: 0 };
  if (!o.solid) {
    b.x += b.vx;
    b.y += b.vy;
    return hit;
  }
  const bounce = o.bounce ?? 0;
  if (stepAxis(b, "x", b.vx, o.solid)) {
    hit.x = Math.sign(b.vx);
    b.vx = bounce ? -b.vx * bounce : 0;
  }
  if (stepAxis(b, "y", b.vy, o.solid)) {
    hit.y = Math.sign(b.vy);
    b.vy = Math.abs(b.vy) * bounce < 0.5 ? 0 : -b.vy * bounce;
  }
  return hit;
}

/**
 * Keep a body inside a box, turning it back off the edges. `bounciness` 1 keeps all its speed, 0 stops it dead.
 * @param {Body} b @param {{ x: number, y: number, w: number, h: number }} box @param {number} [bounciness]
 * @returns {Bump}
 */
export function bounce(b, box, bounciness = 0.7) {
  const hit = { x: 0, y: 0 };
  const right = box.x + box.w - (b.w ?? 0);
  const bottom = box.y + box.h - (b.h ?? 0);
  if (b.x < box.x) {
    b.x = box.x;
    b.vx = Math.abs(b.vx) * bounciness;
    hit.x = -1;
  } else if (b.x > right) {
    b.x = right;
    b.vx = -Math.abs(b.vx) * bounciness;
    hit.x = 1;
  }
  if (b.y < box.y) {
    b.y = box.y;
    b.vy = Math.abs(b.vy) * bounciness;
    hit.y = -1;
  } else if (b.y > bottom) {
    b.y = bottom;
    b.vy = -Math.abs(b.vy) * bounciness;
    hit.y = 1;
  }
  return hit;
}

/**
 * Does the box touch a solid tile of a text map? `rows` is the map, one character per tile, `tile` pixels each;
 * `solid` is the characters that count (default "#"). Off the map is open. Use it as `move`'s `solid`.
 * @param {readonly string[]} rows @param {number} tile
 * @param {number} x @param {number} y @param {number} w @param {number} h @param {string} [solid]
 */
export function mapHit(rows, tile, x, y, w, h, solid = "#") {
  const x1 = Math.ceil((x + w) / tile) - 1;
  const y1 = Math.ceil((y + h) / tile) - 1;
  for (let ty = Math.max(0, Math.floor(y / tile)); ty <= y1 && ty < rows.length; ty++) {
    const row = rows[ty];
    for (let tx = Math.max(0, Math.floor(x / tile)); tx <= x1 && tx < row.length; tx++) {
      if (solid.includes(row[tx])) return true;
    }
  }
  return false;
}
