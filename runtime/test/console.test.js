// The g API and the test handle: drawing, text, sprites, input edges, sound,
// saves and errors.
import { withBot } from "../lib/bot.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { headless } from "../src/headless.js";
import { GLYPHS } from "../src/font.js";
import { noteToFreq } from "../src/sound.js";
import checks from "../examples/hello/checks.js";

const HELLO = new URL("../examples/hello/game.js", import.meta.url);
const at = (f, x, y) => f.pixels[y * f.width + x];

/** A cart whose draw is a function of the test. */
const drawing = (fn) => ({ init: () => ({}), update: () => {}, draw: (g) => fn(g) });

test("the hello cart passes its own checks", async () => {
  for (const [id, check] of Object.entries(checks)) {
    const t = withBot(await headless(HELLO));
    await check(t);
    assert.ok(true, id);
  }
});

test("frame 0 shows init's first draw; g.frame counts updates", async () => {
  const t = await headless(drawing((g) => g.cls(g.frame % 32)));
  assert.equal(at(await t.frame(), 0, 0), 0);
  await t.step(3);
  const f = await t.frame();
  assert.equal(f.frame, 3);
  assert.equal(at(f, 255, 191), 3);
  assert.equal(f.width, 256);
  assert.equal(f.height, 192);
  assert.equal(f.pixels.length, 256 * 192);
});

test("shapes land on the right pixels and clip at the edges", async () => {
  const t = await headless(
    drawing((g) => {
      g.cls(0);
      g.rectfill(-5, -5, 10, 10, 7);
      g.rect(100, 100, 10, 5, 8);
      g.line(0, 191, 255, 191, 9);
      g.circfill(200, 50, 3, 10);
      g.pset(400, 400, 11);
    }),
  );
  const f = await t.frame();
  assert.equal(at(f, 0, 0), 7);
  assert.equal(at(f, 4, 4), 7);
  assert.equal(at(f, 5, 5), 0);
  assert.equal(at(f, 100, 100), 8);
  assert.equal(at(f, 109, 104), 8);
  assert.equal(at(f, 105, 102), 0, "rect is an outline");
  assert.equal(at(f, 255, 191), 9);
  assert.equal(at(f, 200, 50), 10);
  assert.equal(at(f, 203, 50), 10);
  assert.equal(at(f, 204, 50), 0);
});

test("camera and clip", async () => {
  const t = await headless(
    drawing((g) => {
      g.cls(0);
      g.camera(10, 0);
      g.pset(10, 0, 5);
      g.camera();
      g.clip(50, 50, 10, 10);
      g.rectfill(0, 0, g.W, g.H, 6);
      g.clip();
    }),
  );
  const f = await t.frame();
  assert.equal(at(f, 0, 0), 5);
  assert.equal(at(f, 50, 50), 6);
  assert.equal(at(f, 59, 59), 6);
  assert.equal(at(f, 60, 60), 0);
  assert.equal(at(f, 49, 50), 0);
});

test("font: 95 glyphs, text width and alignment", async () => {
  assert.equal(GLYPHS.length, 95);
  assert.ok(GLYPHS.slice(1).every((rows) => rows.some(Boolean)), "every printable glyph except space has ink");
  let widths = {};
  const t = await headless(
    drawing((g) => {
      g.cls(0);
      widths = { hi: g.text("HI", 0, 0, 5), big: g.textWidth("HI", 2), empty: g.textWidth("") };
      g.text("I", 128, 100, 5, { align: "center" });
    }),
  );
  assert.deepEqual(widths, { hi: 11, big: 22, empty: 0 });
  const f = await t.frame();
  assert.equal(at(f, 0, 0), 5, "H's top-left pixel");
  assert.equal(at(f, 128, 100), 5, "centered I's top bar includes x=128");
});

