# The `checks.js` format

Every cart with `(auto)` rules has a `checks.js` beside `spec.md` (D11). It holds one check per auto rule. The playtest harness runs them; `validate_cart` makes sure they line up with the spec.

## Shape

An ES module whose default export is an object keyed by rule id. Each value is an async function that takes the test handle `t`:

```js
// One small helper is fine; checks.js can't import anything.
const expect = (ok, why) => { if (!ok) throw new Error(why); };

export default {
  R1: async (t) => {
    const before = t.probe().player.x;
    t.input(/* hold right on player 1 for 10 frames */);
    t.step(10);
    const after = t.probe().player.x;
    expect(after === before + 20, `expected x to go from ${before} to ${before + 20}, got ${after}`);
  },

  R3: async (t) => {
    // …
  },
};
```

- **Pass or fail:** a check passes if it finishes and fails if it throws. The error message becomes the reason in `playtest.json`, so make it say what was expected and what happened.
- **The handle `t`:** `t.step(n)` runs n frames, `t.input(script)` queues button presses, `t.probe()` returns the state the cart exposes through `g.probe()`, and `t.frame()` captures the current frame. The exact types are in `runtime/test-hook.d.ts`, which is the source of truth for the input script and frame formats.
- **Fresh game per check:** each check starts from a freshly loaded cart with the same seed, so checks don't depend on each other's order.
- **What a cart should expose:** give `g.probe()` the state your rules talk about (positions, score, lives, the current screen). If a rule can't be checked from the probe, add what's missing to the probe rather than checking pixels.

## What validate_cart enforces

Errors (the cart doesn't publish):

- an `(auto)` rule with no check;
- a check for a rule id the spec doesn't have;
- a check for a `(you check)` rule;
- a check that isn't a function;
- a missing `checks.js` when the spec has auto rules;
- `import`, `import()` or `require()` anywhere in `checks.js`;
- top-level code that reads files, starts processes, or runs longer than 5 seconds.

Only the rule ids are read at validate time. Top-level code should do nothing except define the checks.
