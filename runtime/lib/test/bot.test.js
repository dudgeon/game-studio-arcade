// t.bot (D162) and t.poke (D163), against a small real cart on the real machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { headless } from "../../src/headless.js";
import { away, eq, near, nearest, ok, pathStep, toward, withBot } from "../bot.js";

/** One thing falls at 1 px per frame; touching the floor costs a life; at 0 lives the game is over. */
const cart = {
  init(g) {
    return { flow: g.lib.flow.newFlow(), x: 10, y: 0, lives: 2, played: 0 };
  },
  update(g, s) {
    const { flow } = g.lib;
    flow.tick(s.flow);
    if (s.flow.mode !== "play") {
      if (flow.startPressed(g, s.flow)) flow.go(s.flow, "play");
      return;
    }
    s.played += 1;
    if (g.btn("right")) s.x += 2;
    if (g.btn("left")) s.x -= 2;
    s.y += 1;
    if (s.y >= 50) {
      s.y = 0;
      s.lives -= 1;
      if (s.lives <= 0) flow.go(s.flow, "over");
    }
  },
  draw(g) {
    g.cls(0);
  },
  probe(g, s) {
    return { mode: s.flow.mode, x: s.x, y: s.y, lives: s.lives, played: s.played };
  },
  poke(g, s, o) {
    if (o.lives !== undefined) s.lives = o.lives;
  },
};

const open = async (/** @type {any} */ c = cart) => withBot(await headless(c, { seed: 1 }));

test("toward: picks the buttons, respects the dead zone and axis, and uses centers", () => {
  assert.equal(toward({ x: 0, y: 0 }, { x: 10, y: 0 }), "right");
  assert.equal(toward({ x: 10, y: 10 }, { x: 0, y: 0 }), "up left");
  assert.equal(toward({ x: 0, y: 0 }, { x: 2, y: 2 }), "");
  assert.equal(toward({ x: 0, y: 0 }, { x: 10, y: 10 }, { axis: "x" }), "right");
  assert.equal(toward({ x: 0, y: 0 }, { x: 10, y: 10 }, { axis: "y" }), "down");
  // A 16-wide player at 0 has its center at 8: an 8-wide thing at 4 has its center there too.
  assert.equal(toward({ x: 0, y: 0, w: 16 }, { x: 4, y: 0, w: 8 }, { axis: "x" }), "");
});

test("away: heads the other way, and level means right or down", () => {
  assert.equal(away({ x: 5, y: 0 }, { x: 0, y: 0 }, { axis: "x" }), "right");
  assert.equal(away({ x: 5, y: 0 }, { x: 9, y: 0 }, { axis: "x" }), "left");
  assert.equal(away({ x: 5, y: 5 }, { x: 5, y: 5 }, { axis: "x" }), "right");
  assert.equal(away({ x: 0, y: 5 }, { x: 0, y: 1 }, { axis: "y" }), "down");
  assert.equal(away({ x: 0, y: 5 }, { x: 0, y: 9 }, { axis: "y" }), "up");
  assert.equal(away({ x: 0, y: 5 }, { x: 0, y: 5 }, { axis: "y" }), "down");
});

test("nearest: the closest thing, or null", () => {
  const a = { x: 1, y: 1 };
  const b = { x: 40, y: 0 };
  assert.equal(nearest({ x: 0, y: 0 }, [b, a]), a);
  assert.equal(nearest({ x: 0, y: 0 }, []), null);
});

test("pathStep: the first step of the shortest walk around walls", () => {
  const map = ["..#.", ".##.", "....", ];
  const open = (x, y) => map[y]?.[x] === ".";
  assert.equal(pathStep(open, { x: 0, y: 0 }, { x: 3, y: 0 }), "down", "the only way round");
  assert.equal(pathStep(open, { x: 3, y: 2 }, { x: 3, y: 0 }), "up");
  assert.equal(pathStep(open, { x: 1, y: 2 }, { x: 0, y: 2 }), "left");
  assert.equal(pathStep(open, { x: 1, y: 2 }, { x: 1, y: 2 }), "", "already there");
  assert.equal(pathStep(open, { x: 0, y: 0 }, { x: 2, y: 0 }), "", "a wall tile can't be reached");
  assert.equal(pathStep(open, { x: 0, y: 0 }, null), "", "nowhere to go");
});

