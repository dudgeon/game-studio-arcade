// @ts-check
/** Press START until the named scene is up. */
const goTo = async (t, name) => {
  for (let i = 0; i < 4; i++) {
    const p = await t.probe();
    if (p.name === name) return p;
    await t.bot.press("start");
  }
  const p = await t.probe();
  t.bot.eq(p.name, name, "the scene after pressing START four times");
  return p;
};

/** @type {Arcade.Checks} */
export default {
  async R1(t) {
    const names = [(await t.probe()).name];
    for (let i = 0; i < 4; i++) names.push((await t.bot.press("start")).name);
    t.bot.eq(names, ["RUN", "DRIVE", "MAZE", "SPIN", "RUN"], "the scenes START steps through");
  },

  async R2(t) {
    t.bot.eq((await t.bot.wait(149)).name, "RUN", "the scene after 149 frames with nothing pressed");
    t.bot.eq((await t.bot.wait(1)).name, "DRIVE", "the scene after 150 frames with nothing pressed");
    await t.bot.wait(100);
    t.bot.eq((await t.bot.hold("left", 100)).name, "DRIVE", "the scene when a button was held before 150 frames were up");
    t.bot.eq((await t.bot.wait(150)).name, "MAZE", "the scene 150 frames after letting go");
  },

  async R3(t) {
    await t.bot.wait(60); // let the runner land
    const speeds = [];
    for (let i = 0; i < 14; i++) speeds.push((await t.bot.hold("right", 1)).runner.vx);
    for (let i = 0; i < 11; i++) t.bot.near(speeds[i], 0.2 * (i + 1), `speed after ${i + 1} frames of holding right`);
    t.bot.near(speeds[13], 2.2, "top speed");
    const a = await t.probe();
    const b = await t.bot.hold("right", 10);
    t.bot.near(b.runner.x - a.runner.x, 22, "pixels moved in 10 frames at top speed");
    for (let i = 1; i <= 11; i++) t.bot.near((await t.bot.wait(1)).runner.vx, Math.max(0, 2.2 - 0.2 * i), `speed ${i} frames after letting go`);
  },

  async R4(t) {
    const onScreen = (p, what) => {
      t.bot.ok(p.runner.x >= p.cam.x && p.runner.x + 10 <= p.cam.x + p.W, `${what}: the runner (x ${p.runner.x}) should be on screen (${p.cam.x} to ${p.cam.x + p.W})`);
      t.bot.ok(p.cam.x >= 0 && p.cam.x + p.W <= p.world, `${what}: the screen (${p.cam.x} to ${p.cam.x + p.W}) should stay inside the world (0 to ${p.world})`);
    };
    let p = await t.probe();
    t.bot.eq(p.world, 640, "the world's width");
    for (let i = 0; i < 40; i++) onScreen((p = await t.bot.hold("right a", 10)), `running right, frame ${i * 10}`);
    t.bot.near(p.cam.x, p.world - p.W, "the screen's left edge at the right end of the world", 0.5);
    t.bot.near(p.runner.x, p.world - 10, "the runner against the right end");
    for (let i = 0; i < 40; i++) onScreen((p = await t.bot.hold("left a", 10)), `running left, frame ${i * 10}`);
    t.bot.near(p.cam.x, 0, "the screen's left edge back at the start", 0.5);
  },

  async R5(t) {
    const a = await t.bot.wait(60);
    t.bot.ok(a.runner.onGround, "the runner should be standing on the ground after 60 frames");
    const up = await t.bot.press("a", 5);
    t.bot.ok(!up.runner.onGround && up.runner.y < a.runner.y - 10, `5 frames after A the runner should be in the air, higher than ${a.runner.y - 10} (y ${up.runner.y})`);
    const down = await t.bot.wait(60);
    t.bot.ok(down.runner.onGround, "the runner should have landed 60 frames later");
    t.bot.eq(down.runner.y, a.runner.y, "the runner's y after landing");
    t.bot.eq(down.runner.vy, 0, "the runner's falling speed after landing");
  },

  async R6(t) {
    const a = await goTo(t, "DRIVE");
    const alone = (await t.bot.wait(40)).view.angle - a.view.angle;
    const b = await t.probe();
    const left = (await t.bot.hold("left", 40)).view.angle - b.view.angle;
    t.bot.ok(alone > 0, `by itself the view turns right, round the ring (it turned ${alone})`);
    t.bot.ok(left < alone - 0.5, `holding left for 40 frames should turn the view at least 0.5 further left than by itself (${left} against ${alone})`);
  },

  async R7(t) {
    let p = await goTo(t, "MAZE");
    const from = { x: p.eye.x, y: p.eye.y };
    p = await t.bot.hold("up", 30);
    t.bot.ok(Math.hypot(p.eye.x - from.x, p.eye.y - from.y) > 0.8, `30 frames of up should walk most of a tile (from ${JSON.stringify(from)} to ${JSON.stringify(p.eye)})`);
    for (let i = 0; i < 60; i++) {
      p = await t.bot.hold(i % 7 < 2 ? "up left" : "up", 10);
      t.bot.ok(p.eyeOpen, `the walker is inside a wall at ${p.eye.x}, ${p.eye.y}`);
      t.bot.ok(p.eye.x > 1 && p.eye.x < 11 && p.eye.y > 1 && p.eye.y < 7, `the walker left the maze: ${p.eye.x}, ${p.eye.y}`);
    }
  },

  async R8(t) {
    const a = await goTo(t, "SPIN");
    const b = await t.bot.wait(30);
    const slow = b.spin - a.spin;
    t.bot.near(slow, 0.6, "how far the cars circle in 30 frames by themselves", 0.01);
    const c = await t.bot.hold("right", 60);
    const d = await t.bot.hold("right", 30);
    t.bot.near(d.spin - c.spin, 2.4, "how far they circle in 30 frames with right held", 0.01);
  },
};
