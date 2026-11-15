// @ts-check
const right = () => "right";

/** @type {Arcade.Checks} */
export default {
  async R1(t) {
    const { near } = t.bot;
    await t.bot.start();
    for (let i = 1; i <= 12; i++) near((await t.bot.hold("right", 1)).vx, Math.min(2, 0.2 * i), `speed after ${i} frames of holding right`);
    for (let i = 1; i <= 11; i++) near((await t.bot.wait(1)).vx, Math.max(0, 2 - 0.2 * i), `speed ${i} frames after letting go`);
    near((await t.bot.hold("left", 3)).vx, -0.6, "speed after 3 frames of holding left");
  },

  async R2(t) {
    const a = await t.bot.start();
    t.bot.ok(a.onGround, "the runner should start standing on the ground");
    const up = await t.bot.press("a", 8);
    t.bot.ok(!up.onGround && up.y < a.y - 12, `8 frames after A the runner should be in the air, above y ${a.y - 12} (y ${up.y})`);
    const down = await t.bot.wait(60);
    t.bot.ok(down.onGround, "the runner should have landed 60 frames later");
    t.bot.eq(down.y, a.y, "y after landing");
  },

  async R3(t) {
    const a = await t.bot.start();
    const p = await t.bot.reach(right, (q) => q.stars < a.stars, "the first star");
    t.bot.eq([p.score, p.stars], [10, a.stars - 1], "score and stars left after one star");
  },

  async R4(t) {
    let p = await t.bot.start();
    await t.poke({ lives: 99 });
    const seen = (q, what) => {
      t.bot.ok(q.x >= q.cam && q.x + 10 <= q.cam + q.W, `${what}: the runner (x ${q.x}) should be on screen (${q.cam} to ${q.cam + q.W})`);
      t.bot.ok(q.cam >= 0 && q.cam + q.W <= q.world, `${what}: the screen (${q.cam} to ${q.cam + q.W}) should be inside the world (0 to ${q.world})`);
    };
    for (let i = 0; i < 50; i++) seen((p = await t.bot.hold("right a", 10)), `running right, frame ${i * 10}`);
    await t.poke({ x: p.world - 40 }); // past the flag
    await t.bot.wait(60); // the jump there isn't play: let the screen catch up
    for (let i = 0; i < 8; i++) seen((p = await t.bot.hold("right", 10)), "at the far end");
    t.bot.near(p.cam, p.world - p.W, "the screen's left edge at the far end", 0.5);
  },

  async R5(t) {
    const a = await t.bot.start();
    const p = await t.bot.reach(right, (q) => q.lives < 3, "the spikes");
    t.bot.eq([p.lives, p.x, p.cam], [2, a.x, 0], "lives, and the runner and screen back at the start");
    await t.poke({ x: 30.5 * 16 }); // over the pit
    const q = await t.bot.reach(() => "", (r) => r.lives < 2, "the bottom of the pit");
    t.bot.eq([q.lives, q.x], [1, a.x], "lives and x after falling down the pit");
  },

  async R6(t) {
    t.bot.eq((await t.bot.start()).lives, 3, "lives at the start");
    await t.bot.reach(right, (q) => q.lives === 0, "0 lives", { anyMode: true });
    const p = await t.bot.wait(30);
    t.bot.eq([p.mode, p.won], ["over", false], "mode and won 30 frames after the last life");
  },

  async R7(t) {
    const a = await t.bot.start();
    await t.poke({ x: a.flag - 40 });
    const p = await t.bot.reach(right, (q) => q.won, "the flag", { anyMode: true });
    t.bot.eq([p.score, p.mode, p.lives], [50, "over", 3], "score, mode and lives at the flag");
  },
};
