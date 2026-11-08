# House runtime

A small JavaScript fantasy console: 256×192 (shown 4× on the Picade 10"'s 1024×768 panel, D81), 32 fixed colors, 4-voice chip synth, the cabinet's buttons, deterministic under test. Design: D3, D10, D11, D13, D21 and D50 in [../docs/decisions.md](../docs/decisions.md).

- **Cart API:** [cart.d.ts](cart.d.ts) (`Arcade.Cart`, `Arcade.G`, `Arcade.Lib.*`)
- **Test hook:** [test-hook.d.ts](test-hook.d.ts) (`Arcade.Checks`, `Arcade.TestHandle`)
- **Starter library:** [lib/REFERENCE.md](lib/REFERENCE.md), an index of `lib/ref/<module>.md` (carts use it as `g.lib`)
- **Example:** [examples/hello/](examples/hello/) (`game.js` + `checks.js`)

## Writing a cart

A cart's `game.js` is one ES module that **imports nothing**. Its default export has four functions. All game state lives in the object `init` returns, which comes back as `s`:

```js
// @ts-check
/** @typedef {{ x: number, score: number, board: Arcade.Lib.Grid }} State */
/** @type {Arcade.Cart<State>} */
export default {
  init(g) { return { x: g.W / 2, score: 0, board: g.lib.grid.make(10, 20) }; },
  update(g, s) { if (g.btn("right")) s.x += 2; if (g.btnp("a")) g.sfx("coin"); },
  draw(g, s) { g.cls(g.colors.night); g.text(`SCORE ${s.score}`, 4, 4, g.colors.white); },
  probe(g, s) { return { x: s.x, score: s.score }; },  // what checks.js can see
};
```

- **The clock** is a fixed 60 Hz. `update` runs once per frame, then `draw`. `g.frame` counts frames.
- **Input:**
  - `g.btn(b, p)` is true while a button is held;
  - `g.btnp(b, p)` is true on the frame it's pressed;
  - `g.btnr(b, p)` is true on the frame it's released.
  
  Buttons are `up down left right a b x y start`, and `p` is the player, 1 to 8 (default 1).
- **Players (D110–D113):** `g.players` is how many controllers the console has: **1 on the cabinet**, and 1 by default everywhere else. Games are single player by default. A player with no controller holds nothing (`g.btn("a", 2)` is false at `g.players === 1`), so a game for two people takes turns with `g.lib.turns`, which hands over controller 1 between turns.
- **Drawing** on 256×192 (`g.W`, `g.H`; use those, never the numbers), with colors 0–31 or by name (`g.colors.red`):
  - shapes: `cls pset pget line rect rectfill circ circfill`;
  - text: `text(s, x, y, c, {scale, align})` and `textWidth`;
  - sprites: `sprite(rows)` and `spr(s, x, y, {flipX, flipY, scale, color})`. In sprite rows, `0`–`9` and `a`–`v` are colors 0–31 and `.` is transparent;
  - view: `camera`, `clip`.
- **Randomness:** `g.rand()`, `g.rnd(n)` and `g.pick(arr)`. These are seeded, so tests reproduce. Never use `Math.random`.
- **Sound:** `g.sfx(name)` takes `blip select jump coin pop hit explode powerup lose win`. Also `g.tone({ note: "C5", wave, frames, vol, slide })` and `g.stop()`.
- **Colors outside 0–31** still draw (wrapped), but each one is reported once as a dev warning (`t.warnings()`, `arcade.warnings`, the browser console), so the playtest's palette check can flag it.
- **Saves:** `g.save(data)` and `g.load()` hold one JSON value of at most 4 KB, e.g. for a high score.
- **Library:** `g.lib.grid`, `g.lib.collide`, `g.lib.timers`, `g.lib.score`, `g.lib.flow`, `g.lib.turns` and `g.lib.fx`. See [lib/REFERENCE.md](lib/REFERENCE.md). Types are `Arcade.Lib.Grid`, `Arcade.Lib.Piece`, `Arcade.Lib.Timer` and so on.
- **Not allowed:** `document`, `window`, `fetch`, timers, `eval` and imports. The frame's sandbox blocks them anyway, and the type-check flags them.

`checks.js` has one async check per `(auto)` rule id. A check fails by throwing, and the message becomes the reason in the report. Each check's `t` also has the tested bot `t.bot` (D162, [lib/bot.js](lib/bot.js)), and `t.poke(o)` calls a cart's optional `poke(g, s, o)` to set up a situation (D163). See [test-hook.d.ts](test-hook.d.ts) and [examples/hello/checks.js](examples/hello/checks.js).

Commands (package.json `bin`):

- `arcade-run <game.js> [--frames N] [--seed N] [--players N] [--input JSON] [--checks checks.js]` runs the cart headless and prints `{ ok, frame, hash, probe, sounds, warnings, checks }`. It exits 1 on a cart error or a failed check.
- `arcade-dev-server [--port N] [--cart name=dir]` serves carts for a browser (below).
- Type-check a cart with no DOM: `tsc -p runtime/tsconfig.cart.json`, or copy that config for your cart folder.

## Play a cart

```sh
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
node runtime/dev-server.js                       # serves runtime/examples/* on :8320
node runtime/dev-server.js --cart mine=~/game-studio-data/carts/mine --port 8320
open "http://127.0.0.1:8320/runtime/play.html?cart=/carts/hello/game.js&fps=1"
```

Keyboard (dev):

| Player | Stick | A | B | X | Y | START |
|---|---|---|---|---|---|---|
| P1 | arrows | Z | X | C | V | Enter |
| P2 | W A S D | 1 | 2 | 3 | 4 | 5 |

Only players up to `?players=N` (default 1) get input, so add `&players=2` to use the P2 keys. Escape is ★, the leave-game key (the Picade's ESC button, D88): it goes to the host as `onStar` and never reaches the cart. Gamepads use the standard mapping: pad *k* is player *k*+1 (pad 0 is P1), for pads below `players`; guide on any pad is ★. The face buttons are A B X Y (0 1 2 3), START is 9, and the stick is the d-pad or the left stick (dead zone 0.5). Guide is ★.

`play.html` parameters:

- `cart`: the URL path of `game.js` on the same server (the frame's CSP is `script-src 'self'`).
- `seed`: default 1.
- `players`: how many controllers, 1–8 (default 1, like the cabinet). The cabinet passes its config's `players` to `createHost({ players })`.
- `test=1`: a paused clock and no live input. Frames only advance through `arcade.test.step()`.
- `save=<url-encoded JSON>`: the initial `g.load()` value.
- `fps=1`: show the fps, the scale and the tick count.

## Driving it from code

**Headless (Node, no browser).** This is the fastest way to run checks:

```js
import { headless } from "@game-studio-arcade/runtime";
const t = await headless("path/to/game.js", { seed: 1 }); // { players: 2 } for two controllers
await t.input([{ frames: 30, p1: "right" }]);
await t.step(30);
console.log(await t.probe(), (await t.frame()).hash);
```

**Browser (Playwright).** The contract the playtest relies on, kept stable:

```js
import { startServer } from "@game-studio-arcade/runtime/dev-server";
const s = await startServer({ port: 0, carts: { mine: "/abs/path/to/cart" } });
await page.goto(`${s.url}/runtime/play.html?cart=/carts/mine/game.js&seed=1&test=1`);
await page.waitForFunction(() => window.arcade);
await page.evaluate(() => window.arcade.ready);            // rejects with the load/init error
await page.evaluate(() => window.arcade.test.step(60));
const frame = await page.evaluate(() => window.arcade.test.frame()); // pixels: plain number[]
await s.close();
```

- `startServer({ port = 8320, host = "127.0.0.1", carts = {}, root })` resolves to `{ url, port, close() }`. Port 0 picks a free port.
- `createHandler(sameOptions)` returns a `(req, res)` handler to mount in another server.
- Routes: `/runtime/…` is this folder, `/carts/<name>/…` is each cart folder, and `/…` is `root` if given.
- Every response has `Access-Control-Allow-Origin: *` (the sandboxed frame has an opaque origin) and `Cache-Control: no-store`.
- `window.arcade` is set synchronously.
- `arcade.state` is `"loading" | "ready" | "error"`.
- `arcade.errors` collects every uncaught cart error as `{ message, stack, where, frame }`.
- `arcade.test` is the same `t` as headless. For a fresh cart, call `t.reset()` or reload the page.

## How it fits together

```
host page (play.html + src/host.js)            sandboxed iframe (frame.html + src/frame.js)
  owns: 60 Hz clock, keyboard/gamepad,  ─tick{n, masks}─▶  machine: update ×n, draw, render canvas
        WebAudio synth, saves           ◀─out{audio, save}─
  window.arcade.test  ─call{method,args}─▶  test handle (src/testhandle.js) ─result─▶
```

- **`src/machine.js`** is the console core: the `g` object, framebuffer, RNG, input edges, voices and the save slot. It has no DOM and no timers. Headless Node and the frame both run it, which is why their frame hashes match.
- **The host** accumulates fixed 60 Hz ticks on `requestAnimationFrame`, allowing 4 ms of slack so a 16.5 ms frame still gets exactly one tick. A key tapped and released between two ticks still counts as held for one frame.
- **Sandbox:** `sandbox="allow-scripts"` with no same-origin, plus CSP `default-src 'none'; script-src 'self'`. A cart can't fetch, use storage, cookies or eval, load images or remote modules, or reach the host page.

## Tests

`npm test` (from the repo root or `runtime/`) covers:

- input mapping (keyboard, gamepad, scripts);
- the palette;
- determinism (same seed and input give the same hashes; a different seed or input gives different ones);
- the `g` API, saves and errors;
- the dev server;
- the starter library.

`tsconfig.cart.json` type-checks carts the way `validate_cart` should, with no DOM and no Node types.
