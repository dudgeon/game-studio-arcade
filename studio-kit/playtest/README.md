# studio-kit/playtest

The playtest harness (D60–D63). It runs a cart's `checks.js` (one check per `(auto)` rule, D11), adds our own generic checks, saves key frames as PNG, and writes `playtest.json`.

## Run it

```sh
node studio-kit/playtest/bin/gsa-playtest.js path/to/cart            # node driver, writes path/to/cart/playtest.json
node studio-kit/playtest/bin/gsa-playtest.js path/to/cart --driver browser
node studio-kit/playtest/bin/gsa-playtest.js path/to/cart --rules R1,R3 --out /tmp/pt --json
```

**In the sandbox,** run the node driver first, then the browser driver with Playwright's global path on `NODE_PATH` (D18):

```sh
NODE_PATH="$(npm root -g)" node /workspace/kit/studio-kit/playtest/bin/gsa-playtest.js /workspace/cart --driver browser
```

Never `npm install` Playwright there; the preinstalled one is the right version.

The exit code is 0 when everything passes, 1 when a rule or generic check fails, and 2 when the harness couldn't run (no `spec.md`, no runtime, no Playwright).

Options: `--no-frames`, `--budget-ms N` (p95 frame-time budget; default 4 ms for node and 16.7 for browser, D64), `--soak-frames N` (default 600), `--seed N` (default 1), and `--runtime dir` (a runtime folder other than `../../runtime`, for development).

```js
import { playtest, comparable } from "./studio-kit/playtest/index.js";
const report = await playtest(cartDir, { driver: "node", out: null }); // out: null writes nothing
```

## What it checks

- **Rules:** each auto rule's check runs on a fresh cart (seed 1) in its own worker thread. It passes by returning and fails by throwing; the message is the reason. If the game itself throws, the reason says "the game crashed …" instead. Limits per check: 10 s of wall time (30 s in the browser) and 18,000 stepped frames.
- **Generic checks (ours, D61):** `loads`, `no-errors`, `soak` (600 frames of seeded random input on both players, plus 600 with no input), `palette` (pixels and the runtime's color warnings), `frame-time` (p95 update+draw per frame) and `deterministic` (the same seed and input must draw the same screens).

## Drivers

- `node` uses the runtime's `headless()`. It's fast and needs no browser.
- `browser` uses Playwright against `runtime/play.html?…&test=1` through `window.arcade.test`, served by `runtime/dev-server.js`. It gives the same report as `node` (the tests check this). The harness never installs Playwright (D63): it uses the copy it finds (`GSA_PLAYWRIGHT`, local `node_modules`, the global npm root, `/opt/npm-tools/node_modules`). For development, `npm install` gets 1.56.0, the sandbox's version, and `node node_modules/playwright/cli.js install --only-shell chromium` gets its browser.

## The report

`playtest.json` (D62) has `ok`, `rules` (`id`, `kind`, `text`, `status`, `passed`, `reason`, `frames`), `coverage` (spec/checks drift), `generic` (`id`, `name`, `status`, `passed`, `reason`), `frameTime`, `errors`, `warnings` (runtime dev warnings), `frames` (the PNGs in `playtest-frames/`) and `env`. `comparable(report)` drops `env` and the timing numbers. What's left must match on every machine.

## Tests

`npm test` here (or at the root). The fixtures are `dot-catch` (passes), `dot-catch-broken` (fails R1, R2, R5, `no-errors`, `soak`, `palette` and `deterministic` with readable reasons) and `hangs` (R2 loops forever). Most tests use a small stand-in runtime in `test/fake-runtime/`. The real-runtime and browser-parity tests run when `runtime/` and Playwright's Chromium are present, and are skipped otherwise.
