import { test } from "node:test";
import assert from "node:assert/strict";
import { motion } from "../index.js";
import { asG, fakeG } from "./fake-g.js";

const near = (got, want, what, eps = 1e-9) => assert.ok(Math.abs(got - want) <= eps, `${what}: got ${got}, want ${want}`);

test("clamp, lerp, approach and damp", () => {
  assert.deepEqual([motion.clamp(5, 0, 3), motion.clamp(-1, 0, 3), motion.clamp(2, 0, 3)], [3, 0, 2]);
  assert.deepEqual([motion.lerp(10, 20, 0), motion.lerp(10, 20, 0.5), motion.lerp(10, 20, 1)], [10, 15, 20]);
  assert.deepEqual([motion.approach(0, 5, 2), motion.approach(4, 5, 2), motion.approach(5, 0, 2), motion.approach(1, 0, 2), motion.approach(3, 3, 2)], [2, 5, 3, 0, 3]);
  let v = 0;
  const steps = [];
  for (let i = 0; i < 200; i++) steps.push((v = motion.damp(v, 100, 0.2)));
  assert.equal(steps[0], 20);
  for (let i = 1; i < steps.length; i++) assert.ok(steps[i] >= steps[i - 1] && steps[i] <= 100, "closes the gap and never passes it");
  assert.equal(v, 100, "it arrives, exactly");
});

test("every easing starts at 0 and ends at 1; the plain ones never go back; back and elastic overshoot", () => {
  const kinds = /** @type {const} */ (["linear", "in", "out", "inOut", "back", "bounce", "elastic"]);
  for (const k of kinds) {
    near(motion.ease(0, k), 0, `${k} at 0`);
    near(motion.ease(1, k), 1, `${k} at 1`);
    assert.equal(motion.ease(-3, k), motion.ease(0, k), `${k} clamps below`);
    assert.equal(motion.ease(7, k), motion.ease(1, k), `${k} clamps above`);
    const ys = Array.from({ length: 101 }, (_, i) => motion.ease(i / 100, k));
    for (const y of ys) assert.ok(Number.isFinite(y) && y > -0.5 && y < 1.5, `${k} stays near 0..1`);
    if (k === "linear" || k === "in" || k === "out" || k === "inOut") for (let i = 1; i <= 100; i++) assert.ok(ys[i] >= ys[i - 1], `${k} never goes back`);
    if (k === "back" || k === "elastic") assert.ok(Math.max(...ys) > 1.02, `${k} overshoots`);
    if (k === "bounce") assert.ok(Math.max(...ys) <= 1 + 1e-9 && ys.some((y, i) => i > 0 && y < ys[i - 1]), "bounce comes back off the end");
  }
  assert.ok(motion.ease(0.25, "in") < 0.25 && motion.ease(0.25, "out") > 0.25);
  near(motion.ease(0.5, "inOut"), 0.5, "inOut is half way at half time");
  assert.throws(() => motion.ease(0.5, /** @type {any} */ ("wobble")), /unknown kind "wobble"/);
});

test("tween runs a value from a to b over a number of frames", () => {
  assert.equal(motion.tween(10, 50, 0, 20), 10);
  assert.equal(motion.tween(10, 50, 20, 20), 50);
  assert.equal(motion.tween(10, 50, 99, 20), 50, "holds the end");
  assert.equal(motion.tween(10, 50, 10, 20, "linear"), 30);
  assert.equal(motion.tween(10, 50, 3, 0), 50, "no frames is already there");
});

test("a spring overshoots, settles on the target exactly, and can be kicked", () => {
  const sp = { x: 0, v: 0 };
  let peak = 0;
  for (let i = 0; i < 300; i++) peak = Math.max(peak, motion.spring(sp, 10));
  assert.ok(peak > 10.2 && peak < 14, `overshoot ${peak}`);
  assert.deepEqual(sp, { x: 10, v: 0 });
  sp.v = 3;
  assert.ok(motion.spring(sp, 10) > 10, "a kick moves it");
  for (let i = 0; i < 300; i++) motion.spring(sp, 10);
  assert.deepEqual(sp, { x: 10, v: 0 });
  const stiff = { x: 0, v: 0 };
  const soft = { x: 0, v: 0 };
  motion.spring(stiff, 10, 0.5);
  motion.spring(soft, 10, 0.05);
  assert.ok(stiff.x > soft.x);
});

test("stick reads the stick as -1, 0 or 1 each way", () => {
  const f = fakeG();
  assert.deepEqual(motion.stick(asG(f)), { x: 0, y: 0 });
  f.press("right");
  f.press("up");
  assert.deepEqual(motion.stick(asG(f)), { x: 1, y: -1 });
  f.press("left");
  assert.deepEqual(motion.stick(asG(f)), { x: 0, y: -1 }, "left and right cancel");
  assert.deepEqual(motion.stick(asG(f), 2), { x: 0, y: 0 });
});

test("drive speeds a body up to its top speed and slows it to a stop; nothing is instant", () => {
  const b = motion.body(0, 0);
  const o = { max: 3, accel: 0.5, friction: 0.25 };
  const up = [];
  for (let i = 0; i < 8; i++) {
    motion.drive(b, 1, 0, o);
    up.push(b.vx);
  }
  assert.deepEqual(up, [0.5, 1, 1.5, 2, 2.5, 3, 3, 3]);
  const down = [];
  for (let i = 0; i < 13; i++) {
    motion.drive(b, 0, 0, o);
    down.push(b.vx);
  }
  assert.equal(down[0], 2.75);
  assert.equal(down[11], 0);
  assert.equal(down[12], 0);
  motion.drive(b, -1, null, o);
  assert.equal(b.vx, -0.5);
  b.vy = 4;
  motion.drive(b, null, null, o);
  assert.deepEqual([b.vx, b.vy], [-0.5, 4], "null leaves an axis alone");
  for (let i = 0; i < 20; i++) motion.drive(b, 0.5, null, o);
  assert.equal(b.vx, 1.5, "half stick, half speed");
  const d = motion.body(0, 0);
  motion.drive(d, 1, 1);
  assert.deepEqual([d.vx, d.vy], [0.25, 0.25], "defaults");
});

