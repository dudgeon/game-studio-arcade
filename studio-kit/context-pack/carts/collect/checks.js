// @ts-check
// Checks for Gem Garden.
const expect = (/** @type {boolean} */ ok, /** @type {string} */ why) => {
  if (!ok) throw new Error(why);
};

async function start(/** @type {Arcade.TestHandle} */ t) {
  await t.step(31); // START is ignored for the title's first 30 frames
  await t.input([{ frames: 1, p1: "start" }]);
  await t.step(2);
  expect((await t.probe()).mode === "play", "pressing START on the title should start the game");
}

/** Hold `dir` for `frames` frames, then let go for a frame. */
async function hold(/** @type {Arcade.TestHandle} */ t, /** @type {string} */ dir, /** @type {number} */ frames) {
  await t.input([{ frames, p1: dir }, { frames: 1 }]);
  await t.step(frames + 1);
  return t.probe();
}

/** Tap toward the nearest gem until the score changes. */
async function grabGem(/** @type {Arcade.TestHandle} */ t) {
  const start = (await t.probe()).score;
  for (let n = 0; n < 100; n++) {
    const p = await t.probe();
    if (p.score !== start) return p;
    const d = (/** @type {any} */ q) => Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
    const gem = p.gems.reduce((/** @type {any} */ a, /** @type {any} */ b) => (d(b) < d(a) ? b : a));
    await hold(t, gem.x > p.x ? "right" : gem.x < p.x ? "left" : gem.y > p.y ? "down" : "up", 1);
  }
  throw new Error("couldn't walk to a gem in 100 taps");
}

/** @type {Arcade.Checks} */
export default {
  async R1(t) {
    await start(t);
    const a = await t.probe();
    const b = await hold(t, "left", 1);
    expect(b.x === a.x - 1, `a tap left should move one tile, from ${a.x} to ${a.x - 1}, got ${b.x}`);
    await hold(t, "up", 200); // room to walk down
    for (const [frames, tiles] of [[12, 1], [13, 2], [19, 3]]) {
      const p = await t.probe();
      const q = await hold(t, "down", frames);
      expect(q.y - p.y === tiles, `holding down for ${frames} frames should move ${tiles} tiles, moved ${q.y - p.y}`);
    }
    const c = await hold(t, "right", 200);
    const d = await hold(t, "down", 200);
    expect(c.x === c.cols - 1 && d.y === d.rows - 1, `the gardener should stop at the garden's edge (${c.cols - 1}, ${d.rows - 1}), got (${c.x}, ${d.y})`);
    const e = await hold(t, "left", 200);
    const f = await hold(t, "up", 200);
    expect(e.x === 0 && f.y === 0, `the gardener should stop at the top-left corner (0, 0), got (${e.x}, ${f.y})`);
  },

  async R2(t) {
    await start(t);
    for (let i = 1; i <= 3; i++) {
      const p = await grabGem(t);
      expect(p.score === 10 * i, `gem ${i} should make the score ${10 * i}, got ${p.score}`);
      expect(p.gems.length === 3, `there should always be 3 gems, there are ${p.gems.length}`);
      expect(!p.gems.some((/** @type {any} */ g) => g.x === p.x && g.y === p.y), "the new gem appeared under the gardener");
    }
    expect((await t.sounds()).length >= 3, "each gem should play a sound");
  },

  async R3(t) {
    await start(t);
    const p = await t.probe();
    expect(p.left + 1 === 1800, `a round should last 1800 frames; ${p.left} left after 1 frame of play`);
    await t.step(p.left - 1);
    expect((await t.probe()).mode === "play", "the round ended early");
    await t.step(1);
    const q = await t.probe();
    expect(q.mode === "over", `after 1800 frames the game-over screen should show, but the mode is "${q.mode}"`);
  },

  async R4(t) {
    await start(t);
    await grabGem(t);
    await t.step((await t.probe()).left);
    expect((await t.probe()).mode === "over", "couldn't reach the end of the round");
    await t.reset({ keepSave: true });
    const p = await t.probe();
    expect(p.mode === "title" && p.best === 10, `after a restart the title should show best 10, got mode "${p.mode}", best ${p.best}`);
  },
};
