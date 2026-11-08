# Decision log

Newest last. Each entry says who decided, and which HANDOFF section it settles or changes. Where an entry here and HANDOFF.md disagree, this file wins until the brief is updated.

## 2026-11-07 — kickoff

**D1. Spec rules come in two kinds.** *(Geoff; changes §7, §8.)*
- `auto` rules are proven by the playtest.
- `you-check` rules are confirmed by the kid on first play, e.g. a "Did the sloth look happy?" yes/no on the cabinet.

Every rule is still written so it's checkable, by a machine or by a person. The kid's answers are logged on the `cart_version` and fed into the next fork. This keeps the learning goal in the loop: the kid checks that the agent met the requirements.

**D2. Cabinet hardware: Pimoroni Picade Max kit plus a Raspberry Pi 5.** *(Geoff; closes §3.3 "which cabinet".)* 1280×1024 screen, bartop. Re-check price and stock live before buying. **Superseded by D80:** Geoff switched to the 10" Picade.

**D3. Screen: 320×256, fixed 32-color palette.** *(Claude, following D2; changes the §7 proposal.)* **Screen size superseded by D81** (256×192, for the Picade's 1024×768). The palette and the other limits below stand.
- 320×256 is 5:4 and scales exactly 4× to the Picade Max's 1280×1024, with no bars and no blur.
- 32 colors instead of 16 gives imported pictures (desktop flow) room after quantizing, and still keeps every game in one house look.
- The other §7 limits stand: the cabinet's buttons only, a 4-voice chip synth, no network, no DOM, persistence only through `g.save()`.

**D4. Cabinet software is stock Raspberry Pi OS Lite 64-bit (trixie, Debian 13) plus a versioned provisioning script.** *(Claude; implements §3.1 "built by a script and reproducible".)*
- No custom image build. The script installs the kiosk, cabinet service, players and config, with pinned versions and idempotent steps.
- Reproducible means: the same script and lock file on a freshly flashed stock card give the same cabinet.
- The Cabinet Manager runs a newer version of the script to update the cabinet.

**D5. Nothing is deleted, server-side included.** *(Geoff.)* Managed Agents sessions stay at Anthropic. We delete data only for a concrete functional benefit, such as a real storage cost. (Deleting a session also deletes its outputs, so this is the safe default anyway.)

**D6. Plugin tools come from a bundled MCP server.** *(Claude; platform constraint, changes §9.3 names.)* The plugin `game-studio` bundles a stdio MCP server `studio` with tools `new_cart`, `playtest`, `import_asset`, `validate_cart`. Full names are `mcp__plugin_game-studio_studio__<tool>`. No dotted tool names.

**D7. The cabinet's `arcade` MCP server uses streamable HTTP with a static bearer token** (the Manager pairing token) at `http://arcade.local:<port>/mcp`. *(Claude; platform constraint: OAuth needs HTTPS.)* The token goes in an environment variable named `ARCADE_TOKEN`, not a credential-like name.

**D8. Every cart passes a publish gate on the Pi, cabinet-built carts included.** *(Claude; changes the §3.2 proposal.)*
- The sandbox is x86 cloud, so only the Pi tells us real frame time.
- For cabinet builds, the gate is a fast smoke test: the cart loads, 10 seconds of random input, frame-time budget. The full auto rules already passed in the sandbox.
- Desktop publishes run the full playtest on the Pi.
- The gate runs at low priority and waits while a game is being played.

**D9. Node 22 everywhere**, matching the sandbox default. *(Claude.)* Pinned with `.nvmrc` and `engines`. The mini currently runs Node 26, so install `node@22`.

**D10. The runtime is deterministic under test.** *(Claude.)*
- Fixed 60 Hz timestep, seeded `g.rand`, and a test hook that steps frames and injects input.
- Playtests drive frames, not wall-clock time, so a report reproduces on any machine.

**D11. Auto rules are checked by a `checks.js` in each cart.** *(Claude; adds a file to the §7 cart format.)*
- One named check per `auto` rule id: scripted input plus assertions on state the cart exposes through `g.probe()`, and on frame pixels where needed.
- The harness adds generic checks on top: loads cleanly, no errors, random-input soak, palette compliance, frame-time budget.

**D12. Falling Blocks is built by the agent, not by hand.** *(Claude.)* The context pack's example carts must not be falling-blocks games, so the Phase 0 model comparison measures building rather than copying. After Phase 0 the best build becomes the seed cart in `carts-examples/`.

**D13. Carts run in a sandboxed iframe** (`sandbox="allow-scripts"`, no same-origin, CSP `default-src 'none'`) and talk to the runtime host through `postMessage`. *(Claude.)* This enforces no network and no host DOM. `validate_cart` also lints for DOM and network APIs.

**D14. Phase 0 logs and the dev cart library live outside this repo**, in `~/game-studio-data/` (logs as JSONL, the cart library as its own git repo). *(Claude; follows §15.)*

**D15. API auth uses Workload Identity Federation, not API keys.** *(Geoff asked for WIF; Claude designed it.)* **Superseded for now by D16:** the account can't use WIF.

How it works:
- Each machine that calls the Claude API (the mini now, the cabinet later) has its own ES256 signing key in `~/.config/game-studio-arcade/identity/<device>.key.pem` (0600, never in the repo).
- One "Custom OIDC" federation issuer, `https://game-studio-arcade.home.arpa`, carries the devices' public keys inline. Anthropic only string-compares that URL and never fetches it, so no public endpoint is needed.
- Each device gets its own service account and federation rule (`studio-<device>`), matched on subject `device:<device>` and audience `https://api.anthropic.com`, with scope `workspace:developer` in the `game-studio-arcade` workspace and a 600 s token lifetime.
- Devices mint 5-minute, single-use (`jti`) identity tokens with `scripts/wif/identity.mjs`.
- `.env` holds only non-secret IDs.

Setup: `scripts/setup-anthropic-auth.sh` (set `GSA_DEVICE=cabinet` for the Pi, and add its public key to the same issuer).

Phase 0 work:
- Our TypeScript code mints in-process for every exchange, through the SDK's identity-token provider. Check that the SDK accepts a function there.
- The `ant` CLI gets a wrapper that mints a fresh token file per invocation.

Honest trade-off: on home machines the signing key is still a long-lived secret on disk, so a stolen key is about as bad as a stolen API key. The gains:
- nothing secret is ever shown, copied or pasted, and the private key never leaves the device;
- API credentials expire in 10 minutes;
- each device has its own identity, with authentication history in the Console;
- revoking access means archiving one rule.

Fallback if WIF gets in the way: an API key from a dedicated workspace (one env var).

**D16. For now the mini signs in with the ant CLI's browser login.** *(Geoff chose this after WIF turned out to be unavailable.)*

What happened: Geoff's Console account is an *Individual* org. The Admin API and WIF aren't offered to Individual accounts (admin-api docs: "unavailable for individual accounts"). On 2026-11-07, with an `org:admin` login, the service-account and issuer endpoints returned 404 and the workspace listing returned 403. Nothing was created, and the admin session was logged out.

What we use instead:
- `ant auth login --profile game-studio-arcade`, bound to workspace `game-studio-arcade` (`wrkspc_01WedcsrdZuSF9AsHKRTJaFJ`).
- An OAuth token that lasts 8 h and refreshes itself, stored in `~/.config/anthropic/credentials/` (0600).
- The SDK and CLI pick it up through the active profile. Nothing secret is pasted, and `.env` holds no credentials.
- Setup or re-check: `scripts/setup-anthropic-auth.sh`.
- Verified: the Models list, Managed Agents agents list and environments list all succeed.

Still open:
- Confirm in Phase 0 task 1 that the TypeScript SDK resolves the profile.
- **Cabinet auth is undecided** (Phase 1–2). Browser login fits a machine with a person present, not an unattended Pi. The options: convert the Console account to an organization (unlocks WIF; `scripts/wif/` is ready), or a workspace-scoped key on the Pi. Ask Geoff when Phase 1 starts.

**D17. One way to get a Claude API client: `@game-studio-arcade/auth`.** *(Claude, Phase 0 task 1; implements D16.)*
- `createClient()` returns an SDK client (`@anthropic-ai/sdk` pinned at 1.6.0) and passes the profile **explicitly**: `GSA_PROFILE` if set, otherwise `game-studio-arcade`. An explicit profile outranks `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`, so a stray key in a shell is ignored rather than refused (verified live with a bogus key). This replaces the task wording "refuse to run if ANTHROPIC_API_KEY is set": ignoring the key is safer and never blocks.
- `createClient()` rejects `apiKey`, `authToken`, `credentials` and `config` options.
- `checkAuth()` makes one free `GET /v1/models` and turns auth failures into an `AuthSetupError` that points at `scripts/setup-anthropic-auth.sh`.
- `npm run check -w @game-studio-arcade/auth` is the live check. Every Studio-side Node tool (CLI driver, cabinet service, Manager) gets its client from here, never from `new Anthropic()` directly. The cabinet will get its own profile through `GSA_PROFILE` once its auth is decided (D16).

**D18. Sandbox toolchain pins, from the probe** (session `sesn_01Qbgy4bgLKvukuMevfJDiU5`, 2026-11-07). *(Claude, Phase 0 task 1.)*
- **Playwright 1.56.0, exactly.** It's what `npm root -g`, `npx playwright` and Python resolve to (`/opt/npm-tools/node_modules/playwright`), and its browsers are in `/opt/pw-browsers` (`chromium-1194`, Chromium 141.0.7390.37). A second copy, 1.56.1 in `/opt/node-tools`, is not on any default path: ignore it.
- **The local playtest harness pins `playwright` at `1.56.0`** (no caret). The task 5 worker owns that package.json.
- In the sandbox the harness must load Playwright with `NODE_PATH="$(npm root -g)"`. The sandbox's default `NODE_PATH` points elsewhere (`/usr/local/lib/node_modules_global`). It must never `npm install`: the network is blocked anyway.
- Node is 22.22.0 in the sandbox and 22.23.x on the mini; the same major is enough. TypeScript 6.0.3 is installed globally in the sandbox, matching D20, so agents can run `tsc --checkJs` offline.
- Re-probe (`npm run probe -w @game-studio-arcade/probe`) when the docs announce a new sandbox image, or if a playtest that passes locally fails in the sandbox.

**D19. How drivers handle session files and cost.** *(Claude, Phase 0 task 1; from the probe.)*
- **Outputs keep syncing after idle.** `probe-report.txt` was downloaded at 6,244 bytes; the finished file, 9,241 bytes, showed up about 4 s after `session.status_idle`. The agent must write a marker file (`/mnt/session/outputs/DONE.json`, with a manifest) **last**. The driver polls `files.list({scope_id})` until the marker is there and the sizes match the manifest, then downloads.
- `files.list({scope_id: session})` also returns the session's **uploaded inputs** (the kit tarball), so filter by name or path.
- Mount files at absolute paths under `/mnt/session/uploads/`. They're read-only (confirmed), and tarballs extract fine with GNU tar 1.35. On macOS, pack kits with `tar --no-xattrs --no-mac-metadata`.
- **Cost:** read `usage.list_cost` from the session object (authoritative), or the `session.usage` event, which arrived at the end of the turn, not only at a budget stop. It's rounded to the cent, so cheap sessions read `"0"`: log the raw `usage` token counts and `active_seconds` alongside it. The probe cost about 0.3¢ (tokens about 0.09¢, runtime 79.5 s ≈ 0.18¢).
- Agents for unattended runs use `permission_policy: always_allow` inside the offline sandbox. Nothing there can reach the network.

**D20. TypeScript 6 (pure JS) for type-checking; no bundler.** *(Claude, scaffolding+runtime worker; implements Phase 0 task 0.)*
- The repo is plain ES modules on Node 22. TypeScript only type-checks JS (`tsc --checkJs`, `noEmit`) against hand-written `.d.ts` files. Nothing is compiled, so `npm run build` leaves `git status` clean.
- Pinned to `typescript@6.0.3`, not 7.x. TypeScript 7 is the native compiler and installs one platform binary, so a kit packed on the mini (darwin-arm64) wouldn't run in the x86 sandbox or on the Pi. 6.x is pure JS and runs anywhere offline.
- Root `npm test` = type-check, then each workspace's `node:test` suite.

**D21. House runtime v0 shape.** *(Claude, scaffolding+runtime worker; implements Phase 0 task 2, refines D11 and D13.)* The contract is `runtime/cart.d.ts` and `runtime/test-hook.d.ts`.
- **A cart** is `game.js`, an ES module that imports nothing. Its default export is `{ init(g) → state, update(g, s), draw(g, s), probe?(g, s) }`. All game state lives in the object `init` returns.
- **Probe (refines D11):** the state checks see comes from the cart's own `probe(g, s)` export, not a `g.probe()` call. It's read only when a check asks, so it costs nothing in play.
- **Types without paths:** the types are global (`Arcade.Cart`, `Arcade.Checks`, `Arcade.TestHandle`). A cart type-checks with `tsc --checkJs` plus those two files, wherever it lives.
- **The test handle `t`** has `step(n)`, `input(script)`, `probe()`, `frame()`, `sounds()` and `reset()`, all async. An input script is a list of `{ frames, p1, p2 }` steps holding buttons. A check fails by throwing, and the message becomes the reason in the report. The same handle runs headless in Node (no browser), inside the cart frame, and on the host page as `window.arcade.test` for Playwright.
- **The host owns the clock, input, sound and saves.** The host page accumulates fixed 60 Hz ticks on requestAnimationFrame and posts each tick, with the held buttons, to the frame. The frame runs update and draw and replies with sounds and saves. Reasons:
  - a sandboxed frame has no storage;
  - audio needs a user gesture on the host;
  - the Gamepad API is read on the host;
  - the frame stays a pure function of ticks and input.
- **Frame loading (refines D13):** the frame is a real page, `runtime/frame.html`, in an iframe with `sandbox="allow-scripts"` and no same-origin. Its CSP is `default-src 'none'; script-src 'self'`, so code loads only from the server that serves the runtime and carts, and there's no fetch, socket, image or frame access. Module scripts from an opaque origin are CORS fetches, so the runtime server sends `Access-Control-Allow-Origin: *`. `runtime/dev-server.js` exports a handler that the player, the Manager and the playtest reuse.
- **Rendering:** a 320×256 palette-indexed framebuffer, drawn inside the frame. The host sizes the iframe to the largest integer multiple in device pixels (4× on the Picade Max's 1280×1024). *Size superseded by D81: 256×192, still 4× on the 10" Picade's 1024×768.*
- **Palette:** our own 32 colors with names (`g.colors.red`); index 0 is black.
- **Font:** a 5×7 bitmap font in a 6×8 cell, printable ASCII, scalable by whole numbers.
- **Sprites:** rows of characters, `0`–`9` and `a`–`v` for palette indices 0–31, `.` for transparent.
- **Sound:** 4 voices (square, pulse, triangle, saw, noise) with `g.tone` and named `g.sfx` presets.
- **Saves:** `g.save` is one JSON value per cart, at most 4 KB.
- **Dev keyboard:** P1 is the arrows, Z X C V for A B X Y, and Enter for START. P2 is W A S D, then 1 2 3 4 for A B X Y and 5 for START. Escape stands in for ★ and never reaches the cart. Gamepads use the standard mapping: pad 0 is P1, pad 1 is P2, with face buttons A B X Y = 0 1 2 3, START = 9, the d-pad or left stick (dead zone 0.5), and guide = ★. The Picade's own key map is set in Phase 2 (now D82: the cabinet's controls emit these same P1 keys).
- **Timing and taps:** the host gives `requestAnimationFrame` 4 ms of slack, so a jittery 16.5 ms frame still gets exactly one tick, and it never runs more than 4 ticks per frame. A key pressed and released between two ticks still counts as held for one frame, so quick taps aren't lost.
- **Checked 2026-11-07 in Chrome on the mini:**
  - the hello cart ran at 60 fps, 60 ticks/s;
  - a frame costs 0.4 ms median and 1.2 ms p95, including the postMessage round trip and the canvas draw;
  - browser and headless Node gave the same frame hash for the same seed and input;
  - a hostile test cart was blocked from fetch, localStorage, cookies, the parent DOM, eval, images and remote imports.
- **Resized to 256×192 for D81.** Rechecked in headless Chromium: 60 fps, scale 4 on 1024×768, a frame costs 0.6 ms median, and the browser and Node hashes match.
- **Out-of-range colors** (e.g. 40, or 2.5) still draw, wrapped into 0–31, so a kid's game never crashes over one. Each kind is reported once as a dev warning, through `t.warnings()`, `window.arcade.warnings` and the browser console, so the playtest's palette check can catch it. `warnings` is optional on `Arcade.TestHandle`, so existing wrappers stay valid.

**D30. The `spec.md` line format, rule ids, and how `checks.js` is read.** *(Claude, Phase 0 task 4; settles the §7 details.)*
- The title line is `# <Title>`, followed by one byline: `maker: <initial> · with: <initial or —> · parent: <cart@version or —> · session: <id or —>`. `cart.json` stays the machine record; the byline is for people.
- Sections are `##` headings in the order Pitch, Rules, Controls, Look & sound, Assumptions, Changelog. A missing or out-of-order section is an error. An unknown section is kept as written and reported as a warning.
- A rule is one list item: `- R<n> (auto): <text>` or `- R<n> (you check): <text>`. Indented lines continue the rule. Assumptions are `- A<n>: <text>`; changelog entries are `- v<n>: <text>`.
- Ids are stable for the life of a cart and its forks: never renumbered, never reused. A removed rule leaves a gap, and the Changelog says why. A fork adds rules after the parent's highest id.
- `checks.js` must be self-contained (no `import`); everything it needs comes through the test handle `t`. `validate_cart` reads its keys by importing it in a child Node process with the permission model on (read access to the cart folder only, no child processes or workers) and a 5-second timeout. Node 22's permission model doesn't block the network, so this limits, not seals; the playtest harness is where checks really run.
- Coverage rules: every `auto` rule needs a check (error); a check with no matching rule, or on a `you check` rule, is an error too, since it means the spec and checks have drifted.

**D31. What `validate_cart` checks, and where it lives.** *(Claude, full-validate-cart worker; completes D6's `validate_cart`, implements D13's lint.)*
- `validateCart(cartDir)` and the `validate-cart` bin live in `studio-kit/spec`, beside rule coverage, so the kit ships them and `KIT.md` lists the command. It never writes to the cart folder. Any error fails the cart; warnings never do. Each issue carries `file`, `line`, `check` (`coverage`, `cart.json`, `lint` or `types`) and a message written for the agent.
- **cart.json:** `id` (lowercase slug, at most 40 characters), `title` and `players` (1 or 2) are required, because that is what the agent writes. The fields the CLI or cabinet adds when it files the cart (`version`, `maker`, `with`, `parent` as `cart-id@version` or null, `session_id`, `origin`, `created`) are checked only if present, so the same check passes before and after filing. Unknown fields and a title that differs from the spec's are warnings.
- **Lint (D13):** `game.js` and `checks.js` may not use imports (game.js; checks.js imports are already a coverage error), DOM or browser globals, network APIs, `eval`/`Function`/`.constructor`, host globals (`globalThis`, `process`, `require`), timers, the clock (`Date`, `performance`), `Math.random` or `crypto` (D10, D21), backslash escapes in names, or `@ts-ignore`/`@ts-nocheck`/`@ts-expect-error`. A small tokenizer skips strings, comments, template text and regexes, and property names (`s.document`, `{ fetch: 1 }`) are allowed. The lint is a guardrail that explains itself; the sandboxed frame (D13, D21) is the boundary.
- **Types:** `tsc` runs over copies of `game.js` and `checks.js` in a temp folder with a tsconfig that `extends` `runtime/tsconfig.cart.json` (ES2023, no DOM, no Node, plus `cart.d.ts` and `test-hook.d.ts`). The copies get `/** @type {Arcade.Cart<any>} */` (or `Arcade.Checks`) in front of `export default` on the same line, unless the file already has that annotation, so line numbers still match and unannotated carts are still checked: a bad button name, a missing `draw` or a misspelled `t` method fails. Globals the lint list doesn't name (`parent`, `top`) fail here as unknown names.
- **Finding tsc:** the repo's `typescript` devDependency, then `tsc` on PATH (the sandbox's global TypeScript 6.0.3, D18), then known global npm roots. No tsc is an error, not a silent pass; `types: false` (`--no-types`) skips the pass on purpose and the report says so.

