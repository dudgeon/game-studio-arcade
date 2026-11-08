// @ts-check
/** Move the paddle to meet the ball, or keep away from it. */
const aim = (t) => (p) => (p.ball ? t.bot.toward({ x: 0, y: p.pad.y + p.pad.h / 2 }, { x: 0, y: p.ball.y + 2 }, { axis: "y", dead: 3 }) : "");
const flee = (p) => (!p.ball ? "" : p.ball.y + 2 > p.pad.y + p.pad.h / 2 ? "up" : "down");

/** @type {Arcade.Checks} */
export default {
  async R1(t) {
    const { eq } = t.bot;
    const a = await t.bot.start();
    eq((await t.bot.hold("down", 10)).pad.y, a.pad.y + 30, "y after holding down 10 frames");
    const low = await t.bot.hold("down", 200);
    eq(low.pad.y, low.H - low.pad.h, "y at the bottom");
    const high = await t.bot.hold("up", 200);
    eq(high.pad.y, high.top, "y at the top");
  },

  async R2(t) {
    await t.bot.start();
    await t.poke({ lives: 99 });
    const seen = { top: false, bottom: false, right: false };
    let last = null;
    for (let n = 0; n < 3000 && !(seen.top && seen.bottom && seen.right); n++) {
      const p = await t.bot.hold("up", 1); // parked at the top, out of the way
      const b = p.ball;
      if (b) {
        t.bot.ok(b.y >= p.top && b.y <= p.H - 4 && b.x <= p.W - 4, `the ball went through a wall: (${b.x}, ${b.y})`);
        if (last?.vy < 0 && b.vy > 0 && b.y === p.top) seen.top = true;
        if (last?.vy > 0 && b.vy < 0 && b.y === p.H - 4) seen.bottom = true;
        if (last?.vx > 0 && b.vx < 0) seen.right = true;
      }
      last = b;
    }
    t.bot.eq(seen, { top: true, bottom: true, right: true }, "walls the ball bounced off");
  },

  async R3(t) {
    await t.bot.start();
    const p = await t.bot.reach(aim(t), (q) => q.score > 0 || q.lives < 3, "the ball", { every: 2 });
    t.bot.eq([p.score, p.lives], [1, 3], "score and lives after one swat");
    t.bot.ok(p.ball && p.ball.vx > 0, "after a swat the ball should head right");
    t.bot.ok((await t.sounds()).length > 0, "a swat should play a sound");
  },

  async R4(t) {
    await t.bot.start();
    const p = await t.bot.reach(flee, (q) => q.lives < 3, "a miss", { every: 2 });
    t.bot.eq([p.lives, p.ball], [2, null], "lives and ball after a miss");
    const q = await t.bot.reach(flee, (r) => r.ball !== null, "a new ball", { max: 60, every: 2 });
    t.bot.near(q.ball.x, q.W / 2, "where the new ball starts", 4);
  },

  async R5(t) {
    await t.bot.start();
    await t.bot.reach(flee, (q) => q.lives === 0, "0 lives", { max: 4000, every: 2 });
    t.bot.eq((await t.bot.wait(30)).mode, "over", "mode 30 frames after the last life");
  },

  async R6(t) {
    await t.bot.start();
    await t.poke({ lives: 99 });
    await t.bot.reach(aim(t), (q) => q.score >= 2, "a score of 2", { every: 2 });
    await t.poke({ lives: 1 });
    const end = await t.bot.reach(flee, (q) => q.mode === "over", "game over", { max: 4000, every: 2, anyMode: true });
    await t.reset({ keepSave: true });
    const p = await t.probe();
    t.bot.eq([p.mode, p.best], ["title", end.score], "mode and best after a restart");
  },
};
