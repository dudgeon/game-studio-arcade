import { test } from "node:test";
import assert from "node:assert/strict";
import { headless } from "../../src/headless.js";
import { DARKER } from "../../src/palette.js";
import { raycast } from "../index.js";

const W = 256;
const H = 192;
const MAP = [
  "#########",
  "#.......#",
  "#.B.....#",
  "#.......#",
  "#########",
];
const near = (got, want, what, eps = 1e-9) => assert.ok(Math.abs(got - want) <= eps, `${what}: got ${got}, want ${want}`);

test("open says which tiles can be walked; off the map is wall", () => {
  assert.equal(raycast.open(MAP, 1.5, 1.5), true);
  assert.equal(raycast.open(MAP, 2.9, 2.1), false);
  assert.equal(raycast.open(MAP, 0.5, 0.5), false);
  assert.equal(raycast.open(MAP, -3, 2), false);
  assert.equal(raycast.open(MAP, 4, 99), false);
  assert.equal(raycast.open(["# #"], 1.5, 0.5), true, "a space is open too");
});

test("cast finds the wall a ray hits: how far, which tile, which face, and where along it", () => {
  const east = raycast.cast(MAP, 1.5, 1.5, 0);
  assert.ok(east);
  near(east.dist, 6.5, "east");
  assert.deepEqual([east.cell, east.mx, east.my, east.side], ["#", 8, 1, 0]);
  near(east.u, 0.5, "half way along the face");
  const south = raycast.cast(MAP, 4.25, 1.5, Math.PI / 2);
  assert.ok(south);
  near(south.dist, 2.5, "south");
  assert.deepEqual([south.my, south.side], [4, 1]);
  const block = raycast.cast(MAP, 2.5, 1.5, Math.PI / 2);
  assert.ok(block);
  assert.deepEqual([block.cell, block.mx, block.my], ["B", 2, 2]);
  near(block.dist, 0.5, "the B block");
  const diag = raycast.cast(MAP, 4.5, 1.5, Math.PI / 4);
  assert.ok(diag);
  near(diag.dist, 2.5 * Math.SQRT2, "diagonal", 1e-9);
  assert.equal(raycast.cast(MAP, 1.5, 1.5, 0, 3), null, "nothing within 3 tiles");
  // u runs the same way round a block from every side, so a picture isn't mirrored on two faces.
  const w = raycast.cast(MAP, 1.2, 2.25, 0);
  const e = raycast.cast(MAP, 3.8, 2.25, Math.PI);
  assert.ok(w && e);
  near(w.u + e.u, 1, "mirrored between opposite faces");
});

test("walk moves a body and slides it along walls", () => {
  const b = { x: 1.5, y: 1.5 };
  assert.equal(raycast.walk(MAP, b, 0.2, 0.1), false);
  near(b.x, 1.7, "x");
  near(b.y, 1.6, "y");
  const c = { x: 1.5, y: 1.3 };
  assert.equal(raycast.walk(MAP, c, 0.2, -0.2), true, "the top wall stops y");
  near(c.x, 1.7, "but x still moves: it slides");
  assert.equal(c.y, 1.3);
  const d = { x: 1.52, y: 2.5 };
  for (let i = 0; i < 50; i++) raycast.walk(MAP, d, 0.05, 0);
  assert.ok(d.x < 1.76 && d.x > 1.7, `stops a body's width short of the B block: ${d.x}`);
  const wide = { x: 1.5, y: 1.5 };
  raycast.walk(MAP, wide, 0, -0.1, 0.45);
  assert.equal(wide.y, 1.5, "a wider body is stopped sooner");
  assert.equal(raycast.walk(MAP, { x: 1.5, y: 1.5 }, 0, 0), false);
});

