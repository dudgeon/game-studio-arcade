// @ts-check
/** Steer away from the comet closest ahead, or toward it. */
const ahead = (p) => p.comets.filter((c) => c.x > p.ship.x - 8 && c.x < p.ship.x + 48);
const chase = (t) => (p) => {
  const c = t.bot.nearest(p.ship, ahead(p));
  return c ? t.bot.toward(p.ship, c, { axis: "y", dead: 0 }) : "";
};

/** @type {Arcade.Checks} */
export default {
  async R1(t) {
    const { eq } = t.bot;
    const a = await t.bot.start();
    const b = await t.bot.hold("down", 10);
    eq(b.ship.y, a.ship.y + 20, "y after holding down 10 frames");
    eq((await t.bot.hold("right", 10)).ship.x, b.ship.x + 20, "x after holding right 10 frames");
    const d = await t.bot.hold("right down", 400);
    eq([d.ship.x, d.ship.y], [d.W - 8, d.H - 8], "the bottom-right corner");
  },

  async R2(t) {
    await t.bot.start();
    await t.poke({ lives: 99 });
    const p = await t.bot.wait(300);
    t.bot.eq(p.score, Math.floor(p.played / 60), `score after ${p.played} frames of play`);
  },

  async R3(t) {
    await t.bot.start();
    const hit = await t.bot.reach(chase(t), (p) => p.lives < 3, "a comet");
    t.bot.eq(hit.lives, 2, "lives after the first touch");
    t.bot.ok(hit.safe, "right after a hit the ship should be safe");
    const after = await t.bot.play(chase(t), { max: 84 });
    t.bot.eq(after.p.lives, 2, "lives during the 90 safe frames");
    const later = await t.bot.reach(chase(t), (p) => p.lives < 2, "a second comet");
    t.bot.eq(later.lives, 1, "lives after the safe time");
  },

  async R4(t) {
    await t.bot.start();
    await t.bot.reach(chase(t), (p) => p.lives === 0, "0 lives", { max: 4000 });
    t.bot.eq((await t.bot.wait(30)).mode, "over", "mode 30 frames after the last life");
  },

  async R5(t) {
    await t.bot.start();
    await t.poke({ lives: 999 });
    for (const at of [60, 610, 1210, 2410, 3010]) {
      const p = await t.bot.reach(() => "", (q) => q.played >= at && q.comets.length > 0, `frame ${at} with a comet`, { every: 10 });
      const c = p.comets.at(-1);
      const moved = await t.bot.delta((q) => q.comets.find((x) => x.y === c.y).x);
      const want = Math.min(3, 1 + 0.5 * Math.floor((p.played + 1) / 600));
      t.bot.near(-moved, want, `pixels per frame at frame ${p.played + 1}`);
    }
  },
};
