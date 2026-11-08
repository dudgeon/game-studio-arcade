// Fixture: checks for the valid cart, unannotated so the type check adds Arcade.Checks.
const expect = (ok, why) => { if (!ok) throw new Error(why); };

export default {
  R1: async (t) => {
    const before = (await t.probe()).x;
    await t.input([{ frames: 10, p1: "right" }]);
    await t.step(10);
    const after = (await t.probe()).x;
    expect(after === before + 10, `expected x ${before + 10}, got ${after}`);
  },
  R2: async (t) => { await t.step(120); expect((await t.probe()).score >= 0, 'score went negative'); },
  R3: async (t) => { await t.step(1); expect((await t.probe()).lives === 3, 'should start with 3 lives'); },
  R5: async (t) => { await t.reset({ keepSave: true }); await t.step(1); },
};
