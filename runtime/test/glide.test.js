// Glide, turned and zoomed sprites, and textured rows and columns (D475-D477).
// The promise these keep: the framebuffer a check sees is drawn exactly as before,
// and the glide picture is the same drawing on a finer grid.
import { test } from "node:test";
import assert from "node:assert/strict";
import { headless } from "../src/headless.js";
import { FineBuffer, fineFactor } from "../src/fine.js";
import { Framebuffer, H, W, makeSprite } from "../src/gfx.js";
import { fineForScale } from "../src/host.js";
import { DARKER, RGB, SHADES, shadeTable } from "../src/palette.js";
import { createRng } from "../src/rng.js";
import { sprX, texCol, texRow } from "../src/xform.js";

const SHIP = makeSprite(["..77....", ".7887...", "78ff87..", "78ff8777", "78ff8777", "78ff87..", ".7887...", "..77...."]);
const ODD = makeSprite(["1.2", "345", ".6.", "7.8", "9ab"]);
const at = (/** @type {{ pixels: Uint8Array, w?: number }} */ b, x, y, w = W) => b.pixels[y * w + x];

/** The same random drawing on any buffer: every primitive, a camera and a clip, whole or fractional places. */
function scribble(buf, seed, whole) {
  const r = createRng(seed);
  const n = (/** @type {number} */ m) => (whole ? Math.floor(r() * m) : Math.round(r() * m * 4) / 4) - 8;
  buf.reset();
  buf.cls(1);
  for (let i = 0; i < 300; i++) {
    const c = 2 + Math.floor(r() * 30);
    switch (Math.floor(r() * 12)) {
      case 0:
        buf.pset(n(W), n(H), c);
        break;
      case 1:
        buf.line(n(W), n(H), n(W), n(H), c);
        break;
      case 2:
        buf.rect(n(W), n(H), n(60), n(60), c);
        break;
      case 3:
        buf.rectfill(n(W), n(H), n(60), n(60), c);
        break;
      case 4:
        buf.circ(n(W), n(H), n(30), c);
        break;
      case 5:
        buf.circfill(n(W), n(H), n(30), c);
        break;
      case 6:
        buf.text(`Hi ${i}\ny`, n(W), n(H), c, { scale: 1 + Math.floor(r() * 3), align: /** @type {const} */ (["left", "center", "right"])[Math.floor(r() * 3)] });
        break;
      case 7:
        buf.spr(SHIP, n(W), n(H), { flipX: r() < 0.5, flipY: r() < 0.5, scale: 1 + Math.floor(r() * 3), color: r() < 0.3 ? c : undefined });
        break;
      case 8:
        buf.camera(n(40), n(40));
        break;
      case 9:
        if (r() < 0.5) buf.clip(n(W), n(H), n(W), n(H));
        else buf.clip();
        break;
      case 10:
        sprX(buf, r() < 0.5 ? SHIP : ODD, n(W), n(H), { rot: r() * 7, zoom: 0.5 + r() * 3, zoomX: 0.5 + r(), flipX: r() < 0.5, pivot: [r(), r()], shade: Math.floor(r() * 3) });
        break;
      default:
        if (r() < 0.5) texRow(buf, SHIP, n(W), n(H), n(120), r() * 40 - 20, r() * 40 - 20, r() * 2 - 1, r() * 2 - 1, Math.floor(r() * 3));
        else texCol(buf, SHIP, n(W), n(H), n(120), r() * 40 - 20, r() * 40 - 20, r() * 2 - 1, Math.floor(r() * 3));
    }
  }
}

test("a glide buffer of one pixel per pixel draws exactly what the framebuffer draws", () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const lo = new Framebuffer();
    const fine = new FineBuffer(1);
    scribble(lo, seed, seed % 2 === 0);
    scribble(fine, seed, seed % 2 === 0);
    assert.deepEqual(fine.pixels, lo.pixels, `seed ${seed}`);
  }
});

