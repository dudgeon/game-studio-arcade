# Decision log

Newest last. Each entry says who decided, and which HANDOFF section it settles or changes. Where an entry here and HANDOFF.md disagree, this file wins until the brief is updated.

## 2026-11-07 — kickoff

**D1. Spec rules come in two kinds.** *(Geoff; changes §7, §8.)*
- `auto` rules are proven by the playtest.
- `you-check` rules are confirmed by the kid on first play, e.g. a "Did the sloth look happy?" yes/no on the cabinet.

Every rule is still written so it's checkable, by a machine or by a person. The kid's answers are logged on the `cart_version` and fed into the next fork. This keeps the learning goal in the loop: the kid checks that the agent met the requirements.

**D2. Cabinet hardware: Pimoroni Picade Max kit plus a Raspberry Pi 5.** *(Geoff; closes §3.3 "which cabinet".)* 1280×1024 screen, bartop. Re-check price and stock live before buying.

**D3. Screen: 320×256, fixed 32-color palette.** *(Claude, following D2; changes the §7 proposal.)*
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
- **Rendering:** a 320×256 palette-indexed framebuffer, drawn inside the frame. The host sizes the iframe to the largest integer multiple in device pixels (4× on the Picade's 1280×1024).
- **Palette:** our own 32 colors with names (`g.colors.red`); index 0 is black.
- **Font:** a 5×7 bitmap font in a 6×8 cell, printable ASCII, scalable by whole numbers.
- **Sprites:** rows of characters, `0`–`9` and `a`–`v` for palette indices 0–31, `.` for transparent.
- **Sound:** 4 voices (square, pulse, triangle, saw, noise) with `g.tone` and named `g.sfx` presets.
- **Saves:** `g.save` is one JSON value per cart, at most 4 KB.
- **Dev keyboard:** P1 is the arrows, Z X C V for A B X Y, and Enter for START. P2 is W A S D, then 1 2 3 4 for A B X Y and 5 for START. Escape stands in for ★ and never reaches the cart. Gamepads use the standard mapping: pad 0 is P1, pad 1 is P2, with face buttons A B X Y = 0 1 2 3, START = 9, the d-pad or left stick (dead zone 0.5), and guide = ★. The Picade's own key map is set in Phase 2.
- **Timing and taps:** the host gives `requestAnimationFrame` 4 ms of slack, so a jittery 16.5 ms frame still gets exactly one tick, and it never runs more than 4 ticks per frame. A key pressed and released between two ticks still counts as held for one frame, so quick taps aren't lost.
- **Checked 2026-11-07 in Chrome on the mini:**
  - the hello cart ran at 60 fps, 60 ticks/s;
  - a frame costs 0.4 ms median and 1.2 ms p95, including the postMessage round trip and the canvas draw;
  - browser and headless Node gave the same frame hash for the same seed and input;
  - a hostile test cart was blocked from fetch, localStorage, cookies, the parent DOM, eval, images and remote imports.

**D30. The `spec.md` line format, rule ids, and how `checks.js` is read.** *(Claude, Phase 0 task 4; settles the §7 details.)*
- The title line is `# <Title>`, followed by one byline: `maker: <initial> · with: <initial or —> · parent: <cart@version or —> · session: <id or —>`. `cart.json` stays the machine record; the byline is for people.
- Sections are `##` headings in the order Pitch, Rules, Controls, Look & sound, Assumptions, Changelog. A missing or out-of-order section is an error. An unknown section is kept as written and reported as a warning.
- A rule is one list item: `- R<n> (auto): <text>` or `- R<n> (you check): <text>`. Indented lines continue the rule. Assumptions are `- A<n>: <text>`; changelog entries are `- v<n>: <text>`.
- Ids are stable for the life of a cart and its forks: never renumbered, never reused. A removed rule leaves a gap, and the Changelog says why. A fork adds rules after the parent's highest id.
- `checks.js` must be self-contained (no `import`); everything it needs comes through the test handle `t`. `validate_cart` reads its keys by importing it in a child Node process with the permission model on (read access to the cart folder only, no child processes or workers) and a 5-second timeout. Node 22's permission model doesn't block the network, so this limits, not seals; the playtest harness is where checks really run.
- Coverage rules: every `auto` rule needs a check (error); a check with no matching rule, or on a `you check` rule, is an error too, since it means the spec and checks have drifted.

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