test("move adds gravity up to a top falling speed", () => {
  const b = motion.body(10, 0);
  b.vx = 1;
  const hit = motion.move(b, { gravity: 0.5, maxFall: 2 });
  assert.deepEqual([b.x, b.y, b.vy], [11, 0.5, 0.5]);
  assert.deepEqual(hit, { x: 0, y: 0 });
  for (let i = 0; i < 10; i++) motion.move(b, { gravity: 0.5, maxFall: 2 });
  assert.equal(b.vy, 2);
  const still = motion.body(3, 4);
  motion.move(still);
  assert.deepEqual([still.x, still.y], [3, 4]);
});

test("move stops a body flush against what's solid, says which side, and doesn't tunnel", () => {
  const floor = (x, y, w, h) => y + h > 100 || x + w > 200 || x < 0;
  const b = motion.body(50, 60.3, 8, 8);
  let landed = -1;
  for (let i = 0; i < 200 && landed < 0; i++) if (motion.move(b, { gravity: 0.37, solid: floor }).y === 1) landed = i;
  assert.ok(landed > 0, "it lands");
  assert.equal(b.y, 92, "resting on the floor, not above it");
  assert.equal(b.vy, 0);
  assert.equal(motion.move(b, { gravity: 0.37, solid: floor }).y, 1, "still standing next frame");
  assert.equal(b.y, 92);

  b.x = 190.4;
  b.vx = 5;
  assert.equal(motion.move(b, { solid: floor }).x, 1);
  assert.deepEqual([b.x, b.vx], [192, 0]);
  b.x = 150;
  b.vx = 60; // faster than the wall is anything: still stopped
  assert.equal(motion.move(b, { solid: floor }).x, 1);
  assert.equal(b.x, 192);
  b.vx = -400;
  for (let i = 0; i < 6; i++) motion.move(b, { solid: floor });
  assert.equal(b.x, 0, "never through the left wall");

  const up = motion.body(50, 20, 8, 8);
  up.vy = -3;
  const roof = (x, y) => y < 18.5;
  assert.equal(motion.move(up, { solid: roof }).y, -1, "a ceiling is -1");
  assert.equal(up.y, 19);
});

test("move with bounce comes back off the ground, a little lower each time, then rests", () => {
  const floor = (x, y, w, h) => y + h > 100;
  const b = motion.body(0, 20, 4, 4);
  const peaks = [];
  let top = 100;
  let bounces = 0;
  for (let i = 0; i < 1500; i++) {
    const hit = motion.move(b, { gravity: 0.3, solid: floor, bounce: 0.6 });
    top = Math.min(top, b.y);
    if (hit.y === 1 && b.vy < 0) {
      bounces++;
      peaks.push(top);
      top = 100;
    }
  }
  assert.ok(bounces >= 3, `bounced ${bounces} times`);
  for (let i = 2; i < peaks.length; i++) assert.ok(peaks[i] > peaks[i - 1], `each bounce is lower: ${peaks}`);
  assert.deepEqual([b.y, b.vy], [96, 0], "and it comes to rest");
});

test("bounce keeps a body in a box and turns it round", () => {
  const box = { x: 0, y: 10, w: 100, h: 80 };
  const b = motion.body(98, 50, 4, 4);
  b.vx = 3;
  b.vy = -1;
  motion.move(b);
  assert.deepEqual(motion.bounce(b, box, 0.5), { x: 1, y: 0 });
  assert.deepEqual([b.x, b.vx], [96, -1.5]);
  b.y = 5;
  assert.deepEqual(motion.bounce(b, box, 1), { x: 0, y: -1 });
  assert.deepEqual([b.y, b.vy], [10, 1]);
  b.x = -3;
  b.y = 200;
  b.vx = -2;
  b.vy = 2;
  assert.deepEqual(motion.bounce(b, box), { x: -1, y: 1 });
  assert.deepEqual([b.x, b.y], [0, 86]);
  assert.ok(b.vx > 0 && b.vy < 0);
  assert.deepEqual(motion.bounce(motion.body(50, 50), box), { x: 0, y: 0 });
});

test("mapHit says whether a box touches a solid tile", () => {
  const MAP = ["....", ".#..", "..=.", "####"];
  const hit = (x, y, w, h, solid) => motion.mapHit(MAP, 8, x, y, w, h, solid);
  assert.equal(hit(0, 0, 8, 8), false);
  assert.equal(hit(8, 8, 8, 8), true);
  assert.equal(hit(0, 0, 8, 8.5), false, "beside it isn't in it");
  assert.equal(hit(1, 1, 7.5, 7.5), true);
  assert.equal(hit(16, 16, 8, 8), false, "= isn't solid by default");
  assert.equal(hit(16, 16, 8, 8, "#="), true);
  assert.equal(hit(0, 23.5, 4, 1), true, "the floor row");
  assert.equal(hit(-50, -50, 8, 8), false, "off the map is open");
  assert.equal(hit(100, 100, 8, 8), false);
  assert.equal(hit(-4, 24, 8, 8), true, "partly off still hits what's on");
});
