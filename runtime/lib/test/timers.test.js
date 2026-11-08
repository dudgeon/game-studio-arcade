import { test } from "node:test";
import assert from "node:assert/strict";
import * as timers from "../timers.js";
import { fakeG, asG } from "./fake-g.js";

/** Frames (1-based) on which `fn` returned true over `n` calls. */
const firings = (n, fn) => {
  const out = [];
  for (let i = 1; i <= n; i++) if (fn()) out.push(i);
  return out;
};

test("seconds", () => {
  assert.equal(timers.seconds(1), 60);
  assert.equal(timers.seconds(0.5), 30);
  assert.equal(timers.seconds(0.01), 1);
});

test("a one-shot timer fires once, on its last frame", () => {
  const t = timers.timer(3);
  assert.deepEqual(firings(10, () => timers.tick(t)), [3]);
  assert.equal(t.done, true);
  assert.equal(timers.progress(t), 1);
});

test("a looping timer fires every n frames", () => {
  const t = timers.timer(4, true);
  assert.deepEqual(firings(12, () => timers.tick(t)), [4, 8, 12]);
  assert.equal(t.done, false);
});

test("restart, with a new length, and progress", () => {
  const t = timers.timer(10, true);
  timers.tick(t);
  timers.tick(t);
  assert.equal(timers.progress(t), 0.2);
  timers.restart(t, 2);
  assert.equal(timers.progress(t), 0);
  assert.deepEqual(firings(6, () => timers.tick(t)), [2, 4, 6]);
  const once = timers.timer(1);
  timers.tick(once);
  timers.restart(once);
  assert.equal(once.done, false);
  assert.equal(timers.tick(once), true);
  assert.equal(timers.timer(0).len, 1, "at least one frame");
});

test("every follows g.frame", () => {
  const f = fakeG();
  const g = asG(f);
  const on = [];
  for (let i = 0; i < 10; i++) {
    f.frame = i;
    if (timers.every(g, 4)) on.push(i);
  }
  assert.deepEqual(on, [0, 4, 8]);
  f.frame = 5;
  assert.equal(timers.every(g, 4, 1), true);
});

test("repeat: press, delay, then rate; release resets", () => {
  const r = timers.repeat(5, 2);
  assert.deepEqual(firings(12, () => timers.repeatTick(r, true)), [1, 6, 8, 10, 12]);
  assert.equal(timers.repeatTick(r, false), false);
  assert.equal(timers.repeatTick(r, true), true, "a new press fires at once");
  assert.equal(timers.repeatTick(r, true), false);
});

test("timers are plain JSON", () => {
  const t = timers.timer(5, true);
  timers.tick(t);
  assert.deepEqual(JSON.parse(JSON.stringify(t)), t);
  assert.deepEqual(JSON.parse(JSON.stringify(timers.repeat())), timers.repeat());
});
