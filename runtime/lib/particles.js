// @ts-check
// Particles (D475): sparks, dust, smoke, confetti. A list of plain objects in the
// cart's state. They have their own dice, so adding a burst never changes what
// g.rand gives the game next.

/** @typedef {{ x: number, y: number, vx: number, vy: number, life: number, max: number, color: Arcade.Color, size: number, gravity: number, drag: number }} Particle */

/** The most particles a list holds; a burst past it is cut short. */
export const MAX = 400;

/** @param {number} seed */
function dice(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Add a burst of particles at x, y. Defaults: 12 of them, flying out in every direction at up to 2 pixels a frame,
 * living about 30 frames, white, 1 pixel, falling a little. `angle` and `spread` (radians) aim them: `angle: -Math.PI / 2,
 * spread: 1` is a fountain going up. Several `colors` are shared out at random.
 * @param {Arcade.G} g @param {Particle[]} list @param {number} x @param {number} y
 * @param {{ n?: number, speed?: number, life?: number, colors?: readonly Arcade.Color[], gravity?: number, angle?: number, spread?: number, size?: number, drag?: number }} [o]
 */
export function burst(g, list, x, y, o = {}) {
  const rand = dice(Math.imul(g.frame + 1, 73856093) ^ Math.imul(Math.floor(x), 19349663) ^ Math.imul(Math.floor(y), 83492791) ^ list.length);
  const n = o.n ?? 12;
  const speed = o.speed ?? 2;
  const life = o.life ?? 30;
  const colors = o.colors && o.colors.length ? o.colors : [g.colors.white];
  const spread = o.spread ?? Math.PI * 2;
  for (let i = 0; i < n && list.length < MAX; i++) {
    const a = (o.angle ?? 0) + (rand() - 0.5) * spread;
    const v = speed * (0.4 + 0.6 * rand());
    const max = Math.max(1, Math.round(life * (0.6 + 0.4 * rand())));
    list.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: max, max, color: colors[Math.floor(rand() * colors.length)], size: o.size ?? 1, gravity: o.gravity ?? 0.05, drag: o.drag ?? 0.98 });
  }
}

/**
 * Run the particles one frame; the finished ones go. Call once per update, in every mode.
 * @param {Particle[]} list
 */
export function tick(list) {
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.vx *= p.drag;
    p.vy = p.vy * p.drag + p.gravity;
    p.x += p.vx;
    p.y += p.vy;
    p.life -= 1;
    if (p.life <= 0) list.splice(i, 1);
  }
}

/**
 * Draw the particles, in world coordinates (so after `camera.use`). Big ones shrink as they die.
 * @param {Arcade.G} g @param {readonly Particle[]} list
 */
export function draw(g, list) {
  for (const p of list) {
    const size = Math.max(1, Math.ceil((p.size * p.life * 2) / p.max));
    const d = Math.min(p.size, size);
    if (d <= 1) g.pset(p.x, p.y, p.color);
    else g.rectfill(p.x - d / 2, p.y - d / 2, d, d, p.color);
  }
}
