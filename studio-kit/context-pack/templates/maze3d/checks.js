// @ts-check
const FACING = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };
/** Walk to the nearest gem by the shortest way: face the next tile on the way, then go forward. */
const seek = (t) => (p) => {
  const open = (x, y) => p.map[y]?.[x] === ".";
  const tile = (o) => ({ x: Math.floor(o.x), y: Math.floor(o.y) });
  const gem = t.bot.nearest(p.eye, p.gems);
  const step = gem ? t.bot.pathStep(open, tile(p.eye), tile(gem)) : "";
  // In the gem's own tile, head straight for it; otherwise for the middle of the next tile.
  const want = step ? FACING[step] : gem ? Math.atan2(gem.y - p.eye.y, gem.x - p.eye.x) : p.eye.angle;
  const off = Math.atan2(Math.sin(want - p.eye.angle), Math.cos(want - p.eye.angle));
  const turn = off > 0.06 ? "right" : off < -0.06 ? "left" : "";
  return Math.abs(off) > 0.5 ? turn : `up ${turn}`;
};

/** @type {Arcade.Checks} */
export default {
  async R1(t) {
    const { near } = t.bot;
    const a = await t.bot.start();
    for (let i = 1; i <= 12; i++) near((await t.bot.hold("right", 1)).turn, Math.min(0.045, 0.005 * i), `turn rate after ${i} frames of right`);
    const b = await t.probe();
    t.bot.ok(b.eye.angle > a.eye.angle, "holding right should turn to the right");
    near((await t.bot.hold("right", 10)).eye.angle - b.eye.angle, 0.45, "how far it turns in 10 frames at the full rate");
    near((await t.bot.wait(9)).turn, 0, "turn rate 9 frames after letting go");
    near((await t.bot.hold("left", 9)).turn, -0.045, "turn rate after 9 frames of left");
  },

  async R2(t) {
    const { near } = t.bot;
    const a = await t.bot.start();
    for (let i = 1; i <= 12; i++) near((await t.bot.hold("up", 1)).go, Math.min(0.06, 0.006 * i), `walking speed after ${i} frames of up`);
    const b = await t.probe();
    t.bot.ok(b.eye.x > a.eye.x && b.eye.y === a.eye.y, "up should walk the way it faces: to the right at the start");
    near((await t.bot.hold("up", 10)).eye.x - b.eye.x, 0.6, "tiles walked in 10 frames at full speed");
    near((await t.bot.wait(10)).go, 0, "walking speed 10 frames after letting go");
    near((await t.bot.hold("down", 10)).go, -0.06, "walking speed after 10 frames of down");
  },

  async R3(t) {
    let p = await t.bot.start();
    for (let i = 0; i < 90; i++) {
      p = await t.bot.hold(i % 9 < 2 ? "up right" : i % 9 < 3 ? "up left" : "up", 10);
      t.bot.ok(!p.inWall, `the walker is inside a wall at ${p.eye.x}, ${p.eye.y}`);
    }
    // Straight into the wall on the left of the start: it stops a body's width short of it.
    await t.reset();
    await t.bot.start();
    p = await t.bot.hold("down", 120);
    t.bot.near(p.eye.x, 1.25, "x after backing into the wall", 0.06);
  },

  async R4(t) {
    const a = await t.bot.start();
    const p = await t.bot.reach(seek(t), (q) => q.gems.length < a.gems.length, "the nearest gem", { every: 1 });
    t.bot.eq([p.score, p.gems.length], [10, a.gems.length - 1], "score and gems left after one gem");
  },

  async R5(t) {
    const a = await t.bot.start();
    t.bot.eq(a.gems.length, 5, "gems at the start");
    const p = await t.bot.reach(seek(t), (q) => q.won, "the last gem", { every: 1, max: 3400, anyMode: true });
    t.bot.eq([p.score, p.gems.length], [50, 0], "score and gems left after all five");
    t.bot.eq((await t.bot.wait(30)).mode, "over", "mode 30 frames after the last gem");
    t.bot.eq(await t.scores(), [50], "the score reported");
  },

  async R6(t) {
    const a = await t.bot.start();
    t.bot.eq(a.left, 3600 - 1, "frames left after the first frame of play");
    t.bot.eq((await t.bot.wait(3590)).mode, "play", "mode with 9 frames left");
    const p = await t.bot.wait(39);
    t.bot.eq([p.mode, p.won], ["over", false], "mode and won 30 frames after the time ran out");
  },
};
