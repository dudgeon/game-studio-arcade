import { test } from "node:test";
import assert from "node:assert/strict";
import { camera } from "../index.js";

/** A g with a frame count, a screen size, and a camera() that records where it was pointed. */
function recG(frame = 0) {
  const g = { W: 256, H: 192, frame, calls: /** @type {number[][]} */ ([]), camera: (x = 0, y = 0) => g.calls.push([x, y]), rand: () => assert.fail("the camera must not use the game's dice") };
  return g;
}
const G = (/** @type {ReturnType<typeof recG>} */ g) => /** @type {Arcade.G} */ (/** @type {unknown} */ (g));

test("the camera waits while its target is in the middle zone", () => {
  const g = recG();
  const cam = camera.newCamera(100, 50);
  // The zone is the middle quarter: world x 196..260, y 122..170 for this camera.
  for (const [x, y] of [[228, 146], [197, 123], [259, 169]]) {
    camera.follow(G(g), cam, { x, y });
    assert.deepEqual([cam.x, cam.y], [100, 50], `target ${x},${y}`);
  }
});

test("outside the zone the camera eases after it and settles with the target on the zone's edge", () => {
  const g = recG();
  const cam = camera.newCamera(0, 0);
  const target = { x: 400, y: 20, w: 8, h: 8 };
  const xs = [];
  for (let i = 0; i < 200; i++) {
    camera.follow(G(g), cam, target, { ease: 0.2 });
    xs.push(cam.x);
  }
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] >= xs[i - 1], "never goes back");
  assert.ok(xs[1] - xs[0] > xs[10] - xs[9], "fast at first, then gentle");
  assert.ok(xs[0] > 0 && xs[0] < 100, "but not there in one frame");
  // Target center 404 sits on the zone's right edge: cam.x + 96 + 64 = 404.
  assert.ok(Math.abs(cam.x - 244) < 1e-6, `x ${cam.x}`);
  assert.ok(Math.abs(cam.y + 48) < 1e-6, `and on the top edge going up: cam.y + 72 = 24 (y ${cam.y})`);
});

test("bounds keep the screen inside the world", () => {
  const g = recG();
  const cam = camera.newCamera(0, 0);
  const bounds = { x: 0, y: 0, w: 600, h: 192 };
  for (let i = 0; i < 300; i++) camera.follow(G(g), cam, { x: 590, y: -500 }, { bounds });
  assert.deepEqual([cam.x, cam.y], [344, 0]);
  for (let i = 0; i < 300; i++) camera.follow(G(g), cam, { x: -90, y: 900 }, { bounds });
  assert.deepEqual([cam.x, cam.y], [0, 0]);
  const small = camera.newCamera(50, 50);
  camera.follow(G(g), small, { x: 0, y: 0 }, { bounds: { x: 10, y: 20, w: 100, h: 100 } });
  assert.deepEqual([small.x, small.y], [10, 20], "a world smaller than the screen pins to its corner");
});

test("use points the screen at the camera; a shake jitters it, dies away, and repeats exactly", () => {
  const g = recG(100);
  const cam = camera.newCamera(40, 30);
  camera.use(G(g), cam);
  assert.deepEqual(g.calls.pop(), [40, 30]);

  camera.shake(G(g), cam, 4, 10);
  const offs = [];
  for (let f = 100; f < 112; f++) {
    g.frame = f;
    camera.use(G(g), cam);
    const [x, y] = /** @type {number[]} */ (g.calls.pop());
    offs.push([x - 40, y - 30]);
  }
  const size = (/** @type {number[]} */ o) => Math.max(Math.abs(o[0]), Math.abs(o[1]));
  assert.ok(offs.slice(0, 10).every((o) => size(o) <= 4), "never more than the amount");
  assert.ok(offs.slice(0, 5).some((o) => size(o) > 1), "it does move");
  assert.ok(new Set(offs.slice(0, 10).map((o) => o.join())).size >= 8, "a different place most frames");
  assert.ok(size(offs[9]) <= 0.4 + 1e-9, "nearly still by the last frame");
  assert.deepEqual(offs[10], [0, 0]);
  assert.deepEqual(offs[11], [0, 0]);

  const again = camera.newCamera(40, 30);
  g.frame = 100;
  camera.shake(G(g), again, 4, 10);
  g.frame = 103;
  camera.use(G(g), again);
  const [x, y] = /** @type {number[]} */ (g.calls.pop());
  assert.deepEqual([x - 40, y - 30], offs[3], "same frame, same shake");
});

test("a small shake doesn't cut a big one short", () => {
  const g = recG(0);
  const cam = camera.newCamera();
  camera.shake(G(g), cam, 8, 20);
  g.frame = 5;
  camera.shake(G(g), cam, 2, 5);
  assert.deepEqual([cam.shake, cam.until], [8, 20]);
  g.frame = 19;
  camera.shake(G(g), cam, 2, 5);
  assert.deepEqual([cam.shake, cam.until], [2, 24], "but takes over once the big one has faded");
});

test("view is the part of the world on screen", () => {
  const g = recG();
  const cam = camera.newCamera(100, 20);
  assert.deepEqual(camera.view(G(g), cam), { x: 100, y: 20, w: 256, h: 192 });
  assert.deepEqual(camera.view(G(g), cam, 16), { x: 84, y: 4, w: 288, h: 224 });
});
