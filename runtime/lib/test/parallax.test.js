import { test } from "node:test";
import assert from "node:assert/strict";
import { headless } from "../../src/headless.js";

const W = 256;
/** Draw with a function of g and return the frame's pixels. */
async function shot(fn) {
  const t = await headless({ init: () => ({}), update: () => {}, draw: (g) => (g.cls(0), fn(g)) });
  return /** @type {Uint8Array} */ ((await t.frame()).pixels);
}
/** A layer of strips 40 wide: a 1-pixel post at the strip's left in the strip's own color, then a bar. */
const posts = (g, camX, speed, seen = []) =>
  g.lib.parallax.layer(g, { x: camX, y: 0 }, { speed, w: 40, y: 50 }, (i) => {
    seen.push(i);
    g.rectfill(0, 0, 1, 10, 2 + (((i % 8) + 8) % 8));
    g.rectfill(1, 0, 39, 1, 31);
  });
const row = (px, y) => Array.from(px.subarray(y * W, (y + 1) * W));

test("a layer repeats its strip across the whole screen, at its own y", async () => {
  const seen = [];
  const px = await shot((g) => posts(g, 0, 1, seen));
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6]);
  const top = row(px, 50);
  for (let x = 0; x < W; x++) assert.equal(top[x], x % 40 === 0 ? 2 + Math.floor(x / 40) : 31, `x ${x}`);
  assert.ok(row(px, 49).every((v) => v === 0) && row(px, 60).every((v) => v === 0), "only where the strip draws");
});

test("speed sets how far a layer scrolls against the camera", async () => {
  const still = await shot((g) => posts(g, 0, 0));
  assert.deepEqual(await shot((g) => posts(g, 1000, 0)), still, "speed 0 never moves");
  const postsAt = (px) => row(px, 55).flatMap((v, x) => (v ? [x] : []));
  assert.deepEqual(postsAt(await shot((g) => posts(g, 10, 1))), [30, 70, 110, 150, 190, 230], "speed 1 moves with the world");
  assert.deepEqual(postsAt(await shot((g) => posts(g, 10, 0.5))), [35, 75, 115, 155, 195, 235], "speed 0.5 moves half as far");
  const far = [];
  const px = await shot((g) => posts(g, -1234.5, 0.5, far));
  assert.ok(far.length >= 7 && far[0] < 0, "a negative camera works too");
  assert.ok(row(px, 50).every((v) => v !== 0), "with no gaps");
});

test("the camera is reset afterwards, and a bad width is a clear error", async () => {
  const px = await shot((g) => {
    posts(g, 77, 1);
    g.pset(3, 3, 9);
  });
  assert.equal(px[3 * W + 3], 9);
  await assert.rejects(shot((g) => g.lib.parallax.layer(g, { x: 0, y: 0 }, { speed: 1, w: 0 }, () => {})), /strip width w of at least 8/);
});

test("speedY scrolls a layer up and down", async () => {
  const px = await shot((g) => g.lib.parallax.layer(g, { x: 0, y: 40 }, { speed: 0, w: 64, speedY: 0.5 }, () => g.rectfill(0, 100, 64, 1, 7)));
  assert.equal(px[80 * W], 7);
  assert.equal(px[100 * W], 0);
});