async function shot(fn) {
  const t = await headless({ init: (g) => ({ made: fn.init(g) }), update: () => {}, draw: (g, s) => (g.cls(0), fn(g, s.made)) });
  return /** @type {Uint8Array} */ ((await t.frame()).pixels);
}
const art = (g) => ({ brick: g.sprite(["77", "77"]), blue: g.sprite(["nn", "nn"]), gem: g.sprite(["ff", "ff"]) });
const colAt = (px, x) => Array.from({ length: H }, (_, y) => px[y * W + x]);
const run = (col, c) => col.filter((v) => v === c).length;

test("a wall straight ahead is as tall as its distance says, with ceiling above and floor below", async () => {
  for (const [x, dist] of /** @type {const} */ ([[5.5, 2.5], [3.5, 4.5]])) {
    const eye = { x, y: 1.5, angle: 0 };
    const px = await shot(Object.assign((g, a) => g.lib.raycast.draw(g, eye, MAP, { "#": a.brick, B: a.blue }, { floor: 16, ceil: 22, fog: 0 }), { init: art }));
    const mid = colAt(px, W / 2);
    const f = W / 2 / Math.tan(1.15 / 2);
    assert.ok(Math.abs(run(mid, 7) - f / dist) <= 2, `wall ${run(mid, 7)} px tall at ${dist} tiles; want about ${f / dist}`);
    assert.equal(mid[0], 22);
    assert.equal(mid[H - 1], 16);
    assert.equal(mid[H / 2], 7);
    assert.equal(run(mid, 7) + run(mid, 22) + run(mid, 16), H, "nothing else in the column");
    assert.ok(Math.abs(run(mid, 22) - run(mid, 16)) <= 1, "centered on the horizon");
  }
});

test("walls are flat (no fisheye), the other face is a step darker, and each wall has its own picture", async () => {
  const eye = { x: 4.5, y: 2.5, angle: 0 };
  const px = await shot(Object.assign((g, a) => g.lib.raycast.draw(g, eye, MAP, { "#": a.brick, B: a.blue }, { floor: 16, ceil: 22, fog: 0 }), { init: art }));
  const heights = [60, 90, 128, 166, 196].map((x) => run(colAt(px, x), 7));
  assert.ok(Math.max(...heights) - Math.min(...heights) <= 1, `the end wall is the same height all the way across: ${heights}`);
  const edge = colAt(px, 1);
  assert.ok(run(edge, DARKER[7]) > 0 && run(edge, 7) === 0, "the side walls are the darker red");
  const back = await shot(Object.assign((g, a) => g.lib.raycast.draw(g, { x: 5.5, y: 2.5, angle: Math.PI }, MAP, { "#": a.brick, B: a.blue }, { fog: 0 }), { init: art }));
  assert.ok(run(colAt(back, W / 2), 23) > 20, "the B block is blue");
  const one = await shot(Object.assign((g, a) => g.lib.raycast.draw(g, { x: 5.5, y: 2.5, angle: Math.PI }, MAP, { "#": a.brick }, { fog: 0 }), { init: art }));
  assert.ok(run(colAt(one, W / 2), 7) > 20, "with no picture of its own it uses the first");
});

test("fog darkens far walls, and floor and ceiling can be tile pictures", async () => {
  const eye = { x: 1.5, y: 1.5, angle: 0 };
  const draw = (o) => shot(Object.assign((g, a) => g.lib.raycast.draw(g, eye, MAP, { "#": a.brick }, o(a)), { init: art }));
  const plain = await draw(() => ({ fog: 0 }));
  const foggy = await draw(() => ({ fog: 3 }));
  assert.equal(plain[(H / 2) * W + W / 2], 7);
  assert.equal(foggy[(H / 2) * W + W / 2], DARKER[DARKER[7]], "6.5 tiles away at 3 tiles a step: two steps darker");
  const def = await draw(() => ({}));
  assert.equal(def[(H / 2) * W + W / 2], DARKER[7], "the default fog is a step every 4 tiles");
  assert.deepEqual([def[W / 2], def[(H - 1) * W + W / 2]], [1, 2], "default ceiling night, floor slate");
  const tiled = await draw((a) => ({ floor: a.gem, ceil: a.blue, fog: 0 }));
  assert.equal(tiled[(H - 1) * W + W / 2], 15);
  assert.equal(tiled[W / 2], 23);
  const mid = colAt(tiled, W / 2);
  assert.equal(run(mid, 7) + run(mid, 15) + run(mid, 23), H, "the pictures fill the floor and ceiling");
});