test("sprites: characters to palette indices, transparency, flips and recolor", async () => {
  const t = await headless(
    drawing((g) => {
      g.cls(1);
      const s = g.sprite(["a.", "0v"]);
      g.spr(s, 0, 0);
      g.spr(s, 10, 0, { flipX: true });
      g.spr(s, 20, 0, { scale: 2 });
      g.spr(s, 30, 0, { color: 5 });
    }),
  );
  const f = await t.frame();
  assert.deepEqual([at(f, 0, 0), at(f, 1, 0), at(f, 0, 1), at(f, 1, 1)], [10, 1, 0, 31]);
  assert.deepEqual([at(f, 10, 0), at(f, 11, 0)], [1, 10]);
  assert.deepEqual([at(f, 20, 0), at(f, 21, 1), at(f, 22, 0)], [10, 10, 1]);
  assert.equal(at(f, 30, 0), 5);
  assert.equal(at(f, 31, 0), 1);
});

test("sprite errors are readable", async () => {
  await assert.rejects(headless({ init: (g) => g.sprite(["ab", "a"]), update() {}, draw() {} }), /row 1 is 1 characters long, expected 2/);
  await assert.rejects(headless({ init: (g) => g.sprite(["z"]), update() {}, draw() {} }), /use 0-9 and a-v/);
});

test("btn, btnp and btnr see edges per player", async () => {
  const log = [];
  const t = await headless(
    {
      init: () => ({}),
      update: (g) => log.push([g.btn("a"), g.btnp("a"), g.btnr("a"), g.btn("a", 2)]),
      draw() {},
    },
    { players: 2 },
  );
  await t.input([{ frames: 2, p1: "a" }, { frames: 1, p2: ["a"] }]);
  await t.step(4);
  assert.deepEqual(log, [
    [true, true, false, false],
    [true, false, false, false],
    [false, false, true, true],
    [false, false, false, false],
  ]);
});

test("players: g.players is the setting (default 1); a player with no controller holds nothing (D110-D112)", async () => {
  /** @type {any[]} */
  const log = [];
  /** @type {Arcade.Cart} */
  const cart = {
    init: (g) => ({ n: g.players }),
    update: (g) => log.push([g.players, g.btn("a", 1), g.btn("a", 2), g.btnp("a", 2), g.btnr("a", 2), g.btn("b", 8)]),
    draw() {},
  };
  const t = await headless(cart);
  await t.input([{ frames: 1, p1: "a", p2: "a", p8: "b" }]); // the playtest soak always sends p2
  await t.step(2);
  assert.deepEqual(log, [
    [1, true, false, false, false, false],
    [1, false, false, false, false, false],
  ]);

  log.length = 0;
  await t.reset({ players: 8 });
  await t.input([{ frames: 1, p2: "a", p8: "b" }]);
  await t.step(2);
  assert.deepEqual(log, [
    [8, false, true, true, false, true],
    [8, false, false, false, true, false],
  ]);

  log.length = 0;
  await t.reset();
  await t.step();
  assert.equal(log[0][0], 1, "reset() goes back to the run's starting count");

  const three = await headless(cart, { players: 3 });
  await three.reset();
  log.length = 0;
  await three.step();
  assert.equal(log[0][0], 3, "the starting count is the one headless() was given");

  await assert.rejects(t.reset({ players: 0 }), /whole number from 1 to 8, got 0/);
  await assert.rejects(headless(cart, { players: 9 }), /whole number from 1 to 8, got 9/);
  const bad = await headless({ init: () => ({}), update: (g) => g.btn("a", /** @type {any} */ (9)), draw() {} });
  await assert.rejects(bad.step(), /player must be 1 to 8, got 9/);
});

test("unknown buttons and players throw with the frame", async () => {
  const t = await headless({ init: () => ({}), update: (g) => g.btn(/** @type {any} */ ("jump")), draw() {} });
  await assert.rejects(t.step(), /cart error in update at frame 1: unknown button "jump"/);
});

