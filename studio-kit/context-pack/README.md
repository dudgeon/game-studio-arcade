# Context pack

Everything you need to build a cart on the house runtime, small enough to read in one go. Read it before you design.

1. **The cart API:** `runtime/README.md` (drawing, input, sound, saves) and `runtime/cart.d.ts`.
2. **The starter library:** `runtime/lib/REFERENCE.md`. Carts use it as `g.lib`. Reuse it; don't rewrite it.
3. **Recipes:** [RECIPES.md](RECIPES.md). Six patterns, each from a spec rule to code, probe and check.
4. **Example carts:** three tiny, complete carts that pass their playtest. Copy their shape, not their games.

| Cart | Folder | What it shows |
|---|---|---|
| Comet Dodge | [carts/dodge/](carts/dodge/) | free movement, a spawner, `collide.resolve`, lives, a "safe" timer after a hit, a speed-up curve |
| Wall Ball | [carts/paddle/](carts/paddle/) | ball velocity and bounces, `collide.overlap`, a serve delay, a saved best score |
| Gem Garden | [carts/collect/](carts/collect/) | a tile grid, `grid.stickStep` with `timers.repeat`, a timed round, a saved best score |

## A cart folder

- `spec.md`: the source of truth. Format: `studio-kit/spec/template.md` and `writing-rules.md`.
- `game.js`: one ES module, imports nothing, default export `{ init, update, draw, probe }`.
- `checks.js`: one async check per `(auto)` rule id. Format: `studio-kit/spec/checks-format.md`; the handle `t` is in `runtime/test-hook.d.ts`.
- `cart.json`: you write `{ "id": "comet-dodge", "title": "Comet Dodge", "players": 1 }` (`id` in kebab case, `title` as in the spec). The CLI adds `maker`, `with`, `parent`, `session_id`, `origin` and `created` (an ISO 8601 time) when it files the cart. `validate-cart` checks every field present.
- `assets/`: optional.

## House conventions

- **Never write the screen size as a number.** Use `g.W` and `g.H` in `game.js`, and put `W` and `H` in `probe()` so checks never hardcode it either. Lay out from them: `g.W / 2` for centre, `g.H - size` for the bottom edge. Text is 6 pixels a character, so a line holds `g.W / 6` characters.
- **One player.** Use player 1's stick, A B X Y and START. ★ never reaches the cart.
- **Screens with `g.lib.flow`:** title → play → over → title. `flow.startPressed` ignores presses for the first 30 frames of a screen, so checks step 31 frames before pressing START.
- **State in `s`, randomness from `g`.** `g.rnd`, `g.pick`, `g.rand` only. The playtest's `deterministic` check fails a cart that uses `Math.random` or the clock.
- **Probe what the rules talk about:** mode, positions, score, lives, timers, plus `W` and `H`. Checks read state, not pixels.
- **Check helpers live in `checks.js`** (it can't import). Each example has `start(t)` plus a small "bot" that reads the probe and steers.

## Commands

From the kit root (see `KIT.md`), for a cart folder `cart/`:

```sh
node studio-kit/spec/bin/gsa-spec.js coverage cart/      # every auto rule has a check
node studio-kit/playtest/bin/gsa-playtest.js cart/       # rules + generic checks -> cart/playtest.json
```
