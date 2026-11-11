// @ts-check
const RIVER = [10, 9, 8, 7, 5, 4, 3, 2];
const BANK = (r) => r === 11 || r === 6 || r === 1;
const lane = (p, row) => p.lanes.find((l) => l.row === row);
const landsOn = (p, row, m = 6) => lane(p, row).logs.some((l) => p.frog.cx >= l.x + m && p.frog.cx < l.x + l.w - m);
const overWater = (p, row, m = 6) => lane(p, row).logs.every((l) => p.frog.cx < l.x - m || p.frog.cx >= l.x + l.w + m);

/** wait until a hop up is safe, then hop. Returns the probe after the hop. */
async function hopUp(t) {
  for (let i = 0; i < 900; i++) {
    const p = await t.probe();
    if (p.mode !== "play") throw new Error("the game ended while the bot waited to hop");
    if (!p.dying && (BANK(p.frog.row - 1) || landsOn(p, p.frog.row - 1))) return await t.bot.press("up");
    await t.bot.wait(1);
  }
  throw new Error("the bot never found a log to hop onto");
}

/** wait at the start row until there is only water above, then hop into it. */
async function hopIntoWater(t) {
  for (let i = 0; i < 900; i++) {
    const p = await t.probe();
    if (!p.dying && p.frog.row === 11 && overWater(p, 10)) return await t.bot.press("up");
    await t.bot.wait(1);
  }
  throw new Error("the bot never found open water to hop into");
}

/** hop up until the frog is on `row` */
async function climbTo(t, row) {
  for (let i = 0; i < 400; i++) {
    const p = await t.probe();
    if (p.frog.row === row && !p.dying) return p;
    await hopUp(t);
  }
  throw new Error("the bot couldn't reach row " + row);
}

/** play until one crossing is done; keep the lives topped up */
async function cross(t) {
  await t.poke({ lives: 99 });
  for (let i = 0; i < 400; i++) {
    const p = await t.probe();
    if (p.crossings >= 1) return p;
    if (p.frog.row === 2 && !p.dying) {
      const before = p;
      const after = await t.bot.press("up");
      return { before, after };
    }
    await hopUp(t);
  }
  throw new Error("the bot couldn't cross the river");
}