test("ok, eq and near pass quietly and fail with what was expected", () => {
  ok(true, "no");
  eq({ a: 1 }, { a: 1 }, "same");
  near(0.1 + 0.2, 0.3, "close");
  assert.throws(() => ok(false, "the why"), /the why/);
  assert.throws(() => eq(1, 2, "score"), /score: expected 2, got 1/);
  assert.throws(() => near(1.5, 1, "speed"), /speed: expected 1, got 1.5/);
});

test("start: waits out the title's 30 frames and lands in play", async () => {
  const t = await open();
  const p = await t.bot.start();
  assert.equal(p.mode, "play");
});

test("start: says so when START doesn't start the game", async () => {
  const t = await open({ ...cart, update() {} });
  await assert.rejects(t.bot.start(), /should reach mode "play", but mode is "title"/);
});

test("hold and press step exactly what they say", async () => {
  const t = await open();
  await t.bot.start();
  const a = await t.probe();
  const b = await t.bot.hold("right", 5);
  assert.equal(b.x, a.x + 10);
  assert.equal(b.played, a.played + 5);
  const c = await t.bot.press("left", 3);
  assert.equal(c.x, b.x - 2, "the press is one frame");
  assert.equal(c.played, b.played + 4, "plus the frames after it");
});

test("wait and delta measure real change", async () => {
  const t = await open();
  await t.bot.start();
  assert.equal((await t.bot.wait(4)).y, (await t.probe()).y);
  assert.equal(await t.bot.delta((p) => p.y), 1);
  assert.equal(await t.bot.delta((p) => p.x, { frames: 3, held: "right" }), 6);
});

test("play: stops when until comes true and reports it", async () => {
  const t = await open();
  await t.bot.start();
  const r = await t.bot.play(() => "right", { until: (p) => p.x >= 40 });
  assert.equal(r.reached, true);
  assert.ok(r.p.x >= 40);
  assert.ok(r.frames > 0 && r.frames % 3 === 0, "looks every 3 frames by default");
});

test("play: stops at max and when the mode changes, not reached", async () => {
  const t = await open();
  await t.bot.start();
  const short = await t.bot.play(() => "", { until: () => false, max: 7 });
  assert.deepEqual([short.reached, short.frames], [false, 7], "max is exact");
  const over = await t.bot.play(() => "", { until: () => false });
  assert.equal(over.reached, false);
  assert.equal(over.p.mode, "over", "stops at game over rather than playing on");
  assert.ok(over.frames < 3000);
});

test("play: anyMode keeps going past a mode change", async () => {
  const t = await open();
  await t.bot.start();
  const r = await t.bot.play(() => "", { until: () => false, max: 300, anyMode: true });
  assert.equal(r.frames, 300);
  assert.equal(r.p.mode, "over");
});

test("reach: returns the probe, or blames the bot and shows where the game ended", async () => {
  const t = await open();
  await t.bot.start();
  const p = await t.bot.reach(() => "right", (q) => q.x >= 20, "x 20");
  assert.ok(p.x >= 20);
  await assert.rejects(t.bot.reach(() => "", () => false, "the moon"), /the bot couldn't get to the moon in \d+ frames; .*"mode":"over"/);
});

test("poke: keeps a player alive to read the late game (D163)", async () => {
  const t = await open();
  await t.bot.start();
  await t.poke({ lives: 99 });
  const p = await t.bot.reach(() => "", (q) => q.played >= 400, "frame 400");
  assert.equal(p.mode, "play");
  assert.ok(p.lives < 99, "the poked lives really are the game's");
});

test("poke: a cart without it gets a clear error, and a bad poke says it was the cart", async () => {
  const { poke, ...noPoke } = cart;
  const a = await open(noPoke);
  await assert.rejects(a.poke({ lives: 9 }), /has no poke/);
  const b = await open({ ...cart, poke: () => { throw new Error("boom"); } });
  await assert.rejects(b.poke({}), /cart error in poke .*boom/);
});

