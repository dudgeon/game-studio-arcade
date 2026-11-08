# Local player

Plays carts from the dev cart library in a local browser, then asks their `(you check)` rules and logs the answers (phase-0 task 9; D70–D72). It grows into the Cabinet Manager's simulator in Phase 1.

```sh
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
node studio-kit/player/bin/studio-play.js            # http://127.0.0.1:8330/
node studio-kit/player/bin/studio-play.js --examples # also list runtime/examples/*
```

| Flag | |
| --- | --- |
| `--port N` | default 8330 (or `GSA_PLAYER_PORT`) |
| `--host H` | default 127.0.0.1 |
| `--carts DIR` | the cart library; default `~/game-studio-data/carts` (or `$GSA_DATA_DIR/carts`) |
| `--logs DIR` | where logs go; default `~/game-studio-data/logs` |
| `--examples` | add `runtime/examples/*`; the library wins on a name clash |
| `--checker X` | who answers you-check rules, as an initial; default `G` |

It prints the URL and never opens a window. `/?cart=<id>` starts a cart straight away.

## Using it

- **List:** stick up/down to choose, **A** (or START) to play, **X** to answer a cart's you-check rules now. A badge shows how many rules are still to check.
- **Play:** the runtime's host runs the cart, so keys and gamepads are exactly as in [runtime/README.md](../../runtime/README.md). **★** (Escape, or the pad's guide button) leaves the game.
- **Check:** after a play, if nobody has answered that cart version's you-check rules, it asks them one at a time: **Yes**, **No** or **Not sure**, with an optional typed note. **Later** (or B) skips; it asks again after the next play.

Keyboard in menus: arrows, Z = A, C = X, X = B, Enter = START, Escape = ★.

## What it logs (D72)

Appended to `~/game-studio-data/logs/`, in the same `{ "type": …, … }` JSONL shape as the CLI's records:

- `play.jsonl`: `id, cart_id, cart_version, commit, session_id, origin, sides, started_at, duration_s, ticks, early_quit, ended, errors`.
- `you_check.jsonl`: `id, cart_id, cart_version, commit, session_id, checker, play_id, answered_at, answers: [{rule, text, answer, said}]`.

The server fills in the version, commit and session from the library and only accepts rule ids that are `you check` rules of that cart's spec. Writes from another origin (including a cart's sandboxed frame) are refused. Nothing is ever overwritten; the latest `you_check` record for a cart version is its answer.

## Code

- `src/server.js`: `startPlayer(opts)` / `createPlayerHandler(opts)`. Serves `web/`, the JSON API, and hands everything else to the runtime's `createHandler` with the library's carts.
- `src/library.js`: reads the library on every request, so a newly committed cart appears without a restart.
- `web/`: the page. It imports the runtime's `host.js` and `input.js` from the server, so menu input uses the same key map and gamepad mapping as the carts. `window.player` (`view`, `host`, `act()`) is there for tests and the simulator later.

## Tests

`npm test -w studio-kit/player` type-checks (including `web/`), then runs:

- `test/server.test.js`: the cart list, static routes and path escapes, a newly added cart, both log records, every refused write, `--examples`.
- `test/browser.test.js`: headless Chromium through Playwright: keyboard play → ★ → both you-check answers → logs; a cart that fails to start; a fake gamepad driving the menu and leaving with guide; and that the cart's size and scale come from the runtime. It uses Playwright's own headless shell if installed, else the system Chrome in headless mode, and skips with a reason if neither launches. It never installs a browser.
