// @ts-check
// Checks for Comet Dodge. Helpers live here because checks.js imports nothing.
const expect = (/** @type {boolean} */ ok, /** @type {string} */ why) => {
  if (!ok) throw new Error(why);
};

/** From the title, press START and land in play. START is ignored for the title's first 30 frames. */
async function start(/** @type {Arcade.TestHandle} */ t) {
  await t.step(31);
  await t.input([{ frames: 1, p1: "start" }]);
  await t.step(2);
  expect((await t.probe()).mode === "play", "pressing START on the title should start the game");
}

/** Steer the ship up or down, `frames` frames at a time, until `done(p)` or `max` frames. away=true dodges, false chases. */
async function fly(/** @type {Arcade.TestHandle} */ t, /** @type {boolean} */ away, /** @type {number} */ max, /** @type {(p: any) => boolean} */ done) {
  for (let n = 0; n < max; n += 2) {
    const p = await t.probe();
    if (done(p)) return p;
    const ahead = p.comets.filter((/** @type {any} */ c) => c.x > p.ship.x - 8 && c.x < p.ship.x + 48);
    let dir = "";
    if (away) {
      const near = ahead.find((/** @type {any} */ c) => Math.abs(c.y - p.ship.y) < 14);
      if (near) dir = near.y > p.ship.y ? (p.ship.y > 20 ? "up" : "down") : p.ship.y < p.H - 20 ? "down" : "up";
    } else if (ahead.length) {
      dir = ahead[0].y > p.ship.y ? "down" : ahead[0].y < p.ship.y ? "up" : "";
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
    expect(b.ship.y === a.ship.y + 20, `holding down for 10 frames should move the ship from y=${a.ship.y} to ${a.ship.y + 20}, got ${b.ship.y}`);
    await t.input([{ frames: 10, p1: "right" }]);
    await t.step(10);
    const c = await t.probe();
    expect(c.ship.x === b.ship.x + 20, `holding right for 10 frames should move the ship from x=${b.ship.x} to ${b.ship.x + 20}, got ${c.ship.x}`);
    await t.input([{ frames: 400, p1: "right down" }]);
    await t.step(400);
    const d = await t.probe();
    expect(d.ship.x === d.W - 8 && d.ship.y === d.H - 8, `the ship should stop in the bottom-right corner (${d.W - 8}, ${d.H - 8}), but it's at (${d.ship.x}, ${d.ship.y})`);
  },

  async R2(t) {
    await start(t);
    const p = await fly(t, true, 300, (p) => p.played >= 300);
    expect(p.lives === 3, "the dodge helper got hit, so the score can't be read cleanly");
    expect(p.score === Math.floor(p.played / 60), `after ${p.played} frames of play the score should be ${Math.floor(p.played / 60)}, got ${p.score}`);
  },

  async R3(t) {
    await start(t);
    const hit = await fly(t, false, 1200, (p) => p.lives < 3);
    expect(hit.lives === 2, `chasing comets should cost exactly one life on the first touch, lives are ${hit.lives}`);
    expect(hit.safe, "right after a hit the ship should be safe");
    const after = await fly(t, false, 84, () => false);
    expect(after.lives === 2, `comets shouldn't hurt the ship in the 90 frames after a hit, but lives went to ${after.lives}`);
    const later = await fly(t, false, 1200, (p) => p.lives < 2);
    expect(later.lives === 1, `once the safe time is over a comet should take another life, lives are ${later.lives}`);
  },

  async R4(t) {
    await start(t);
    const p = await fly(t, false, 4000, (p) => p.lives === 0);
    expect(p.lives === 0, "couldn't lose every life by chasing comets");
    await t.step(30);
    const q = await t.probe();
    expect(q.mode === "over", `at 0 lives the game-over screen should show, but the mode is "${q.mode}"`);
  },

  async R5(t) {
    await start(t);
    // Measure real comet movement over one frame, at points along the curve.
    for (const at of [60, 610, 1210, 2410, 3010]) {
      const p = await fly(t, true, 4000, (p) => (p.played >= at && p.comets.length > 0) || p.mode !== "play");
      expect(p.mode === "play", `the dodge helper lost every life before frame ${at} of play`);
      await t.step(1);
      const q = await t.probe();
      const c = q.comets.find((/** @type {any} */ c) => c.y === p.comets[0].y);
      const want = Math.min(3, 1 + 0.5 * Math.floor(q.played / 600));
      expect(c && p.comets[0].x - c.x === want, `after ${q.played} frames of play comets should move ${want} pixels per frame, moved ${c ? p.comets[0].x - c.x : "?"}`);
    }
  },
};
