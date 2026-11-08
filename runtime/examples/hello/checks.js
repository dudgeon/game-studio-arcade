// @ts-check
// Checks for the hello cart; also the reference example of the checks.js
// contract (runtime/test-hook.d.ts).

/** @type {Arcade.Checks} */
export default {
  // R1: holding right moves the smiley right.
  async R1(t) {
    const before = await t.probe();
    await t.input([{ frames: 30, p1: "right" }]);
    await t.step(30);
    const after = await t.probe();
    if (!(after.x > before.x)) throw new Error(`holding right for 30 frames should move the smiley right (x ${before.x} -> ${after.x})`);
  },

  // R2: pressing A plays a sound and counts a beep.
  async R2(t) {
    await t.input([{ frames: 1, p1: "a" }]);
    await t.step(2);
    const p = await t.probe();
    if (p.beeps !== 1) throw new Error(`one press of A should count one beep, got ${p.beeps}`);
    const sounds = await t.sounds();
    if (sounds.length === 0) throw new Error("pressing A should play a sound, none played");
  },

  // R3: the best beep count survives a restart.
  async R3(t) {
    await t.input([{ frames: 1, p1: "a" }, { frames: 1 }, { frames: 1, p1: "a" }]);
    await t.step(4);
    await t.reset({ keepSave: true });
    const p = await t.probe();
    if (p.best !== 2) throw new Error(`best should still be 2 after a restart, got ${p.best}`);
  },
};
