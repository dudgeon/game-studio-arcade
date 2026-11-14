import { test } from "node:test";
import assert from "node:assert/strict";
import { headless } from "../../src/headless.js";
import { DARKER } from "../../src/palette.js";

const W = 256;
const H = 192;
async function shot(fn) {
  const t = await headless({ init: (g) => ({ made: fn.init?.(g) }), update: () => {}, draw: (g, s) => (g.cls(0), fn(g, s.made)) });
  return /** @type {Uint8Array} */ ((await t.frame()).pixels);
}
const TILES = { g: ["hh", "hh"], r: ["33", "33"], x: ["77", "77"] };
// A 16x16 floor: green, with a gray road up the middle and one red tile.
const MAP = ["gggrrggg", "gggrrggg", "gggrrggg", "gggrxggg", "gggrrggg", "gggrrggg", "gggrrggg", "gggrrggg"];
const GREEN = 17;
const GRAY = 3;
const RED = 7;

test("texture builds one sprite from a map of tiles, and says what's wrong with a bad one", async () => {
  /** @type {any} */
  let tex;
  await shot(Object.assign(() => {}, { init: (g) => (tex = g.lib.floor.texture(g, MAP, TILES)) }));
  assert.deepEqual([tex.w, tex.h], [16, 16]);
  assert.equal(tex.data[0], GREEN);
  assert.equal(tex.data[6 * 16 + 8], RED);
  assert.equal(tex.data[6 * 16 + 6], GRAY);
  const bad = (map, tiles) => shot(Object.assign(() => {}, { init: (g) => g.lib.floor.texture(g, map, tiles) }));
  await assert.rejects(bad(["g?"], TILES), /the map has "\?" but there's no tile for it/);
  await assert.rejects(bad(["gr"], { g: ["hh", "hh"], r: ["333", "333", "333"] }), /tile "r" isn't 2 by 2/);
  await assert.rejects(bad(["g"], {}), /at least one tile/);
});

const cam = { x: 8, y: 30, angle: -Math.PI / 2, height: 8, horizon: 70 }; // on the road, looking up the map

test("the floor fills from the horizon down and leaves the sky alone", async () => {
  const draw = Object.assign((g, tex) => g.lib.floor.draw(g, cam, tex), { init: (g) => g.lib.floor.texture(g, MAP, TILES) });
  const px = await shot(draw);
  for (let i = 0; i < 70 * W; i++) assert.equal(px[i], 0, "nothing above the horizon");
  for (let i = 70 * W; i < H * W; i++) assert.ok(px[i] === GREEN || px[i] === GRAY || px[i] === RED, `floor colors only, got ${px[i]}`);
  // Looking straight up the road: the middle of the bottom row is road, the edges grass.
  assert.equal(px[(H - 1) * W + W / 2], GRAY);
  assert.equal(px[(H - 1) * W + 4], GREEN);
  assert.equal(px[(H - 1) * W + W - 5], GREEN);
  // The road narrows with distance.
  const roadWidth = (y) => {
    let n = 0;
    for (let x = W / 2; x < W && px[y * W + x] !== GREEN; x++) n++;
    return n;
  };
  assert.ok(roadWidth(H - 1) > roadWidth(130) && roadWidth(130) > roadWidth(90), `${roadWidth(H - 1)} > ${roadWidth(130)} > ${roadWidth(90)}`);
});

test("project says where a place on the floor is drawn: the floor's pixel there has that place's color", async () => {
  /** @type {any} */
  let p;
  /** @type {any[]} */
  const others = [];
  const draw = Object.assign(
    (g, tex) => {
      const { floor } = g.lib;
      floor.draw(g, cam, tex);
      p = floor.project(g, cam, 9, 7); // the middle of the red tile
      others.push(floor.project(g, cam, 8, 40), floor.project(g, cam, 8, 29.5), floor.project(g, cam, 2, 7), floor.project(g, cam, 14, 7), floor.project(g, cam, 8, 10), floor.project(g, cam, 8, 20));
    },
    { init: (g) => g.lib.floor.texture(g, MAP, TILES) },
  );
  const px = await shot(draw);
  assert.ok(p && p.y > 70 && p.y < H, JSON.stringify(p));
  assert.equal(px[Math.floor(p.y) * W + Math.floor(p.x)], RED);
  assert.ok(Math.abs(p.depth - 23) < 1e-9, "23 floor pixels ahead");
  const [behind, tooNear, left, right, far, nearer] = others;
  assert.equal(behind, null);
  assert.equal(tooNear, null);
  assert.ok(left.x < W / 2 && right.x > W / 2, "left is left and right is right");
  assert.ok(Math.abs(left.x + right.x - W) < 1e-6, "evenly");
  assert.ok(Math.abs(far.x - W / 2) < 1e-6 && far.y < nearer.y && far.zoom < nearer.zoom, "farther is higher up and smaller");
  assert.ok(Math.abs(nearer.zoom * nearer.depth - far.zoom * far.depth) < 1e-6, "zoom falls off with distance");
});

test("turning turns the floor, and fog darkens the distance in steps", async () => {
  const init = (g) => g.lib.floor.texture(g, MAP, TILES);
  const side = await shot(Object.assign((g, tex) => g.lib.floor.draw(g, { ...cam, angle: 0 }, tex), { init }));
  // Facing along +x from the road, the road runs across the view: a near row is one color all the way.
  assert.equal(new Set(side.subarray((H - 1) * W, H * W)).size, 1);
  const fog = await shot(Object.assign((g, tex) => g.lib.floor.draw(g, cam, tex, { fog: 20 }), { init }));
  assert.equal(fog[(H - 1) * W + W / 2], GRAY, "near: as it is");
  const farRow = Array.from(fog.subarray(72 * W, 73 * W));
  const dark = (c, n) => (n ? dark(DARKER[c], n - 1) : c);
  assert.ok(farRow.every((v) => [GREEN, GRAY, RED].some((c) => v === dark(c, 5))), "far: five steps darker (black)");
  const mid = fog[100 * W + 4];
  assert.ok(mid !== GREEN && mid !== 0, `in between: some steps darker (${mid})`);
});

test("haze fades the distance into a color in a dither, and far things can be left out", async () => {
  const init = (g) => g.lib.floor.texture(g, MAP, TILES);
  const px = await shot(Object.assign((g, tex) => g.lib.floor.draw(g, cam, tex, { fog: 20, haze: 25 }), { init }));
  const hazed = (y) => Array.from(px.subarray(y * W, (y + 1) * W)).filter((v) => v === 25).length;
  assert.equal(hazed(H - 1), 0, "near: none");
  assert.equal(hazed(71), W, "far: all haze");
  const mids = [92, 108, 140, 180].map((y) => hazed(y) + hazed(y + 1) + hazed(y + 2) + hazed(y + 3)); // a whole 4-row pattern each
  assert.ok(mids[0] > mids[1] && mids[1] > mids[2] && mids[2] === 0 && mids[3] === 0, `thinning toward you, and clear up close: ${mids}`);
  assert.ok(mids[1] > 0 && mids[1] < 4 * W && mids[1] % (W / 4) === 0, "an even pattern, not noise");
  for (let i = 70 * W; i < H * W; i++) assert.ok([GREEN, GRAY, RED, 25].includes(px[i]), "no darkening with haze");
  const art = (g) => g.sprite(["77", "77"]);
  const count = async (far) => (await shot(Object.assign((g, a) => g.lib.floor.sprites(g, cam, [{ spr: a, x: 8, y: 0 }, { spr: a, x: 8, y: -70 }], { far }), { init: art }))).filter((v) => v === 7).length;
  assert.ok((await count(undefined)) > (await count(50)) && (await count(50)) > 0, "the one 100 away is left out at far 50");
});

test("the sky is bands of color with a strip on the horizon that slides as you turn", async () => {
  const init = (g) => g.sprite(["5...", "5555"]);
  const at = async (angle) => shot(Object.assign((g, strip) => g.lib.floor.sky(g, { ...cam, angle }, [22, 23, 24], strip), { init }));
  const a = await at(0);
  assert.deepEqual([a[0], a[30 * W], a[60 * W + 7]], [22, 23, 24]);
  assert.ok(a.subarray(70 * W).every((v) => v === 0), "nothing below the horizon");
  assert.ok(Array.from(a.subarray(69 * W, 70 * W)).every((v) => v === 5), "the strip's bottom row sits on the horizon");
  const posts = (px) => Array.from(px.subarray(68 * W, 69 * W)).flatMap((v, x) => (v === 5 ? [x] : []));
  assert.deepEqual(posts(a).slice(0, 3), [0, 4, 8]);
  const b = await at(0.01);
  assert.notDeepEqual(posts(b).slice(0, 3), [0, 4, 8], "a small turn slides it");
  const noStrip = await shot((g) => g.lib.floor.sky(g, cam, [9]));
  assert.ok(noStrip.subarray(0, 70 * W).every((v) => v === 9));
});

test("sprites stand on the floor, far ones behind near ones, shrunk by distance", async () => {
  const init = (g) => ({ a: g.sprite(["77", "77", "77", "77"]), b: g.sprite(["88", "88", "88", "88"]) });
  /** @type {any} */
  let feet;
  const px = await shot(
    Object.assign(
      (g, art) => {
        const { floor } = g.lib;
        // Listed near first: the far one must still be drawn first.
        floor.sprites(g, cam, [
          { spr: art.b, x: 8, y: 6 },
          { spr: art.a, x: 8, y: -10 },
          { spr: art.a, x: 8, y: 60 },
          { spr: art.a, x: 5000, y: 20 },
        ]);
        feet = [floor.project(g, cam, 8, 6), floor.project(g, cam, 8, -10)];
      },
      { init },
    ),
  );
  const box = (c) => {
    const ys = [];
    const xs = [];
    px.forEach((v, i) => {
      if (v === c) {
        ys.push(Math.floor(i / W));
        xs.push(i % W);
      }
    });
    return { top: Math.min(...ys), bottom: Math.max(...ys), left: Math.min(...xs), right: Math.max(...xs) };
  };
  const near = box(8);
  const far = box(7);
  assert.ok(Math.abs(near.bottom + 1 - feet[0].y) < 1, `feet on the ground where project says: ${near.bottom + 1} vs ${feet[0].y}`);
  assert.ok(Math.abs((near.left + near.right + 1) / 2 - W / 2) <= 1, "centered on its place");
  const tall = (b) => b.bottom - b.top + 1;
  assert.ok(Math.abs(tall(near) - 4 * feet[0].zoom) <= 1, `4 pixels tall times the zoom: ${tall(near)} vs ${4 * feet[0].zoom}`);
  assert.ok(far.top < near.top, "the far one is higher up");
  // The far one's feet would be inside the near one: the near one covers them.
  assert.ok(feet[1].y > near.top + 1 && far.bottom < near.top, "and hidden where they overlap");
});
