// @ts-check
// Helpers live here: checks.js imports nothing.
const expect = (/** @type {any} */ ok, /** @type {string} */ why) => {
  if (!ok) throw new Error(why);
};
const near = (/** @type {number} */ a, /** @type {number} */ b, eps = 1e-6) => Math.abs(a - b) < eps;

/** From the title, press START and land in play. START is ignored for the title's first 30 frames. */
async function start(/** @type {Arcade.TestHandle} */ t) {
  await t.step(31);
  await t.input([{ frames: 1, p1: "start" }]);
  await t.step(2);
  expect((await t.probe()).mode === "play", "pressing START on the title should start the game");
}

/** Which way to hold to get the penguin to slide to a spot (it coasts about 24 frames of speed). */
function steer(/** @type {any} */ p, /** @type {number} */ target) {
  const cx = p.peng.x + p.peng.w / 2;
  const goal = Math.max(8, Math.min(p.W - 8, target));
  const stop = cx + p.peng.vx * 24;
  if (stop < goal - 3) return "right";
  if (stop > goal + 3) return "left";
  return "";
}

/** What the bot wants to do. mode: "fish" catches fish and dodges boots, "boots" chases boots, "flee" runs away from fish. */
function choose(/** @type {any} */ p, /** @type {string} */ mode) {
  const cx = p.peng.x + p.peng.w / 2;
  /** @type {any[]} */
  const things = p.things;
  const fish = things.filter((t) => t.kind === "fish").sort((a, b) => b.y - a.y);
  const boots = things.filter((t) => t.kind === "boot").sort((a, b) => b.y - a.y);
  if (mode === "flee") {
    const f = fish[0] || boots[0];
    if (!f) return steer(p, p.W / 2);
    return steer(p, f.x + f.w / 2 < p.W / 2 ? p.W - 8 : 8);
  }
  if (mode === "boots" && boots[0] && !(fish[0] && fish[0].y > boots[0].y)) return steer(p, boots[0].x + boots[0].w / 2);
  // dodge a boot that is about to land on the penguin
  for (const b of boots) {
    const bx = b.x + b.w / 2;
    if (b.y > p.ground - 90 && Math.abs(bx - cx) < 26) return bx < cx ? "right" : "left";
  }
  if (fish[0]) return steer(p, fish[0].x + fish[0].w / 2);
  return steer(p, p.W / 2);
}

/**
 * Play with the bot, one frame at a time. `each(prev, now)` sees every pair of
 * frames and returns true to stop. Returns the last probe.
 */
async function play(/** @type {Arcade.TestHandle} */ t, /** @type {string} */ mode, /** @type {number} */ max, /** @type {(a: any, b: any) => boolean} */ each) {
  let prev = await t.probe();
  for (let n = 0; n < max; n++) {
    await t.input([{ frames: 1, p1: choose(prev, mode) }]);
    await t.step(1);
    const now = await t.probe();
    if (each(prev, now)) return now;
    if (now.mode !== "play") return now;
    prev = now;
  }
  return prev;
}

const count = (/** @type {any} */ p, /** @type {string} */ kind) => p.things.filter((/** @type {any} */ x) => x.kind === kind).length;