test("sound: tones and sfx are logged with frame and voice; 4 voices round-robin", async () => {
  const t = await headless({
    init: () => ({}),
    update: (g) => {
      if (g.frame === 1) for (let i = 0; i < 5; i++) g.tone({ note: "C4", frames: 30 });
      if (g.frame === 2) g.sfx("coin");
    },
    draw() {},
  });
  await t.step(2);
  const s = await t.sounds();
  assert.deepEqual(
    s.map((e) => [e.frame, e.kind, e.voice]),
    [[1, "tone", 0], [1, "tone", 1], [1, "tone", 2], [1, "tone", 3], [1, "tone", 0], [2, "coin", 1]],
  );
  await t.reset();
  assert.deepEqual(await t.sounds(), []);
});

test("notes to frequencies", () => {
  assert.equal(noteToFreq("A4"), 440);
  assert.ok(Math.abs(noteToFreq("C4") - 261.63) < 0.01);
  assert.ok(Math.abs(noteToFreq("A#4") - noteToFreq("Bb4")) < 1e-9);
  assert.equal(noteToFreq(220), 220);
  assert.throws(() => noteToFreq("H2"), /isn't a note/);
});

test("save/load: JSON round trip, 4 KB limit, survives reset only with keepSave", async () => {
  const t = await headless(
    {
      init: (g) => ({ loaded: g.load() }),
      update: (g) => {
        if (g.frame === 1) g.save({ best: 12, name: "cat" });
      },
      draw() {},
      probe: (g, s) => ({ loaded: s.loaded, now: g.load() }),
    },
    { save: { best: 3 } },
  );
  assert.deepEqual(await t.probe(), { loaded: { best: 3 }, now: { best: 3 } });
  await t.step();
  assert.deepEqual((await t.probe()).now, { best: 12, name: "cat" });
  await t.reset({ keepSave: true });
  assert.deepEqual((await t.probe()).loaded, { best: 12, name: "cat" });
  await t.reset();
  assert.equal((await t.probe()).loaded, null);

  const big = await headless({ init: () => ({}), update: (g) => g.save("x".repeat(5000)), draw() {} });
  await assert.rejects(big.step(), /limit is 4096/);
});

test("g.score: each round's final score, in order, for the cabinet; whole numbers only (D215)", async () => {
  const t = await headless({
    init: () => ({}),
    update: (g) => {
      if (g.frame === 2) g.score(120);
      if (g.frame === 4) g.score(0);
    },
    draw() {},
  });
  assert.deepEqual(await t.scores(), []);
  await t.step(5);
  assert.deepEqual(await t.scores(), [120, 0]);
  await t.reset();
  assert.deepEqual(await t.scores(), [], "a reset starts a new run");
  for (const bad of [-1, 1.5, NaN, "9", 1e10]) {
    const b = await headless({ init: () => ({}), update: (g) => g.score(/** @type {any} */ (bad)), draw() {} });
    await assert.rejects(b.step(), /g\.score\(\) needs a whole number/, String(bad));
  }
});

test("probe is JSON-cloned and null when the cart has none", async () => {
  const shared = { list: [1, 2] };
  const t = await headless({ init: () => shared, update() {}, draw() {}, probe: (g, s) => s });
  const p = await t.probe();
  p.list.push(3);
  assert.deepEqual(shared.list, [1, 2]);
  const none = await headless({ init: () => ({}), update() {}, draw() {} });
  assert.equal(await none.probe(), null);
});

test("g is frozen and seeded randomness is in range", async () => {
  /** @type {any} */
  let got;
  await headless({
    init: (g) => {
      got = { frozen: Object.isFrozen(g), r: Array.from({ length: 200 }, () => g.rnd(6)), p: g.pick(["x"]) };
      return {};
    },
    update() {},
    draw() {},
  });
  assert.equal(got.frozen, true);
  assert.ok(got.r.every((n) => Number.isInteger(n) && n >= 0 && n < 6));
  assert.equal(new Set(got.r).size, 6);
  assert.equal(got.p, "x");
});

test("bad carts are rejected with a readable message", async () => {
  await assert.rejects(headless(/** @type {any} */ ({ init() {}, draw() {} })), /no update\(g, s\) function/);
  await assert.rejects(headless({ init: () => { throw new Error("boom"); }, update() {}, draw() {} }), /cart error in init at frame 0: boom/);
});
