// @ts-check
// Checks for Dot Catch (shared by the broken variant, which must fail them).
const expect = (/** @type {boolean} */ ok, /** @type {string} */ why) => {
  if (!ok) throw new Error(why);
};

/** Move the basket so the current dot lands in it (aim = true) or misses it. */
async function steer(/** @type {Arcade.TestHandle} */ t, /** @type {boolean} */ aim) {
  const p = await t.probe();
  const target = aim ? p.dot.x - 12 : p.dot.x > 128 ? 0 : 232;
  const dx = target - p.bx;
  const frames = Math.ceil(Math.abs(dx) / 2);
  if (frames > 0) await t.input([{ frames, p1: dx > 0 ? "right" : "left" }]);
  return frames;
}

/** @type {Arcade.Checks} */
export default {
  async R1(t) {
    const before = await t.probe();
    await t.input([{ frames: 10, p1: "right" }]);
    await t.step(10);
    const after = await t.probe();
    expect(after.bx === before.bx + 20, `holding right for 10 frames should move the basket from x=${before.bx} to ${before.bx + 20}, but it went to ${after.bx}`);
    await t.input([{ frames: 200, p1: "right" }]);
    await t.step(200);
    const edge = await t.probe();
    expect(edge.bx === 232, `the basket should stop at the right edge (x=232), but it's at ${edge.bx}`);
  },

  async R2(t) {
    await t.step(Math.max(125, await steer(t, true)));
    const p = await t.probe();
    expect(p.score === 10, `catching one dot should make the score 10, but it's ${p.score}`);
  },

  async R3(t) {
    for (let i = 3; i > 0; i--) {
      await t.step(Math.max(130, await steer(t, false)));
      const p = await t.probe();
      expect(p.lives === i - 1, `missing a dot with ${i} lives should leave ${i - 1}, but there are ${p.lives}`);
    }
    const p = await t.probe();
    expect(p.mode === "over", `at 0 lives the game-over screen should show, but the mode is "${p.mode}"`);
  },

  async R5(t) {
    for (let i = 0; i < 3; i++) {
      await t.step(Math.max(130, await steer(t, false)));
    }
    expect((await t.probe()).mode === "over", "couldn't reach the game-over screen to test START");
    await t.input([{ frames: 1, p1: "start" }]);
    await t.step(2);
    const p = await t.probe();
    expect(p.mode === "play" && p.lives === 3 && p.score === 0, `START on game over should start a new game with 3 lives and score 0, got mode "${p.mode}", ${p.lives} lives, score ${p.score}`);
  },
};
