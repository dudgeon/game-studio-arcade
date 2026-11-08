# Context pack

What you need to build a cart on the house runtime. Read it all before you design.

1. **Cart API:** `runtime/README.md` and `runtime/cart.d.ts`.
2. **Starter library:** `runtime/lib/REFERENCE.md`, used as `g.lib`. Reuse it; don't rewrite it.
3. **Recipes:** [RECIPES.md](RECIPES.md), each from a spec rule to code, probe and check.
4. **Example carts**, complete and passing. Copy their shape, not their games:
   - [carts/dodge/](carts/dodge/) Comet Dodge: free movement, a spawner, `collide.resolve`, lives, a safe timer, a speed curve.
   - [carts/paddle/](carts/paddle/) Wall Ball: ball bounces, `collide.overlap`, a serve delay, a saved best.
   - [carts/collect/](carts/collect/) Gem Garden: a tile grid, `grid.stickStep` with `timers.repeat`, a timed round.

## A cart folder

`spec.md` (format: `studio-kit/spec/template.md`, `writing-rules.md`), `game.js` (one module, imports nothing, exports `{ init, update, draw, probe }`), `checks.js` (one async check per `(auto)` rule; `studio-kit/spec/checks-format.md`), `cart.json` (you write `{ "id": "comet-dodge", "title": "Comet Dodge", "players": 1 }`; the CLI adds the rest), and optional `assets/`.

## House conventions

- **No screen-size numbers.** Lay out from `g.W` and `g.H`, and return `W` and `H` from `probe()` for checks. A text line holds `g.W / 6` characters.
- **One player by default.** Player 1's stick, A B X Y and START; ★ never reaches the cart. A game for 2 or more people takes turns with `g.lib.turns` (REFERENCE.md). A check that needs two controllers at once calls `await t.reset({ players: 2 })` first.
- **Screens with `g.lib.flow`:** title → play → over → title. START is ignored for a screen's first 30 frames, so checks step 31 frames before pressing it.
- **Randomness from `g` only** (`g.rnd`, `g.pick`, `g.rand`). The `deterministic` check fails `Math.random` and the clock.
- **Probe what the rules talk about** (mode, positions, score, lives, timers). Checks read state, not pixels, and keep their helpers inside `checks.js`.

## Commands

From the kit root, for a cart folder `cart/`: `node studio-kit/spec/bin/validate-cart.js cart/`, then `node studio-kit/playtest/bin/gsa-playtest.js cart/`.
