import { test } from "node:test";
import assert from "node:assert/strict";
import { headless } from "../../src/headless.js";
import { DARKER } from "../../src/palette.js";
import { stack } from "../index.js";

const W = 256;
async function shot(fn) {
  const t = await headless({ init: (g) => ({ made: fn.init(g) }), update: () => {}, draw: (g, s) => (g.cls(0), fn(g, s.made)) });
  return /** @type {Uint8Array} */ ((await t.frame()).pixels);
}
// A 6x4 slab in three colors, bottom to top.
const init = (g) => [7, 8, 9].map((c) => g.sprite(Array(4).fill(c.toString(32).repeat(6))));
const box = (px, c) => {
  const xs = [];
  const ys = [];
  px.forEach((v, i) => {
    if (v === c) {
      xs.push(i % W);
      ys.push(Math.floor(i / W));
    }
  });
  return xs.length ? { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), n: xs.length } : null;
};

test("slices stack upward from the bottom one, centered on x, y", async () => {
  const px = await shot(Object.assign((g, s) => g.lib.stack.draw(g, s, 100, 80), { init }));
  // The top slice is whole; each one below shows only the row the next doesn't cover.
  assert.deepEqual(box(px, 9), { x0: 97, x1: 102, y0: 76, y1: 79, n: 24 });
  assert.deepEqual(box(px, 8), { x0: 97, x1: 102, y0: 80, y1: 80, n: 6 });
  assert.deepEqual(box(px, 7), { x0: 97, x1: 102, y0: 81, y1: 81, n: 6 });
});

test("gap and zoom spread and grow it; height says how tall it stands", async () => {
  const px = await shot(Object.assign((g, s) => g.lib.stack.draw(g, s, 100, 80, 0, { gap: 3, zoom: 2 }), { init }));
  assert.deepEqual(box(px, 9), { x0: 94, x1: 105, y0: 64, y1: 71, n: 96 });
  assert.deepEqual([box(px, 8)?.y1, box(px, 7)?.y1], [77, 83], "6 pixels apart: gap 3 times zoom 2");
  assert.equal(stack.height([1, 2, 3].map(() => /** @type {any} */ ({})), { gap: 3, zoom: 2 }), 12);
  assert.equal(stack.height([]), 0);
});

test("the whole stack turns together", async () => {
  const px = await shot(Object.assign((g, s) => g.lib.stack.draw(g, s, 100, 80, Math.PI / 2), { init }));
  const top = /** @type {any} */ (box(px, 9));
  assert.deepEqual([top.x1 - top.x0 + 1, top.y1 - top.y0 + 1], [4, 6], "a quarter turn: 6 wide becomes 6 tall");
  assert.ok(box(px, 7) && box(px, 8), "the lower slices still show below it");
  const a = await shot(Object.assign((g, s) => g.lib.stack.draw(g, s, 100, 80, 0.6), { init }));
  const b = await shot(Object.assign((g, s) => g.lib.stack.draw(g, s, 100, 80, 0.6 + Math.PI * 2), { init }));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, px);
});

test("shade darkens the lower slices, and shadow lays one flat color underneath", async () => {
  const px = await shot(Object.assign((g, s) => g.lib.stack.draw(g, s, 100, 80, 0, { shade: 2 }), { init }));
  assert.ok(box(px, 9), "the top is its own color");
  assert.ok(box(px, DARKER[8]), "the middle a step darker");
  assert.ok(box(px, DARKER[DARKER[7]]), "the bottom two steps");
  const sh = await shot(Object.assign((g, s) => g.lib.stack.draw(g, s, 100, 80, 0, { shadow: 2 }), { init }));
  const shadow = box(sh, 2);
  assert.ok(shadow && shadow.x1 === 103 && shadow.y1 === 82, `a shadow down and right of the base: ${JSON.stringify(shadow)}`);
  await shot(Object.assign((g) => g.lib.stack.draw(g, [], 5, 5, 0, { shadow: 2 }), { init }));
});
