import { test } from "node:test";
import assert from "node:assert/strict";
import { anim } from "../index.js";

const run = (fn, n) => Array.from({ length: n }, (_, t) => fn(t));

test("loop goes round, a new frame every so many game frames", () => {
  assert.deepEqual(run((t) => anim.loop(3, t, 2), 10), [0, 0, 1, 1, 2, 2, 0, 0, 1, 1]);
  assert.equal(anim.loop(4, 8), 1, "8 frames each by default");
  assert.equal(anim.loop(4, -5), 0);
  assert.equal(anim.loop(0, 5), 0);
});

test("once plays through and holds the last frame; done says when", () => {
  assert.deepEqual(run((t) => anim.once(3, t, 2), 9), [0, 0, 1, 1, 2, 2, 2, 2, 2]);
  assert.deepEqual(run((t) => anim.done(3, t, 2), 8), [false, false, false, false, false, false, true, true]);
  assert.equal(anim.once(0, 5), 0);
});

test("pingpong goes there and back", () => {
  assert.deepEqual(run((t) => anim.pingpong(4, t, 1), 13), [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0]);
  assert.deepEqual(run((t) => anim.pingpong(2, t, 1), 4), [0, 1, 0, 1]);
  assert.equal(anim.pingpong(1, 7), 0);
});

test("walk steps by distance, so it stops when the walker stops", () => {
  assert.deepEqual([0, 5.9, 6, 11.9, 12, 24].map((d) => anim.walk(4, d)), [0, 0, 1, 1, 2, 0]);
  assert.equal(anim.walk(4, -13, 6), 2, "either direction");
  assert.equal(anim.walk(2, 9, 3), 1);
});