test("things stand in the maze, shrink with distance, and hide behind walls", async () => {
  const eye = { x: 1.5, y: 1.5, angle: 0 };
  const draw = (things) => shot(Object.assign((g, a) => g.lib.raycast.draw(g, eye, MAP, { "#": a.brick, B: a.blue }, { fog: 0, things: things(a) }), { init: art }));
  const count = (px, c) => px.reduce((n, v) => n + (v === c ? 1 : 0), 0);
  const nearPx = await draw((a) => [{ spr: a.gem, x: 3.5, y: 1.5, size: 0.5 }]);
  const farPx = await draw((a) => [{ spr: a.gem, x: 6.5, y: 1.5, size: 0.5 }]);
  assert.ok(count(nearPx, 15) > count(farPx, 15) * 4 && count(farPx, 15) > 0, `near ${count(nearPx, 15)} px, far ${count(farPx, 15)} px`);
  // It stands on the floor: its bottom is where the floor is at that distance.
  const col = colAt(nearPx, W / 2);
  const f = W / 2 / Math.tan(1.15 / 2);
  const bottom = col.lastIndexOf(15);
  assert.ok(Math.abs(bottom + 1 - (H / 2 + f / 2 / 2)) <= 1.5, `feet at row ${bottom}`);
  assert.ok(Math.abs(run(col, 15) - (f / 2) * 0.5) <= 1.5, "half a tile tall");
  const lifted = colAt(await draw((a) => [{ spr: a.gem, x: 3.5, y: 1.5, size: 0.5, lift: 0.5 }]), W / 2);
  assert.ok(lifted.lastIndexOf(15) < bottom - 30, "lift raises it");
  // Behind the B block from here, and behind the eye: neither shows.
  const eye2 = { x: 2.5, y: 1.5, angle: Math.PI / 2 };
  const hidden = await shot(Object.assign((g, a) => g.lib.raycast.draw(g, eye2, MAP, { "#": a.brick, B: a.blue }, { fog: 0, things: [{ spr: a.gem, x: 2.5, y: 3.5 }, { spr: a.gem, x: 2.5, y: 0.2 }] }), { init: art }));
  assert.equal(count(hidden, 15), 0);
  // Two things in line: the near one covers the far one.
  const both = await draw((a) => [{ spr: a.gem, x: 3, y: 1.5 }, { spr: a.blue, x: 5, y: 1.5 }]);
  assert.equal(both[(H / 2) * W + W / 2], 15);
  assert.ok(count(both, 23) === 0, "the far one is wholly behind");
});

test("it needs a wall picture, and odd places don't hang", async () => {
  await assert.rejects(shot(Object.assign((g) => g.lib.raycast.draw(g, { x: 1.5, y: 1.5, angle: 0 }, MAP, {}), { init: art })), /at least one wall picture/);
  for (const eye of [{ x: 0.5, y: 0.5, angle: 1 }, { x: -20, y: 7, angle: 2 }, { x: 1.5, y: 1.5, angle: NaN }, { x: NaN, y: 1.5, angle: 0 }]) {
    await shot(Object.assign((g, a) => g.lib.raycast.draw(g, eye, MAP, { "#": a.brick }, { floor: a.gem, things: [{ spr: a.gem, x: 3, y: 1.5 }] }), { init: art }));
  }
  assert.equal(raycast.cast(MAP, 1.5, 1.5, NaN), null);
});