test("at whole-pixel places the glide picture is the framebuffer, each pixel a k x k block", () => {
  for (const k of [2, 3, 4]) {
    const lo = new Framebuffer();
    const fine = new FineBuffer(k);
    scribble(lo, 11, true);
    scribble(fine, 11, true);
    let diff = 0;
    for (let y = 0; y < H * k; y++) for (let x = 0; x < W * k; x++) if (fine.pixels[y * W * k + x] !== lo.pixels[Math.floor(y / k) * W + Math.floor(x / k)]) diff++;
    assert.equal(diff, 0, `k=${k}`);
  }
});

test("a fraction of a pixel moves the glide picture and not the framebuffer", () => {
  const lo = new Framebuffer();
  const fine = new FineBuffer(4);
  for (const b of [lo, fine]) {
    b.cls(0);
    b.rectfill(10.5, 20.25, 2, 1, 7);
    b.camera(0.75, 0);
    b.pset(40, 40, 9);
  }
  assert.equal(at(lo, 10, 20), 7);
  assert.equal(at(lo, 12, 20), 0);
  assert.equal(at(lo, 40, 40), 9, "camera 0.75 floors to 0");
  // 10.5 px is buffer column 42; the block is 8 wide and 4 tall from row 81.
  assert.equal(at(fine, 41, 81, W * 4), 0);
  assert.equal(at(fine, 42, 81, W * 4), 7);
  assert.equal(at(fine, 49, 84, W * 4), 7);
  assert.equal(at(fine, 50, 81, W * 4), 0);
  assert.equal(at(fine, 42, 85, W * 4), 0);
  // The camera's 0.75 px is 3 buffer pixels.
  assert.equal(at(fine, 157, 160, W * 4), 9);
  assert.equal(at(fine, 160, 160, W * 4), 9);
  assert.equal(at(fine, 161, 160, W * 4), 0);
});

test("the glide picture is never more than a pixel from the framebuffer's", () => {
  const lo = new Framebuffer();
  const fine = new FineBuffer(4);
  for (let i = 0; i < 40; i++) {
    const x = 20 + i * 0.37;
    const cam = i * 0.61;
    for (const b of [lo, fine]) {
      b.reset();
      b.cls(0);
      b.camera(cam, 0);
      b.rectfill(x, 50, 1, 1, 5);
    }
    const lx = lo.pixels.indexOf(5) % W;
    const fx = (fine.pixels.indexOf(5) % (W * 4)) / 4;
    assert.ok(Math.abs(fx - lx) < 1, `x ${x} cam ${cam}: framebuffer ${lx}, glide ${fx}`);
  }
});

/** A cart whose ship drifts by a quarter pixel a frame; `glide` is the only difference. */
const drifter = (glide) => ({
  init: (g) => {
    if (glide) g.glide();
    return { x: 10, ship: g.sprite(["77", "77"]) };
  },
  update: (g, s) => {
    s.x += 0.25;
  },
  draw: (g, s) => {
    g.cls(1);
    g.camera(s.x / 3, 0);
    g.rectfill(0, 100, 400, 4, 17);
    g.spr(s.ship, s.x * 2, 60);
    g.camera();
    g.text(`X ${Math.floor(s.x)}`, 2, 2, 5);
  },
  probe: (g, s) => ({ x: s.x }),
});

test("g.glide() changes nothing a check can see: frames and hashes are the same with it and without", async () => {
  const plain = await headless(drifter(false));
  const glide = await headless(drifter(true), { fine: 4 });
  const noBuffer = await headless(drifter(true));
  for (let i = 0; i < 30; i++) {
    await Promise.all([plain.step(3), glide.step(3), noBuffer.step(3)]);
    const want = (await plain.frame()).hash;
    assert.equal((await glide.frame()).hash, want, `frame ${i * 3}`);
    assert.equal((await noBuffer.frame()).hash, want, `frame ${i * 3}`);
  }
});

test("the glide picture exists only for a cart that asks and a run that has a buffer", async () => {
  const cases = /** @type {const} */ ([[false, 4, false], [true, undefined, false], [true, 1, false], [true, 4, true], [true, 3, true]]);
  for (const [asks, fine, expected] of cases) {
    const t = await headless(drifter(asks), { fine });
    await t.step(1);
    const f = t.machine().fine;
    assert.equal(f !== null, expected, `asks ${asks}, fine ${fine}`);
    assert.equal(t.machine().glides, asks);
    if (f) {
      assert.equal(f.k, fine);
      assert.equal(f.pixels.length, W * H * f.k * f.k);
    }
  }
});