## 2026-11-07 — Studio agent and CLI driver (Phase 0 tasks 7–8)

Decided by Claude (the tasks 7+8 worker) from live Managed Agents docs, before any live session. Each needs confirming by the first real session; see `studio-kit/managed-agent/README.md` for what is still unproven.

**D40. The Studio agent is applied from `studio-kit/managed-agent/` as an `ant apply` project.** *(Claude; implements phase-0 task 7.)*
- Files: `agents/studio.md` (frontmatter = config, body = system prompt), `agents/tools/*.json` (custom tools, inserted by glob), `environments/studio.yaml`.
- `agents/studio.md` instead of the plan's `studio.agent.md`: `ant apply .` infers a file's kind from its directory, so this layout needs no flags.
- Run `ant apply .` **from that directory**, so `claude-lock.json` lands there (the lockfile is written in the current directory) and is committed with the files.
- The agent's default model is Sonnet 5.5. A run picks its model with a session-level `agent_with_overrides` (`model: {id}`), which never versions the agent.
- Toolset `agent_toolset_20260401` with `web_fetch` and `web_search` disabled; environment `limited` with no hosts and no package managers.
- The context pack ships inside the kit tarball. Attaching it as a custom skill instead is an experiment for the first live sessions, not the default.

**D41. Studio sessions use three custom tools.** *(Claude; extends HANDOFF §9.1.)*
- `ask_player`: exactly as §9.1. Results `{"choice":"A"|"B"|"D"}` or `{"choice":"C","said":"…"}`.
- `show_plan`: the "Here's the plan" step (§8.1 step 4). Input `{summary, rules:[{id, kind: "auto"|"you-check", text}]}`, where `text` is the rule in plain words. Result `{"choice":"build"}` or `{"choice":"change","said":"…"}`. After a change the agent edits the spec and calls `show_plan` again.
- `tell_player`: a short progress line in kid language (`{message, stage}`), answered at once with `{"ok":true}`. The front end shows these instead of the agent's raw text.
- Once a player picks D, the relay answers any further `ask_player` with D automatically and counts it as a protocol slip.

