import { test } from "node:test";
import assert from "node:assert/strict";
import { overlap, contains, hits, resolve, alive } from "../collide.js";

const box = (x, y, w = 10, h = 10, kind = "thing") => ({ x, y, w, h, kind });

test("overlap: overlapping, touching and apart", () => {
  assert.equal(overlap(box(0, 0), box(5, 5)), true);
  assert.equal(overlap(box(0, 0), box(10, 0)), false, "touching edges don't count");
  assert.equal(overlap(box(0, 0), box(0, 10)), false);
  assert.equal(overlap(box(0, 0), box(9, 9)), true);
  assert.equal(overlap(box(0, 0, 100, 100), box(40, 40, 2, 2)), true, "inside counts");
  assert.equal(overlap(box(0, 0), box(30, 30)), false);
});

test("contains: inclusive top-left, exclusive bottom-right", () => {
  const b = box(10, 10);
  assert.equal(contains(b, 10, 10), true);
  assert.equal(contains(b, 19, 19), true);
  assert.equal(contains(b, 20, 15), false);
  assert.equal(contains(b, 9, 15), false);
});

test("hits: pairs across lists, skipping dead and self", () => {
  const a = box(0, 0), b = box(5, 0), c = { ...box(5, 5), dead: true }, d = box(50, 50);
  assert.deepEqual(hits([a], [b, c, d]), [[a, b]]);
  const same = hits([a, b], [a, b]);
  assert.equal(same.length, 2, "each pair once each way, never with itself");
});

test("resolve: bullet and enemy both die, enemy kills player", () => {
  const bullet = box(0, 0, 2, 2, "bullet");
  const enemy = box(1, 1, 10, 10, "enemy");
  const enemy2 = box(100, 100, 10, 10, "enemy");
  const player = box(100, 105, 10, 10, "player");
  const things = [bullet, enemy, enemy2, player];
  const out = resolve(things, [
    { a: "bullet", b: "enemy", kill: "both" },
    { a: "enemy", b: "player", kill: "b" },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].a, bullet);
  assert.equal(out[0].b, enemy);
  assert.equal(out[1].b, player);
  assert.equal(bullet.dead, true);
  assert.equal(enemy.dead, true);
  assert.equal(enemy2.dead, undefined, "the killer survives a kill:'b' rule");
  assert.equal(player.dead, true);
  assert.deepEqual(alive(things), [enemy2]);
});

test("resolve: a bullet killed on its first hit doesn't kill a second enemy", () => {
  const bullet = box(5, 5, 2, 2, "bullet");
  const e1 = box(0, 0, 10, 10, "enemy");
  const e2 = box(4, 4, 10, 10, "enemy");
  const out = resolve([bullet, e1, e2], [{ a: "bullet", b: "enemy", kill: "both" }]);
  assert.equal(out.length, 1);
  assert.equal(e1.dead, true);
  assert.equal(e2.dead, undefined);
});

test("resolve: kill 'a' keeps b; kill 'none' only reports; a pierce bullet hits all", () => {
  const coin1 = box(0, 0, 4, 4, "coin");
  const coin2 = box(2, 2, 4, 4, "coin");
  const cat = box(0, 0, 10, 10, "cat");
  const out = resolve([cat, coin1, coin2], [{ a: "coin", b: "cat", kill: "a" }]);
  assert.equal(out.length, 2);
  assert.equal(cat.dead, undefined);
  assert.equal(coin1.dead && coin2.dead, true);

  const wall = box(0, 0, 10, 10, "wall");
  const ball = box(5, 5, 4, 4, "ball");
  assert.equal(resolve([ball, wall], [{ a: "ball", b: "wall", kill: "none" }]).length, 1);
  assert.equal(ball.dead || wall.dead, undefined);

  const laser = box(0, 0, 100, 2, "laser");
  const es = [box(10, 0, 5, 5, "enemy"), box(50, 0, 5, 5, "enemy")];
  assert.equal(resolve([laser, ...es], [{ a: "laser", b: "enemy", kill: "b" }]).length, 2);
  assert.equal(laser.dead, undefined);
});