test("a gliding ship moves a display pixel at a time where the framebuffer's waits for a whole one", async () => {
  const t = await headless(drifter(true), { fine: 4 });
  const m = t.machine();
  const shipX = (/** @type {Uint8Array} */ px, /** @type {number} */ w, /** @type {number} */ row) => px.subarray(row * w, (row + 1) * w).indexOf(7);
  const lo = [];
  const fine = [];
  for (let i = 0; i < 12; i++) {
    await t.step(1);
    lo.push(shipX(m.pixels, W, 60));
    fine.push(shipX(/** @type {any} */ (m.fine).pixels, W * 4, 240));
  }
  assert.equal(new Set(fine).size, 12, `the glide picture moved every frame: ${fine}`);
  assert.ok(new Set(lo).size <= 6, `the framebuffer moved on whole pixels only: ${lo}`);
  for (let i = 1; i < fine.length; i++) assert.ok(fine[i] - fine[i - 1] >= 1 && fine[i] - fine[i - 1] <= 2, `steps of a display pixel or two: ${fine}`);
});

test("a reset keeps the glide buffer, and setFine resizes or drops it", async () => {
  const t = await headless(drifter(true), { fine: 4 });
  await t.step(2);
  await t.reset();
  assert.equal(t.machine().fine?.k, 4);
  const m = t.machine();
  m.setFine(2);
  assert.equal(m.fine, null, "nothing to show until the next draw");
  m.draw();
  assert.equal(/** @type {any} */ (m).fine?.width, W * 2);
  m.setFine(1);
  m.draw();
  assert.equal(m.fine, null);
});

test("the glide buffer's size follows the screen's scale", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(fineForScale), [1, 1, 2, 3, 4, 5, 6, 1, 4, 3, 5, 1, 6]);
  assert.deepEqual([undefined, 0, 1, 2, 4.9, 8, 9, "x"].map(fineFactor), [1, 1, 1, 2, 4, 8, 1, 1]);
});

/** Draw on a clean framebuffer and return it. */
const drawn = (/** @type {(b: Framebuffer) => void} */ fn) => {
  const b = new Framebuffer();
  b.cls(0);
  fn(b);
  return b.pixels;
};

test("a sprite with no turn and no zoom draws the same through either path", () => {
  for (const s of [SHIP, ODD]) {
    for (const o of [{}, { flipX: true }, { flipY: true, scale: 3 }, { color: 9, scale: 2 }]) {
      for (const [x, y] of [[40, 50], [40.7, 50.2], [-3, 188]]) {
        assert.deepEqual(drawn((b) => sprX(b, s, x, y, { ...o, rot: 0, zoom: 1 })), drawn((b) => b.spr(s, x, y, o)), JSON.stringify({ o, x, y }));
      }
    }
  }
});

test("a quarter turn puts each pixel where a quarter turn puts it", () => {
  const p = drawn((b) => sprX(b, SHIP, 100, 100, { rot: Math.PI / 2 }));
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const want = SHIP.data[y * 8 + x];
    assert.equal(p[(100 + x) * W + (107 - y)], want < 0 ? 0 : want, `sprite pixel ${x},${y}`);
  }
  const back = drawn((b) => sprX(b, SHIP, 100, 100, { rot: Math.PI * 2 }));
  assert.deepEqual(back, drawn((b) => b.spr(SHIP, 100, 100)), "a full turn is no turn");
});

test("zoom grows a sprite from its pivot, in whole chunky pixels", () => {
  assert.deepEqual(drawn((b) => sprX(b, SHIP, 100, 100, { zoom: 2 })), drawn((b) => b.spr(SHIP, 96, 96, { scale: 2 })), "from the middle");
  assert.deepEqual(drawn((b) => sprX(b, SHIP, 100, 100, { zoom: 3, pivot: [0, 0] })), drawn((b) => b.spr(SHIP, 100, 100, { scale: 3 })), "from the corner");
  const feet = drawn((b) => sprX(b, SHIP, 100, 100, { zoomX: 2, zoomY: 0.5, pivot: [0.5, 1] }));
  const rows = new Set();
  const cols = new Set();
  feet.forEach((v, i) => {
    if (v) {
      rows.add(Math.floor(i / W));
      cols.add(i % W);
    }
  });
  assert.deepEqual([Math.min(...rows), Math.max(...rows)], [104, 107], "squashed to half height, standing on the same row");
  assert.deepEqual([Math.min(...cols), Math.max(...cols)], [96, 111], "stretched to twice the width, about the middle");
});