**D42. Kit in, one tarball out.** *(Claude.)*
- The kit is one tarball, mounted at `/mnt/session/uploads/studio-kit.tgz`, with a generated `KIT.md` saying what's inside and which commands validate and playtest a cart. The agent reads `KIT.md` rather than having command names in its prompt.
- Uploads are cached by a content hash of the kit's files (in `~/game-studio-data/kit-uploads.json`), so an unchanged kit is uploaded once.
- The agent builds in `/workspace/cart/` and writes outputs as flat files: `spec.md` (as soon as the plan is accepted), and at the end `cart.tgz` (the whole cart folder) and `report.json` (`status`, per-rule results, summary). Flat, because the Files API lists only a `filename` for each output, so folder structure isn't guaranteed to survive.
- Following D19: the agent writes `DONE.json` (`{files: [{name, size}]}`) last. The driver polls `files.list` until it's there and every listed size matches, skips the session's inputs (`studio-kit.tgz`), and still keeps whatever arrived if it gives up (`outputs_complete: false`). The kit mounts at `/mnt/session/uploads/studio-kit.tgz`, and is packed with `--no-xattrs --no-mac-metadata` on macOS.

**D43. The CLI keeps everything and commits only what passes.** *(Claude; implements phase-0 task 8 and D14.)*
- Every session's downloads, answers and local reports go to `~/game-studio-data/sessions/<session_id>/`, pass or fail.
- A cart is committed to the dev cart library (`~/game-studio-data/carts/`, its own git repo) only when `validate_cart` passes and every `auto` rule passes the local playtest. `--commit-anyway` overrides this.
- A new cart never overwrites one: an id that's taken gets a numeric suffix.
- Log records (§9.5) are appended to `~/game-studio-data/logs/studio_session.jsonl` and `cart_version.jsonl`. List cost is read from the session's `usage.list_cost` (whole cents as a string; D19). It rounds to the cent, so each record also logs `active_seconds` and the token counts.
- Answers replay by position: `--answers <file>` gives the same answers in the same order to every model. If a run asks more questions than were recorded, the replay answers D and the log marks `replay_exhausted`. Every run saves its answers, so a live run can be replayed.

