// @ts-check
// Checks for Wall Ball.
const expect = (/** @type {boolean} */ ok, /** @type {string} */ why) => {
  if (!ok) throw new Error(why);
};

async function start(/** @type {Arcade.TestHandle} */ t) {
  await t.step(31); // START is ignored for the title's first 30 frames
  await t.input([{ frames: 1, p1: "start" }]);
  await t.step(2);
  expect((await t.probe()).mode === "play", "pressing START on the title should start the game");
}

/** Move the paddle toward the ball (aim) or away from it, 2 frames at a time, until done(p) or max frames. */
async function play(/** @type {Arcade.TestHandle} */ t, /** @type {boolean} */ aim, /** @type {number} */ max, /** @type {(p: any) => boolean} */ done) {
  for (let n = 0; n < max; n += 2) {
    const p = await t.probe();
    if (done(p)) return p;
    let dir = "";
    if (p.ball) {
      const off = p.ball.y + 2 - (p.pad.y + p.pad.h / 2);
      if (aim) dir = off > 3 ? "down" : off < -3 ? "up" : "";
      else dir = off > 0 ? "up" : "down";
    }
    await t.input([{ frames: 2, p1: dir }]);
    await t.step(2);
  }
  return t.probe();
}

/** @type {Arcade.Checks} */
export default {
  async R1(t) {
    await start(t);
    const a = await t.probe();
    await t.input([{ frames: 10, p1: "down" }]);
    await t.step(10);
    const b = await t.probe();
    expect(b.pad.y === a.pad.y + 30, `holding down for 10 frames should move the paddle from y=${a.pad.y} to ${a.pad.y + 30}, got ${b.pad.y}`);
    await t.input([{ frames: 200, p1: "down" }, { frames: 200, p1: "up" }]);
    await t.step(200);
    const c = await t.probe();
    expect(c.pad.y === c.H - c.pad.h, `the paddle should stop at the bottom (y=${c.H - c.pad.h}), but it's at ${c.pad.y}`);
    await t.step(200);
    const d = await t.probe();
    expect(d.pad.y === d.top, `the paddle should stop at the top (y=${d.top}), but it's at ${d.pad.y}`);
  },

  async R2(t) {
    await start(t);
    const seen = { top: false, bottom: false, right: false };
    let last = null;
    for (let n = 0; n < 3000 && !(seen.top && seen.bottom && seen.right); n++) {
      await t.input([{ frames: 1, p1: "up" }]); // paddle parked at the top, out of the way
      await t.step(1);
      const p = await t.probe();
      const b = p.ball;
      if (b) {
        expect(b.y >= p.top && b.y <= p.H - 4 && b.x <= p.W - 4, `the ball went through a wall: (${b.x}, ${b.y})`);
        if (last) {
          if (last.vy < 0 && b.vy > 0 && b.y === p.top) seen.top = true;
          if (last.vy > 0 && b.vy < 0 && b.y === p.H - 4) seen.bottom = true;
          if (last.vx > 0 && b.vx < 0) seen.right = true;
        }
      }
      last = b;
    }
    expect(seen.top && seen.bottom && seen.right, `the ball should bounce off all three walls; saw ${JSON.stringify(seen)}`);
  },

  async R3(t) {
    await start(t);
    const p = await play(t, true, 1200, (p) => p.score > 0 || p.lives < 3);
    expect(p.score === 1 && p.lives === 3, `swatting the ball once should score 1 with no life lost, got score ${p.score}, ${p.lives} lives`);
    expect(p.ball && p.ball.vx > 0, "after a swat the ball should head right");
    const sounds = await t.sounds();
    expect(sounds.length > 0, "a swat should play a sound, none played");
  },

  async R4(t) {
    await start(t);
    const p = await play(t, false, 1200, (p) => p.lives < 3);
    expect(p.lives === 2 && p.ball === null, `missing the ball should cost one life and take the ball away, got ${p.lives} lives`);
    const q = await play(t, false, 60, (q) => q.ball !== null);
    expect(q.ball !== null, "a new ball should come within 60 frames of a miss");
    expect(Math.abs(q.ball.x - q.W / 2) <= 4, `the new ball should start in the middle (x≈${q.W / 2}), got x=${q.ball.x}`);
  },

  async R5(t) {
    await start(t);
    const p = await play(t, false, 4000, (p) => p.lives === 0);
    expect(p.lives === 0, "couldn't lose every life by dodging the ball");
    await t.step(30);
    const q = await t.probe();
    expect(q.mode === "over", `at 0 lives the game-over screen should show, but the mode is "${q.mode}"`);
  },

  async R6(t) {
    await start(t);
    const a = await play(t, true, 3000, (p) => p.score >= 2);
    expect(a.score >= 2, `couldn't score 2 by swatting, score is ${a.score}`);
    const b = await play(t, false, 4000, (p) => p.mode === "over");
    expect(b.mode === "over", "couldn't reach game over");
    await t.reset({ keepSave: true });
    const c = await t.probe();
    expect(c.mode === "title" && c.best === b.score, `after a restart the title should show best ${b.score}, got mode "${c.mode}", best ${c.best}`);
  },
};
