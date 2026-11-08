// @ts-check
/** Hold a direction, then let go for a frame so the next press counts as new. */
async function tap(t, dir, frames = 1) {
  await t.input([{ frames, p1: dir }, { frames: 1 }]);
  await t.step(frames + 1);
  return t.probe();
}

const open = (p) => (x, y) => p.map[y]?.[x] !== undefined && p.map[y][x] !== "#";

/** Tap along the shortest path to the nearest gem until the score changes. */
async function grabGem(t) {
  const from = (await t.probe()).score;
  for (let n = 0; n < 100; n++) {
    const p = await t.probe();
    if (p.score !== from) return p;
    await tap(t, t.bot.pathStep(open(p), p, t.bot.nearest(p, p.gems)));
  }
  throw new Error("the bot couldn't walk to a gem in 100 taps");
}

/** @type {Arcade.Checks} */
export default {
  async R1(t) {
    const { eq } = t.bot;
    const a = await t.bot.start();
    eq((await tap(t, "right")).x, a.x + 1, "x after a tap right");
    await tap(t, "left");
    // Row 0 is all floor: walk up to it, then time a hold along it from the left end.
    for (let n = 0; n < 40 && (await t.probe()).y > 0; n++) {
      const p = await t.probe();
      await tap(t, t.bot.pathStep(open(p), p, { x: p.x, y: 0 }));
    }
    const edge = await tap(t, "left", 200);
    eq([edge.x, edge.y], [0, 0], "the top-left corner stops you");
    for (const [frames, tiles] of [[12, 1], [13, 2], [19, 3]]) {
      const p = await t.probe();
      const q = await tap(t, "right", frames);
      eq(q.x - p.x, tiles, `tiles moved holding right ${frames} frames`);
    }
  },

  async R2(t) {
    await t.bot.start();
    const p = await t.probe();
    const wall = [["left", -1, 0], ["right", 1, 0], ["up", 0, -1], ["down", 0, 1]];
    // Walk the whole floor once with a stuck-free walker, trying each wall we pass.
    let bumped = 0;
    let q = p;
    for (let n = 0; n < 60 && bumped < 3; n++) {
      for (const [dir, dx, dy] of wall) {
        if (open(q)(q.x + dx, q.y + dy)) continue;
        const r = await tap(t, dir);
        t.bot.eq([r.x, r.y], [q.x, q.y], `walking ${dir} into a wall`);
        bumped += 1;
      }
      const target = t.bot.nearest(q, q.gems);
      q = await tap(t, t.bot.pathStep(open(q), q, target));
    }
    t.bot.ok(bumped >= 3, `the bot only found ${bumped} walls to walk into`);
  },

  async R3(t) {
    await t.bot.start();
    for (let i = 1; i <= 3; i++) {
      const p = await grabGem(t);
      t.bot.eq(p.score, 10 * i, `score after gem ${i}`);
      t.bot.eq(p.gems.length, 3, "gems on the board");
      t.bot.ok(!p.gems.some((g) => g.x === p.x && g.y === p.y), "the new gem appeared under the player");
      t.bot.ok(p.gems.every((g) => open(p)(g.x, g.y)), "a gem appeared inside a wall");
    }
    t.bot.ok((await t.sounds()).length >= 3, "each gem should play a sound");
  },

  async R4(t) {
    const a = await t.bot.start();
    t.bot.eq(a.left + 1, 1800, "frames in a round, after 1 frame of play");
    t.bot.eq((await t.bot.wait(a.left - 1)).mode, "play", "mode one frame before the end");
    t.bot.eq((await t.bot.wait(1)).mode, "over", "mode after 1800 frames");
  },

  async R5(t) {
    await t.bot.start();
    await grabGem(t);
    await t.bot.wait((await t.probe()).left);
    await t.reset({ keepSave: true });
    const p = await t.probe();
    t.bot.eq([p.mode, p.best], ["title", 10], "mode and best after a restart");
  },
};