/** @type {Arcade.Checks} */
export default {
  async R1(t) {
    const a = await t.bot.start();
    await t.poke({ lives: 99 });
    const l1 = await t.bot.press("left", 0);
    t.bot.eq(l1.frog.x, a.frog.x - 16, "x after one left press");
    await t.bot.wait(1); // let go of the stick first, so the next press is a new press
    t.bot.eq((await t.bot.hold("left", 10)).frog.x, a.frog.x - 32, "x after holding left 10 frames: one more hop only");
    await t.bot.wait(1);
    t.bot.eq((await t.bot.press("right", 0)).frog.x, a.frog.x - 16, "x after one right press");
    await t.bot.wait(1);
    await t.bot.press("right", 0);
    const b = await t.probe();
    t.bot.eq([b.frog.row, b.frog.x], [11, a.frog.x], "back at the start");
    await hopUp(t);
    const up = await t.probe();
    t.bot.eq(up.frog.row, 10, "row after one up press");
    const down = await t.bot.press("down", 0);
    t.bot.eq(down.frog.row, 11, "row after one down press");
    for (let i = 0; i < 900; i++) {
      const p = await t.probe();
      if (landsOn(p, 10)) break;
      await t.bot.wait(1);
    }
    const held = await t.bot.hold("up", 20);
    t.bot.eq(held.frog.row, 10, "row after holding up 20 frames: one hop only");
  },

  async R2(t) {
    const a = await t.bot.start();
    t.bot.eq(a.lanes.map((l) => l.row).sort((x, y) => x - y), [2, 3, 4, 5, 7, 8, 9, 10], "river rows");
    for (const l of a.lanes) t.bot.eq(l.logs.length, 4, `logs in lane ${l.row}`);
    for (const [r1, r2] of [[10, 9], [9, 8], [8, 7], [5, 4], [4, 3], [3, 2]]) {
      t.bot.ok(lane(a, r1).dir === -lane(a, r2).dir, `lanes ${r1} and ${r2} should float opposite ways`);
    }
    const b = await t.bot.wait(300);
    for (const l of b.lanes) {
      const l0 = lane(a, l.row);
      t.bot.eq(l.logs.length, 4, `logs in lane ${l.row} later`);
      const want = ((((l0.logs[0].x + 64 + l.dir * l.speed * 300) % 320) + 320) % 320) - 64;
      t.bot.near(l.logs[0].x, want, `log position in lane ${l.row} after 300 frames`, 0.05);
    }
  },

  async R3(t) {
    await t.bot.start();
    await t.poke({ lives: 99 });
    await hopUp(t);
    const a = await t.probe();
    t.bot.eq(a.frog.row, 10, "row after hopping onto a log");
    const l = lane(a, 10);
    const b = await t.bot.wait(20);
    t.bot.eq(b.frog.row, 10, "still on the log");
    t.bot.near(b.frog.x - a.frog.x, l.dir * l.speed * 20, "how far the frog floated in 20 frames", 0.01);
  },

  async R4(t) {
    await t.bot.start();
    const a = await hopIntoWater(t);
    t.bot.eq(a.lives, 2, "lives right after landing in the water");
    t.bot.ok(a.dying > 0, "the frog should be splashing");
    const b = await t.bot.wait(10);
    t.bot.eq([b.lives, b.mode], [2, "play"], "lives and mode 10 frames later");
    const c = await t.bot.wait(20);
    t.bot.eq([c.frog.row, c.frog.x, c.lives], [11, a.startX, 2], "frog back at the start 30 frames after the splash");
  },

  async R5(t) {
    await t.bot.start();
    await hopUp(t);
    const p = await t.bot.reach(() => "", (q) => q.lives < 3, "a life lost by floating off the edge", { every: 10, max: 3000 });
    t.bot.eq(p.lives, 2, "lives after floating off the edge");
    t.bot.eq(p.lastDeath, "edge", "why the life was lost");
    t.bot.ok(p.frog.cx < 0 || p.frog.cx >= p.W, "the frog should be past the screen edge");
  },

  async R6(t) {
    const a = await t.bot.start();
    const b = await t.bot.wait(600);
    t.bot.eq([b.lives, b.frog.row, b.mode], [3, 11, "play"], "after 600 frames on the start row");
    await t.poke({ lives: 99 });
    await climbTo(t, 6);
    const c = await t.probe();
    const d = await t.bot.wait(600);
    t.bot.eq([d.frog.row, d.lives, d.mode], [6, c.lives, "play"], "after 600 frames on the middle row");
    t.bot.ok(a.lives === 3, "start lives");
  },

  async R7(t) {
    await t.bot.start();
    const r = await cross(t);
    const { before, after } = /** @type {any} */ (r);
    t.bot.eq(after.score, 100, "score after reaching the top bank");
    t.bot.eq(after.lives, before.lives, "lives after reaching the top bank");
    t.bot.eq([after.frog.row, after.frog.x, after.crossings], [11, after.startX, 1], "frog back at the start after a crossing");
  },

  async R8(t) {
    await t.bot.start();
    await cross(t);
    const a = await t.probe();
    for (const l of a.lanes) t.bot.near(l.speed, l.base + 0.1, `speed in lane ${l.row} after 1 crossing`, 0.001);
    await t.poke({ crossings: 9 });
    const b = await t.bot.wait(1);
    for (const l of b.lanes) t.bot.near(l.speed, l.base + 0.5, `top speed in lane ${l.row}`, 0.001);
  },

  async R9(t) {
    const a = await t.bot.start();
    t.bot.eq(a.lives, 3, "lives at the start");
    for (const want of [2, 1]) {
      const p = await hopIntoWater(t);
      t.bot.eq([p.lives, p.mode], [want, "play"], "lives after a splash");
      await t.bot.wait(31);
    }
    const last = await hopIntoWater(t);
    t.bot.eq(last.lives, 0, "lives after the third splash");
    const end = await t.bot.wait(60);
    t.bot.eq(end.mode, "over", "mode within 60 frames of the last life");
  },

  async R10(t) {
    await t.bot.start();
    await cross(t);
    await t.poke({ lives: 1 });
    await hopIntoWater(t);
    const end = await t.bot.wait(60);
    t.bot.eq(end.mode, "over", "mode after the last life");
    t.bot.eq(end.score, 100, "score at the end");
    await t.reset({ keepSave: true });
    const p = await t.probe();
    t.bot.eq([p.mode, p.best], ["title", 100], "mode and best after a restart");
  },
};
