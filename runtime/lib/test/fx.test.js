// g.lib.fx (D170), on the real console, so what's checked is what's drawn.
import { test } from "node:test";
import assert from "node:assert/strict";
import { headless } from "../../src/headless.js";
import * as fx from "../fx.js";

/** Run one draw on a black screen and return the frame and whatever draw returned. */
async function drawn(/** @type {(g: any) => any} */ fn) {
  let out;
  const t = await headless({ init: () => ({}), update() {}, draw(g) { g.cls(0); out = fn(g); } }, { seed: 1 });
  await t.step(1);
  return { frame: await t.frame(), out: () => out };
}

const litRows = (/** @type {any} */ f, /** @type {number} */ from, /** @type {number} */ to) => {
  let n = 0;
  for (let y = Math.max(0, from); y < Math.min(f.height, to); y++) for (let x = 0; x < f.width; x++) if (f.pixels[y * f.width + x]) n++;
  return n;
};

test("pop adds one, tick drifts it up and removes it when it's done", () => {
  /** @type {fx.Pop[]} */
  const pops = [];
  fx.pop(pops, "+10", 50, 100, 5, 2);
  assert.deepEqual(pops, [{ text: "+10", x: 50, y: 100, color: 5, left: 2 }]);
  fx.tick(pops);
  assert.equal(pops[0].y, 99.5);
  assert.deepEqual(JSON.parse(JSON.stringify(pops)), pops, "plain JSON, so it can sit in a cart's state");
  fx.tick(pops);
  assert.deepEqual(pops, []);
});

test("tick removes only the finished ones", () => {
  /** @type {fx.Pop[]} */
  const pops = [];
  fx.pop(pops, "a", 0, 0, 5, 1);
  fx.pop(pops, "b", 0, 0, 5, 3);
  fx.tick(pops);
  assert.deepEqual(pops.map((p) => p.text), ["b"]);
});

test("draw shows a pop-up, and keeps one near an edge on the screen", async () => {
  const { frame } = await drawn((g) => {
    fx.draw(g, [{ text: "+10", x: g.W + 50, y: -20, color: 5, left: 9 }]);
  });
  assert.ok(litRows(frame, 0, 10) > 0, "still on screen");
});

test("lives draws that many hearts, from the right edge, and caps the row", async () => {
  const count = async (/** @type {number} */ n) => {
    const { frame } = await drawn((g) => fx.lives(g, n, g.W, 0));
    return litRows(frame, 0, 8);
  };
  const one = await count(1);
  assert.ok(one > 0);
  assert.equal(await count(3), 3 * one);
  assert.equal(await count(0), 0);
  assert.equal(await count(99999), 12 * one, "a check's poke can't flood the screen");
});

test("lives stays inside the given right edge", async () => {
  const { frame } = await drawn((g) => fx.lives(g, 1, 20, 0));
  for (let y = 0; y < 8; y++) for (let x = 20; x < frame.width; x++) assert.equal(frame.pixels[y * frame.width + x], 0);
});

for (const name of ["APPLE CATCH", "PENGUIN FISH CATCH", "A VERY LONG TITLE THAT WILL NOT FIT AT TWICE THE SIZE"]) {
  test(`title leaves its art space clear: "${name}"`, async () => {
    const r = await drawn((g) => fx.title(g, name, 1234));
    const art = r.out();
    assert.ok(art.h >= 90, `room for a big picture, got ${art.h}`);
    const top = art.cy - art.h / 2;
    assert.equal(litRows(r.frame, top, top + art.h), 0, "no words in the art space");
    assert.ok(litRows(r.frame, 0, top) > 0, "the name is above it");
    assert.ok(litRows(r.frame, top + art.h, r.frame.height) > 0, "the small words are below it");
  });
}

test("title fits its name across the screen", async () => {
  const g = { W: 256, H: 192, frame: 0, colors: { white: 5, yellow: 15 }, textWidth: (/** @type {string} */ s, /** @type {number} */ k = 1) => s.length * 6 * k, text(/** @type {string} */ s, /** @type {number} */ _x, /** @type {number} */ _y, /** @type {number} */ _c, /** @type {any} */ o) { if (o.scale) calls.push([s, o.scale]); } };
  /** @type {[string, number][]} */
  const calls = [];
  fx.title(/** @type {any} */ (g), "SHORT", 0);
  fx.title(/** @type {any} */ (g), "X".repeat(30), 0);
  assert.deepEqual(calls.map((c) => c[1]), [2, 1]);
});

test("banner draws a panel with its words, with or without a second line", async () => {
  const a = await drawn((g) => fx.banner(g, "GAME OVER"));
  const b = await drawn((g) => fx.banner(g, "GAME OVER", "SCORE 120"));
  assert.ok(litRows(a.frame, 80, 112) > 0);
  assert.ok(litRows(b.frame, 80, 112) > litRows(a.frame, 80, 112));
  assert.equal(litRows(a.frame, 0, 70), 0, "only the middle of the screen");
});