test("a turned sprite keeps its colors and roughly its size at any angle, and bad options draw nothing", () => {
  const count = (/** @type {Uint8Array} */ p) => p.reduce((n, v) => n + (v ? 1 : 0), 0);
  const solid = count(drawn((b) => b.spr(SHIP, 100, 100)));
  for (let a = 0; a < 6.3; a += 0.37) {
    const p = drawn((b) => sprX(b, SHIP, 100, 100, { rot: a }));
    assert.ok(Math.abs(count(p) - solid) <= 8, `angle ${a}: ${count(p)} pixels, ${solid} unturned`);
    for (const v of p) assert.ok(v === 0 || v === 7 || v === 8 || v === 15, `angle ${a}: color ${v}`);
  }
  for (const o of [{ zoom: 0 }, { zoom: -1 }, { zoom: NaN }, { zoomX: 0 }, { pivot: /** @type {any} */ ([NaN, 0]) }]) assert.equal(count(drawn((b) => sprX(b, SHIP, 100, 100, o))), 0, JSON.stringify(o));
  assert.ok(count(drawn((b) => sprX(b, SHIP, 100, 100, { zoom: 1e9 }))) > 0, "a huge zoom is capped, not a hang");
  assert.throws(() => sprX(new Framebuffer(), /** @type {any} */ (null), 0, 0, { rot: 1 }), /needs a sprite/);
});

test("texRow copies a row of a sprite, steps through it, wraps and shades", () => {
  const p = drawn((b) => {
    texRow(b, SHIP, 10, 5, 8, 0, 3, 1, 0); // row 3 as it is
    texRow(b, SHIP, 10, 6, 20, 0, 3, 1, 0); // wraps past the edge
    texRow(b, SHIP, 10, 7, 16, 0, 3, 0.5, 0); // each pixel twice
    texRow(b, SHIP, 10, 8, 8, -8, -5, 1, 0); // negative places wrap too
    texRow(b, SHIP, 10, 9, 8, 0, 3, 1, 0, 1); // a step darker
    texRow(b, SHIP, 250, 10, 20, 0, 3, 1, 0); // off the right edge
    texRow(b, SHIP, 10, 11, 8, 0, 0, 1, 0); // row 0 has holes
  });
  const row = (y, x0, n) => Array.from(p.subarray(y * W + x0, y * W + x0 + n));
  const r3 = [7, 8, 15, 15, 8, 7, 7, 7];
  assert.deepEqual(row(5, 10, 8), r3);
  assert.deepEqual(row(6, 10, 20), [...r3, ...r3, ...r3.slice(0, 4)]);
  assert.deepEqual(row(7, 10, 16), r3.flatMap((v) => [v, v]));
  assert.deepEqual(row(8, 10, 8), r3);
  assert.deepEqual(row(9, 10, 8), r3.map((v) => DARKER[v]));
  assert.deepEqual(row(10, 250, 6), r3.slice(0, 6));
  assert.deepEqual(row(11, 10, 8), [0, 0, 7, 7, 0, 0, 0, 0], "transparent pixels are left alone");
});

test("texCol copies a column of a sprite, stretched, and clips at the top and bottom", () => {
  const p = drawn((b) => {
    texCol(b, SHIP, 20, 30, 8, 2, 0, 1); // column 2 as it is
    texCol(b, SHIP, 21, 30, 16, 2, 0, 0.5); // twice as tall
    texCol(b, SHIP, 22, -4, 8, 2, 0, 1); // starts above the screen
    texCol(b, SHIP, 23, 188, 8, 2, 0, 1); // runs off the bottom
    texCol(b, SHIP, 24, 30, 8, 2, 0, 1, 2); // two steps darker
  });
  const col = (x, y0, n) => Array.from({ length: n }, (_, j) => p[(y0 + j) * W + x]);
  const c2 = [7, 8, 15, 15, 15, 15, 8, 7].map((v, y) => SHIP.data[y * 8 + 2]);
  assert.deepEqual(c2, [7, 8, 15, 15, 15, 15, 8, 7]);
  assert.deepEqual(col(20, 30, 8), c2);
  assert.deepEqual(col(21, 30, 16), c2.flatMap((v) => [v, v]));
  assert.deepEqual(col(22, 0, 4), c2.slice(4));
  assert.deepEqual(col(23, 188, 4), c2.slice(0, 4));
  assert.deepEqual(col(24, 30, 8), c2.map((v) => SHADES[2][v]));
});

