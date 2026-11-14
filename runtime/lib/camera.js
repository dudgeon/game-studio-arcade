// @ts-check
// A camera that follows (D475): it trails its target softly, stays inside the
// world, and shakes on a hit. A plain object the cart keeps in its state.

/** The world position of the screen's top-left, and the shake in progress. */
/** @typedef {{ x: number, y: number, shake: number, from: number, until: number }} Camera */

/**
 * A camera with the screen's top-left at world x, y.
 * @param {number} [x] @param {number} [y]
 * @returns {Camera}
 */
export function newCamera(x = 0, y = 0) {
  return { x, y, shake: 0, from: 0, until: 0 };
}

/** One axis of `follow`. */
function chase(pos, at, screen, zone, rate, lo, hi) {
  const near = pos + (screen - zone) / 2;
  let goal = pos;
  if (at < near) goal = pos - (near - at);
  else if (at > near + zone) goal = pos + (at - near - zone);
  let next = pos + (goal - pos) * rate;
  if (Math.abs(goal - next) < 0.01) next = goal;
  return hi === null ? next : Math.max(lo, Math.min(Math.max(lo, hi - screen), next));
}

/**
 * Move the camera one frame toward its target (anything with x, y and maybe w, h). The target can roam a
 * soft zone in the middle of the screen before the camera moves at all; then the camera closes `ease` of
 * the gap each frame. `bounds` is the world's box, which the screen never leaves. Call once per update.
 * @param {Arcade.G} g @param {Camera} cam @param {{ x: number, y: number, w?: number, h?: number }} target
 * @param {{ zoneW?: number, zoneH?: number, ease?: number, bounds?: { x: number, y: number, w: number, h: number } }} [o]
 *   defaults: a zone a quarter of the screen each way, ease 0.15, no bounds
 */
export function follow(g, cam, target, o = {}) {
  const rate = o.ease ?? 0.15;
  const b = o.bounds;
  cam.x = chase(cam.x, target.x + (target.w ?? 0) / 2, g.W, o.zoneW ?? g.W / 4, rate, b ? b.x : 0, b ? b.x + b.w : null);
  cam.y = chase(cam.y, target.y + (target.h ?? 0) / 2, g.H, o.zoneH ?? g.H / 4, rate, b ? b.y : 0, b ? b.y + b.h : null);
}

/**
 * Start a shake: up to `amount` pixels, dying away over `frames` frames. A bigger shake in progress is kept.
 * @param {Arcade.G} g @param {Camera} cam @param {number} [amount] @param {number} [frames]
 */
export function shake(g, cam, amount = 3, frames = 12) {
  const left = cam.until > g.frame ? (cam.shake * (cam.until - g.frame)) / Math.max(1, cam.until - cam.from) : 0;
  if (amount < left) return;
  cam.shake = amount;
  cam.from = g.frame;
  cam.until = g.frame + Math.max(1, Math.round(frames));
}

/** A steady number in -1..1 for a whole number: the shake's own dice, so it never disturbs g.rand. */
function jitter(n) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 2147483648 - 1;
}

/**
 * Point the screen at the camera: `g.camera` with the shake added. Call in draw before the world;
 * `g.camera()` with no arguments goes back to screen coordinates for the HUD.
 * @param {Arcade.G} g @param {Camera} cam
 */
export function use(g, cam) {
  let sx = 0;
  let sy = 0;
  if (g.frame < cam.until) {
    const amp = (cam.shake * (cam.until - g.frame)) / Math.max(1, cam.until - cam.from);
    sx = jitter(g.frame * 2) * amp;
    sy = jitter(g.frame * 2 + 1) * amp;
  }
  g.camera(cam.x + sx, cam.y + sy);
}

/**
 * The part of the world on screen, as a box, grown by `margin` pixels each way. For skipping what can't be seen.
 * @param {Arcade.G} g @param {Camera} cam @param {number} [margin]
 */
export function view(g, cam, margin = 0) {
  return { x: cam.x - margin, y: cam.y - margin, w: g.W + 2 * margin, h: g.H + 2 * margin };
}
