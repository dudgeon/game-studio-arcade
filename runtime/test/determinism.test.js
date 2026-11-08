import { test } from "node:test";
import assert from "node:assert/strict";
import { headless } from "../src/headless.js";
import { createRng } from "../src/rng.js";

const HELLO = new URL("../examples/hello/game.js", import.meta.url);

/** A cart that uses randomness, input and time, so hashes depend on all three. */
const noisy = {
  init: (g) => ({ dots: [], x: 0 }),
  update: (g, s) => {
    if (g.btn("right")) s.x += 3;
    if (g.btnp("a")) g.sfx("pop");
    s.dots.push({ x: g.rnd(g.W), y: g.rnd(g.H), c: 1 + g.rnd(31) });
    if (s.dots.length > 200) s.dots.shift();
  },
  draw: (g, s) => {
    g.cls(0);
    for (const d of s.dots) g.pset(d.x, d.y, d.c);
    g.rectfill(s.x % g.W, 96, 8, 8, g.colors.yellow);
    g.text(`f${g.frame}`, 2, 2);
  },
  probe: (g, s) => ({ x: s.x, n: s.dots.length }),
};

const SCRIPT = [
  { frames: 20, p1: "right" },
  { frames: 1, p1: "a" },
  { frames: 30 },
  { frames: 10, p1: "right a", p2: "left" },
];

async function run(cart, seed) {
  const t = await headless(cart, { seed });
  await t.input(SCRIPT);
  const hashes = [];
  for (let i = 0; i < 6; i++) {
    await t.step(10);
    hashes.push((await t.frame()).hash);
  }
  return { hashes, probe: await t.probe(), sounds: await t.sounds() };
}

test("rng: same seed, same stream; different seed, different stream", () => {
  const a = createRng(42);
  const b = createRng(42);
  const c = createRng(43);
  const sa = Array.from({ length: 100 }, a);
  assert.deepEqual(Array.from({ length: 100 }, b), sa);
  assert.notDeepEqual(Array.from({ length: 100 }, c), sa);
  for (const v of sa) assert.ok(v >= 0 && v < 1);
});

test("same seed + same input => same frame hashes, probe and sounds", async () => {
  const one = await run(noisy, 7);
  const two = await run(noisy, 7);
  assert.deepEqual(two, one);
  assert.equal(new Set(one.hashes).size, one.hashes.length, "frames change over time");
});

test("a different seed gives different frames", async () => {
  const one = await run(noisy, 7);
  const other = await run(noisy, 8);
  assert.notDeepEqual(other.hashes, one.hashes);
});

test("different input gives different frames", async () => {
  const t1 = await headless(noisy, { seed: 7 });
  const t2 = await headless(noisy, { seed: 7 });
  await t1.input([{ frames: 10, p1: "right" }]);
  await t1.step(10);
  await t2.step(10);
  assert.notEqual((await t1.frame()).hash, (await t2.frame()).hash);
});

test("reset() replays identically, and runs are independent of wall-clock time", async () => {
  const t = await headless(HELLO);
  await t.input([{ frames: 15, p1: "right down" }, { frames: 1, p1: "a" }]);
  await t.step(40);
  const first = await t.frame();
  await new Promise((r) => setTimeout(r, 20));
  await t.reset();
  await t.input([{ frames: 15, p1: "right down" }, { frames: 1, p1: "a" }]);
  await t.step(40);
  const second = await t.frame();
  assert.equal(second.hash, first.hash);
  assert.equal(second.frame, 40);
});

test("step(n) in one call equals n single steps", async () => {
  const a = await headless(noisy, { seed: 3 });
  const b = await headless(noisy, { seed: 3 });
  await a.input(SCRIPT);
  await b.input(SCRIPT);
  await a.step(45);
  for (let i = 0; i < 45; i++) await b.step();
  assert.equal((await a.frame()).hash, (await b.frame()).hash);
});