test("wild numbers draw nothing and never throw or hang", () => {
  for (const b of [new Framebuffer(), new FineBuffer(4)]) {
    for (const v of [NaN, Infinity, -Infinity, 1e12, -1e12]) {
      texRow(b, SHIP, v, 5, 8, 0, 0, 1, 0);
      texRow(b, SHIP, 5, v, 8, 0, 0, 1, 0);
      texRow(b, SHIP, 5, 5, v, 0, 0, 1, 0);
      texRow(b, SHIP, 5, 5, 8, v, v, v, v);
      texCol(b, SHIP, v, 5, 8, 0, 0, 1);
      texCol(b, SHIP, 5, v, 8, 0, 0, 1);
      texCol(b, SHIP, 5, 5, v, 0, 0, 1);
      texCol(b, SHIP, 5, 5, 8, v, v, v);
      sprX(b, SHIP, v, v, { rot: 1 });
      sprX(b, SHIP, 5, 5, { rot: v });
      if (b instanceof FineBuffer) {
        b.spr(SHIP, v, v);
        b.rectfill(v, v, 4, 4, 3);
        b.line(v, 0, 10, v, 3);
        b.circfill(v, v, 3, 3);
        b.camera(v, v);
        b.pset(1, 1, 3);
        b.camera();
      }
    }
  }
});

test("every color gets darker in luminance down to black, and five steps reaches black", () => {
  const lum = (/** @type {number} */ c) => 0.3 * RGB[c][0] + 0.59 * RGB[c][1] + 0.11 * RGB[c][2];
  for (let c = 0; c < 32; c++) {
    if (c > 0) assert.ok(lum(DARKER[c]) < lum(c), `${c} -> ${DARKER[c]}`);
    assert.equal(SHADES[5][c], 0, `color ${c} after five steps`);
    assert.equal(SHADES[0][c], c);
  }
  assert.equal(shadeTable(99), SHADES[5]);
  assert.equal(shadeTable(-2), SHADES[0]);
  assert.equal(shadeTable(undefined), SHADES[0]);
});

test("g.spr, g.texRow and g.texCol reach a cart, and a bad sprite is a clear error", async () => {
  const cart = {
    init: (g) => ({ s: g.sprite(["12", "34"]) }),
    update: () => {},
    draw: (g, s) => {
      g.cls(0);
      g.spr(s.s, 10, 10, { rot: Math.PI, pivot: [0.5, 0.5] });
      g.texRow(s.s, 20, 10, 4, 0, 0, 1, 0);
      g.texCol(s.s, 30, 10, 4, 0, 0, 1);
      g.spr(s.s, 40, 10, { shade: 1, color: 5 });
    },
  };
  const t = await headless(cart);
  const f = await t.frame();
  const px = (x, y) => f.pixels[y * W + x];
  assert.deepEqual([px(10, 10), px(11, 10), px(10, 11), px(11, 11)], [4, 3, 2, 1], "half a turn");
  assert.deepEqual([px(20, 10), px(21, 10), px(22, 10), px(23, 10)], [1, 2, 1, 2]);
  assert.deepEqual([px(30, 10), px(30, 11), px(30, 12), px(30, 13)], [1, 3, 1, 3]);
  assert.equal(px(40, 10), 4, "white, a step darker");
  await assert.rejects(headless({ init: () => ({}), update: () => {}, draw: (g) => g.texRow(/** @type {any} */ (null), 0, 0, 4, 0, 0, 1, 0) }), /g\.texRow\(\) needs a sprite/);
});
