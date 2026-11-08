# The `checks.js` format

Every cart with `(auto)` rules has a `checks.js` beside `spec.md` (D11). It holds one check per auto rule. The playtest harness runs them; `validate_cart` makes sure they line up with the spec.

## Shape

An ES module whose default export is an object keyed by rule id. Each value is an async function that takes the test handle `t`. Every method on `t` is async, so `await` each call:

```js
// One small helper is fine; checks.js can't import anything.
const expect = (ok, why) => { if (!ok) throw new Error(why); };

/** @type {Arcade.Checks} */
export default {
  R1: async (t) => {
    const before = (await t.probe()).player.x;
    await t.input([{ frames: 10, p1: "right" }]);
    await t.step(10);
    const after = (await t.probe()).player.x;
    expect(after === before + 20, `expected x to go from ${before} to ${before + 20}, got ${after}`);
  },

  R3: async (t) => {
    // …
  },
};
```

- **Pass or fail:** a check passes if it finishes and fails if it throws. The error message becomes the reason in `playtest.json`, so make it say what was expected and what happened.
- **The handle `t`:** `await t.step(n)` runs n frames, `await t.input(script)` queues button presses, `await t.probe()` returns what the cart's `probe(g, s)` export returns, `await t.frame()` captures the current frame, `await t.sounds()` lists the sounds started, and `await t.reset(opts)` starts the cart again. The exact types are in `runtime/test-hook.d.ts`, which is the source of truth for the input script and frame formats. `t.bot` is the tested check bot and `t.poke` sets up a situation (D162, D163): see `studio-kit/context-pack/modules/checks.md`.
- **Fresh game per check:** each check starts from a freshly loaded cart with the same seed, so checks don't depend on each other's order.
- **What a cart should expose:** give the cart's `probe(g, s)` export the state your rules talk about (positions, score, lives, the current screen). If a rule can't be checked from the probe, add what's missing to the probe rather than checking pixels.

## What validate_cart enforces

Run it with `validate-cart <cart-dir>` (or `validateCart(dir)` from this package). It checks the cart without running it; the playtest runs it. Any error means the cart doesn't publish. Warnings don't block. See D31.

**Rule coverage** (D30):

- an `(auto)` rule with no check;
- a check for a rule id the spec doesn't have;
- a check for a `(you check)` rule;
- a check that isn't a function;
- a missing `checks.js` when the spec has auto rules;
- `import`, `import()` or `require()` anywhere in `checks.js`;
- top-level code that reads files, starts processes, or runs longer than 5 seconds;
- any `spec.md` format error.

**`cart.json`:**

- it must exist and be a JSON object with `id` (lowercase letters, digits and dashes, like `sloth-snacks`), `title` and `players` (how many people the game is for, 1 to 8, the runtime's `MAX_PLAYERS`; more people than controllers means they take turns, D112);
- the fields the Studio adds when it files the cart (`version`, `maker`, `with`, `parent` as `cart-id@version` or `null`, `session_id`, `origin` as `cabinet` or `desktop`, `created` as an ISO time) must have that shape if present;
- an unknown field, or a title that differs from the spec's, is a warning.

**Cart-safe code** (D10, D13, D21), in `game.js` and `checks.js`:

- no imports of any kind in `game.js` (the starter library is `g.lib`);
- no DOM or browser APIs (`document`, `window`, `localStorage`, `requestAnimationFrame`, …);
- no network (`fetch`, `WebSocket`, `XMLHttpRequest`, workers, …);
- no `eval`, `Function` or `.constructor` tricks, and no backslash escapes in names;
- no host globals (`globalThis`, `process`, `require`, …);
- no timers (`setTimeout`, `setInterval`, …): count frames;
- no clock (`Date`, `performance`): use `g.frame`;
- no `Math.random` or `crypto`: use `g.rand`, `g.rnd` and `g.pick`;
- no `@ts-ignore`, `@ts-nocheck` or `@ts-expect-error`.

Words inside strings and comments, and property names like `s.document` or `{ fetch: 1 }`, are fine.

**Types:** `game.js` and `checks.js` are type-checked with `tsc` under `runtime/tsconfig.cart.json` (ES2023 only, no DOM, no Node, plus the `Arcade` types). `game.js` is checked as an `Arcade.Cart` and `checks.js` as `Arcade.Checks` even if you didn't annotate them, so a misspelled button name (`g.btn("jump")`), a missing `draw`, or `t.stepp()` is an error with its line. Annotating them yourself (`/** @type {Arcade.Cart<State>} */`) gets you better checks on your own state.
