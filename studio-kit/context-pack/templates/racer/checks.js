// @ts-check
/** Hold the pedal and steer round the ring: aim along the road, and back toward its middle when off it. */
const drive = (p) => {
  const want = Math.atan2(p.car.y - p.mid, p.car.x - p.mid) + Math.PI / 2 + (p.far - p.road) * 0.05;
  const off = Math.atan2(Math.sin(want - p.car.angle), Math.cos(want - p.car.angle));
  return off > 0.04 ? "a right" : off < -0.04 ? "a left" : "a";
};

/** @type {Arcade.Checks} */
export default {
  async R1(t) {
    const { near, ok } = t.bot;
    await t.bot.start();
    for (let i = 1; i <= 15; i++) near((await t.bot.hold("a", 1)).car.speed, 0.03 * i, `speed after ${i} frames of A`);
    for (let i = 1; i <= 5; i++) near((await t.bot.wait(1)).car.speed, 0.45 - 0.02 * i, `speed ${i} frames after letting go`);
    near((await t.bot.wait(40)).car.speed, 0, "speed after coasting to a stop");
    let p = await t.bot.reach(drive, (q) => q.car.speed >= 2, "top speed on the road", { every: 1 });
    for (let i = 0; i < 20; i++) {
      p = await t.bot.play(drive, { max: 5, every: 1 }).then((r) => r.p);
      ok(p.car.speed <= 2 + 1e-9, `speed should never pass 2 (it was ${p.car.speed})`);
    }
  },

  async R2(t) {
    const { near } = t.bot;
    const a = await t.bot.start();
    for (let i = 1; i <= 12; i++) near((await t.bot.hold("right", 1)).car.turn, Math.min(0.04, 0.004 * i), `turn rate after ${i} frames of right`);
    const b = await t.probe();
    t.bot.ok(b.car.angle > a.car.angle, "holding right should turn the car to the right");
    near((await t.bot.hold("right", 10)).car.angle - b.car.angle, 0.4, "how far it turns in 10 frames at the full rate");
    near((await t.bot.wait(10)).car.turn, 0, "turn rate 10 frames after letting go");
    near((await t.bot.hold("left", 10)).car.turn, -0.04, "turn rate after 10 frames of left");
  },

  async R3(t) {
    await t.bot.start();
    const off = await t.bot.reach(() => "a", (q) => !q.onRoad, "the grass, by driving straight on");
    t.bot.ok(off.car.speed > 0.8, `it should still be going fast when it leaves the road (${off.car.speed})`);
    const p = await t.bot.hold("a", 60);
    t.bot.ok(!p.onRoad, "it should still be on the grass");
    t.bot.near(p.car.speed, 0.8, "speed on the grass with A held");
  },

  async R4(t) {
    await t.bot.start();
    let p = await t.bot.reach(drive, (q) => q.laps >= 1, "the end of the first lap", { every: 1 });
    t.bot.eq([p.laps, p.score], [1, 100], "laps and score after one lap");
    p = await t.bot.reach(drive, (q) => q.laps >= 2, "the end of the second lap", { every: 1 });
    t.bot.eq(p.score, 200, "score after two laps");
    t.bot.ok(p.onRoad, "the bot should have stayed on the road");
  },

  async R5(t) {
    const a = await t.bot.start();
    t.bot.eq(a.left, 3600 - 1, "frames left after the first frame of play");
    t.bot.eq((await t.bot.wait(3590)).mode, "play", "mode with 9 frames left");
    t.bot.eq((await t.bot.wait(39)).mode, "over", "mode 30 frames after the time ran out");
    t.bot.eq(await t.scores(), [0], "the score reported for a race with no laps");
  },
};
