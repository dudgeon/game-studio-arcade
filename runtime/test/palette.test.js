import { test } from "node:test";
import assert from "node:assert/strict";
import { COLORS, PALETTE, RGB, colorIndex, nearest, rgbaTable } from "../src/palette.js";
import { headless } from "../src/headless.js";

test("the palette has exactly 32 distinct #rrggbb colors, index 0 black", () => {
  assert.equal(PALETTE.length, 32);
  for (const hex of PALETTE) assert.match(hex, /^#[0-9a-f]{6}$/);
  assert.equal(new Set(PALETTE).size, 32);
  assert.equal(PALETTE[0], "#000000");
  assert.equal(PALETTE[COLORS.white], "#ffffff");
});

test("color names cover every index once, in order", () => {
  const entries = Object.entries(COLORS);
  assert.equal(entries.length, 32);
  assert.deepEqual(entries.map(([, i]) => i), [...Array(32).keys()]);
  assert.equal(COLORS.black, 0);
  assert.equal(COLORS.rose, 31);
});

test("the palette is frozen", () => {
  assert.ok(Object.isFrozen(PALETTE));
  assert.ok(Object.isFrozen(COLORS));
  assert.throws(() => {
    // @ts-expect-error writing to a frozen array
    PALETTE[0] = "#123456";
  });
});

test("RGBA table matches the hex values (little-endian ABGR)", () => {
  const t = rgbaTable();
  RGB.forEach(([r, g, b], i) => {
    assert.equal(t[i] & 0xff, r);
    assert.equal((t[i] >>> 8) & 0xff, g);
    assert.equal((t[i] >>> 16) & 0xff, b);
    assert.equal(t[i] >>> 24, 255);
  });
});

test("nearest() maps each palette color to itself", () => {
  RGB.forEach(([r, g, b], i) => assert.equal(nearest(r, g, b), i));
  assert.equal(nearest(2, 1, 3), 0);
});

test("color values wrap into 0..31", () => {
  assert.equal(colorIndex(32), 0);
  assert.equal(colorIndex(-1), 31);
  assert.equal(colorIndex(7.9), 7);
  assert.equal(colorIndex(NaN), 0);
});

test("whatever a cart draws, the framebuffer only holds palette indices", async () => {
  const t = await headless({
    init: () => ({}),
    update: () => {},
    draw: (g) => {
      g.cls(99);
      g.pset(1, 1, -5);
      g.rectfill(10, 10, 50, 50, 1000);
      g.circfill(100, 100, 20, 33.7);
      g.text("Hi", 0, 0, 77);
    },
  });
  await t.step();
  const f = await t.frame();
  for (let i = 0; i < f.pixels.length; i++) assert.ok(f.pixels[i] >= 0 && f.pixels[i] < 32);
});

test("out-of-range colors still draw (wrapped) but each kind is reported once", async () => {
  const t = await headless({
    init: () => ({}),
    update: () => {},
    draw: (g) => {
      g.cls(0);
      g.rectfill(0, 0, 4, 4, 40);
      g.rectfill(8, 0, 4, 4, 40);
      g.pset(20, 0, 2.5);
      g.text("x", 30, 0, g.colors.white);
    },
  });
  await t.step(3);
  const f = await t.frame();
  assert.equal(f.pixels[0], 8, "40 wraps to 8");
  const w = await t.warnings();
  assert.deepEqual(
    w.map((x) => x.message),
    ["g.rectfill() got color 40; colors are 0..31, so it was drawn as 8", "g.pset() got color 2.5; colors are 0..31, so it was drawn as 2"],
  );
  assert.equal(w[0].frame, 0, "first seen in init's draw");
  await t.reset();
  assert.equal((await t.warnings()).length, 2, "a reset starts a fresh list (init's draw re-reports both)");
});
