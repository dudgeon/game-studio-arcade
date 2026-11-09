// @ts-check
/** @type {Arcade.Checks} */
export default {
  async R1(t) {
    const a = await t.bot.start();
    t.bot.eq((await t.bot.hold("right", 10)).x, a.x + 20, "x after holding right 10 frames");
    const end = await t.bot.hold("right down", 200);
    t.bot.eq([end.x, end.y], [end.W - end.size, end.H - end.size], "the bottom-right corner");
    const top = await t.bot.hold("left up", 200);
    t.bot.eq([top.x, top.y], [0, top.top], "the top-left corner");
  },

  async R2(t) {
    const a = await t.bot.start();
    const p = await t.bot.wait(a.left);
    t.bot.eq(p.mode, "over", "mode when the round's 1800 frames are up");
    t.bot.ok(p.score >= 29, `a whole round should score about 30, got ${p.score}`);
  },

  async R3(t) {
    const a = await t.bot.start();
    const end = await t.bot.wait(a.left);
    await t.reset({ keepSave: true });
    const p = await t.probe();
    t.bot.eq([p.mode, p.best], ["title", end.score], "mode and best after a restart");
  },
};
