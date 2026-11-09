// @ts-check
const lowest = (list) => list.reduce((a, b) => (b.y > a.y ? b : a), list[0]);
const highest = (list) => list.reduce((a, b) => (b.y < a.y ? b : a), list[0]);
const ofKind = (p, kind) => p.things.filter((x) => x.kind === kind);

const chase = (t, kind) => (p) => {
  const it = lowest(ofKind(p, kind));
  return it ? t.bot.toward(p.player, it, { axis: "x" }) : "";
};
const dodge = (t, kind) => (p) => {
  const it = lowest(kind ? ofKind(p, kind) : p.things);
  return it ? t.bot.away(p.player, it, { axis: "x" }) : "";
};

/** Into play with lives to spare, for rules that aren't about losing them. */
const startAlive = async (t) => {
  await t.bot.start();
  await t.poke({ lives: 9999 });
};

/** @type {Arcade.Checks} */
export default {
  async R1(t) {
    const a = await t.bot.start();
    t.bot.eq((await t.bot.hold("right", 10)).player.x, a.player.x + 30, "x after holding right 10 frames");
    const end = await t.bot.hold("right", 120);
    t.bot.eq(end.player.x, end.W - end.player.w, "x at the right edge");
    t.bot.eq((await t.bot.hold("left", 200)).player.x, 0, "x at the left edge");
  },

  async R2(t) {
    await startAlive(t);
    const p = await t.bot.wait(300);
    t.bot.eq(p.kinds.length, Math.floor(p.played / 50), `things started by frame ${p.played}`);
    t.bot.ok(new Set(p.things.map((x) => x.x)).size > 1, "things should fall from random spots");
  },

  async R3(t) {
    await startAlive(t);
    const p = await t.bot.reach(chase(t, "apple"), (q) => q.caught.apple >= 2, "two caught apples");
    t.bot.eq(p.score, 10 * p.caught.apple, "score after catching apples");
  },

  async R4(t) {
    await t.bot.start();
    const p = await t.bot.reach(dodge(t), (q) => q.landed.apple >= 1, "an apple on the ground");
    t.bot.eq(p.lives, 3 - p.landed.apple - p.caught.rock, "lives after a missed apple");
  },

  async R5(t) {
    await startAlive(t);
    const p = await t.bot.reach(chase(t, "rock"), (q) => q.caught.rock >= 1, "a caught rock");
    t.bot.eq(p.lives, 9999 - p.landed.apple - p.caught.rock, "lives after a rock");
    t.bot.eq(p.score, 10 * p.caught.apple, "a rock doesn't change the score");
  },

  async R6(t) {
    await startAlive(t);
    const p = await t.bot.reach(dodge(t, "rock"), (q) => q.landed.rock >= 1, "a rock on the ground");
    t.bot.eq(p.lives, 9999 - p.landed.apple - p.caught.rock, "a landed rock costs no life");
    t.bot.eq(p.score, 10 * p.caught.apple, "a landed rock changes no score");
  },

  async R7(t) {
    const a = await t.bot.start();
    t.bot.eq(a.lives, 3, "lives at the start");
    await t.bot.reach(dodge(t), (q) => q.lives === 0, "0 lives");
    t.bot.eq((await t.bot.wait(30)).mode, "over", "mode 30 frames after the last life");
  },

  async R8(t) {
    await startAlive(t);
    for (const at of [60, 610, 2410, 3610, 4210]) {
      const p = await t.bot.reach(() => "", (q) => q.played >= at && q.things.length > 0, `frame ${at} with something falling`, { max: 5000, every: 10 });
      const id = highest(p.things).id;
      const moved = await t.bot.delta((q) => q.things.find((x) => x.id === id).y);
      const want = Math.min(2.5, 1 + 0.25 * Math.floor((p.played + 1) / 600));
      t.bot.near(moved, want, `pixels per frame at frame ${p.played + 1}`);
    }
  },

  async R9(t) {
    await startAlive(t);
    const p = await t.bot.reach(() => "", (q) => q.kinds.length >= 20, "20 things started", { every: 10 });
    p.kinds.forEach((kind, i) => t.bot.eq(kind, (i + 1) % 5 === 0 ? "rock" : "apple", `thing ${i + 1}`));
  },

  async R10(t) {
    await startAlive(t);
    await t.bot.reach(chase(t, "apple"), (q) => q.score >= 10, "a score");
    await t.poke({ lives: 1 });
    const end = await t.bot.reach(dodge(t), (q) => q.mode === "over", "game over", { anyMode: true });
    await t.reset({ keepSave: true });
    const p = await t.probe();
    t.bot.eq([p.mode, p.best], ["title", end.score], "mode and best after a restart");
  },
};
