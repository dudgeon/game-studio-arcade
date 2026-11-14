import { test } from "node:test";
import assert from "node:assert/strict";
import { particles } from "../index.js";
import { headless } from "../../src/headless.js";

const G = (frame = 5) => /** @type {Arcade.G} */ (/** @type {unknown} */ ({ frame, colors: { white: 5 }, rand: () => assert.fail("particles must not use the game's dice"), rnd: () => assert.fail("nor g.rnd") }));

test("a burst adds particles that fly out, and the same burst is the same every time", () => {
  /** @type {Arcade.Lib.Particle[]} */
  const a = [];
  particles.burst(G(), a, 100, 50);
  assert.equal(a.length, 12);
  for (const p of a) {
    assert.deepEqual([p.x, p.y, p.color, p.size], [100, 50, 5, 1]);
    const v = Math.hypot(p.vx, p.vy);
    assert.ok(v >= 0.8 - 1e-9 && v <= 2 + 1e-9, `speed ${v}`);
    assert.ok(p.life >= 18 && p.life <= 30 && p.max === p.life);
  }
  assert.ok(a.some((p) => p.vx < 0) && a.some((p) => p.vx > 0) && a.some((p) => p.vy < 0) && a.some((p) => p.vy > 0), "every direction");
  /** @type {Arcade.Lib.Particle[]} */
  const b = [];
  particles.burst(G(), b, 100, 50);
  assert.deepEqual(b, a);
  /** @type {Arcade.Lib.Particle[]} */
  const c = [];
  particles.burst(G(6), c, 100, 50);
  assert.notDeepEqual(c, a, "another frame, another burst");
});

test("options aim, color and size a burst", () => {
  /** @type {Arcade.Lib.Particle[]} */
  const up = [];
  particles.burst(G(), up, 0, 0, { n: 40, angle: -Math.PI / 2, spread: 0.5, speed: 3, life: 10, colors: [7, 8], size: 3, gravity: 0, drag: 1 });
  assert.equal(up.length, 40);
  for (const p of up) {
    assert.ok(p.vy < 0 && Math.abs(p.vx) < Math.abs(p.vy), "upward");
    assert.ok(p.color === 7 || p.color === 8);
    assert.deepEqual([p.size, p.gravity, p.drag], [3, 0, 1]);
  }
  assert.ok(up.some((p) => p.color === 7) && up.some((p) => p.color === 8));
});

test("tick moves them, gravity pulls, and they go when their time is up", () => {
  /** @type {Arcade.Lib.Particle[]} */
  const list = [{ x: 0, y: 0, vx: 2, vy: 0, life: 3, max: 3, color: 5, size: 1, gravity: 0.5, drag: 1 }];
  particles.tick(list);
  assert.deepEqual([list[0].x, list[0].y, list[0].vy, list[0].life], [2, 0.5, 0.5, 2]);
  particles.tick(list);
  assert.deepEqual([list[0].x, list[0].y], [4, 1.5]);
  particles.tick(list);
  assert.equal(list.length, 0);
  particles.tick(list);
});

test("a list never grows past the cap", () => {
  /** @type {Arcade.Lib.Particle[]} */
  const list = [];
  for (let i = 0; i < 50; i++) particles.burst(G(i), list, i, i, { n: 20 });
  assert.equal(list.length, particles.MAX);
});

test("draw puts them on screen, big ones as squares that shrink", async () => {
  /** @type {Arcade.Lib.Particle[]} */
  const list = [
    { x: 10, y: 10, vx: 0, vy: 0, life: 10, max: 10, color: 7, size: 1, gravity: 0, drag: 1 },
    { x: 50, y: 50, vx: 0, vy: 0, life: 10, max: 10, color: 8, size: 4, gravity: 0, drag: 1 },
    { x: 90, y: 50, vx: 0, vy: 0, life: 2, max: 10, color: 9, size: 4, gravity: 0, drag: 1 },
  ];
  const t = await headless({ init: () => ({}), update: () => {}, draw: (g) => (g.cls(0), g.lib.particles.draw(g, list)) });
  const f = await t.frame();
  const count = (c) => /** @type {Uint8Array} */ (f.pixels).reduce((n, v) => n + (v === c ? 1 : 0), 0);
  assert.equal(f.pixels[10 * 256 + 10], 7);
  assert.deepEqual([count(7), count(8), count(9)], [1, 16, 4]);
});