/** @type {Arcade.Checks} */
export default {
  async R1(t) {
    await start(t);
    const a = await t.probe();
    expect(a.peng.vx === 0, `the penguin should start still, vx is ${a.peng.vx}`);
    await t.input([{ frames: 5, p1: "right" }]);
    await t.step(5);
    const b = await t.probe();
    expect(near(b.peng.vx, 1.25), `after 5 frames of holding right the speed should be 1.25 (0.25 per frame), got ${b.peng.vx}`);
    expect(near(b.peng.x - a.peng.x, 0.25 + 0.5 + 0.75 + 1 + 1.25), `after 5 frames the penguin should have moved 3.75 pixels, moved ${b.peng.x - a.peng.x}`);
    await t.input([{ frames: 20, p1: "right" }]);
    await t.step(20);
    const c = await t.probe();
    expect(near(c.peng.vx, 3.5), `holding right should top out at 3.5 pixels per frame, got ${c.peng.vx}`);
    await t.step(1);
    const d = await t.probe();
    expect(near(d.peng.x - c.peng.x, 3.5 * 0.96), `one frame after letting go it should slide ${3.5 * 0.96} pixels, slid ${d.peng.x - c.peng.x}`);
    expect(near(d.peng.vx, 3.5 * 0.96), `letting go should slow the penguin by 4% (to ${3.5 * 0.96}), got ${d.peng.vx}`);
    await t.step(9);
    const e = await t.probe();
    expect(near(e.peng.vx, 3.5 * Math.pow(0.96, 10), 1e-4), `10 frames after letting go the speed should be ${3.5 * Math.pow(0.96, 10)}, got ${e.peng.vx}`);
    expect(e.peng.x > d.peng.x + 15, "the penguin should keep sliding after you let go");
    // left works the same way and the right edge stops it
    await t.input([{ frames: 90, p1: "right" }]);
    await t.step(90);
    const r = await t.probe();
    expect(r.peng.x === r.W - r.peng.w && r.peng.vx === 0, `the penguin should stop at the right edge (x=${r.W - r.peng.w}), but it is at ${r.peng.x} with speed ${r.peng.vx}`);
    await t.input([{ frames: 10, p1: "left" }]);
    await t.step(10);
    const l = await t.probe();
    expect(near(l.peng.vx, -2.5), `holding left for 10 frames should give speed -2.5, got ${l.peng.vx}`);
    await t.input([{ frames: 90, p1: "left" }]);
    await t.step(90);
    const z = await t.probe();
    expect(z.peng.x === 0 && z.peng.vx === 0, `the penguin should stop at the left edge (x=0), but it is at ${z.peng.x}`);
  },

  async R2(t) {
    await start(t);
    let before = 0;
    const end = await play(t, "fish", 1500, (a, b) => {
      if (b.score > a.score) {
        before = a.score;
        return true;
      }
      return false;
    });
    expect(end.score === before + 10 && end.score === 10, `catching a fish should give 10 points, the score is ${end.score}`);
    expect(end.lives === 3, `catching a fish should not cost a life, lives are ${end.lives}`);
    const px = end.peng;
    const still = end.things.filter((/** @type {any} */ f) => f.x < px.x + px.w && f.x + f.w > px.x && f.y < px.y + px.h && f.y + f.h > px.y);
    expect(still.length === 0, "the caught fish should disappear on the frame it is caught");
  },

  async R3(t) {
    await start(t);
    const a = await t.probe();
    expect(a.lives === 3, `you should start with 3 lives, got ${a.lives}`);
    let fishBefore = 0;
    const end = await play(t, "flee", 1000, (p, n) => {
      if (n.lives < p.lives) {
        fishBefore = count(p, "fish");
        return true;
      }
      return false;
    });
    expect(end.lives === 2, `a missed fish should cost exactly one life, lives are ${end.lives}`);
    expect(count(end, "fish") === fishBefore - 1, `the missed fish should disappear (fish before ${fishBefore}, after ${count(end, "fish")})`);
    expect(end.score === 0, `a missed fish should not change the score, it is ${end.score}`);
  },

  async R4(t) {
    await start(t);
    let info = /** @type {any} */ (null);
    const end = await play(t, "boots", 6000, (p, n) => {
      if (n.lives < p.lives && count(n, "boot") === count(p, "boot") - 1 && count(n, "fish") >= count(p, "fish")) {
        info = { before: p, after: n };
        return true;
      }
      return false;
    });
    expect(info, `couldn't catch a boot (mode ${end.mode}, lives ${end.lives}, boots seen ${end.boots})`);
    expect(info.after.lives === info.before.lives - 1, `catching a boot should cost one life (${info.before.lives} -> ${info.after.lives})`);
    expect(info.after.score === info.before.score, `catching a boot should not change the score (${info.before.score} -> ${info.after.score})`);
    const px = info.after.peng;
    const stuck = info.after.things.filter((/** @type {any} */ f) => f.kind === "boot" && f.x < px.x + px.w && f.x + f.w > px.x && f.y < px.y + px.h && f.y + f.h > px.y);
    expect(stuck.length === 0, "the caught boot should disappear on the frame it is caught");
  },

  async R5(t) {
    await start(t);
    let info = /** @type {any} */ (null);
    const end = await play(t, "fish", 8000, (p, n) => {
      const onIce = p.things.filter((/** @type {any} */ f) => f.kind === "boot" && f.y + f.h + 3.1 >= p.ground);
      if (onIce.length && count(n, "boot") < count(p, "boot")) {
        const px = p.peng;
        const touching = onIce.some((/** @type {any} */ f) => f.x < px.x + px.w && f.x + f.w > px.x);
        if (!touching) {
          info = { before: p, after: n };
          return true;
        }
      }
      return false;
    });
    expect(info, `never saw a boot reach the ice without being caught (mode ${end.mode}, boots seen ${end.boots})`);
    // a fish may be caught or missed on the very same frame, so compare lives only when the fish didn't change
    if (count(info.before, "fish") === count(info.after, "fish")) {
      expect(info.after.lives === info.before.lives, `a boot hitting the ice should cost nothing (lives ${info.before.lives} -> ${info.after.lives})`);
    }
    expect(info.after.score >= info.before.score, "a boot hitting the ice should not take points away");
  },

  async R6(t) {
    await start(t);
    const end = await play(t, "flee", 3000, (p, n) => n.lives === 0);
    expect(end.lives === 0, `couldn't lose all the lives (lives ${end.lives})`);
    await t.step(30);
    const q = await t.probe();
    expect(q.mode === "over", `with 0 lives the game-over screen should show within 30 frames, the mode is "${q.mode}"`);
    expect(q.things.length === 0, "nothing should be left falling at game over");
    await t.step(200);
    const r = await t.probe();
    expect(r.spawned === q.spawned && r.things.length === 0, "nothing more should fall after game over");
  },

  async R7(t) {
    await start(t);
    // real movement near the start
    const a = await t.probe();
    let p = a;
    for (let i = 0; i < 400 && p.things.length === 0; i++) {
      await t.input([{ frames: 1, p1: choose(p, "fish") }]);
      await t.step(1);
      p = await t.probe();
    }
    expect(p.things.length > 0, "no thing fell in the first 400 frames");
    const f0 = p.things[0];
    await t.input([{ frames: 1, p1: "" }]);
    await t.step(1);
    const q = await t.probe();
    const f1 = q.things.find((/** @type {any} */ f) => f.x === f0.x);
    expect(f1 && near(f1.y - f0.y, 1), `at the start things should fall 1 pixel per frame, moved ${f1 ? f1.y - f0.y : "?"}`);
    // keep going past one level and measure again
    const mid = await play(t, "fish", 1500, (x, n) => n.played >= 610 && n.things.length > 0);
    expect(mid.mode === "play", `the bot lost before reaching 610 frames of play (played ${mid.played})`);
    expect(mid.played >= 610, `didn't reach level 2, played ${mid.played}`);
    const m0 = mid.things[0];
    expect(m0, "nothing falling at the second level");
    await t.input([{ frames: 1, p1: "" }]);
    await t.step(1);
    const m1 = (await t.probe()).things.find((/** @type {any} */ f) => f.x === m0.x);
    expect(m1 && near(m1.y - m0.y, 1.2), `after 600 frames of play things should fall 1.2 pixels per frame, moved ${m1 ? m1.y - m0.y : "?"}`);
    // the whole curve, including the top speed
    for (const c of mid.curve) {
      const lvl = Math.floor(c.played / 600);
      const want = Math.min(3, 1 + 0.2 * lvl);
      expect(near(c.fallSpeed, want), `after ${c.played} frames of play things should fall ${want} pixels per frame, the game says ${c.fallSpeed}`);
    }
    const top = mid.curve[mid.curve.length - 1];
    expect(near(top.fallSpeed, 3), `the top fall speed should be 3, got ${top.fallSpeed}`);
  },

  async R8(t) {
    await start(t);
    let early = true;
    const end = await play(t, "fish", 6000, (p, n) => {
      if (n.spawned <= 3 && n.boots > 0) early = false;
      return n.boots >= 1 && n.spawned > 3;
    });
    expect(early, "one of the first 3 things was a boot");
    expect(end.mode === "play" && end.boots >= 1, `no boot fell during the game (things spawned: ${end.spawned}, mode ${end.mode})`);
    expect(end.spawned > 3, "a boot should only come after the first 3 things");
    const want = [0.15, 0.15, 0.2, 0.25, 0.4, 0.4, 0.4];
    end.curve.forEach((/** @type {any} */ c, /** @type {number} */ i) => {
      expect(near(c.bootChance, want[i]), `after ${c.played} frames of play the boot chance should be ${want[i]}, the game says ${c.bootChance}`);
    });
  },

  async R9(t) {
    await start(t);
    /** @type {{ at: number, n: number }[]} */
    const seen = [];
    let last = 0;
    await play(t, "fish", 1500, (p, n) => {
      if (n.spawned > last) {
        last = n.spawned;
        seen.push({ at: n.played, n: n.spawned });
      }
      return seen.length >= 20;
    });
    expect(seen.length >= 3, `only ${seen.length} things appeared`);
    expect(seen[0].at === 30, `the first thing should appear after 30 frames of play, it came at ${seen[0].at}`);
    expect(seen[1].at - seen[0].at === 70, `at the start a thing should fall every 70 frames, gap was ${seen[1].at - seen[0].at}`);
    const late = seen.filter((x) => x.at > 600);
    if (late.length >= 2) {
      const i = seen.indexOf(late[0]);
      const gap = seen[i + 1].at - seen[i].at;
      expect(gap === 65, `after 600 frames of play a thing should fall every 65 frames, gap was ${gap}`);
    }
    const want = [70, 70, 65, 60, 45, 30, 30];
    const p = await t.probe();
    p.curve.forEach((/** @type {any} */ c, /** @type {number} */ i) => {
      expect(c.spawnEvery === want[i], `after ${c.played} frames of play a thing should fall every ${want[i]} frames, the game says ${c.spawnEvery}`);
    });
  },

  async R10(t) {
    await t.step(5);
    await t.input([{ frames: 1, p1: "start" }]);
    await t.step(2);
    expect((await t.probe()).mode === "title", "START in the first half second should be ignored on the title");
    await start(t);
    const p = await t.probe();
    expect(p.score === 0 && p.lives === 3, `a new game should start with score 0 and 3 lives, got ${p.score} and ${p.lives}`);
    const end = await play(t, "flee", 3000, () => false);
    expect(end.mode === "over", `couldn't reach game over (mode ${end.mode})`);
    await t.step(31);
    await t.input([{ frames: 1, p1: "start" }]);
    await t.step(2);
    expect((await t.probe()).mode === "title", "START on the game-over screen should go back to the title");
    await t.step(31);
    await t.input([{ frames: 1, p1: "start" }]);
    await t.step(2);
    const q = await t.probe();
    expect(q.mode === "play" && q.score === 0 && q.lives === 3, `the next game should start fresh, got mode ${q.mode} score ${q.score} lives ${q.lives}`);
  },

  async R11(t) {
    await start(t);
    const a = await t.probe();
    expect(a.best === 0, `the best score should start at 0, got ${a.best}`);
    const got = await play(t, "fish", 2000, (p, n) => n.score >= 20);
    expect(got.score >= 20, `couldn't score points (score ${got.score}, mode ${got.mode})`);
    const end = await play(t, "flee", 3000, () => false);
    expect(end.mode === "over", `couldn't reach game over (mode ${end.mode})`);
    const score = end.score;
    expect(score >= 20, `the score should still be at least 20, got ${score}`);
    await t.reset({ keepSave: true });
    await t.step(2);
    const q = await t.probe();
    expect(q.mode === "title", `after a restart the title should show, the mode is ${q.mode}`);
    expect(q.best === score, `the title should show the best score ${score}, got ${q.best}`);
    // a worse game does not replace it
    await start(t);
    await play(t, "flee", 3000, () => false);
    await t.reset({ keepSave: true });
    await t.step(2);
    const r = await t.probe();
    expect(r.best === score, `a worse game should not replace the best score ${score}, got ${r.best}`);
  },
};