## 2026-11-07 — Starter library (Phase 0 task 3)

**D50. Carts reach the starter library as `g.lib`.** *(Claude, director-approved; Phase 0 task 3, keeps D21's "a cart imports nothing".)*
- `runtime/lib/index.js` exports one namespace per module: `g.lib.collide`, `g.lib.grid`, `g.lib.timers`, `g.lib.score`, `g.lib.flow`. The runtime (headless.js and frame.js) imports it and sets `g.lib`. `cart.d.ts` types it as `typeof import("./lib/index.js")`. No import maps, no loader hooks, no tsc `paths`.
- Library code is cart-side: it type-checks under the cart rules (ES2023, no DOM, no Node), imports nothing outside `runtime/lib`, and uses no `Math.random`, wall clock or module-level state. One copy is shared across `reset()`, so all state lives in plain JSON objects the cart keeps in its own state. That also lets `probe()` return those objects as they are.
- Functions that need the console take `g` as their first argument. Everything else is pure.
- `g.save()` holds one value per cart, so the score helpers read and merge a field of a saved object (`{ best: 1200, ... }`) and never overwrite the cart's other saved fields.
- The reference is `runtime/lib/REFERENCE.md`: one paragraph per exported function, written for an agent. A test fails if an export is missing from it.

**D60. The playtest harness runs every check in its own worker, with two drivers behind one handle.** *(Claude, Phase 0 task 5; implements §8 and D11.)*
- `playtest(cartDir, opts)` in `studio-kit/playtest/` reads `spec.md` with `rulesOf()`, imports `checks.js`, runs each check and the generic checks, and writes `playtest.json`. The CLI is `gsa-playtest <cart> [--driver node|browser] [--rules R1,R3] [--out dir]`; the plugin's `playtest(path, rules?)` tool wraps it.
- **Drivers.** `node` (default) uses the runtime's `headless()`; `browser` uses Playwright against the host page's `window.arcade.test` (browser parity, real canvas). Both give the check the same `t` from `runtime/test-hook.d.ts`.
- **Isolation and hangs.** Each check, and each generic run, gets a fresh `worker_thread` with a freshly imported cart at seed 1, so a module-level variable can't leak between checks. A cart stuck in a `while` loop can't be interrupted in-process, so the main thread enforces limits and terminates the worker: **10 s of wall time** and **18,000 stepped frames** (5 game minutes) per check. Both fail the check with a plain reason.
- **Crash vs. wrong.** If `t.step()` rejects, the reason says the game crashed (with the frame and message), not that the rule was wrong.
- The cabinet service should run the CLI as a child process rather than import it, because checks are agent-written code.

**D61. Generic checks: six, all ours.** *(Claude, Phase 0 task 5; implements D11, adds one.)*
- `loads`: the cart imports, `init` runs, one frame steps and draws, and `probe()` returns JSON.
- `no-errors`: nothing the cart did threw anywhere in the run (checks and generic runs).
- `soak`: 600 frames (10 s, as in D8's gate) of seeded random input on both players, START included, from our own PRNG, plus 600 frames with no input. No crash, no hang, and `probe()` stays JSON.
- `palette`: every captured frame (load, one per 60 soak frames, and the end of each check) holds only palette indices 0–31. The runtime wraps any color number into 0–31 and records a dev warning, so the check also fails on any color warning from `t.warnings()` (see D64).
- `frame-time`: update+draw time per soak frame. Default budget (D64 sets the browser's): **p95 ≤ 4 ms** off the Pi (a quarter of a 60 Hz frame, leaving headroom for a Pi that is several times slower) and ≤ 16.7 ms when `--budget-ms` is set for the Pi gate (D8). Provisional until Phase 2 measures the Pi.
- **`deterministic` (new):** the no-input run and the soak each run twice from the same seed and input, and the frame hashes (one per 60 frames) must match. The no-input pair still measures this when the soak crashes early. A cart that uses `Math.random` or the clock breaks D10, and every other report from it would be unreproducible.

**D62. `playtest.json` and key frames.** *(Claude, Phase 0 task 5; settles the §7 "last report" shape.)*
- Written to the cart folder by default (§7), or to `--out`. Fields: `schema: 1`, `cart`, `driver`, `seed`, `ok`, `rules` (every spec rule in spec order, `status` = `pass` | `fail` | `missing` | `you-check` | `skipped`, with `reason`, `frames` stepped, and `passed`: true, false, or null when the playtest doesn't decide), `coverage` (drift errors from `checkCoverage()`), `generic` (`id` and `name`, `status`, `passed`, `reason`), `frameTime` (`frames`, `meanMs`, `p50Ms`, `p95Ms`, `maxMs`, `budgetMs`), `errors` (every crash, with where and frame), `frames` (key frame list), and `env` (Node, Playwright and browser versions, platform, time).
- `ok` is true only when every auto rule passes, coverage has no errors, and every generic check passes.
- **Same cart, same report:** everything except `env` and the timing numbers in `frameTime` (and the `frame-time` status) must be identical on the mini and in the sandbox. `comparable(report)` returns that part, and the parity test compares it.
- **Key frames** are 8-bit indexed PNGs in the house palette, written without dependencies to `<out>/playtest-frames/`: `load.png`, `soak-<frame>.png` every 120 soak frames, and `<rule id>.png` (the screen when each check ended, pass or fail). Whether the cart library commits them is task 8's call.
- CLI exit code: 0 ok, 1 a rule or generic check failed, 2 the harness couldn't run (no spec, no runtime, no Playwright).

**D63. The harness never installs Playwright, and needs no `node_modules`.** *(Claude, Phase 0 task 5; implements the §5 sandbox constraint and D18.)*
- The browser driver looks for Playwright in this order: `GSA_PLAYWRIGHT` (a path to the package), the kit's own `node_modules`, the global npm root, then `/opt/npm-tools/node_modules` (where the sandbox has it). It uses whatever browsers `PLAYWRIGHT_BROWSERS_PATH` points at, and falls back from the headless shell to the full Chromium build (`channel: "chromium"`) if only that is present. If nothing works it stops with exit 2 and says so.
- For development on the mini, `studio-kit/playtest` pins `playwright` **1.56.0** exactly, the sandbox's version (D18; Chromium 141.0.7390.37). The packed kit leaves it out.
- The harness imports the spec package and the runtime by relative path (`../../spec`, `../../../runtime`), not by package name, because the packed kit has no `node_modules` (D42). Checked by running a packed and extracted kit.

## 2026-11-07 — Local player (Phase 0 task 9)

Decided by Claude (the task 9 worker). The player is `studio-kit/player/`; it grows into the Cabinet Manager's simulator in Phase 1.

**D70. The local player is one Node server in front of the runtime's handler.** *(Claude; implements phase-0 task 9.)*
- `studio-play [--port 8330] [--host 127.0.0.1] [--carts DIR] [--examples] [--checker G]` serves the player page at `/`, a small JSON API at `/api/…`, and hands every other path to the runtime's `createHandler` (`/runtime/…`, `/carts/<id>/…`), so carts load exactly as in the playtest.
- The cart library is read on every request (`~/game-studio-data/carts`, or `GSA_DATA_DIR`), so a cart the CLI just committed shows up without a restart. Only folders with a `game.js` count. `--examples` adds `runtime/examples/*` for trying it without a library.
- It binds to 127.0.0.1 by default and never opens a browser window itself; it prints the URL.
- The page takes the screen size and scale from the runtime's host (it never names 320×256), so a new screen size needs no player change.
- Menus work with the keyboard and a gamepad through the runtime's own input map: stick up/down to move, A or START to pick, B or ★ (Escape, guide) to go back. ★ during play leaves the game.

**D71. You-check questions come after the first play of each cart version.** *(Claude; implements D1 for Phase 0.)*
- When a play of a cart version ends and nobody has answered that version's `you check` rules yet, the player asks them one at a time, each with the rule in the spec's words and three answers: **Yes**, **No**, **Not sure**, plus an optional typed note. "Later" skips; "Check rules" on the cart list asks again any time.
- Each round of answers appends one record; nothing is overwritten (§3.1 "never delete data"). The latest record per cart version is the current answer.
- The server fills in the cart's version, library commit and session from the library, and accepts only rule ids that are `you check` rules of that cart's spec.

**D72. Two new log records, in the CLI's JSONL shape.** *(Claude; extends §9.5, follows D14 and D43.)* Appended as `{ "type": …, … }` lines to `~/game-studio-data/logs/<type>.jsonl`, like `studio_session` and `cart_version`.
- `you_check`: `id`, `cart_id`, `cart_version`, `commit`, `session_id`, `checker`, `play_id`, `answered_at`, `answers: [{rule, text, answer: "yes"|"no"|"not_sure", said}]`. `said` is the note (or null), the same name the CLI uses for typed text. `checker` comes from `--checker` (default `G`, since Geoff answers in Phase 0).
- `play` (§9.5): `id`, `cart_id`, `cart_version`, `commit`, `session_id`, `origin: "desktop"`, `sides` (which players pressed anything: `["p1"]`, `["p1","p2"]` or `[]`), `started_at`, `duration_s`, `ticks`, `early_quit`, `ended` (`star`, `back`, `left_page`), `errors` (cart error count).
- `early_quit` means the play lasted under 30 seconds. A cart can't tell us "game over" yet, so this is a stand-in; revisit when the launcher logs plays in Phase 1.

## 2026-11-07 — Switch to the 10" Picade

Specs were checked live on 2026-11-07. Sources and details are in [platform-notes.md](platform-notes.md#picade-10-inch-2025-edition).

**D64. Frame time is judged with a whole-frame budget in the browser; colors are judged by runtime warnings.** *(Claude, Phase 0 task 5 follow-up; refines D61 after the sandbox parity run.)*
- In the sandbox, trivial `dot-catch` took p95 3.5 ms (max 108.7 ms) per frame in the browser driver. Most of that is the page round trip and cloud-VM noise, not the cart, so a 4 ms budget would fail heavier carts for the wrong reason.
- **Default budgets:** the node driver keeps p95 ≤ 4 ms (update+draw only, the number that predicts the Pi). The browser driver gets p95 ≤ 16.7 ms, a whole 60 Hz frame, which still catches a cart that can't keep up. `--budget-ms` overrides either. The real frame-time verdict stays on the Pi (D8).
- The agent runs the node driver first (the default) and the browser driver for parity.
- **Palette:** every job reads `t.warnings()` when the handle has it. The report lists each warning once in `warnings`, and any color warning fails `palette` with the runtime's message. `comparable()` keeps `warnings`, since they're deterministic.

**D80. Cabinet hardware: Pimoroni Picade with 10" display, plus a Raspberry Pi 5 8 GB. Both ordered 2026-11-07.** *(Geoff; supersedes D2.)*
- Picade: Pimoroni PIM469, PiShop US SKU 2009, $349.95, in stock (pishop.us/product/picade-with-10-inch-display). Pi 5 8 GB: PiShop SKU 8GB-9028, $175.00, in stock.
- What changes from the Max: a 10" 1024×768 (4:3) panel instead of 19" 1280×1024 (5:4). **One player's controls**: one joystick, six player buttons, four utility buttons and a power button, all on a Picade X HAT. A desk-sized cabinet (310 × 260 × 250 mm, H × W × D).
- Still to get (not ordered, not decided here): a USB-C power supply (Pi 5 wants 5 V/5 A, e.g. the official 27 W supply, $12.95 at PiShop), an Active Cooler (Pimoroni recommends one; $12.95 at PiShop), a microSD card, and a mic (still open, Geoff).
- The hardware rule (§3.1, kit if not prebuilt with a Pi 5) still holds: this is a kit.

**D81. Screen: 256×192, 4× to the Picade's 1024×768.** *(Claude, following D80; supersedes D3's size. The 32-color palette and the other D3 limits stand.)*
- 1024×768 divides by whole numbers only at 2, 4 and 8, so the sizes that fill the panel are 512×384, 256×192 and 128×96. 256×192 at 4× fills it with no bars and no blur.
- It keeps the house look: each game pixel is 4×4 panel pixels, as 320×256 was on the Max, so it stays chunky and sharp. (On the smaller panel a game pixel is about 0.8 mm across instead of 1.2 mm, viewed from closer.) 256 wide is also the §7 kickoff proposal's width.
- Trade-offs, accepted:
  - 40% fewer pixels than 320×256 (49,152 vs 81,920). The 6×8 font gives 42 × 24 characters instead of 53 × 32. Small sprites (8×8, 16×16) are unaffected; busy layouts get tighter.
  - It changes code that is already written: runtime size constants, types, the frame canvas, tests, and any example cart that assumes 320×256 (list in the task report).
  - Not chosen: keep 320×256 at 3× (960×768, filling the height with 32-pixel bars at each side). That needs no code change, but wastes 6% of the screen and isn't an exact fit. 512×384 at 2× is too fine for the house look and makes imported pictures and agent-drawn sprites much bigger work.
- The simulator and the dev host keep sizing to the largest whole multiple of the window, so nothing else changes on the mini.

**D82. The Picade's controls are a keyboard that sends the runtime's P1 keys.** *(Claude, following D80; refines D21's dev keyboard.)*
- The X HAT reads the controls on GPIO, and Pimoroni's `picade` device-tree overlay turns them into a virtual keyboard (Linux keycodes, set per input with `dtparam`). It isn't a USB HID gamepad.
- The provisioning script (D4) sets the overlay so the cabinet sends exactly the dev keyboard's P1 keys. Then the runtime needs no Picade-specific input code, and the simulator and the cabinet behave the same.

  | Picade input | overlay param | key (code) | runtime |
  |---|---|---|---|
  | joystick | up/down/left/right | arrows (103/108/105/106, the overlay's default) | P1 stick |
  | player buttons 1–4 | button1–4 | Z X C V (44 45 46 47) | A B X Y |
  | player buttons 5–6 | button5–6 | Q E (16 18) | not given to carts in v0; spare for the launcher or later |
  | utility 1UP | start | Enter (28) | START |
  | utility ESC | escape | Escape (1) | ★, provisionally (D84) |
  | utility ENT, COIN | enter, coin | F1, F2 (59 60) | launcher only, never reach carts |
  | power button | (KEY_POWER) | | safe shutdown |
- Which physical button is which (the button layout on the console, which utility buttons are on the front or sides) is set when the cabinet is built, and the table is updated then.
- P2 stays in the runtime (keyboard WASD and gamepad 1) for the desktop and for whatever D84 decides. *(D85: the number of controllers is now a setting, default 1 on the cabinet.)*

**D83. Pi 5 setup facts the provisioning script must handle.** *(Claude, from Pimoroni's setup guide and the picade-hat repo, 2026-11-07.)*
- Build and install the overlay from `pimoroni/picade-hat` at a pinned commit (Pi 5 support merged July 2025, PR #49), not with the `curl | bash` installer, which isn't reproducible.
- Add `usb_max_current_enable=1` to `/boot/firmware/config.txt`. Power comes in through the X HAT's USB-C and back-powers the Pi over GPIO, so the Pi can't detect the supply. Without the line the screen flashes, because the display is powered from a Pi USB port.
- Audio is the X HAT's I2S DAC (mono, 3 W): turn off the Pi's own audio (`dtparam=audio=off`) and HDMI audio (`vc4-kms-v3d,noaudio`) so Chromium's WebAudio reaches the speaker. Check on arrival; one user needed PulseAudio on Bookworm.
- The power button: tap to start, hold 3 s to shut down. On the Pi 5, power-off from the button works; power-on was reported unreliable in issue #45 (still open). Check it on arrival.
- An Active Cooler is recommended. One user reported about 85 °C and throttling under the HAT.

**D84. Open, for Geoff: second player, the MAKE button, and the mic.** *(Claude raised these; the decisions are Geoff's. HANDOFF §3.3.)* **Answered 2026-11-08:** players by D85, MAKE by D86. The mic is still open (Geoff is having an XLR jack on the front with an XLR gooseneck researched; see hardware-mic.md).
- **Second player.** The cabinet has one player's controls. Options:
  1. One player at the cabinet. Two-player games take turns on the same controls. No hardware. Alina's "can Owen play too" becomes a turns game at the cabinet, and side-by-side games only work at the desktop.
  2. Add a USB gamepad as player 2 (wired through the back panel, or wireless with a dongle). The runtime already reads a second gamepad; the cabinet needs a small input change (the first gamepad becomes P2, since the Picade is P1). Owen gets his own side.
  3. Add a second joystick and buttons to the cabinet. The X HAT has only two spare button inputs, so this needs a USB encoder and new holes in the panel. Most work.
- **MAKE (★).** The plan had one MAKE button per side; now there is one side. Options:
  1. Use one of the existing front utility buttons as ★, with a sticker. No drilling.
  2. Add a dedicated, distinct MAKE button (bigger or lit) on the X HAT's spare button pins or plasma-button connector. Needs a hole in the cabinet.
- **Mic:** still open (Geoff, 2026-11-07). The case has no USB socket on the outside. A USB mic plugs into a Pi USB port inside the cabinet (the Pi 5 has four; the display's power takes one) and either sits inside or is routed out through the removable back panel. The X HAT uses the I2S pins for its DAC, so an I2S mic is out; USB is the path.

## 2026-11-08 — Players and MAKE (Geoff, answering D84)

**D85. Games default to single player; turns are well supported; the number of controllers is a setting.** *(Geoff; answers D84 "second player", changes HANDOFF §4, §7 and §10.)*
- Geoff: "Default to single player games; optional mechanic well supported in library for turn based games, address ext controllers later. Make number of controllers a configuration setting to anticipate arbitrary numbers of controllers in the future."
- A new game is single player unless the kid asks for more. When a kid wants someone else to play too, at the cabinet that means **taking turns** on the one set of controls.
- The starter library gets a well-tested turn-taking helper (whose turn, handing over, per-player scores and lives), so "can Owen play too" doesn't get re-derived each build. The helper ships in the library, not as a rule every cart must follow.
- **How many controllers there are is a configuration setting**, not a fixed two. The cabinet is set to 1 today. The runtime and carts must not assume exactly one or exactly two, so that adding controllers later is a config change. (Implementation is with the runtime worker, routed by the director.)
- External controllers (a USB gamepad and so on) come later. Nothing is bought or wired for them now.
- The desktop simulator can still be set to more than one controller, for testing and for desktop play.

**D86. No physical MAKE button is assumed; the Studio starts from the launcher/shelf.** *(Geoff; answers D84 "MAKE", changes HANDOFF §1, §4 and §8.1.)*
- Geoff: "It is not obvious we need a physical 'make' button; this could be in the launch screen/game shelf."
- Starting a new game (and forking one) is something the kid picks on screen in the launcher, not a dedicated button. Nothing is drilled or wired for MAKE.
- ★ stays reserved: the key that never reaches a cart (D21, D82). What it does without MAKE (for example, back to the shelf from a game) is one of the questions below.
- Questions this opens, for Geoff (not decided):
  1. **What starts and stops the mic** when a kid is asked to talk (the request, and the C "Something else" tile)? (a) Hold a button while talking, e.g. any player button while the "tell me" screen is up. Clear and kid-proof, and closest to the original plan. (b) Press once to start, again to stop, with a time limit. Frees both hands, but kids forget to stop. (c) Voice activity: the mic opens when the screen asks and stops after a pause. Hands-free, but it can cut off a kid who pauses to think, and basement echo and the cabinet's own speaker make it less reliable.
  2. **Where the Studio entry sits on the shelf:** (a) a "Make a new game" tile in the game list, or (b) a menu opened with a utility button. Forking stays "pick a game, then change it" (§8.2).
  3. **How a kid leaves a game and gets back to the shelf** now that ★ isn't MAKE: (a) a utility button (the ESC one, D82) held for a second, or (b) a pause menu on START.
  4. **Who is making:** the shelf shows the maker's initial, and there's no longer a "side" to hint at it. (a) Ask "Who's making? O or A" when the kid picks Make, or (b) leave it unattributed at the cabinet and tag it later in the Manager.

