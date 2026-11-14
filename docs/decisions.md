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
- *Built as D310-D313 (2026-11-13): cabinet builds now get the full auto rules in the cabinet's Chromium, not only a smoke test, and frame time blocks only once calibrated (D311).*

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
- ~~Confirm in Phase 0 task 1 that the TypeScript SDK resolves the profile.~~ Closed by D17: `createClient()` passes the profile explicitly and the live check passes.
- ~~**Cabinet auth is undecided**~~ **Closed by D131 (Geoff, 2026-11-08): each cabinet has its own workspace-scoped API key.** (Was: Phase 1–2. Browser login fits a machine with a person present, not an unattended Pi. The options: convert the Console account to an organization (unlocks WIF; `scripts/wif/` is ready), or a workspace-scoped key on the Pi. Ask Geoff when Phase 1 starts.)

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
- **cart.json:** `id` (lowercase slug, at most 40 characters), `title` and `players` are required, because that is what the agent writes. `players` is how many people the game is for, 1 to the runtime's `MAX_PLAYERS` (was 1 or 2; widened for D110–D112). The fields the CLI or cabinet adds when it files the cart (`version`, `maker`, `with`, `parent` as `cart-id@version` or null, `session_id`, `origin`, `created`) are checked only if present, so the same check passes before and after filing. Unknown fields and a title that differs from the spec's are warnings.
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

**D44. Checks frozen; fix the game.** *(Geoff, 2026-11-08, after the first real build changed only `checks.js` to get its rules passing; implemented by Claude, tasks 7+8 worker.)*
- Checks are written from the spec before any game code, then frozen. A failing check means fix `game.js`.
- **Amended by D46:** changing what a rule means requires **first** changing the spec rule or adding an Assumption naming the rule, so the numbers live in the spec. A check bug takes D46's lighter route.
- A change of meaning shows in the plan: the agent calls `show_plan` again with a `changes` list (`[{id, text}]`, rule id and plain words).
- Every check change is logged. The agent saves `spec.frozen.md` and `checks.frozen.js` to outputs before its first playtest, and the CLI fetches them itself when that playtest starts, so later writes can't change the baseline (the first trial overwrote its snapshot at pack-up). The CLI compares each rule's check there with the final cart and writes `checks_changed_after_playtest` on the `studio_session` record: `changed`, `edit_events`, `baseline`, and per rule `{rule, spec_changed, rule_text_changed, assumption_names_rule, shown_in_plan}`, plus `unjustified` (rules whose check changed with no spec change).
- Edits are also detected from the event stream, independently of the snapshot. `baseline` is `captured`, `snapshot` or `none`; with `none` the edits are still counted, with `rules_known: false`. `snapshot_overwritten` flags a rewritten snapshot.
- The record also gets `first_playtest` (which rules passed and failed on the first run) and `edits_after_first_playtest` (`game_js`, `checks_js`, `spec_md`).
- This logs and doesn't block: a cart with an unjustified change can still commit (no approval loop; the activity log is the oversight).

**D45. The context pack stays in the kit tarball, not a custom skill.** *(Claude, tasks 7+8 worker; settles D40's experiment, on the director's clearance.)* Two builds of the penguin request on Sonnet 5.5, 300¢ cap, the D44 brief, replaying the recorded answers (2026-11-08):

| | Tarball | Skill |
|---|---|---|
| Session | `sesn_0137VBbwE4xHnZy1Bupx84v6` | `sesn_01Mt89MxLgQtq7L6Ezeqf3Jh` |
| List cost (recomputed) | 80¢ ($0.798) | 60¢ ($0.595) |
| Active time | 534 s | 296 s |
| Questions | 2 | 3 |
| Auto rules passing on the first playtest | 10 of 10 | 10 of 11 (R2 failed) |
| Fix rounds (agent's report) | 1 | 1 |
| `game.js` edits after the first playtest | 1 (title screen polish) | 0 |
| Check edits after the first playtest | 1 (R2, R6: too slow for the browser driver) | 1 (R2: test ran until the game ended) |
| Spec change and plan first? | Yes: A10 naming both, re-plan | Yes: A10, re-plan |
| Driver runs in the browser | 4 | 1 |

Why tarball, though the skill run was cheaper:
- **The gap isn't from how the pack arrives.** Cost by phase, tarball vs skill: read and ask $0.20 vs $0.24; build $0.41 vs $0.16; test and fix $0.18 vs $0.20. Context at the first plan was 44.7k vs 42.0k tokens: the brief says to read the whole pack, so the skill's load-on-demand saves nothing. The whole gap is the build phase, where the tarball run wrote 28k output tokens to the skill run's 9k.
- **One run each, and not the same game.** Answers replay by position, and the two runs asked different questions, so the tarball run built a lane-hopping penguin and the skill run a slippery slider. Earlier, a tarball build under the old brief cost 68¢, so 60–80¢ looks like ordinary variation.
- **The tarball is simpler.** One artifact, versioned by content hash with the runtime and tools it describes. A skill is a second resource to keep in step with the kit.

Revisit if a test with more runs, or a brief that doesn't say to read everything, shows a real saving. The experiment's skill stays in the workspace (`claude-lock.skill.json`, `studio make --context-pack skill`).

**D46. A check bug is quoted, fixed and logged; only a change of meaning goes through the spec.** *(Geoff, 2026-11-08, on the question raised by D44's first trials; amends D44. Implemented by Claude, tasks 7+8 worker.)* Geoff's words: when a check contradicts the unchanged spec's own words, "the agent quotes the rule, fixes the check to match it, and the change is logged as a check bug and shown in the build summary. Changing what a rule means still requires changing the spec first."
- A **check bug** needs no Assumption and no re-plan, and doesn't stop the kid. This covers test mechanics that don't change what the rule means: a check too slow to finish, a bot that ends the game mid-test, a type error.
- The agent declares every check change in `report.json`: `check_changes: [{rule, kind: "check_bug" | "rule_change", quote, what}]`, where `quote` is the rule's exact words.
- The CLI classifies each rule whose check changed since the frozen snapshot, in `checks_changed_after_playtest.rules[].classification`:
  - `rule_change`: the rule's text changed, or a new or changed Assumption names it. `shown_in_plan` says whether the re-plan happened.
  - `check_bug`: the spec is unchanged for that rule, and the agent declared a bug with a quote that is really in the rule's text.
  - `unexplained`: neither. These rules are also listed in `unjustified`.
- Classification is per rule, comparing the snapshot with the final cart, because bash edits can't be attributed to a rule one at a time. Comments are ignored in the comparison. With no usable baseline the rules are unknown (D44).
- The CLI's build summary lists check bugs and rule changes. Like D44, this logs and doesn't block.

**D47. Replays match answers by question.** *(Director's instruction; design by Claude, tasks 7+8 worker. Changes D43's replay by position.)*
- A recorded answer holds the question and the answer's words, plus `match`: regexes that must all match a question for this answer to apply. Files recorded from now on save `question`, `option_a`, `option_b` and `answer`; without `match`, questions are compared by word overlap (at least half).
- The reply is by meaning: tile A or B if that option's words overlap the recorded answer by at least half, otherwise C with the recorded words. Options differ between runs, so a letter alone would mean something else.
- A question with no recorded answer gets D ("make it now") and logs `replay_unmatched`. Every replayed question is logged in `replay_log` (asked, matched, reply).
- A file with no questions in it still replays by position.
- Plans still replay in order, and a plan past the end gets build (`replay_replanned`).

**D48. One browser-driver run, at the end.** *(Director's instruction; Claude, tasks 7+8 worker.)* Timeouts on long checks cost minutes in the browser (D45's tarball run). The brief has the agent use the node driver while working, and run the browser driver once as a final check when node passes, and once more only if that run found something to fix.

**D49. Must say what's untested.** *(Geoff, 2026-11-08, after the model comparison found Fishy Penguin's R7 and R8 had dropped their caps under a clean check-bug label; amends D46. Implemented by Claude, tasks 7+8 worker.)* When a check-bug fix tests less of its rule, the agent states which words of the rule the fixed check no longer tests. Any rule that loses tested words is flagged in the build summary and becomes a you-check question on first play, so the kid checks what the test can't.
- **The agent says it:** `check_changes[].untested: [{words, question}]`. `words` must be the rule's exact words. `question` is a short question for the player.
- **The CLI looks for it.** Comparing each rule's check in the snapshot and the final cart, it counts a check as narrowed if a number left a literal list (`[100, 700, 1300, 2500]` → `[100, 700, 1300]`) or it has fewer assertions. A check bug that narrowed and gives no valid `untested` words is `unexplained`, with `untested_missing: true`. An empty list counts as missing. These signals can't prove a check tests the same: they catch the common ways of losing strength, and a false alarm costs the kid one extra question. Moving to a helper can hide a narrowing, so changes in shared helpers are logged as `helpers_narrowed`.
- **The hand-off is the spec.** The CLI adds a `(you check)` rule per untested item to the cart's `spec.md` before validating and committing, with new ids and a Changelog line. The local player and the cabinet already ask a spec's you-check rules on first play, answers log by rule id, and forks inherit them, so nothing else changes. `cart.json` is unchanged. The record lists them as `you_check_added: [{rule, from, words, text}]`. A rule that narrowed without saying how is asked whole. The agent's own copy in `outputs/spec.md` stays as it was.
- **No re-plan.** Like D46, this doesn't stop the kid during the build. The new question appears in the build summary and at first play. `show_plan` is unchanged. A change of meaning through the spec (`rule_change`) doesn't add a question, because the spec already says what the rule now means.
- Carts built before this keep their specs (Fishy Penguin has no added questions).

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

**D64. Frame time is judged with a whole-frame budget in the browser; colors are judged by runtime warnings.** *(Claude, Phase 0 task 5 follow-up; refines D61 after the sandbox parity run.)*
- In the sandbox, trivial `dot-catch` took p95 3.5 ms (max 108.7 ms) per frame in the browser driver. Most of that is the page round trip and cloud-VM noise, not the cart, so a 4 ms budget would fail heavier carts for the wrong reason.
- **Default budgets:** the node driver keeps p95 ≤ 4 ms (update+draw only, the number that predicts the Pi). The browser driver gets p95 ≤ 16.7 ms, a whole 60 Hz frame, which still catches a cart that can't keep up. `--budget-ms` overrides either. The real frame-time verdict stays on the Pi (D8).
- The agent runs the node driver first (the default) and the browser driver for parity.
- **Palette:** every job reads `t.warnings()` when the handle has it. The report lists each warning once in `warnings`, and any color warning fails `palette` with the runtime's message. `comparable()` keeps `warnings`, since they're deterministic.

**D65. The frame where two runs first differ is its own field, outside `comparable()`.** *(Claude, playtest parity flake; refines D61, D62.)*
- On a cart that really uses `Math.random`, the first differing frame is random too. It was in the `deterministic` reason, so the same cart could give two different "same" reports, about 1 run in 256 on `dot-catch-broken`.
- The reason now has no frame in it. A failed `deterministic` carries `frame` (the first sampled frame that differed, or the earlier of the two ending frames), and the CLI prints it. `comparable()` drops `frame`, as it does the other numbers that can't match.
- The check itself is unchanged: the same frames are hashed and compared, and it fails on the same carts.

## 2026-11-07 — Local player (Phase 0 task 9)

Decided by Claude (the task 9 worker). The player is `studio-kit/player/`; it grows into the Cabinet Manager's simulator in Phase 1.

**D70. The local player is one Node server in front of the runtime's handler.** *(Claude; implements phase-0 task 9.)*
- `studio-play [--port 8330] [--host 127.0.0.1] [--carts DIR] [--examples] [--checker G]` serves the player page at `/`, a small JSON API at `/api/…`, and hands every other path to the runtime's `createHandler` (`/runtime/…`, `/carts/<id>/…`), so carts load exactly as in the playtest.
- The cart library is read on every request (`~/game-studio-data/carts`, or `GSA_DATA_DIR`), so a cart the CLI just committed shows up without a restart. Only folders with a `game.js` count. `--examples` adds `runtime/examples/*` for trying it without a library.
- It binds to 127.0.0.1 by default and never opens a browser window itself; it prints the URL.
- The page takes the screen size and scale from the runtime's host (it never names 320×256), so a new screen size needs no player change.
- Menus work with the keyboard and a gamepad through the runtime's own input map: stick up/down to move, A or START to pick, B or ★ (Escape, guide) to go back. ★ during play leaves the game.
- *(Follows D110.)* `--players N` (1–8, default 1 like the cabinet) is passed to the runtime's `createHost` for every cart; a bad value stops start-up. A play's `sides` only counts controllers that exist at that setting.

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

**D80. Cabinet hardware: Pimoroni Picade with 10" display, plus a Raspberry Pi 5 8 GB. Both ordered 2026-11-07.** *(Geoff; supersedes D2.)*
- Picade: Pimoroni PIM469, PiShop US SKU 2009, $349.95, in stock (pishop.us/product/picade-with-10-inch-display). Pi 5 8 GB: PiShop SKU 8GB-9028, $175.00, in stock.
- What changes from the Max: a 10" 1024×768 (4:3) panel instead of 19" 1280×1024 (5:4). **One player's controls**: one joystick, six player buttons, four utility buttons and a power button, all on a Picade X HAT. A desk-sized cabinet (310 × 260 × 250 mm, H × W × D).
- Still to get (not ordered, not decided here): a USB-C power supply (Pi 5 wants 5 V/5 A, e.g. the official 27 W supply, $12.95 at PiShop), an Active Cooler (Pimoroni recommends one; $12.95 at PiShop), a microSD card, and a mic (a USB mic, Geoff choosing, D89).
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
- Which physical button is which (the button layout on the console, which utility buttons are on the front or sides) is set when the cabinet is built, and the table is updated then. *(Set 2026-11-14 before assembly, in [hardware/picade-wiring.png](hardware/picade-wiring.png): A B on the near row, blue then yellow; X Y on the far row; pink 5 and 6 spare; 1UP front left, COIN front right, ESC left side, ENT right side. Replaces the plan in ca35d25.)*
- P2 stays in the runtime (keyboard WASD and gamepad 1) for the desktop and for whatever D84 decides. *(D85: the number of controllers is now a setting, default 1 on the cabinet; implemented by D110–D112, so P2 gets input only when it is 2 or more.)*

**D83. Pi 5 setup facts the provisioning script must handle.** *(Claude, from Pimoroni's setup guide and the picade-hat repo, 2026-11-07.)*
- Build and install the overlay from `pimoroni/picade-hat` at a pinned commit (Pi 5 support merged July 2025, PR #49), not with the `curl | bash` installer, which isn't reproducible.
- Add `usb_max_current_enable=1` to `/boot/firmware/config.txt`. Power comes in through the X HAT's USB-C and back-powers the Pi over GPIO, so the Pi can't detect the supply. Without the line the screen flashes, because the display is powered from a Pi USB port.
- Audio is the X HAT's I2S DAC (mono, 3 W): turn off the Pi's own audio (`dtparam=audio=off`) and HDMI audio (`vc4-kms-v3d,noaudio`) so Chromium's WebAudio reaches the speaker. Check on arrival; one user needed PulseAudio on Bookworm.
- The power button: tap to start, hold 3 s to shut down. On the Pi 5, power-off from the button works; power-on was reported unreliable in issue #45 (still open). Check it on arrival.
- An Active Cooler is recommended. One user reported about 85 °C and throttling under the HAT.

**D84. Open, for Geoff: second player, the MAKE button, and the mic.** *(Claude raised these; the decisions are Geoff's. HANDOFF §3.3.)* **Answered 2026-11-08:** players by D85, MAKE by D86. The mic is a USB mic that Geoff is choosing (D89).
- **Second player.** The cabinet has one player's controls. Options:
  1. One player at the cabinet. Two-player games take turns on the same controls. No hardware. Alina's "can Owen play too" becomes a turns game at the cabinet, and side-by-side games only work at the desktop.
  2. Add a USB gamepad as player 2 (wired through the back panel, or wireless with a dongle). The runtime already reads a second gamepad; the cabinet needs a small input change (the first gamepad becomes P2, since the Picade is P1). Owen gets his own side.
  3. Add a second joystick and buttons to the cabinet. The X HAT has only two spare button inputs, so this needs a USB encoder and new holes in the panel. Most work.
- **MAKE (★).** The plan had one MAKE button per side; now there is one side. Options:
  1. Use one of the existing front utility buttons as ★, with a sticker. No drilling.
  2. Add a dedicated, distinct MAKE button (bigger or lit) on the X HAT's spare button pins or plasma-button connector. Needs a hole in the cabinet.
- **Mic:** still open (Geoff, 2026-11-07); now D89, a USB mic Geoff is choosing. The case has no USB socket on the outside. A USB mic plugs into a Pi USB port inside the cabinet (the Pi 5 has four; the display's power takes one) and either sits inside or is routed out through the removable back panel. The X HAT uses the I2S pins for its DAC, so an I2S mic is out; USB is the path.

## 2026-11-08 — Players and MAKE (Geoff, answering D84)

**D85. Games default to single player; turns are well supported; the number of controllers is a setting.** *(Geoff; answers D84 "second player", changes HANDOFF §4, §7 and §10.)*
- Geoff: "Default to single player games; optional mechanic well supported in library for turn based games, address ext controllers later. Make number of controllers a configuration setting to anticipate arbitrary numbers of controllers in the future."
- A new game is single player unless the kid asks for more. When a kid wants someone else to play too, at the cabinet that means **taking turns** on the one set of controls.
- The starter library gets a well-tested turn-taking helper (whose turn, handing over, per-player scores and lives), so "can Owen play too" doesn't get re-derived each build. The helper ships in the library, not as a rule every cart must follow.
- **How many controllers there are is a configuration setting**, not a fixed two. The cabinet is set to 1 today. The runtime and carts must not assume exactly one or exactly two, so that adding controllers later is a config change. (Implementation is with the runtime worker, routed by the director.)
- External controllers (a USB gamepad and so on) come later. Nothing is bought or wired for them now.
- The desktop simulator can still be set to more than one controller, for testing and for desktop play.

**D86. No physical MAKE button is assumed; the Studio starts from the launcher/shelf.** *(Geoff; answers D84 "MAKE", changes HANDOFF §1, §4 and §8.1.)* **All four questions below are answered: 1, 2 and 4 by D87, 3 by D88.**
- Geoff: "It is not obvious we need a physical 'make' button; this could be in the launch screen/game shelf."
- Starting a new game (and forking one) is something the kid picks on screen in the launcher, not a dedicated button. Nothing is drilled or wired for MAKE.
- ★ stays reserved: the key that never reaches a cart (D21, D82). What it does without MAKE (for example, back to the shelf from a game) is one of the questions below.
- Questions this opens, for Geoff (not decided):
  1. **What starts and stops the mic** when a kid is asked to talk (the request, and the C "Something else" tile)? (a) Hold a button while talking, e.g. any player button while the "tell me" screen is up. Clear and kid-proof, and closest to the original plan. (b) Press once to start, again to stop, with a time limit. Frees both hands, but kids forget to stop. (c) Voice activity: the mic opens when the screen asks and stops after a pause. Hands-free, but it can cut off a kid who pauses to think, and basement echo and the cabinet's own speaker make it less reliable.
  2. **Where the Studio entry sits on the shelf:** (a) a "Make a new game" tile in the game list, or (b) a menu opened with a utility button. Forking stays "pick a game, then change it" (§8.2).
  3. **How a kid leaves a game and gets back to the shelf** now that ★ isn't MAKE: (a) a utility button (the ESC one, D82) held for a second, or (b) a pause menu on START.
  4. **Who is making:** the shelf shows the maker's initial, and there's no longer a "side" to hint at it. (a) Ask "Who's making? O or A" when the kid picks Make, or (b) leave it unattributed at the cabinet and tag it later in the Manager.

**D87. Hold to talk, a "Make a new game" tile, and an open list of makers.** *(Geoff; answers D86 questions 1, 2 and 4. Changes HANDOFF §8.1, §8.2 and §9.5. Question 3, how to get back to the shelf from a game, is answered by D88.)*
- **Mic: hold a button to talk.** While the "tell me" screen is up, the kid holds a player button, talks, and lets go to send. The same works for the request and for the C "Something else" tile. The mic records only while the button is held. (Claude, implementation: any of the six player buttons counts, so the kid needn't find a particular one; the screen shows a "listening" state and the cabinet mutes its own speaker while the button is down.)
- **Make is a tile:** a "Make a new game" tile in the game list on the shelf. Forking stays as it was (§8.2): pick a game, then change it.
- **Who's making:** Geoff: "On launch of the make game, ask who is making; include existing names plus a new name slot (eg when a friend is over)." So the list of makers is open-ended, not just O and A.
- Cabinet-side detail (Claude):
  - The question comes right after the kid picks Make (or picks a game to change), before the mic. It lists the known makers, most recent first, then a "Someone new" slot.
  - A new name is given the same way as everything else: hold a button and say it, then confirm the transcript on screen (retry allowed). First names only.
  - **Where names are kept:** in the cabinet's data, next to its cart library, as a `makers.json` list: `{id, name, added, guest}`. `id` is a stable slug; `guest: true` marks a name added through the new-name slot. It's never in this repo (§15) and is backed up with the cart library. Names are never deleted (D5); a maker can be hidden from the list in the Manager.
  - `cart.json` `maker` / `with`, and the `studio_session` and `play` log records, hold the maker's `id`. A guest's sessions and carts are logged under their own id like anyone else's, so the activity log shows who made what.
  - The shelf shows the maker's name, since initials can collide once friends are added.
  - The desktop flow (§8.3) uses the same ids when Geoff and a kid publish.

## 2026-11-08 — Back to the shelf, and the mic (Geoff)

**D88. Back to the shelf: press the Picade's ESC button, which sends Escape.** *(Geoff; answers D86 question 3.)*
- Geoff asked for the existing default rather than a new mechanism: "What is the default for the os you chose? Don't create an arbitrarily unique mechanism."
- The basis: Raspberry Pi OS Lite (D4) has no desktop, and it boots straight to our launcher, so the OS has no "back to the shelf" of its own. The convention the cabinet already lives in is Escape. The guest players use it (checked live 2026-11-08), and D21/D82 already make Escape the ★ key that never reaches a house cart. ESC is the utility button wired to `escape` on the X HAT (D82).
- What Escape does in each player:
  - **RetroArch:** Escape is "Exit RetroArch" by default, and F1 toggles the menu (docs.libretro.com/guides/input-and-controls). This matches: one press leaves the game.
  - **TIC-80:** "ESC: Switch console/editor or open menu while in game" (TIC-80 wiki, Hotkeys). It opens TIC-80's game menu rather than leaving at once; leaving is a menu item.
  - **PICO-8** (manual v0.2.7): "Press escape to stop the program, and once more to enter editing mode." It stops the cart and drops to PICO-8's own command line, which isn't a shelf, and its pause menu is Enter/P. **This one differs:** the launcher must catch PICO-8 stopping (or its exit) and bring the shelf back, so a kid never lands in PICO-8's console. That's launcher work (Phase 1), not a new button.
  - **House runtime:** Escape goes to the host, never the cart (D21), and the launcher takes it as "back to the shelf".
- ★ in D21 and D82 now means this: the cabinet's Escape, back to the shelf. D86's "what ★ does" question is closed.
- Not decided here (implementation; noted for the launcher): whether a stray press mid-game should need a second press, as RetroArch's optional "press quit twice" does. The default is one press, matching RetroArch.

**D89. The mic is a USB mic, and Geoff is choosing it.** *(Geoff, 2026-11-08; updates D84's mic item and hardware-mic.md.)*
- Geoff: "Leave it open: a usb mic for now, and I'll try to find one that will work."
- It plugs into one of the Pi's free USB ports inside the case (D80 platform notes; there's no external USB socket). The XLR-jack-and-gooseneck idea is set aside for now.
- The picks recommended in hardware-mic.md didn't integrate well with the cabinet, so none is the plan of record. No model is recommended here.
- The rest of the voice plan is unchanged: hold a player button to talk (D87), Groq first and Moonshine on the Pi as backup (§3.1), and in the virtual cabinet the same USB mic is passed through to the VM (D127).

## 2026-11-07 — Context pack (Phase 0 task 6)

**D100. The context pack is a short read order plus three carts, and points to the library reference rather than copying it.** *(Claude, Phase 0 task 6; implements D12.)*
- `studio-kit/context-pack/`: `README.md` (read order, cart folder and `cart.json` fields, house conventions, commands), `RECIPES.md` (six recipes, each from a spec rule to code, probe and check) and `carts/{dodge,paddle,collect}/` (`spec.md`, `cart.json`, `game.js`, `checks.js`).
- The library reference stays in `runtime/lib/REFERENCE.md` (one source, tested against the exports) and the pack points to it. The kit already ships both: `pack-kit.js` lists `studio-kit/context-pack` in `KIT_PARTS`, so no wiring change was needed.
- The carts are Comet Dodge (free movement, spawner, `collide.resolve`, a safe timer, a speed curve), Wall Ball (one paddle against three walls) and Gem Garden (tile grid, held-stick repeat, a timed round). None uses the falling-blocks parts of `g.lib.grid` (rotation, `place`, `clearRows`); a test enforces that. Recipe 5 points at those functions in REFERENCE.md without showing a falling-blocks game.

**D101. Example carts are one-player and never write the screen size as a number.** *(Claude, following D81 and D85.)*
- `game.js` lays out from `g.W` and `g.H`; `probe()` returns `W` and `H`, so checks use those too. A test fails on `320`, `256`, `240` or `192` in any cart or recipe code.
- A test runs every cart's playtest on the installed runtime **and** on a copy patched to the other size (320×256 ↔ 256×192), so the examples pass before and after the D81 runtime change. Text is sized for 42 characters a line.
- One player only (D85: games default to single player). Wall Ball is a one-paddle wall game rather than a two-player duel for that reason. The README says, in one line each, that a game for 2 or more people takes turns with `g.lib.turns` (D113) and that a check needing two controllers at once calls `t.reset({ players: 2 })` (D111). There's no turns example cart; REFERENCE.md covers the helper.
- Example `cart.json` files hold only what the agent writes: `id`, `title` and `players` (D31). The CLI adds the provenance fields.

**D102. Pack size: about 15.0k tokens, estimated offline; target ~15k, test ceiling 16,500.** *(Claude; ceiling raised by the director, 2026-11-08.)*
- `npm run size -w @game-studio-arcade/context-pack` counts what a session reads: the pack's docs, the three carts and `runtime/lib/REFERENCE.md`. `runtime/README.md`, which KIT.md also says to read, is outside the count (about 1.9k more).
- Tokens are estimated as characters / 4 for Markdown and / 3.2 for code and JSON (no API call). The first live session's `usage` should confirm the real number. The stated target is ~15k (`TARGET` in `bin/pack-size.js`); the test fails only above `LIMIT`, 16,500.
- 2026-11-08: the `g.lib.turns` entries (D113) took REFERENCE.md from about 4.2k to 5.5k and the pack to about 16.1k. Back to 14,987 by trimming the pack's own files, not REFERENCE: recipes now point at the carts instead of repeating their code, the README is tighter, checks drop redundant JSDoc casts, and `cart.json` is the agent's three fields. That left 13 tokens of headroom, too brittle: any library addition would fail the test. So the test ceiling is now 16,500 (the director's call), while ~15k stays the target. When a library module grows the pack past 15k, it's noted here; past 16.5k, trim the pack's own files or decide a new ceiling explicitly.

**D103. Example checks are small bots, and checks start with `start(t)`.** *(Claude.)*
- `flow.startPressed` ignores presses for a screen's first 30 frames, so each cart's `checks.js` has a `start(t)` helper that steps 31 frames before pressing START.
- Checks reach game events by steering from the probe (chase a comet, dodge it, aim the paddle, walk to the nearest gem) in 2-frame steps, with a frame limit, rather than by forcing state. Recipe 6 teaches the pattern.
- The package tests also run the full `validateCart` (D31) on each example, so the examples can't drift from the validator.

## 2026-11-08 — Players setting and turns in the runtime (implements D85)

How the runtime and library carry out D85 (Geoff's answer to D84's second-player question).

**D110. The number of controllers is a setting, `players`, default 1.** *(Claude, runtime-players worker; implements D85, refines D21 and D82.)*
- One integer, 1 to 8 (`MAX_PLAYERS`, exported by the runtime). It says how many controllers this console has, not how many people a game is for. Anything else (0, 9, 1.5, "two") is an error at start-up, not a silent fallback.
- Where it's read: `createHost({ players })` on any host page; `play.html?players=N` on the dev host; `headless(cart, { players })` and `arcade-run --players N` in Node; `t.reset({ players })` in a check. Every one defaults to 1, so the desktop gets player 2 only when asked (`?players=2`).
- The cabinet reads it from the cabinet service's config (key `players`, default 1) and passes it to the launcher's host. The cabinet service doesn't exist yet; this is the contract for it. External controllers (D84 option 2) are later: when they come, the cabinet raises `players` and nothing in the runtime changes.
- Carts see it as `g.players`.

**D111. Input is N players, not P1 and P2.** *(Claude; refines D21's input and test-hook shapes.)*
- A frame's input is one button mask per controller (an array of length `players`) all the way through: host → frame → machine, and in the test hook. `Arcade.Player` is now `1 | 2 | … | 8` (was `1 | 2`), which is a widening, so every existing cart still type-checks.
- **Keyboard (dev):** unchanged. P1 is the arrows/ZXCV/Enter and P2 is WASD/1234/5; keys for a player beyond `players` are ignored. Players 3 and up have no keyboard keys; they use gamepads.
- **Gamepads:** pad *k* is player *k*+1, for pads below `players`; pad 0 is still OR-ed into player 1. Pads beyond `players` are ignored, except that guide is ★ on any pad. The cabinet's mapping for added controllers (D84 option 2: the Picade is P1, so the first pad would be P2) is decided with the external controllers, later.
- **Input scripts** take `p1` … `p8`. A step for a player beyond the run's `players` is ignored, because that controller doesn't exist, the same as live play. A key past `p8` is an error. This keeps the playtest soak (which always sends `p1` and `p2`) working at `players: 1`. A check that needs two controllers at once calls `t.reset({ players: 2 })` first.

**D112. A cart that asks for a player who isn't there still runs; that player just holds nothing.** *(Claude; the brief left this to the worker.)*
- `g.btn(b, p)`, `g.btnp` and `g.btnr` for a `p` from 1 to 8 beyond `g.players` return false: nobody is holding that controller. Outside 1–8 still throws, as before.
- Rejected: mapping a missing player 2 onto controller 1. In a side-by-side game both players' things would then move together, which looks broken, and it would hide the problem from the playtest.
- **cart.json and the cart API agree like this.** `cart.json` `players` is how many people the game is for (validate_cart accepts 1 to `MAX_PLAYERS`, D31). A cart for more people than `g.players` must take turns on the controllers it has, and `g.lib.turns` does that with no extra code: on one controller, every player uses controller 1 and a "pass the controls" screen goes between turns. A side-by-side-only cart (players at the same time) still runs on one controller, with player 2 idle; that is a desktop game, and the Studio should prefer turns when the cabinet is the target (D85).

**D113. `g.lib.turns`: take turns, pass the controls, keep one score each.** *(Claude; extends D50.)*
- A turns object is plain data in the cart's state: `{ count, up, round, rounds, scores, passing, t, pass }`. `up` is whose turn it is, `scores[p - 1]` is each player's score, and `passing` is true while the "pass the controls" screen is up.
- Per-player lives or saved high scores use one `score.newScore` per player alongside it (D85's "scores and lives").
- Helpers: `newTurns`, `shared` (fewer controllers than players?), `controller` (which controller a player uses), `btn`/`btnp` (the player who is up, on their controller, and nothing while passing), `next` (end the turn; on to the next player and maybe the next round), `waiting` (run the pass screen; true until the next player presses A or START), `drawPass` (draws "PLAYER 2'S TURN" in the house font), `addScore`, `isOver` (all rounds played) and `winner` (0 for a tie).
- The pass screen shows when the controls really change hands (`pass: "shared"`, the default), always, or never. It ignores presses for its first 30 frames, like `flow.startPressed`, so a button mashed at the end of a turn doesn't skip it.
- Single-player games never touch it. It's optional and default games stay one player.

**D114. `host.destroy()` removes every listener it added.** *(Claude; fixes the leak the player worker found.)* The window `blur` and `pointerdown` (capture) listeners were anonymous, so `destroy()` couldn't remove them; a page that made several hosts kept every old host's listeners. They're named now, and a test counts the window's listeners before and after.

## 2026-11-08 — Virtual cabinet

Decided by Claude (the virtual-cabinet worker), from Geoff's request for "a full emulator stack running as close to accurate a version of a logically isolated … version of the cabinet on the mini". Design, sources and Geoff's open questions: [virtual-cabinet.md](virtual-cabinet.md). Nothing is built yet.

**D120. The virtual cabinet runs in UTM on Apple Virtualization.** *(Claude; implements Geoff's 2026-11-08 request.)*
- UTM 5.0.8 (free GitHub build), Apple Virtualization backend, driven by scripts through `utmctl`. On macOS 27 it passes USB devices through, has separate sound in and out, and Bridged/Shared networking (checked 2026-11-07).
- Not chosen: QEMU Pi emulation (no `raspi5` machine; `raspi4b` is slow and incomplete), Lima (headless-first, no USB passthrough), Tart (CI-oriented, no documented Linux audio/USB), our own Virtualization.framework app (bridging needs Apple's restricted entitlement).
- It is virtualization, not emulation: arm64 code runs natively; no Pi hardware is imitated.

**D121. Same OS image as the Pi; a generic kernel to boot it.** *(Claude; extends D4.)*
- The virtual cabinet starts from the same pinned Raspberry Pi OS Lite 64-bit (trixie) image file, checked by SHA-256.
- The Pi kernel can't boot in a VM. Plan A: the image's root filesystem with Debian trixie's generic arm64 kernel and initrd. Plan B: Debian trixie arm64 with Raspberry Pi's apt archive added. The V0 spike picks one (boots unattended, same package versions, script runs to the end, shelf shows at 1024×768); A wins a tie. Recorded in platform-notes.md.

**D122. One provisioning script, two hardware profiles: `picade` and `virtual`.** *(Claude; extends D4, D82, D83.)*
- Everything above the hardware is shared and pinned the same way. Only the hardware layer differs: kernel, `config.txt` (overlay, key `dtparam`s, `usb_max_current_enable`, audio lines are `picade` only), the audio device, hostname (`arcade` / `arcade-virtual`), and the `virtual` firewall (D124).
- The profile is one config value, so the Manager's update flow is the same for both, and script updates can be tried on the virtual cabinet first.

**D123. VM shape: 4 vCPU, 8 GB RAM, 32 GB sparse disk, one 1024×768 display, virtio sound, USB keyboard, one NIC. No shared folders, clipboard, Rosetta or mini SSH keys.** *(Claude.)* Matches the Pi 5 8 GB's cores and memory (not its speed). Generated by `scripts/virtual-cabinet/`; the VM and its disk live in UTM's library, outside the repo.

**D124. Network: bridged on the mini's Wi-Fi as `arcade-virtual.local`; the cabinet refuses new connections to the mini.** *(Claude; follows D7, §9.4.)*
- Its own DHCP address on the home mesh and its own mDNS name, so it can run next to the real `arcade.local`. Fallback if Wi-Fi bridging fails: UTM Shared networking.
- The Manager and Claude Code pick a cabinet with one setting, `ARCADE_HOST`. Each cabinet has its own pairing token (`ARCADE_TOKEN`, D7).
- The `virtual` profile's firewall drops new outbound connections to the mini's addresses (replies to the mini's requests still flow): the cabinet never uses the mini's resources. This is for fidelity, not security.

**D125. Controls: the Mac keyboard sends the D82 keys straight into the VM.** *(Claude; follows D82, D85.)* The VM's USB keyboard delivers the same Linux key codes the Picade overlay sends, so the runtime and launcher need nothing virtual-specific. Keys reach the VM only while its window has focus. A USB stick or gamepad can be passed through later; none is bought now (D85).

**D126. The screen is a UTM window, opened on demand.** *(Claude.)* 1024×768 (or an exact 2× on a large monitor). The VM keeps running with the window closed and must not take focus when it starts; V0 checks both.

**D127. Audio out through virtio sound; the mic is a USB device passed through.** *(Claude; follows D84.)*
- The mini has no built-in microphone (checked 2026-11-07).
- Passing the cabinet's own USB mic (or USB audio interface) through to the VM (macOS 27) gives the guest the same device the Pi will see. Fallback: a mic on the mini, through virtio sound input.
- Optional mono downmix in the `virtual` profile to match the X HAT's mono speaker.

**D128. Frame-time results from the virtual cabinet are labelled `virtual` and judged against a scaled budget.** *(Claude; refines D8, D64.)*
- The VM's CPU (an M6) is several times faster than the Pi 5's Cortex-A76 and its GPU path differs, so a pass in the VM doesn't prove a pass on the Pi.
- The gate on the virtual cabinet records `host: "virtual"` and divides the frame budget by a cabinet setting `gate.cpu_factor`. Until it's measured, the factor is a stated guess, not a fact; when the Pi arrives, run the same carts on both and set it from the numbers. A CPU quota inside the VM is optional.
- The real Pi's gate stays the final word (D8).

**D129. The virtual cabinet is a separate cabinet with its own data and identity; the locked independence rule is unchanged.** *(Claude; proposes how the virtual cabinet fits §3.1, for Geoff to see.)*
- Its own cart library, logs, play telemetry, Manager token and API identity (never the mini's `game-studio-arcade` profile; a workspace-scoped API key of its own, D131). All inside the VM's disk; never deleted (D5); a UTM snapshot before each update; backups as for the real cabinet.
- It shares the mini's hardware, so it can't run with the mini off: its independence is logical. No mini software (Claude Code, Node servers, files) is in its play or build path. The §3.1 rule "the mini is never in the play path" still governs the real cabinet and isn't relaxed by this.

## 2026-11-08 — Virtual cabinet users and cabinet auth (Geoff)

**D130. The virtual cabinet is used by Geoff with a kid.** *(Geoff; answers virtual-cabinet.md question 1.)*
- Not Geoff alone for testing, and not a kid alone at the mini. The mini is Geoff's logged-in Mac with Claude Code a window away, and the kids never use Geoff's login solo (§5), so a kid plays or makes at the virtual cabinet with Geoff there.
- The virtual cabinet itself still never holds Geoff's login (D129, D131).

**D131. Each cabinet signs in with its own workspace-scoped API key.** *(Geoff; answers virtual-cabinet.md question 2 and closes D16's cabinet-auth question.)*
- One key per cabinet: the virtual cabinet now, the Picade later. Each key belongs to a **dedicated cabinet workspace with its own spend limit**, separate from the mini's `game-studio-arcade` workspace, so a cabinet's builds are capped, counted and revocable on their own. (Workspace-scoped keys can reach only their workspace's resources, and spend limits are set per workspace in the Console: platform.claude.com/docs/en/manage-claude/workspaces, checked 2026-11-08.)
- The key is stored **only on that cabinet**, in the cabinet service's own config file, mode 0600. Never in git, logs, carts or the launcher (§11). Creating the keys and workspace in the Console is Geoff's step; nothing pasted into chat.
- The mini is unchanged: it keeps the `ant` CLI login (D16) and must never have `ANTHROPIC_API_KEY` set. The cabinet service reads its key from its config file and hands it to the SDK directly, not through a shell environment variable on the mini. So the two rules don't meet: the mini has no key, and a cabinet has only its own.
- Code follows (not done here): the auth helper (D17) gets a cabinet path that reads the key file, while the mini path stays profile-only.
- Why not the alternatives: WIF needs the account converted to an organization (D15, D16); browser login needs a person present, which fits an unattended cabinet badly.

## 2026-11-08 — Virtual cabinet V0 build

Decided by Claude (the V0 worker) unless marked. Results are in D147–D149 and platform-notes.md.

**D140. V0 boots Plan A's way: the pinned Pi OS root filesystem, Debian's kernel, our own small initramfs, UTM's direct Linux boot.** *(Claude; implements D121. The Plan A/B verdict waits for the first boot.)*
- Kernel: Debian trixie `linux-image-6.12.107+deb13-arm64`. Its `vmlinuz` is already the uncompressed arm64 Image that Apple's Linux boot loader needs (checked 2026-11-08).
- Initramfs: `busybox-static` plus the kernel modules needed to mount the root, built by our script. It installs the kernel's modules on the root filesystem and hands over to the stock systemd.
- Direct boot, not UEFI, because UTM only creates a UEFI variable store when its GUI saves a VM, and direct boot is fully scriptable. If the display (D141) needs UEFI, it comes with that step.

**D141. V0's VM has no display device, and the kiosk draws to a headless compositor at 1024×768.** *(Claude; proposes a change to D123 and D126 for V0. Follows Geoff's "no windows without my OK" and his request that Claude can drive the screens from the mini without any window.)*
- UTM opens a window for any VM with a display device. A VM without one runs headless.
- Same kiosk above the compositor: `cage` and Chromium, with `WLR_BACKENDS=headless,libinput` and software rendering in the `virtual` profile. The `picade` profile uses `cage`'s normal DRM backend.
- Geoff's window (D126) is still wanted for playing with a kid (D130). It is a later generator option plus his OK. V0 doesn't prove it. Also not proven in V0: the window-focus checks and how the display behaves.
- Sound-in is off in the VM config (`AudioInput` false), so UTM never asks for the microphone. Sound-out stays on.

**D142. Where it lives.** *(Claude.)* `cabinet/provision/` holds the script, its profiles, files and locks. `cabinet/vm/` holds the driver. `scripts/virtual-cabinet/` holds the generator and boot commands (D123). VM disks, downloads and keys live in `~/game-studio-data/vm/`, never in git.

**D143. The seed goes on the image's FAT partition.** *(Claude; extends D4.)* macOS can't write ext4, but it can write the FAT boot partition without sudo. The generator puts the script, the bundle, the kernel modules and the cabinet's SSH public key in `seed/`. A one-shot systemd service runs `provision.sh` on first boot and logs to `seed/provision.log`, which the mini can read with the VM off. The real Pi can use the same seed, so the same script runs on both.

**D144. The driver: uinput for keys, `grim` for screenshots, both over SSH.** *(Claude; implements Geoff's request, via the director, that Claude can drive the virtual cabinet's own screens.)*
- `cabinet/vm/drive` has `press`, `hold`, `down`, `up`, `type` and `screenshot`, using the D82 key names.
- Keys go through a small uinput daemon in the VM, `arcade-keyd` (Python standard library only, `virtual` profile only). So they travel kernel → libinput → compositor → Chromium, the same path as the Picade overlay's virtual keyboard. Chromium's DevTools protocol would skip that path. A real hold is two events apart, which hold-to-talk (D87) needs.
- Screenshots are the compositor's actual 1024×768 output.
- Simulating audio in for hold-to-talk later, not built: load `snd-aloop` in the `virtual` profile and play a WAV into the loopback while `drive hold` holds the talk button, so the speech pipeline hears it through ALSA as if from a mic. Testing the pipeline alone can feed the WAV straight to it.

**D145. Node 22 from nodejs.org, pinned by SHA-256, and `gsa-playtest` uses its node driver in the VM.** *(Director's call, following D9: Node 22 everywhere, matching the sandbox and the Pi.)*
- The official linux-arm64 tarball, v22.23.4, not trixie's Node 20. The generator seeds it, and the script checks its SHA-256 and installs it under `/opt/arcade/node/`.
- Playwright isn't installed in the VM yet, so V0's frame-time numbers come from the node driver, labelled `host: "virtual"` by `cabinet/vm/` (D128). The browser-driver gate is V1.

**D146. Starting the VM needs two steps from Geoff, once.** *(Claude; facts checked 2026-11-08. Geoff decides.)*
- **Gatekeeper:** UTM (notarized, Developer ID Turing Software, WDNLXAD4W8) is still quarantined. Anything that runs from `UTM.app`, even `utmctl --help`, raises the first-open dialog. Removing quarantine by script was OK'd through the director, but Claude Code's permission system refused it, so it stands. Geoff clears it by opening UTM once.
- **Automation:** the only scripted way to start a VM is `utmctl start`, which uses Apple Events. So the first start should raise one "control UTM" consent prompt. UTM removed `utm://start` in v4.5.1 and has no start-on-launch setting (its `shouldAutoStartVM` only applies to a display window already opened), so no route without Apple Events was found. Its remote server needs pairing through the GUI, and Shortcuts would need a shortcut made by hand.
- Geoff approved UTM's first open on 2026-11-08. macOS keeps the quarantine attribute and sets its 0x40 flag (`0181` became `01c1`).
- `scripts/virtual-cabinet/up.sh` is the one command for after that. It refuses to run until that flag is set.
- The 16K-page kernel (it matches the Pi 5) waits until a 4K boot works, so one thing changes at a time.

**D147. Plan A won (D121): the stock Pi OS userland boots on Debian's kernel.** *(Claude, from the first boots, 2026-11-08; D121's checks.)* Boots unattended, apt sees Pi OS's own sources (Chromium comes from Raspberry Pi's archive), and bridged Wi-Fi gives an address and `arcade-virtual.local`. What Debian's kernel changes: `loop` and `uinput` are modules, so the `virtual` profile loads them, which keeps Pi OS's zram-and-file swap working as on the Pi. `rpi-eeprom-update` is masked (no EEPROM).

**D148. A normal build has no serial device.** *(Claude, from a boot that froze for an hour, 2026-11-08.)* UTM's serial device is a pseudo-terminal. With `console=hvc0` and nobody reading it, its buffer fills and the kernel spins on the console: `soft lockup … stuck for 3512s`, with the guest frozen and the mini's CPU at about 190%. The first boot only worked because a reader happened to be attached. So the VM doesn't get one, and nothing can block on it. This goes beyond D123, and UTM's docs recommend keeping a serial device on a headless VM. SSH and `seed/provision.log` are how to look inside. `build.mjs --serial-console` adds it for debugging, with `serial.sh` reading.
- **UTM keeps a VM's config in memory.** Replacing `config.plist` changes nothing until UTM quits, so `rebuild.sh` quits it. That's why boots with other `console=` settings seemed to freeze the same way: they were still running the old config, and those tests showed nothing about `console=`.

**D149. How the VM starts with no window.** *(Claude, measured 2026-11-08.)* `open -gj` launches UTM hidden, then a plain `utmctl start`: no UTM windows on screen, and `verify.sh` counts them. `utmctl --hide` doesn't work here: it asks UTM to close its main window, that's refused with `-10004`, and a 900×652 window stayed on Geoff's screen until UTM quit. Opening the `.utm` package is only needed the first time, and may show that window, so `up.sh` registers, quits UTM before the VM starts, and launches hidden again. After every start it counts UTM's windows, and if one is up it stops the VM, quits UTM and exits with an error rather than leave it there. No privacy setting was changed.
## 2026-11-08 — Virtual cabinet: Geoff's answers

**D150. Games made on the virtual cabinet move to the Picade's shelf when it arrives, with their history.** *(Geoff; answers virtual-cabinet.md question 3.)* Nothing is deleted on either cabinet (D5).

**D151. After the Picade arrives, the virtual cabinet stays as a staging cabinet.** *(Geoff; answers question 4.)* Updates are tried there before they reach the Pi (D122).

**D152. The virtual cabinet is bridged on the home Wi-Fi.** *(Geoff; answers question 7, confirms D124.)* It's a device on the home network like the real cabinet, so any home device could open its pages. Bridging works (D147).

**D153. Played with the Mac keyboard for now; a USB arcade controller later, with its own key map.** *(Geoff; answers question 8, updates D125.)* Geoff: "I plan to buy an arcade controller; it may have different key mappings but we could use it for testing." So a controller passed through to the VM must be able to carry its own key map rather than assume D82's keys. Nothing is bought or built for it now. It's a test device for the virtual cabinet, and it doesn't change the Picade's map (D82).

## 2026-11-08 — Cabinet service in the virtual cabinet

**D154. The cabinet service replaces the V0 launcher in the VM, on replay until the cabinet has a key.** *(Claude; carries out the director's deploy request and cabinet/service/README.md.)*
- `arcade-launcher.service` runs `cabinet-service.js`. With `/etc/arcade/service.json` (D131) it's live; without it, the `virtual` profile replays Penguin Catch and spends nothing (D186), and the `picade` profile stays down and says why.
- `node_modules` comes from `npm ci --omit=dev --ignore-scripts` on the cabinet, from the repo's lock file, so the cabinet contacts registry.npmjs.org while provisioning and never at run time. **The Pi needs the same access when it's provisioned**: the home Wi-Fi it's on anyway, like apt. Nothing the service needs has an install script: the lock file's only one is `fsevents`, a macOS-only optional dependency (checked 2026-11-08), and there are no native `.node` files.
- TypeScript moved from dev-only to a real dependency of `studio-kit/spec`, at the same 6.0.3: `validate_cart` runs `tsc` at run time. Without it, every make on a cabinet ended "didn't pass its tests". The cabinet's whole `node_modules` is 55 MB with it (measured 2026-11-08).
- `cabinet/vm/flow.mjs` runs the same `.drive` scripts as `cabinet/service/scripts/drive.js`, but on the VM's own screens: keys by uinput, shots from the compositor, screen state read through Chromium's DevTools port. That port is 127.0.0.1 only and `virtual` only, and only reads state. It is not part of the Picade.

**D155. A cabinet's agent is applied with its own key, on a pipe, from the mini.** *(Claude; implements D131 and D185, keeps D16. The director asked for the route to be chosen and explained.)*
- `scripts/virtual-cabinet/connect-cabinet.sh` reads the key with no echo, from a terminal only. It runs `ant --api-key-stdin apply --lock-file claude-lock.<cabinet>.json` in `studio-kit/managed-agent`, then writes `/etc/arcade/service.json` over SSH's stdin, owned by `arcade`, mode 0600. The key is only in the script's memory and on pipes: never an argument, an environment variable, a file on the mini, or a log line. The mini's `ANTHROPIC_API_KEY` rule (D16) is untouched, and the script stops if that variable is set.
- **Why this route:**
  - **It can't reach the wrong workspace.** A key belongs to its workspace, and `ant apply` refuses a lock file for any other (docs, checked 2026-11-08). The script also reads the `anthropic-workspace-id` response header before anything else, and refuses the mini's workspace.
  - **It leaves no credential on the mini.** A second `ant auth login --profile` would leave a refreshable token for the cabinet's workspace in `~/.config/anthropic`, and add a browser step. Later re-applies read the key back from the cabinet (`--reapply`), so nothing is pasted twice.
  - **It needs nothing new on the cabinet.** Running `ant` in the VM would mean another binary on the cabinet, just for setup.
- One lock file per workspace, as the docs recommend. The ids aren't secrets, so it's committed.
- **Replay can't go live:** the script stops if a replay cart, session or log is on the cabinet, so one can't move to the Picade under D150. The fix is a rebuild.
- `sudo` logs its command lines to the journal, so the key must never be on one. `service-config.mjs` takes it on stdin, and `key-check.sh` keeps its search patterns in a file.
- The same script serves the Picade later, with `ARCADE_HOST` and `CABINET` set. It has only been tested with stand-ins for `ant` and the API, because a live run is Geoff's and the director's call. So a real `ant apply` with a real key, the first thing Geoff's run does, is unproven.

**D156. Bridged stays (D152), with its Wi-Fi gaps handled, not hidden.** *(Claude; the finding is for Geoff.)* Measured 2026-11-08: see platform-notes.md. `up.sh` restarts a VM that's silent for 10 minutes, once. The cabinet plays on its own through a gap, because its service and kiosk are inside the VM. A gap stops the mini reaching it: the driver, SSH, and later the Manager and MCP. The 3-hour soak showed the guest's own internet staying up through 28 short gaps, so a live make shouldn't feel them. Long lockouts and long-lived streams weren't measured. What does feel them is anything the mini drives: gaps of about 40 seconds every 3½ minutes. Shared networking is the documented fallback (D124), and Geoff would lose the home-network visibility he chose.

**D157. `cabinet-virtual`'s spend limit is $10 a month.** *(Geoff.)* With the cabinet's cap of about $3 a make, that's about three makes at worst. Measured builds cost 30–60¢, so more like 15–30 in practice. *(D204, 2026-11-11: raised to $13, so a make that runs past the family pot can finish.)*

**D158. The cabinet's key: a service account's if the Console offers one, otherwise Geoff's, scoped to `cabinet-virtual`, expiring never.** *(Geoff. Supersedes D131's "workspace-scoped key" only where that means an ownerless key.)*
- The docs now call ownerless workspace keys legacy, and a new key has an owner. D131's other terms stand: one key per cabinet, a dedicated workspace with its own spend limit (D157), stored only on that cabinet.
- **Owner:** a service account, on the Service accounts page, added to `cabinet-virtual`. Otherwise a personal key linked to Geoff. Geoff's account is an Individual org, and the service-accounts API returned 404 on 2026-11-07, so a personal key is likely. The Console page itself hasn't been looked at, so step 3 of cabinet/README.md says how to tell.
- **A personal key acts as Geoff, but only in this workspace.** It isn't his login (D129, D130), but it stops working if he loses access to the organization or the workspace.
- **A service account key changes nothing in `connect-cabinet.sh`:** both start `sk-ant-`, and the script tells them apart only by whether the API answers for one workspace. A service account's key must be scoped too, because the account also belongs to the Default Workspace. A key that isn't scoped gets the API's 400, and the script stops and says so.
- **Expiration:** Never. An expiry would stop Make with no warning to whoever's at the cabinet.

## 2026-11-08 — Library redesign: catalog, fetch on demand, templates

Geoff, after the Penguin Catch cost breakdown: "have a medium weight model (like sonnet) retrieve context as needed from the library; and the library is built for expressiveness and token efficiency", with "a few canned starting points/templates which would be most token efficient but less expressive, and one start from scratch option". It will grow, including "the ability to navigate three dimensional space". The measurements behind this are in [cost-penguin-catch.md](cost-penguin-catch.md) and [phase-0-results.md](phase-0-results.md).

**D160. The library is a short catalog plus modules fetched on demand.** *(Geoff's direction; design by Claude, library worker. Replaces D100's "read it all"; refines D45.)*
- The agent always sees one file, the kit's `KIT.md`: conventions, one line per module and template, and the commands. Its source is `studio-kit/context-pack/CATALOG.md`. Budget: 2,000 tokens, enforced by a test.
- Everything else is read only when the game needs it. Library modules are one file each beside the code, `runtime/lib/ref/<module>.md`, tested against the exports; these stay the one source (D100), and `runtime/lib/REFERENCE.md` becomes an index. Kit-level modules (`cart-api`, `checks`, `sprites`, `spec`) are in `studio-kit/context-pack/modules/`.
- The modules are written for token efficiency: signatures and what a cart needs to know, not paragraphs. `RECIPES.md` is folded into the modules and templates.
- **How it grows:** a new capability (for example a pseudo-3D raycasting or isometric module, which is what "three dimensional space" means on a 256×192 console) adds one code file, one `ref/` file and one catalog line. The catalog grows by a line and a build that doesn't use it pays only for that line. A test fails if a catalog line points to nothing or a module has no line.
- Files read with bash, not a skill. A token costs the same either way, so what matters is reading less (D45, cost breakdown). A skill adds a second versioned resource for no saving.

**D161. Four tested templates and one blank start.** *(Geoff's direction; choice of templates by Claude.)*
- `studio-kit/context-pack/templates/`: `catch` (things fall, catch the good, avoid the bad), `dodge` (free movement, things fly at you), `maze` (tile-by-tile walking with walls and pickups), `paddle` (a ball off walls) and `blank` (title, play, game over, nothing else).
- Each is a complete passing cart (`spec.md`, `cart.json`, `game.js`, `checks.js`), with the numbers an agent would change in one `CFG` block. They replace the three example carts of D100.
- **None is a falling-blocks game (D12);** the test from D100 stays and covers them, so the model comparison still measures building Falling Blocks rather than copying it.
- The agent copies one and edits it in small steps rather than rewriting. Order stays spec first (D44): spec, then checks, then freeze, then `game.js`.
- The trade Geoff named: most token-efficient, less expressive. A game that doesn't fit starts from `blank`, and the agent says which it chose. Forks still start from the parent, not a template.

**D162. Checks get a tested bot helper, `t.bot`.** *(Claude.)* Measured: `checks.js` cost more than twice `game.js`, and almost every first-playtest failure was the agent's own test bot.
- `runtime/lib/bot.js`, with its own tests: `start`, `hold`, `press`, `wait`, `delta`, `play` and `reach`; steering helpers `toward`, `away`, `nearest`; assertions `ok`, `eq`, `near`.
- `checks.js` still imports nothing (D21, D30): the handle carries it, so it works unchanged on both drivers. It isn't in `g.lib`, because carts have no use for it.
- `reach` fails with a message that says what it wanted and where the game stopped, and says plainly that a bot lost, so a dead bot can't be mistaken for a game bug. Steered loops stop at 3,000 frames by default, to stay inside the browser limit.
- D11 and D44 are unchanged: checks still come from the spec, before code, and freeze.

**D163. Checks may set up state with `t.poke`, a cart's optional test hook.** *(Claude; refines D103; additive to D21.)*
- A cart may export `poke(g, s, o)`, called only by `t.poke(o)`, e.g. `{ lives: 99 }`. A cart without it gets a clear error if a check asks.
- It exists because "the bot died before frame 3,000" was the commonest failure and the reason some checks were weakened (phase-0-results: Fishy Penguin R5–R8, R12). With `poke`, a check reads the real speed at frame 3,000 by keeping the player alive, and no bot has to be good at the game.
- **Limit:** poke sets up the situation; it never stands in for the thing a rule is about. A rule about losing lives can't poke lives, and a rule about score can't poke score. `checks.md` says so and a reader can see it in `checks.js`. D103's steering stays the default for anything that can be reached by playing.

**D164. Pack size uses a calibrated ratio.** *(Claude; replaces D102's estimate and ceiling.)*
- Measured from the Penguin Catch reads: Markdown 2.58 characters per token, code 2.35. `pack-size.js` uses those, and the fixture's measured reads are in a test, so the ratio can't drift from the evidence silently.
- Budgets: catalog 2,000; any one module 1,500; any one template's files 4,500. A template costs about a third as much to read as to write, so it can be bigger than a module. There's no more single pack total, since no build reads it all. `pack-size` also prints what a typical build reads.
- Keep prompts well under 100k: Haiku's price jumps about 5× past it. The first builds under this design are the check.

**D165. Ask before reading more.** *(Claude; from the cost breakdown's "ask questions before reading the kit".)* The brief reads only the catalog before asking, which is enough to ask good questions. Modules and templates come after the questions, so a kid's long think (over 5 minutes expires the cache) rewrites about 10k tokens rather than 37k.

**D166. Recommendation: catalog and fetch for every build; templates stay available, with a condition.** *(Claude, library worker; **accepted by Geoff, 2026-11-08**, through the director, with D169. Measured in [phase-0-results.md](phase-0-results.md#the-library-redesign-d160d166).)* Same request, Sonnet 5.5, one build each: up-front bundle 56.9¢, catalog and fetch from blank 40.4¢, from the `catch` template 13.7¢. Peak prompts 69k, 44k and 25k.
- **Fetch on demand is the default.** It costs less at the same question depth, and it makes the prompt small while the kid is thinking. How it's packaged stays files in the tarball (D45).
- **The template build isn't a like-for-like saving.** It reskinned `catch`, and used one of three recorded answers: the slippery penguin and "more boots" weren't built. Part of that is the replay (an unmatched question gets D, D47), and part may be that it read the template before asking.
- **Condition before relying on templates:** the brief should make the agent ask first and treat a template's rules as defaults, then one more build should show a template honouring the kid's answers. Not done here: the task allowed two sessions, and the brief as measured is the brief on this branch.
- `studio make --context-pack no-templates` builds the blank-only kit for this comparison. The `skill` route is untouched and unused.

**D167. A starting point's rules are defaults; the player's answers override them.** *(Director's instruction after D166; Claude, library worker. Tightens D161, D165.)*
- The brief says not to open a template or module until the questions are done, and to ask as if there were no template, including how the player moves.
- After asking, every answer must show up in the spec as a rule or an Assumption, and `CFG` and the code change to match, however much of the template that replaces.

**D168. A replay can answer an unmatched question with A instead of D.** *(Director's instruction; Claude, library worker. Option on D47.)* `studio make --replay-unmatched A`. D ends the questioning (D166's template build stopped early that way), so a comparison that needs the whole conversation answers A, logs `replay_fallback` in the session's notes, and marks that question `fallback: true` in `replay_log`. The default stays D.

**D169. D166's condition is met: use a template when one fits.** *(Claude, library worker; **accepted by Geoff, 2026-11-08**, through the director, with D166. Measured in [phase-0-results.md](phase-0-results.md#re-run-a-template-build-that-honours-the-answers-d167d169).)* Under D167's brief, and with D168 so the questions couldn't end early, a build from `catch` asked all three questions before opening the template and cost 29.4¢, against 40.4¢ from blank and 56.9¢ with the old bundle. It passed 11 of 11 auto rules first time. Measured on the running cart, the penguin slides 74 px after letting go and boots rise from 19% to 35%; the earlier template build does neither.
- **13.7¢ wasn't a build's price; 29.4¢ is the figure to use,** still from one build on the request `catch` fits best.
- **The trade remains the one Geoff named:** the build is cheaper and looks more like the template than the blank-start build does. Worth Geoff playing both before accepting.
- Not changed by this: a replay maps recorded words onto the nearest tile (D47), so "Faster and more boots" became "More fish and more boots" in both builds, and fall speed never rose.

**D170. `g.lib.fx`, and templates polished with it.** *(Geoff asked for polish when accepting D169, through the director; how by Claude, library worker. Extends D50, D161.)*
- A new library module, because four templates each carrying pop-up and heart code would pass D164's budget and be rewritten by every build. `fx.pop`, `fx.tick`, `fx.draw` for pop-ups, `fx.lives` for hearts, `fx.title`, `fx.banner`. It changes no game state, keeps pop-ups as plain data, and has one catalog line and its own tests.
- `fx.title` returns the clear space between its words, so art drawn there can't cover them. That's the fix for Penguin Pond's title sitting under its big penguin, which an agent wrote by hand: the `catch` template had no picture on its title, so it now has one, placed this way, for agents to copy. A test checks that no word lands in that space, including for a title too long for double size.
- `catch`, `dodge`, `paddle`: pop-ups on events, hearts rather than the word LIVES, a game-over panel showing the score or NEW BEST, and falling or flying things cleared at game over rather than hanging in mid-air. `maze` has one life and a clock, so it gets pop-ups and the panel but no hearts. Clearer sprites: `catch` an apple, rock and basket, `dodge` a ship and comet, `maze` a walker and gem, `paddle` a bigger round ball (6 pixels, from 4) and a shaded paddle. `blank` uses the title and panel, so a game built from it starts with them.
- D12 and D164 hold. Sizes in tokens, before → after: `catch` 4,468 → 4,489, `dodge` 3,156 → 3,341, `maze` 3,659 → 3,911, `paddle` 3,406 → 3,582, `blank` 1,763 → 1,720, all within the 4,500 budget, plus `ref/fx.md` at 549 for an agent that wants its details. `pack-size` prints them. No live build has used these yet, so what they do to a build's cost isn't measured.

**D171. A replay picks a tile only if it says the same as the recorded words; otherwise it says them through C.** *(Director's instruction after D169; Claude, library worker. Changes D47's reply by meaning.)*
- D47 picked a tile when the words overlapped by at least half, so "Faster and more boots" picked "More fish and more boots", and "faster" was lost silently in both D169 builds. Now the content words must be the same both ways. "You lose a life" still picks "Lose a life", while "Faster and more boots" goes through C in its own words.
- Matching a recorded answer to a question is unchanged, since that's about which answer applies, not what it says. Earlier builds aren't re-run, so their replay logs stand as recorded.

**D172. `studio make` runs the brief in the repo by default.** *(Geoff's acceptance of D166 and D169 says this is the default; Claude, library worker.)*
- The applied agent is still v1, from before D44, because `ant apply` is blocked. So a plain `studio make` would have run the old read-everything brief. It now sends `agents/studio.md` as a session override unless `--applied-brief` says otherwise; `--brief-from-file` still works and does nothing new.
- **Not done:** applying the agent. The cabinet service will use the applied agent, so `ant --profile game-studio-arcade apply .` must happen before the virtual cabinet makes games. *(Done 2026-11-08, and the default changed back: see D173.)*

## 2026-11-08 — Applied agent v2

**D173. `studio make` runs the applied agent again, and refuses a stale one.** *(Director asked for the decision; decided by Claude, tasks 7+8 worker. Changes D172's default.)*
- Agent v2 is applied, carrying the repo's brief at that time (D44, D46, D48, D49, fetch on demand). `claude-lock.json` pins it, and a re-apply reports nothing to do.
- **Default back to the applied agent.** The cabinet service will run the applied agent, so that's what a CLI build should test. Its version is pinned and logged, where an override is just text in a session.
- **A stale brief can't run silently.** Before anything is uploaded or started, `studio make` reads the pinned agent version from the API and compares its system prompt, custom tools and toolset safeguards with `agents/studio.md`. On a mismatch it stops and says what differs and how to fix it. A live read, because the lockfile only knows what was last applied, not what the repo says now or what changed in the Console. If the agent can't be read, that counts as a mismatch.
- **Two ways past it, both on purpose:** `--brief-from-file` runs the repo's brief as a session override (the way to try a brief before applying it), and `--applied-brief` runs the applied one anyway. The record says which: `brief` is `applied-agent` or `file-override`, and `brief_check` holds the result of the check.
- `studio check-brief` runs just the check. The cabinet service should make the same check.
- **Apply with bare `ant --profile game-studio-arcade apply`,** not `apply .` as D40 said. Bare apply updates only what the lockfile tracks. `apply .` also walks the folder, and it planned to create a second skill from D45's leftover `skills-staged/`. `studio skill` now stages in a temp folder so this can't recur.

**D174. Files over a skill, under the fetch brief, was reasoned and not measured.** *(Director's instruction from the completeness audit; Claude, library worker. Qualifies D160, D166.)*
- **What was measured:** the only skill build (`sesn_01Mt89MxLgQtq7L6Ezeqf3Jh`, D45) ran under an older brief that said to read everything, before D46 and D47. It shows that packaging alone saves nothing. It doesn't show what a skill does when the agent reads only what it needs.
- **What was reasoned:** D160 keeps files because a token read from a skill costs what a token read with bash does, and a skill is a second versioned resource to keep in step with the kit. The one thing that could differ is a skill's description sitting in the prompt, or the agent reading more or less through it. Neither was tested.
- **The comparison as it ran:** (a) up-front bundle, (b) catalog and fetch from blank, (c) and (c2) catalog and fetch from a template, with the older skill build shown for reference only. The task's original wording named a three-way with "pack as skill". No build ran catalog and fetch through a skill.
- Revisit only if a skill offers something files don't. A build to settle it would cost about what (b) did.

## 2026-11-08 — Studio screens on the launcher

Geoff: "Next time I want you to fully run a game build, once the stack is ready, fully from the simulated interface; this will let you pressure test the ui that Alina will be looking at, see text field overruns, pressure test that the studio s output works there". The first slice of the cabinet service and the launcher's Studio flow. Implementation is in [cabinet/service/](../cabinet/service/README.md).

**D180. The launcher draws on the 256×192 console, not as a host page.** *(Claude; the brief left this to the worker. Extends D81.)*
- It uses the runtime's own `Framebuffer`, font and palette, on a canvas the same size as a cart's, shown at the largest whole multiple (4× on 1024×768). So what Alina sees between games is the same chunky pixels as the games, and there's no jump in look or scale.
- It's the deciding reason for text fitting, too: a fixed font on a fixed grid makes a string's size pure arithmetic. A test can prove what fits without a browser, with no font-loading or HTML reflow to go wrong. Every Studio string has 40 columns by 21 rows at most, so overruns are real and worth the care (D181).
- It isn't a cart. A cart can't reach the network (D13), and the launcher must reach the service. It's the trusted host page; carts still run in the sandboxed frame inside it, through the runtime's `createHost`.
- Not chosen: an HTML page at 1024×768, which has room for four times the text but looks like a web page around the games, and whose fit depends on layout we'd have to measure in a browser only.

**D181. Every Studio string goes through one text box, and nothing Claude says is lost.** *(Claude; first-class in the brief.)*
- `text.js` is the only way words reach the screen. It cleans a string to what the font can draw (smart quotes, dashes and accents become their plain forms; emoji and control characters go; D21's font would draw each as `?`), wraps by word, breaks a word too long for a line, and fits the result to a box of columns and rows.
- Text too long for its box ends in `...`, deliberately. Then one of two things applies, and each box says which:
  - **A kid must read it to answer** (questions, options, plan rules, you-check rules, a transcript): stick right opens a reader with the full words, scrolled with the stick. Nothing is lost.
  - **It's passing or a label** (progress lines, shelf titles, names, failure messages): the `...` is the end of it. The full words are in the logs.
  - **Our own words** (hints and fixed messages) must fit: a cut there is a fault, so a test fails rather than a hint trailing off.
- Each frame records every box drawn: its text, position and size, the lines drawn, and whether it was cut. `check()` turns that into violations: a line wider than its box, lines taller than it, a box off screen, two boxes overlapping, or a cut with no way to read the rest when one is required. Tests feed long strings to every screen and fail on any violation, and measure real ink from the framebuffer against the box. The browser run asserts the same report at every step.

**D182. Stick chooses, any player button picks.** *(Claude. Follows D87's "any of the six player buttons".)* Tiles are lettered A, B, C, D, and the cabinet has buttons labelled A, B, X, Y, so "press A" on tile B invites a mistake: picking by a button's letter would sometimes mean another tile than the one lit. So the stick moves the highlight and any of the six buttons, or START, picks what's lit. A button already held when a screen opens does nothing until it's let go, so picking C can't start the mic. ESC always goes back (D88). F1 and F2 (launcher-only, D82) are spare; F1 is used by D184.

**D183. The first service slice: one process, one Studio session at a time.** *(Claude; implements §4's cabinet service in part.)*
- `cabinet/service` runs the session through the CLI's `makeCart` and driver, imported, not copied: the tile relay is an `Answerer` that waits for the launcher. It mounts the local player's handler for the cart list, plays, you-check and the runtime, so the logs have one shape. Launcher to service is plain local HTTP, with server-sent events for Studio state.
- One session at a time; its state is in memory. A launcher reload picks it up again. A service restart loses a running session; D189 says what happens then.
- A failure before `makeCart` can log anything (no network, a refused key) still appends a `studio_session` record with `outcome: "error"`, so no kid's turn goes unlogged (§3.1).
- It serves on 127.0.0.1:8330, the port the kiosk already opens (D140s), and takes the data folder as `GSA_DATA_DIR` does, so `arcade-launcher.service` can point at it.
- Only kid-language lines reach the screen: `tell_player`, `progressFor`, and the service's own words for each outcome. The build summary with test changes (D46, D49) goes in the log, as for the CLI, not on the kid's screen.
- **Stubbed or not here:** real speech (D184), request screening and guardrails (Phase 3), forks (`studio fork` isn't built), MCP, Manager API, publish gate, launcher sound, gamepads in the launcher's own menus, guest players. Screens exist for every step of §8.1; the shelf shows carts one to a line, without a fork action.

**D184. Speech is an interface; for now it's a stub fed text or a WAV, and F1 types instead.** *(Claude; the brief's stub. Phase 3 replaces it.)*
- `start()` when a button goes down, `stop()` when it comes up, returning a transcript. This is the §8.1 shape, so the bake-off's winner fits without touching the screens. No audio is stored.
- The stub answers from a queue, fed by `POST /api/speech/feed` with `{text}` or `{wav}`. A WAV is checked to be one and its transcript comes from the `.txt` beside it, so the path can be tried before there's real speech. An empty queue is silence, and the screen says it didn't hear.
- F1 on a talk screen types instead, since the virtual cabinet has a keyboard (D125) and no mic yet. New names start in typing, as the brief asks; when real speech comes, one flag makes them start on hold-to-talk as D87 says. The Picade has no keyboard, so real speech must land before kids use it there.
- Letter keys only type on the typing screen; everywhere else Z X C V Q E are buttons (D82).

**D185. The cabinet's auth path: the key file, strictly.** *(Claude; implements D131. Closes tasks/cabinet-auth-path-read-the-cabinet-s-api-key-file.md.)*
- `createCabinetClient({configFile})` in `studio-kit/auth` reads `anthropic_api_key` from the service's config file and hands it to the SDK directly, with no profile. It refuses a file that group or others can read or write, a missing file, or a missing key, and never puts the key in an error. `createClient` stays profile-only and still refuses a key, so the mini can't pick this path by accident; the two are separate functions on purpose.
- **What D131 implies, for Geoff's setup step:** a workspace-scoped key can reach only its workspace, so `claude-lock.json`'s agent and environment, which live in the mini's workspace, aren't reachable from a cabinet. The cabinet's config names its own `agent_id` and `environment_id`, made by `ant apply` in the cabinet's workspace, and the kit uploads there on first use.
- **The stale-brief check (D173) applies to the service as it does to the CLI.** The service runs the applied agent through `makeCart`, which makes the check before anything is uploaded or started and stops on a mismatch. The kid sees "the Studio isn't ready" and the log has the record, with what differs. There's no override in the service: `--brief-from-file` and `--applied-brief` are for a person at the mini.

**D186. Scripted in headless Chromium, against a replay.** *(Claude; the brief's "test without spending".)*
- `--replay DIR` on the service swaps the API for a replay of a recorded session (`studio-kit/cli/fixtures/penguin-catch`, now with its cart, so the whole make can finish and be played). The real `makeCart`, library commit, logs, validation and playtest all run. It's never the default, and the service prints that it's replaying.
- `scripts/drive.js` starts the service and a headless browser at 1024×768 with no window, and runs a script of the same verbs and D82 key names as `cabinet/vm/drive` (`press down`, `hold a 800`, `type name`), plus `say`, `wait` and `shot`. So moving to the VM later means swapping the transport. Each step checks the fit report.
- Live runs use the same script against the real API and are the director's call.

**D187. ESC during a make goes to the shelf; the make carries on.** *(Claude; §8.1 step 5, "the kid can play something else meanwhile".)* While a session runs, the Make tile becomes "Back to your game" and says when Claude is waiting on a question, so an answer is one press away. A question doesn't pull a kid out of a game they're playing. *(The gap this left, a kid walking away from a question, is closed by D188.)*

**D188. A make nobody is answering gets released; Make is never stuck.** *(Director's instruction; design by Claude. Closes D187's gap.)*
- **The timeout:** 10 minutes on a question or the plan with no key pressed anywhere on the cabinet, including in a game (`question_timeout_s` in the config). In the last minute the hint says "Still there? Move the stick!", and any key starts the clock again. The service keeps the clock, so a reloaded page or a kid in another game doesn't change it. Waiting costs little (D165: past 5 minutes the prompt cache expires, about 10k tokens to rewrite), so 10 minutes favours a kid who's thinking.
- **The way back:** ESC on a question or plan now asks: keep going, come back later (the shelf, with the way back on its tile, D187), or stop making this game.
- **Release:** the driver is stopped, the session's events are saved in its folder, usage is read, and the session is **archived**, never deleted (D5). The docs (session-operations, checked 2026-11-08): archiving prevents new events and preserves history, and only a `running` session can't be archived. A session waiting on a custom tool is `idle`, so it can go straight away. If the archive is refused, it interrupts, waits briefly and tries once more. Whatever happens, Make is free at once, and a failed archive is logged, not shown.
- **What's logged:** a `studio_session` record with `outcome: "abandoned"`, `ended_by: "timed_out" | "stopped"`, the request, turns, usage and `archive: {ok, error}`.
- **What the kid sees:** after a timeout, a plain message if they're on that screen, then the shelf; if they've gone elsewhere, a line on the Make tile. After choosing to stop, just the shelf.
- A build running with no question pending isn't timed out: it ends by itself under its budget, and the shelf says when it's ready. **Not run against the real API**, like the rest of the service.

**D189. A service restart mid-make: the kid gets a message and the shelf; the session is logged as still running.** *(Director's instruction; design by Claude. Changes D183's "its record isn't written".)*
- The service keeps `studio-run.json` in the data folder from a make's start to its end: maker, request, session id, turns. If it finds one when it starts, the last run didn't end, so it appends a `studio_session` record with `outcome: "service_restarted"` and `session_left_running: true`, and removes the file.
- **The session isn't stopped.** *(D191 corrects this: a session stalls at its next `tell_player` with nobody relaying, and the service now picks it back up and collects the cart.)* It carries on at Anthropic, under its budget, until it finishes or waits on a question no one will answer. Nothing resumes it; the log has its id, for a person or the Manager later. Its work isn't collected, so any cart it finishes never reaches the shelf.
- **What a kid sees:** within a few seconds of the service going, "Just a moment. The cabinet is restarting." When it's back, on any Studio screen: "Sorry! The cabinet restarted, so your game didn't get finished. Tell me your idea again!" and a button to the shelf, where Make is free. If the page reloaded as well, or they weren't on a Studio screen, the message is a line on the Make tile. A game being played carries on, since it's already loaded.

**D190. The brief states the screen's real limits; agent v3.** *(Director's instruction, cleared to apply; Claude.)*
- `ask_player` now gives them: a question under about 60 characters shows double size (20 × 3), 240 at most (40 × 6), each option 111 at most (37 × 3), plain ASCII. Word wrap takes some of each. A test ties these numbers to the layout, so they can't drift. (The first figure given for options, 114, was out by one column.)
- `tell_player` no longer names "unpacking the kit" as a milestone, and rules out words like kit and cart. Its example was why agents wrote "Unpacking the studio kit".
- `progressFor`'s lines are now "Getting my tools out", "Putting it together" and "Checking your game". Recorded streams keep the words they were recorded with.
- Applied with bare `ant --profile game-studio-arcade apply` after a dry run: only the agent's tools changed, the environment didn't. `studio check-brief` says v3 matches the repo.

**D191. After a restart the service picks the make back up, so the kid's game isn't thrown away.** *(Director's instruction; design by Claude. Corrects and changes D189.)*
- **D189 was wrong that a session "carries on until it finishes".** `tell_player` is a custom tool that waits for a result, so with nobody relaying, a session goes idle at its next progress line. Polling for "idle with outputs" would wait forever. So the service re-attaches the driver to the session (`resume` in `runSession` and `makeCart`, the same code, not a copy). It rebuilds the turns from the session's history, relays `tell_player`, waits on the stream to the end, then runs the normal validate, playtest, commit and log path.
- **Finished:** the cart goes on the shelf, with a shelf entry (D192) noting "It finished while the cabinet was restarting". The `studio_session` record has `resumed_after_restart: true`. The session is then archived, never deleted, and that's logged as a `studio_session_correction` with the session's id.
- **Failed its checks or came back with no cart:** nothing goes on the shelf. The entry says so in kid words, everything's kept, and the session is archived.
- **Not finished yet:** it stays attached, within its budget. If the attach fails (no network), it tries again every minute (`recheck_s`). The list of sessions still to collect is `studio-left.json`, so another restart picks up where this left off and doesn't log the restart twice. A session the API says is gone (404) is logged and dropped.
- **Waiting on a question or plan** (*Claude's call; the director's instruction didn't cover it*): nobody can answer, and answering for the kid would build things they didn't choose, so it isn't finished for them. It's archived and logged as `outcome: "abandoned"`, `ended_by: "no_one_to_answer"`. If that was already the case at the restart, the kid has been told; if the question came later, they get a shelf entry saying so.
- **What the kid is told** now depends on where it stopped: on a question, "Tell me your idea again!"; while building, "Your game may still finish: look for it on the shelf."
- No override for the brief check on this path: the session already exists, and it runs what it was started with. The record keeps the lock it started under.
- Not built: deferring this playtest while a kid is playing (§14 wants that for the publish gate, which isn't built either).
- **Not run against the real API**, in particular re-attaching to a live stream and archiving.

**D192. How a make ended is its own shelf entry; Make stays Make.** *(Director's instruction; Claude. Changes D187's tile.)*
- A make that has ended no longer holds Make's place, so the next kid doesn't see someone else's result in its way. The shelf is Make, then any results not yet viewed, then the games. Only a make still running takes Make's place, as "Back to your game" (D183: one session at a time).
- An entry shows its maker's name: "New game ready!" with "by Alina - Penguin Catch", or "A new game didn't finish" with "by Alina". Opening it shows the result screen, and leaving that screen marks it viewed, whoever opened it.
- A kid following their own make still goes straight to the result, and an entry they've seen doesn't appear.
- Entries live in `studio-results.json` next to the library, so they survive a restart. Viewing one stamps `viewed_at` and nothing is removed.

**D193. The shelf's starter games don't ask kids to check anything.** *(Geoff, 2026-11-09, through the director.)*
- The shelf keeps the three starter games, but drops their "1 to check" label, because no kid made them. Made games keep the label and the questions. How it's done is Claude's:
- A cart with no `maker` in its `cart.json` is a starter. Everything made through the Studio has one (`makeCart`, D87), and the seeded templates don't, so this needs no marker, no re-seeding and no change to carts already on a cabinet.
- On the cabinet, a starter's you-check rules aren't offered at all: no label, no questions after a play, and `/api/you-check` refuses an answer. The rules stay in its `spec.md`, untouched. A game made from a starter has a maker, so it asks as usual.
- The desktop player (D71) is unchanged: there, a person checking any cart is the point.

**D194. Back from a game, the shelf stays on that game.** *(Director's instruction; Claude.)* Pressing ESC, answering you-check, or a game that wouldn't start all return to the game just played, so playing it again is one press. If that game no longer exists, the highlight falls back to Make. This only applies to coming back from a game: from any other screen, such as leaving "Who's making?", it's on Make as before.

## 2026-11-09 — Living with a running cabinet

**D195. A running cabinet is updated in place, and the driver's keys land exactly once.** *(Claude; the director asked for both before the first live build. Carries out D4's "the Manager runs a newer script", follows D5, D131 and D156.)*
- **Updating:** `scripts/virtual-cabinet/update-cabinet.mjs` ships a checkout's cabinet software to a running cabinet. A rebuild destroys carts and logs and removes the key, and Geoff's key is shown only once, so a rebuild is for a broken or throwaway cabinet, not for a fix.
- **The cabinet updates itself:** the mini sends the bundle, then `update-on-cabinet.sh` runs there in its own systemd unit, so a dropped connection can't stop it halfway. It runs the newer `provision.sh` over the cabinet as it stands, and compares before and after: every cart file by hash, each log still starting with what it held, the config's hash, mode and owner. If the script fails or the service doesn't return, it relinks the previous release and says so. It refuses while a make is running.
- **Versions:** `/etc/arcade/provisioned-version` now names the release, version plus bundle hash, so it moves with any change. The bundle is built the same way each time (no gzip timestamp, fixed owners), so the same checkout gives the same hash, and updating twice doesn't make a second release. `provisioned-commit` records the commit. Old releases are kept, like everything else (D5).
- **What the update proves about the data is widened by D196.**
- **Not taken:** D129's UTM snapshot before each update. Copying a running VM's disk isn't safe, and stopping the VM would cut off a game. The kept release covers software, and the update doesn't touch data. Worth revisiting for updates that change data formats, which this doesn't handle.
- **Keys:** a held SSH connection doesn't reliably ride out a gap (D156: it survived one and died in the next). So each key has an id, and `arcade-keyd` remembers the ids it has done. When SSH fails, the driver can't tell whether a key landed, so it asks again with the same id. The daemon checks, presses only if it hasn't, and logs the repeat. Reads just repeat. `drive ssh` and `drive run` don't, because their commands may not be safe to repeat.
- **Every SSH attempt has a hard limit.** A screenshot during the gap phase once sat on one stuck attempt for 29 hours, because nothing bounded a single try. Now `drive` cuts an attempt off after 60 seconds plus the keys' own time, `flow.mjs` limits each of its calls, and `verify.sh`, `connect-cabinet.sh` and `update-cabinet.mjs` limit each try to 120 seconds. A cut-off attempt counts as SSH failing, so keys settle by id and reads repeat. A stuck held connection is killed and opened again.
- **How it was proven (2026-11-09 to 10):**
  - On the VM, 16 long walks with every press checked against the screen: about 880 keys each, none pressed twice, none missing. Six crossed gaps: one a real gap on 11-09, the run the 29-hour stall above held up, three across 9 simulated gaps, and two across 15 simulated gaps with ARP blocked.
  - None of those gaps cut a connection, so no key needed settling on the VM. That case, SSH failing after a key landed, is proven by `update.test.mjs` against a stand-in `ssh`: every key was asked again by id and pressed once.
  - The real gaps didn't come back while this was tested (D156).
- **A late key is still in order.** Steps run one at a time, and a `hold` is one command on the cabinet, so its length is right however late it arrives. A `down` and `up` pair can be held longer than asked, if a gap falls between them.

**D196. An update proves every piece of the cabinet's data came through, not only carts and logs.** *(Claude; the director asked, following D5, once the first live makes left a failed make's record in `sessions/`.)*
- Before provisioning, `data-check.mjs` records every file under `/var/lib/arcade`, except `chromium/`, which is the kiosk's browser cache. The record holds each file's size, hash and mode, never its contents. That includes carts and the library's git history, `sessions/`, `makers.json`, `studio-results.json`, `studio-left.json` and `kit-uploads.json`. After provisioning, and after a rollback or a failure too, the update compares.
- Under `logs/`, files only grow: each must still start with exactly what it held, and a new log is fine. Everything else must be byte-identical, and a new file outside `logs/` fails. No update migrates data yet. One that does will have to say which files it changes, and how.
- **The update now also waits when makes cut off by a restart are left to collect (`studio-left.json`).** On start, the service picks those up, which can commit a cart and rewrite that file and the shelf's results (D191). Those are real changes, but they'd look like data loss. It already waited for a running make.
- A kid looking at a new result on the shelf during an update stamps `studio-results.json`. The check would report that as a change, so it errs on the side of saying so.

## 2026-11-10 — Fixes from the first live makes on the virtual cabinet

From `~/game-studio-data/vm/verify/live-make-2026-11-10/REPORT.md` (director). Make 1, Cloud Popper, landed for $0.56. Make 2 proved walk-away, restart, re-attach, collect and archive live, but its game was lost to the first fix below.

**D197. A changelog line can't cost a kid a working game.** *(Director's instruction; Claude's choice of how.)*
- Make 2 passed all 10 auto rules, then local validate refused `- v1.1: Birds enter from the side…`, a line the agent wrote after changing a rule post-playtest. The cart was thrown away as "didn't pass its tests".
- **Both fixes.** `parseSpec` now accepts a dotted changelog version (`v1.1`), counted as its whole number (1) for ordering and the next free version. A changelog line is history for people; nothing reads its decimals, so refusing one protects nothing. The spec guides still show whole numbers as the form.
- **The brief** now says changelog versions are whole numbers, and that after any edit to `spec.md` (and before packing) the agent runs validate again, packing only a cart that validates.
- Other spec form errors still fail, on purpose: those are rules or sections the playtest and the kid's plan depend on. The re-validate line is what keeps those from reaching the cabinet.

**D198. Progress only moves forward.** *(Director's instruction; the order is Claude's, the wording and look are the design worker's.)*
- In make 1 the list went backwards and repeated: "Packing up" and "Putting it together" before building, "Playing your game to test it" twice, "Reading up" after "Writing the rules", and "All done!" before the cabinet's own checks.
- Each line now has a stage: getting started, the spec, building, testing (fixing is part of testing), packing. The driver shows a line only if its stage is at or after the last one shown, and never shows the same words twice. `tell_player` lines take their stage from the tool's own `stage`; the built-in lines from a fixed table. The cabinet's own lines after the session ("Bringing your game home", "Checking your game here at home") come last anyway.
- Lines that told nothing or misled are gone: a shell command with no meaning no longer says "Putting it together", and "Packing up" means making `cart.tgz` or `DONE.json`, not copying the spec to outputs before the build.
- The agent's "done" line isn't shown. It said "ready" before the cabinet had checked the game; the result screen says that, truthfully.
- Recorded streams keep their lines; this decides which reach the screen.

**D199. Make stays busy while a restarted make is being collected, and the journal says so.** *(Director's instruction; Claude. Closes the gap D191 left against D183.)*
- While `studio-left.json` lists any session, including while an attach is waiting to retry, `start` refuses (409) and the shelf's first tile says the last game is being finished. Pressing it explains and goes back. When the list is empty, Make is Make again. One paid session at a time holds across a restart.
- The service writes a journal line when it finds a make a restart cut off, when it re-attaches to a session, and when it collects it, with the outcome and whether the archive succeeded. A failed attempt already logged an error line.
- The trade: if the cabinet can't reach the API for a long time, Make stays busy for that long. It couldn't make a game without the API anyway.

**D200. The brief asks for visible feedback and a title that says how to play.** *(Director's instruction; Claude.)*
- Cloud Popper's dart was a 1-pixel dot gone in about 0.2 s: the playtest passed it, but a kid would think A did nothing. Its title screen said only "CLOUD POPPER / BEST 0".
- Two lines in the build step: every player action shows on screen straight away, big enough and long enough to see (at least 3 pixels across and about half a second); and the title screen says how to play in a line or two: what the buttons do and the goal, within 40 characters a line.
- Kept to two lines: the brief's length is a cost on every build (D164).

## 2026-11-11 — The arcade experience and the family coin pot (Geoff)

Geoff, 2026-11-10: "please have a worker build claude design artifacts to show me the full arcade ux ... there should also be a post game screen asking if the user wants to make any revisions. we likely also need a mechanism to rate limit game creations; maybe an allowance that shows the running total cost, cost per revision, and remaining budget; it should feel fun and arcade-y, but be transparent about cost and limits." The design is the Claude Design canvas https://claude.ai/artifact/M8ndK7LnLr1vYo266rovJA (55 boards). Geoff answered its questions through the director (2026-11-10) and through the narrated walkthrough https://claude.ai/artifact/VTPQrXr9TXRN92r1qRMjd7 (2026-11-11, all five option A). The build handoff is [design/arcade-ux-handoff.md](design/arcade-ux-handoff.md).

**D201. The arcade's screens are the canvas's, end to end.** *(Geoff's ask; design by Claude; the choices below are Geoff's.)*
- The canvas covers boot (first-ever and normal), the shelf, play, the post-game screen, the whole make flow, the change (revision) flow, the coin pot and its limits, errors, and the Cabinet Manager's coin pot page. Where it differs from today's launcher, the canvas wins, within the decisions below.
- **After every game, starters included, a "change anything?" screen shows** (Geoff, answer 10). It follows any you-check questions, offers a fix for a rule the kid just said No to, and has Play again and Back to the shelf. Starters still ask no you-check questions (D193); their post-game screen offers "Make my own version".
- **The plan is one screen** (walkthrough Q13, option A of three): the idea in a line, how to play, and the four rules that matter most, with a "you check" key. The full rules are one stick-press away, and the spec stays the source of truth. Not chosen: three short pages; only the rules the kid will check.
- From the live makes (2026-11-10): a "how to play" screen before every game; a typed idea gets the same confirm step as a spoken one, so Enter can't start a build early; progress is a four-step track (Plan, Build, Test, Done) that only moves forward, with coins used and time left (the look D198 left to design).
- D187's tile wording changes: while a make waits on the kid, the first tile says "Claude is waiting for <name>", not "Back to your game".

**D202. One family coin pot, and a make is charged its real cost.** *(Geoff, answers 1 to 7, 2026-11-10; walkthrough Q17, 2026-11-11.)*
- **One pot for the whole cabinet**, not a wallet per kid. Each maker's running total for the month is shown wherever the pot is. Geoff: "they'll sort it out if they have the data". A friend's make comes out of the same pot and shows under the friend's name.
- **The pot is the real budget: 100 coins = $10 a month.** 1 coin = 10 cents. Coins are shown big, the real cents small beside them.
- **On the 1st of each month the pot fills back to 100** (Q17, option A). Leftover coins don't carry over, and a negative balance is wiped. Not chosen: carrying leftovers over.
- **A make or change is charged what it really cost** (its session's list cost), rounded to whole coins for the kids, in exact cents in the ledger.
- **No refunds, ever.** A failed make still spent real money; its result screen says so kindly and blames Claude, not the kid. The same goes for a stopped or abandoned make (D188) and one a restart cut off (D189, D191).

**D203. A make starts only if the pot holds its usual cost; once started, it always finishes.** *(Geoff, answer 4 and 6; walkthrough Q16, option A.)*
- The cabinet won't start what the pot can't cover. Since a make's real cost is known only at the end, "cover" means its usual cost: **6 coins for a new game, 3 for a change.** With 5 coins left, a change can start and a new game can't. Not chosen: anything above zero; the worst case (30 coins).
- A started make is never cut off for coins. If it costs more than the pot holds, it finishes and the pot shows a negative balance until the 1st.
- The usual costs are settings, not constants: 6 matches the live makes (56¢ and 53¢); 3 is a guess until a change is measured.

**D204. The cabinet workspace's spend limit rises from $10 to $13.** *(Geoff, walkthrough Q15, option A. Changes D157. Changed by D211: $15.)*
- The pot is $10 and the workspace limit was $10, so a make that ran past the pot would have hit the real limit and stopped halfway, which D203 rules out. $13 leaves room for one overrun. The per-make cap stays about $3 (the session budget).
- The pot stays 100 coins. Geoff sets the new limit in the Claude Console. If the real limit is ever hit, the kids see "The Studio is resting" until the 1st (canvas board L5).

**D205. Only the COIN button starts spending, and only grown-ups add coins, in the Manager.** *(Geoff, answers 9 and 12.)*
- A coin check comes before every make and change: the usual cost, the time it takes, and what the pot holds. **Only the COIN button starts it.** Every other screen keeps D182's "any player button picks".
- Top-ups and resets happen only in the Cabinet Manager, never at the cabinet. Each has a reason, which the kids see in the coin history.

**D206. Anyone can change any game, and the shelf shows family rows.** *(Geoff, answer 8; walkthrough Q11, option A of four.)*
- The maker's change is the next version of the same game. Anyone else's change is their own version, which starts from the parent's spec (§8.2). The original is never touched, and nothing is deleted (D5).
- **The shelf shows family rows:** the newest version of each game, one press to play, with a version tag. Other makers' versions are indented under the game they came from. Older versions are on the game's card (stick right on its row). Not chosen: folders, big tiles, a flat list.

**D207. At most two you-check questions after a play, about things you can see.** *(Geoff, answer 14, as a default rather than a question.)*
- After a play of a made game, the cabinet asks at most two you-check questions, chosen from rules a kid can judge in one play. Sound isn't asked about while the cabinet has none to hear. The rest wait for later plays. The live make asked three, including one about holes that only appear later and one about sound.


## 2026-11-11 — Building the arcade UX (worker, to the handoff)

**D208. The coin pot is a ledger in the logs, and the balance is only what the ledger says.** *(Claude; carries out D202-D205 and the handoff's §2.)*
- `logs/coin_ledger.jsonl`, beside `studio_session.jsonl`, one line per charge, refill, top-up or reset: who (a maker id, `cabinet` or `grown-up` with `by`), what, the game and version, the session id (the join to `studio_session`, §9.5), the change in cents, a make's exact cost, the coins it shows as, the outcome, the reason, and the pot before and after. Append only (D5); under `logs/` so an update proves it only grew (D196). There's no separate balance file to disagree with it.
- **The refill is lazy:** the first read of the pot in a new local month appends the refill, set to 100 whatever was there. Nothing can see the pot without reading it, so this is the same as a midnight job and can't be missed by a cabinet that was off.
- **The gate compares whole coins, as shown:** 56c is 6 coins and lets a new game start, because that's what the kid sees. Rounding is to nearest, the same either side of zero (-56c is -6). At 0 or below it's "empty" (L2), under the usual cost "low" (L1).
- **A charge is once per session id**, so a restart that collects a make can't charge it twice. A make with no session (refused before it started, stale brief, no Wi-Fi) costs nothing and leaves no line.
- **Every ending is charged** (D202): on the shelf, didn't finish, stopped, walked away, restart. The cost is the session's `usage.list_cost` (whole cents, the API's own rounding, D19). A session the API no longer has (D191's 404) is charged 0 with `cost_known: false`, rather than a guess.
- **The live meter is cheap:** the stream's `session.usage` events carry the session's running list cost, so the driver passes them to the cabinet as they arrive (a new `ui.usage`). Coins used so far count up during the build; the charge at the end uses the session object's usage (D43).
- **The workspace limit (L5)** is recognised by the session refusing to start with a spend-limit error. That wording is a guess (no limit has been hit yet); when it matches, `cabinet-state.json` marks the month as resting and Make refuses until the 1st.
- **The Manager's side is built, the Manager isn't:** `/api/manager/pot` (pot, ledger, rules), `/pot/preview` (the workspace-limit warning, $15 since D211), `/pot/topup` and `/pot/reset`, each needing a reason, behind a pairing token in the cabinet config (`manager_token`). With no token configured, they don't exist (404). The launcher has no token, so a kid can't add coins (D205). The Manager's page, pairing and the token's delivery are still to build.
- The numbers are settings under the config's `pot` (`usual_cost_new`, `usual_cost_change`, `monthly_coins`, `cents_per_coin`, the usual minutes, `over_usual` 1.5, `workspace_limit_cents` 1500, D211).

**D209. A change is a new cart folder; its version and line are in cart.json.** *(Claude; carries out D206 and §8.2, with `studio fork` still unbuilt.)*
- `makeCart` takes a `parent`. The parent's folder is packed (with its earlier answers as `earlier-turns.json`) and mounted at `/mnt/session/uploads/parent.tgz`, and the first message says it's a fork, as the brief's Forks section already expects.
- **The maker's own change** is the next version: folder `<line>-v<n>` (`penguin-catch-v2`), `version: n`, `parent: "penguin-catch@1"`, `family` (the first game) and `branch` (the line's first cart). **Anyone else's** is version 1 of a new line, `family` the same, no `branch` (its own id is its line). The parent folder is never touched; old versions are folders, so any of them can be played from the game's card.
- A cart with no `family` is its own family, so every cart already on a cabinet reads the same as before. Nothing is migrated.
- The record gets `kind: "change"`, `parent`, and a `spec_diff` against the parent's spec.
- **The replay needs a change to replay:** `studio-kit/cli/fixtures/penguin-catch-change/` is hand-written by `cabinet/service/scripts/make-change-fixture.js` from the real make (a red scarf; R12 changes; 31c, a guess until a live change is measured). Its cart validates and passes its playtest, so the replay commits it. Replace it with a recorded change after the live one.

**D210. The plan tool carries the controls, the four rules, and a change's old words.** *(Claude; carries out D201's one-screen plan and D207. A brief change: the director reapplies it.)*
- `show_plan` gains `controls` (how to play, in kid words), `top_rules` (the ids of the four that matter most, every you-check among them), and per rule `was` (a change's old words) and `new`. The launcher falls back to the first four rules and the cart's Controls when an older agent leaves them out.
- The brief says: at most two `(you check)` rules, each visible in one play, nothing about sound (D207); the plan's new fields; and in a fork, `was`, `new` and `changes`.

**D211. The cabinet workspace's real spend limit is $15; the kids' pot stays 100 coins.** *(Geoff, 2026-11-11, through the director: "let's make it 15 behind the scenes, but still cap the kids usage at 100 coins/month". Changes D204.)*
- The pot is unchanged: 100 coins = $10 a month, the start gate and the overrun rules as D202 and D203 say. Only the real limit behind it moves, which leaves more room for an overrun or a grown-up's top-up before the workspace refuses a session (L5).
- The Manager's top-up warning (D208) now compares against $15 (`workspace_limit_cents` 1500, a setting). Geoff sets the limit in the Console.

**D212. How the boards were built, where the handoff left it open.** *(Claude, building D201 to the handoff.)*
- **One generic board.** Most boards are blocks of words above tiles at the bottom (`launcher/boards.js`), each view tagged with its canvas id (M3, L1, E3...), so the drive scripts wait on and report boards by id. The shelf, card, pot, history, how-to-play, plan and progress have their own layouts.
- **The coin check comes before the idea** (M1, M3, then M4), as the handoff orders it. A retry (E3) and a fix (G3) go through the coin check too, then straight to "Is this right?" with the words filled in. A new name gets its own "Is this your name?" step, like a typed idea (D201).
- **The plan:** up, down or left chooses between Build it and Change it; stick right always opens every rule in the reader, as the screen says.
- **You-check after a play** asks the first two rules that aren't about sound, judged by words (sound, hear, music, beep, noise...) until a rule says what it is (D207). The shelf's tags: NEW for a made game nobody has played, "n to check" once it has been played, "starter" for a game with no maker, and the version past v1.
- **E9 stays on the talk screen**, with the handoff's words and the hint "Hold a button to try. F1: type it.", rather than tiles: on a talk screen every button is the mic.
- **B1 stays up at least 1.5 s**, so "Warming up..." can be read.
- **Score and best on G4 aren't shown:** a game's saves are inside its sandboxed frame and nothing reads them out yet.
- **Replays get their own session ids** (`sesn_replay_<time>`), so each replayed make is charged once, as a live one is. A replay picked up after a restart still counts its answers the old way, so a "Make it now" before a restart replays as a question nobody can answer; live sessions read their real history and aren't affected.

**D213. The boards are driven on the virtual cabinet beside the kiosk, not in it.** *(Claude; the director agreed the plan, 2026-11-11.)*
- The virtual cabinet is live (D154), and a replay's carts, sessions and logs mustn't be in its data (D150). So `cabinet/vm/replay-boards.sh` runs a second cabinet service from the installed release on port 8341 (8331 is the guest games' port on the tetris-like branch, its D232), with its data in `/tmp/arcade-replay/<flow>`, and the cabinet's own Chromium headless beside it. The mini drives that Chromium over an SSH tunnel (Playwright's `connectOverCDP`), so the drive scripts, the board ids and the fit report are the same as on the mini. The kiosk on 8330 and `/var/lib/arcade` are untouched, and both are stopped at the end whatever happens.
- The cabinet has no Playwright package, only `/usr/bin/chromium`; this needs nothing installed there.

## 2026-11-11 — The first live make and change through the new screens

Director's go: one new game and one change by "Tester", $3 at most. Screens are in `~/game-studio-data/vm/verify/arcade-ux-2026-11-11/live/`.

**D214. A change's parent upload is an input, never an output; the mock API now behaves like the real one.** *(Claude; from the live change.)*
- **The new game** (Log Hopper, `sesn_01FThJ8JHr5FVrhSTtrkCnqa`) cost 54c: 2 questions (A, then Make it now) and 1 fix round. The ledger charged 54c / 5 coins, the pot went from 1000 to 946c, and the result screen said so. The new brief led the plan with four rules, two "you check", and the play after asked exactly those two.
- **The change** (Tester's v2, `sesn_01AGtT9A5sdoUx5QYdSDBqxA`) built, validated and passed its playtest in the sandbox, at 9c with one question. Then the cabinet failed to bring it home. The API lists files mounted into a session among its files, and refuses to download an uploaded one (`400 file_not_downloadable`). `INPUT_NAMES` skipped only `studio-kit.tgz`, so `parent.tgz` was taken for an output. The kid saw E3 and was charged 9c (D202: no refunds), as designed.
- **Fix:** `parent.tgz` is an input name. The mock API now lists every uploaded file and refuses to download it, as the real API does, so the change tests failed without the fix and pass with it.
- **Two screen fixes from the same run:**
  - The header's coins-used read "Tester: 0..." cut; it's now "N used" with a coin.
  - A new game's plan re-shown mid-build (a rule change after testing, brief step 7) now says what changed first, and leaves out how to play, which the first plan showed.
- **usual_cost_change is now 2** (the director, 2026-11-11). The one measured change cost 9c (about 1 coin), a one-number change with one question; 2 leaves headroom until more are measured. It stays a setting (config `pot.usual_cost_change`). The change fixture now ends at 9c too, so the replayed change reads "about usual" against 2, and the screens say "about 2" for a change wherever they said "about 3"; the handoff's coin table says so.
- **The change, again, with the fix** (`sesn_01HK8K41KHN8yWLHhwBmfnUd`, after updating the cabinet to 7531b1c): Tester's v2 of Log Hopper came home as `log-hopper-v2`, version 2, for 14c with one question and no fix rounds. The ledger charged 14c / 1 coin, "on the shelf", pot 937 to 923c, and A2 lists it. The two measured changes, 9c and 14c, are both about 1 coin, so 2 holds.

## 2026-11-11 — Arcade UX follow-ups (worker)

From Geoff's answers to the director, 2026-11-11: top-ups before the Manager exists, "A command on the mini"; the post-game score, "Build score and best"; kids changing a downloaded game, recorded verbatim in D218.

**D215. A game reports a round's score with `g.score(n)`, and the post-game screen shows it and the best ever.** *(Geoff: "Build score and best". How is Claude's.)*
- **The runtime:** `g.score(n)` takes a whole number from 0 to 999,999,999, once when a round ends. Anything else throws, so the playtest's no-errors check catches a bad call. The frame passes scores to the host with its other output, and the host keeps them (`host.scores`). Checks can see them with `t.scores()`, on both playtest drivers.
- **The starter library reports for every game that uses it:** `score.commit(g, sc)`, which every starting point already calls at game over, now calls `g.score` first. So games built from the library report with no change, and so do the starters already on the shelf. The brief adds one line for games that don't use the library: call `g.score(n)` once at game over. That's a brief change; the director reapplies it.
- **The play log** keeps each play's `scores` and its best as `score`. The best ever is worked out from the play log, per game line: a game's versions by its maker (D206). Another maker's version has its own best. `/api/carts` gives it as `best`.
- **The screen:** G3, G4 and G5 show "Score: 120. Best: 340." under their title, or "Score: 400. A new best!" when this play beat every earlier one. A game that reports nothing shows no score line. The play is logged before the screen reads the best, so the best includes this play.
- **Downloaded games** don't report yet. teti would need its game-over handler to post `{type: "score", n}` to the launcher's window, which is a few lines in its `src/cabinet.js`, and the guest bridge (D232) would pass it on like Escape. That's small but not done here: its post-game screen (D232) has no score line yet either.
- **Proven on the virtual cabinet** (4fc8a4d, 2026-11-11): a new game by Tester, Rock Rain (`sesn_0165NpFnowwUfRwK4sHFNEQt`, 19c, 1 question, 0 fix rounds), built with the reapplied brief. Played to game over twice, standing still. The post-game screen said "Score: 9. A new best!", then "Score: 9. Best: 9.", and the play log has `scores: [9]` both times. Its plan (M9) showed how to play, in the agent's words. The live run also found that "Play again" asked answered you-check questions again, because it replayed the cart as it was before the answer. Fixed, with a browser test.

**D216. The coin command on the mini, until the Cabinet Manager exists.** *(Geoff: "A command on the mini". Carries out D205's top-ups and resets.)*
- `node scripts/coin.mjs show | add N "reason" | reset "reason"`, using the cabinet's own token-gated Manager endpoints (D208) through the cabinet's SSH (`cabinet/vm/drive`, so the private link of D241).
- **The token:** `coin.mjs pair` has the cabinet make a 32-byte token in `/etc/arcade/manager-token` (0600, owned by arcade) if it has none. It keeps a copy in `~/.config/game-studio-arcade/manager-token` (0600). The service reads that file on each request, so pairing needs no restart and the API key's config file is never touched. The token only ever travels on stdin: a small helper on the cabinet reads the request and the token from stdin and calls the service on 127.0.0.1. It isn't in a command line, a log or this repo. A token file others can read is refused.
- **`add`** previews first. If the month could pass the workspace's real $15 limit (D211), it says so and stops unless given `--yes`. The reason is required, and the kids see it in A2.
- Tested against a real service on the mini (`scripts/test/coin.test.mjs`). The cabinet needs an update to read the token file, then one `pair`.
- **Proven on the virtual cabinet** (2026-11-11): `pair`, then `show`, then `add 1 "Testing the coin command"`. The kiosk's coin history (A2) showed "A grown-up added 1 coin" and the reason. Then `reset "Back to normal"` set the pot to 100. The ledger has both entries, by Geoff.

**D217. The plan always shows how to play: the cabinet's driver was dropping it.** *(Claude. Corrects D214's line that the agent left `controls` out.)*
- In both live sessions the agent did send `controls` and `top_rules`. The CLI's driver built the plan for the screen from `summary`, `rules` and `changes` only, so the screen never saw them. M9 fell back to its own four rules and showed no "How to play".
- **Fix:** the driver passes every `show_plan` field through (`planOf`), both live and when it rebuilds turns after a restart. A test checks that nothing the agent sent is dropped.
- **Belt and braces:** `controls` is now required in the `show_plan` tool's schema. That's a tool change, reapplied with D215's brief line. No retry loop: the agent sent it every time, and a retry would cost a turn to fix a mistake that wasn't the agent's.

**D218. Kids can change downloaded games however they like; it stays on the cabinet.** *(Geoff, 2026-11-11, verbatim: "Kids can make arbitrary changes to look, name, mechanics — these are non commercial, fair use and will not be distributed". Answers D233's open question.)*
- A kid's change to a downloaded game (D230) may change its look, its name and its mechanics. The result stays on the family's cabinet and its backup, and is never published or shared outside the home.
- **Not built.** What building it would take:
  1. **A change flow for guests:** the guest's folder as the parent (`play/` and `guest.json`), mounted as `parent.tgz` is today (D209). The result is a new guest version in the cabinet's data, never in the repo's `guests/`.
  2. **The brief:** teti is 6.5k lines of plain JS with no `spec.md` and no `checks.js`. A spec-first change (D1) needs at least a short spec written for the guest first, and the agent has to find its way around a big codebase rather than read it all. That costs more than a cart change: likely a new-game cost or more, so its own usual cost.
  3. **Checks:** the house playtest can't run a guest. A guest smoke test (it loads, no errors, the keys work, Escape goes back) would stand in, plus you-check questions about the change.
  4. **The screens:** the guest post-game screen (D232) gets "Change it?". The shelf shows a kid's guest version under the original, as family rows do (D206).
- **Licences:** the cabinet keeps each guest's NOTICE as it is, and a kid's version carries it forward. teti is MIT, and its non-free parts were already replaced (D233).

**D219. The replay's change is a recorded one.** *(Claude.)* `studio-kit/cli/fixtures/log-hopper` and `log-hopper-change` are Tester's live make and change (D214), copied from the virtual cabinet, so the replay has a matched, recorded pair. The cabinet service's replay uses `<replay>-change` if it exists, otherwise `log-hopper-change`. The hand-written `penguin-catch-change` and its generator are gone. These are the test maker's sessions, typed by Claude, with nothing a kid said in them.
- **Small follow-ups from the build:**
  - A session that fails on the cabinet's side after it ran (as the live change did, D214) is now archived, like a released one, and the archive is logged as a correction.
  - `cabinet/vm/drive` takes `coin` as the COIN key (it's `f2`).
  - The cabinet's launcher helper waits on board ids (`wait M3`) as well as screen names, so live drives no longer need `expect` and sleeps to tell boards apart. It ships with the next update.

## 2026-11-11 — Downloaded games on the shelf (worker; D208–D229 are the arcade UX build's)

**D230. Downloaded games reach the shelf as web games in the kiosk ("guest games").** *(Geoff asked for the stack to be chosen first and for games Claude can change cheaply, 2026-11-11; the choice is Claude's. Report: docs/falling-blocks.md.)*
- One way in for every downloaded game: an HTML5 page played in the kiosk's Chromium. TIC-80 and PICO-8 carts come in through their web players or exports. Native players (RetroArch, LÖVE, PICO-8 native) come later, and only for a must-have game with no web build. This settles "guest players" in §3.1 and D183's "Stubbed or not here" for web games.
- Why: nothing new takes over the screen; Escape, logging and the kiosk lockdown are solved once; and the Studio's Playwright tools can drive and check a guest game the way they check a cart.
- Games are judged by hackability tier: **A**, edit and reload (plain JS, fantasy-console carts); **B**, edit and rebuild (C/C++ to WebAssembly); **C**, binary only (not picked). Tier A is preferred where the game is good enough.
- A downloaded game costs no coins to play (playing is always free, D202).

**D231. A guest game is a folder, like a cart.** *(Claude; follows D230.)*
- `guest.json` (id, title, by, version, upstream source and commit, entry page, how to play, players), `play/` (exactly what is served), `NOTICE.md` (every file's origin and licence, and whether it uses the Tetris name or look), the upstream licence, and any tools that make its assets.
- Guests that ship with the cabinet live in the repo's `guests/` and update with the service; nothing in a guest's folder is ever deleted, and a new version is a new `version` in `guest.json` with the old one in git. A licence that isn't checked is a reason not to ship the file.

**D232. Guest games play on their own origin, and Escape still goes back to the shelf.** *(Claude; follows D88, D230.)*
- The service serves guests on a second port, `127.0.0.1:8340` by default (`guest_port` in the cabinet config, or `--guest-port`; 0 picks a free one, as the tests and the D213 replay do), never the launcher's origin, so a downloaded game can't call the cabinet's APIs (cross-origin writes are refused) and keeps its own storage.
- The launcher plays a guest in a full-screen iframe that has focus, so the game reads the keys itself. The service puts a small script at the top of the guest's page: it takes Escape before the game sees it and tells the launcher, which ends the play (D88). F1 and F2 stay launcher-only by convention; a guest never gets Escape.
- Plays are logged like a cart's, to `logs/guest_play.jsonl` (guest id and version instead of a cart's).

**D233. The first guest is teti, cleaned up for the cabinet.** *(Its open question, a kid's change to a downloaded game, is answered by D218.)* *(Geoff's pick, 2026-11-11; the cleanup is Claude's.)*
- teti (TitanPlayz100/teti, MIT, pinned to commit 1de7944), tier A: about 6.5k lines of plain JS, no build step.
- Its sounds (TETR.IO's), music (commercial Touhou arrangements), skins and icons are replaced by assets this repo generates (`guests/teti/tools/make-assets.mjs`); pixi.js 8.23.0 (MIT) is vendored at a pinned version; fonts are OFL and local. Nothing loads from the network.
- **No GSAP** (director, 2026-11-11). Upstream teti animates with GSAP, whose Standard "No Charge" licence isn't open source: it bars use in no-code animation tools that compete with Webflow's, and lets Webflow end the licence. So the cabinet's teti has its own small tween helper, `play/src/tween.js`, with GSAP's names, so teti's 31 call sites are unchanged. Everything teti ships is open source (MIT, OFL) or this repo's, and the Studio can change all of it.
- Cabinet changes, all in plain JS: Marathon (a level every 10 lines, faster each level, to 20) and Zen (nothing falls on its own); a game picker, pause and game-over screens driven by stick and buttons (`src/cabinet.js`, loaded with `?cabinet`); the D82 keys (stick moves, up drops, A/B turn, X holds, Y turns twice, START pauses).
- The board is bigger on the cabinet: teti's own Board Size at 130, the top of its slider, so the board is 580 px of the 768 (from 460). That needed one upstream fix: texts shared style objects, so their font size compounded at any size but 100. The in-game info page is ours, crediting only what ships (director, 2026-11-11).
- It keeps guideline-style piece colours; it has no Tetris name. That's acceptable for a downloaded game (D230); a kid's change to it may count as a Studio-made game, and that question is open.

**D234. A version of a downloaded game is its own guest folder, naming its parent and its maker.** *(Geoff: "make a new version that keeps a score; treat it/show it like a fork to test that pattern, make the author Geoff". The shape is Claude's; it's the pattern D218's kid changes will use.)*
- **A full copy, not an overlay:** `guests/teti-geoff/` holds its own `play/`, `guest.json`, `LICENSE` and `NOTICE.md`, like a change to a cart is a new cart folder (D209). A version is a snapshot, so a later change to teti can't change Geoff's. The copy was committed unchanged first, so the history shows exactly what the version changes. Git stores the unchanged files once, so the copy costs almost nothing in the repo.
- **`guest.json` names it:**
  - `maker` (`{id, name}`);
  - `parent` (`{id, version}` of what it came from);
  - `family` (the original's id);
  - `made`, and `changed` (what's different, in a line).
  - `by` stays the original author, so credit stays true.
- **The original is untouched.** A test checks that the two `play/` folders hold the same files and differ only where the version changed them (`src/cabinet.js`, `info.html`).
- **The shelf** shows a guest's versions as family rows (D206): the original, then each version indented under it, "by <maker>", with the same "free game" tag. A version whose original isn't there stands on its own. Neither has a card yet: guests have no older versions to list.
- **NOTICE** is carried forward and says what changed (D218): Geoff's version is teti by TitanPlayz100 (MIT), changed.
- **For a kid's change later** (D218, not built): the same folder shape, written to the cabinet's data (`<data>/guests/`) rather than the repo, with the kid's maker id.

**D235. A guest reports a round's score through the guest bridge; the post-game screen shows it and the best, as made games do.** *(Carries D215 to guests.)*
- **The game posts `{gsa: "score", n}`** to the launcher when a round ends. n is a whole number from 0 to 999,999,999, as for `g.score(n)`. The launcher takes it only from the playing guest's own frame and origin, at most 200 a play, and keeps them as the host's `scores`.
- **The play log** (`guest_play.jsonl`) keeps each play's `scores` and their best as `score`. `/api/guests` gives each guest's `best`, per guest id. A version has its own best, as another maker's line does (D215).
- **G6** shows "Score: N. Best: M." or "Score: N. A new best!" under "Nice game!" when the play reported a score. Otherwise there's no score line, so the original teti shows none.
- **teti's score, in Geoff's version:**
  - **Marathon and 2 Minutes** report teti's own points when a game ends: topping out, or reaching the goal (150 lines, or the 2 minutes).
  - **Sprint** reports nothing: it's a race against the clock, so lower is better, and that doesn't fit a "best" where higher wins.
  - **Zen** reports nothing: nothing falls, so its points only measure patience.
  - The picker says which modes keep score. A round left with Escape before it ends reports nothing, as for made games.

**D236. A guest version's maker is a grown-up maker, added by a grown-up's command on the mini.** *(Claude; the Brief asked that Geoff be added "the way a grown-up maker should be added (not as a guest kid)". Amended 2026-11-11 with the director's choice: an explicit command, not the service.)*
- `makers.json` gets `{id: "geoff", name: "Geoff", guest: false, grown_up: true}`. `guest: false`: he wasn't added through the cabinet's new-name slot (D87). `grown_up: true` marks him as a grown-up.
- **Only a grown-up's command adds one:**
  - `node scripts/maker.mjs add-grown-up Geoff` on the mini, through the cabinet's token-gated Manager endpoints (D208), as coin.mjs works (D216). `maker.mjs list` shows every maker.
  - A maker already there is never changed, a kid's name stays the kid's, and nothing is removed (D5).
- **The service never writes `makers.json` on its own**, so an update's data check stays exact: nothing outside `logs/` changes (D196).
  - A first cut added Geoff at service start. On the virtual cabinet's update to 3bd20c3 the data check came back not ok on `makers.json`.
  - His entry there (added 2026-11-11 19:03 UTC) came from that cut, not from the command. It stays, since data is never deleted.
- **Grown-ups aren't offered in the kids' "who's making" list (M1).** The list is the kids', and a name added to every cabinet would sit in it unasked. Geoff makes games on the mini (desktop-initiated).
  - The shelf takes his name from the version's `guest.json`, so his row reads "by Geoff" whether or not he's in `makers.json`.
  - The entry is there so the logs can name him.
- Playing a guest stays free: no coins, no Studio session.

**D240. Why the virtual cabinet drops off: the mini's own Wi-Fi bridge, not the network.** *(Claude; the finding, 2026-11-11.)* Today it dropped three times (about 07:55, 09:38 and 10:40 local), each time until a restart. The evidence so far:
- **Not the mini's Wi-Fi.** Its log has no roam, disassociation, link-down or DHCP renewal at any of the three times, and its signal held at about -45 dBm. The only `en1` flag changes (08:18, 09:55, 10:44) are the restarts reattaching the bridge.
- **Not the guest's lease.** It's 24 hours from the router, so renewals come every 12 hours.
- **The path between the mini and its own VM is what fails, in both directions.** In the D156 gap data (2026-11-09), during each gap the guest's ARP entry for the mini went DELAY, PROBE, FAILED, while its pings to the router and to another home device all got through. The mini's pings to the same two did too. Today's drops show the mini's half of the same thing: its ARP for the guest is incomplete.
- **The bridge rewrites MACs.** macOS bridges a VM onto Wi-Fi with MAC NAT (`bridge100`: `vmenet0` plus `en1`, flagged `MACNAT`), because a Wi-Fi client can't send frames from a MAC that isn't its own. Traffic between the mini's own stack and the VM goes through that translation. The likely cause is that this local path gets lost, and today it stayed lost instead of coming back after about 40 seconds. Reports from other hypervisors describe the same failure on Wi-Fi bridges.
- **Traffic alone doesn't keep the path open.** In the D156 soak the guest pinged the router every 5 seconds and the gaps came anyway.
- **What isn't known:** the exact mechanism inside macOS's bridge (watching it needs root packet capture), and whether the guest could still reach the internet during today's drops. Its journal was in memory only, so the restarts erased it. D242 fixes that.

**D241. The mini reaches the virtual cabinet over a second, private network card. The bridged card stays (D152).** *(Claude; for the director, and for Geoff only if it changes what he chose.)* The VM gets a second virtio card in UTM's Shared mode (macOS's private NAT network, 192.168.64.0/24, with the mini at .1), with a fixed MAC `5a:47:41:43:41:43`.
- **What stays the same:** the bridged card is still the cabinet's network. It has the default route and DNS, uses the home router, and keeps its address and `arcade-virtual.local`, so home devices still see it the way Geoff chose.
- **What the private card does:** it only lets the mini in. It has no default route, no DNS and no IPv6 (an NetworkManager keyfile matched by its MAC). The firewall refuses new connections out to 192.168.64.0/24 apart from DHCP, mDNS and DNS (D124). The cabinet uses none of the mini's resources: its internet still goes through the home router.
- **What changes for the mini:** `up.sh` finds the card's address in the mini's DHCP table (`vm-addr.mjs`) and writes it to `~/game-studio-data/vm/host`, so `drive`, `flow.mjs`, `update-cabinet.mjs` and `connect-cabinet.sh` use it without being told. With no lease it falls back to `arcade-virtual.local`.
- **Why this way:** host-to-guest traffic on the private network never goes through Wi-Fi or MAC NAT. Lima and Tart default to that NAT mode for this reason. Shared mode alone (the D124 fallback) would drop the home-network visibility Geoff chose; two cards keep both.
- **Builds and the live VM:** new builds get both cards (`--network Both`, now the default). The VM that exists gets the card from `mini-link.sh`. That script edits only UTM's `config.plist`, after keeping a copy. It doesn't touch the disk, the key or the carts, so it isn't a rebuild. It needs the VM stopped and UTM quit, because UTM caches the config (D148).
- **Unproven:** that UTM 5.0.8's Apple backend starts a VM with two cards. Virtualization.framework takes a list of network devices, and UTM's config holds a list, but UTM's docs don't say. The first start after `mini-link.sh` proves it either way, and the config copy undoes it.

**D242. The virtual cabinet keeps its journal on disk and records its own network paths.** *(Claude.)*
- **The journal** is persistent on the virtual profile only, capped at 200 MB. The Picade's SD card keeps the default.
- **`arcade-netwatch`** runs every 15 seconds. It pings the router on the bridged card, and sends an ARP probe to the mini on each card. ARP isn't a connection, so the probe stays inside D124.
- **Its log:** a `CHANGE` line when any path changes, and a `COUNT` line every 10 minutes.
- **On the bridged card it also nudges.** It sends a gratuitous ARP every round. When the mini has been unreachable there for two rounds, it forgets the mini's ARP entry once and announces itself three times, logged as `NUDGE`. Whether that helps is for the soak (D243) to show. It isn't relied on.

**D243. The soak that shows D241 holds.** *(Claude; run when the director frees the cabinet.)*
- **Steps:**
  1. In-place update (D195) for D242 and the guest half of D241. No restart is needed.
  2. Stop the VM, quit UTM, run `mini-link.sh`, then `up.sh`.
  3. Run `verify.sh`, including its new checks: the firewall refuses the mini on the private card, netwatch is recording, the journal is on disk.
  4. Run `path-soak.sh OUT 24`: every 5 seconds from the mini, a new SSH connection on each path, plus a command through a connection held over the private card. At the end it copies netwatch's record.
- **Passes if** over 24 hours that include build-worker use, the private path is up for at least 99.9% of probes and the held connection never dies, whatever the bridged path does.
- **What the bridged path shows:** if it drops in that time, netwatch's record says whether the guest still reached the router, and whether the nudge brought the bridged path back.
- **If the private path fails too,** the next step is Ethernet for the mini (D156), and that's Geoff's call.

**D244. Cabinets don't wait 2 minutes for networkd at boot.** *(Claude, at the director's ask, 2026-11-11; both profiles.)*
- **The problem:** NetworkManager runs Pi OS Lite's network. On first boot, though, systemd's presets also enable `systemd-networkd` and `systemd-networkd-wait-online`. On the virtual cabinet the symlinks date from its first boot, 2026-11-10 23:32:58, before provisioning began at 23:35. With nothing for networkd to manage, the wait runs its full 2 minutes and fails on every boot. That holds `network-online.target` and everything after it: `systemd-analyze` showed the launcher starting 1 min 27 s into boot.
- **Same on the Picade:** it boots the same pinned image with the same first-boot presets, so it would sit through the same 2 minutes on every power-on. This is inferred from the image; it can't be checked until the hardware arrives.
- **The fix:** `provision.sh` masks `systemd-networkd-wait-online` for both profiles (`boot-wait.sh`), but only where NetworkManager is enabled and `/etc` or `/run` has no `.network` file for networkd. A mask outlasts any later preset run. networkd itself stays as it is: it manages nothing, so it costs nothing.
- **How it's checked:** `boot-wait.test.mjs`, plus `verify.sh`. `boot-not-held` checks the mask is in place and that `network-online` was reached within 30 seconds of boot, and `no-failed-units` no longer excuses the wait.
- **Proving it** needs one restart after the update.

**D245. The virtual cabinet ignores the bridge's false address conflicts, and netwatch only watches.** *(Claude, 2026-11-11; from the soak's first hours.)*
- **What happened:** at 17:16:10Z NetworkManager logged "conflict detected for IP address 192.168.86.97 with host C8:80:6D:46:8D:28". That MAC is the mini's own Wi-Fi MAC: macOS's MAC NAT (D240) put it on an ARP for the cabinet's address.
- **What it cost:** from then on the cabinet had no `192.168.86.0/24` route on `eth0`. Its address is `noprefixroute`, so NetworkManager owns that route. Everything on the home network, the mini included, went through the router. The mini's new connections still got through, so the soak counted no drop. It's the first recorded way the bridge's MAC NAT changes the cabinet's own network setup, so it's a likely part of D240's drops.
- **No conflict detection on the virtual profile** (`/etc/NetworkManager/conf.d/arcade-no-acd.conf`: `ipv4.dad-timeout=0`). On a MAC-NAT bridge, the mini answering for the cabinet's address is expected. The provisioning step reapplies the bridged card so it takes the new setting and gets back a lost subnet route; the reapply keeps the lease. The Picade keeps conflict detection, because a conflict there is real.
- **netwatch only watches.** Its gratuitous ARPs and the nudge (D242) are gone: a reflected copy of an announcement would carry the mini's MAC, and could be what tripped the conflict, though 70 minutes of announcements came before it. It now finds the mini's address by each card's own subnet, not the routes, and records whether each card's subnet route is there (`eth0.subnet`).
- **Checks:** `netwatch.test.mjs`, `link.test.mjs`, and `verify.sh`'s `bridged-subnet-route`.
- **The soak** (`path-soak.sh`) now outlasts a deliberate restart. It marks rounds with both paths down as `restart?`, reopens the held connection, and lists the cabinet's boots, so each gap can be matched to a restart.

**D246. Every cabinet keeps the family's time zone, the mini's, by one route.** *(Claude, at the director's ask, 2026-11-13; both profiles.)*
- **What was wrong:** the virtual cabinet ran on the image's default zone, Europe/London. So the coin history showed UTC dates: a make on the evening of the 12th in New York read "Nov 13". The pot's month and its 1st-of-the-month refill followed London too.
- **One function picks the zone:** `miniTimezone()` in `scripts/virtual-cabinet/lib.mjs` reads the mini's `/etc/localtime` link (`ARCADE_TIMEZONE` overrides). The Picade's card script now uses it too, instead of its own copy.
- **One file carries it:** every payload has a `timezone` file. That covers the virtual cabinet's build seed, the Picade's card seed, and each in-place update. The Picade also still gets it from cloud-init at its first boot, before provisioning runs.
- **One step applies it** for both profiles: `provision.sh`'s `step_timezone` (`cabinet/provision/timezone.sh`). It links `/etc/localtime` and writes `/etc/timezone`. It runs before the service and kiosk restart, so both read the new zone. A payload with no zone, or a zone the system doesn't have, leaves the cabinet's zone alone.
- **Checks:** `timezone.test.mjs` tests the step against stand-ins and checks every payload carries the zone. `verify.sh`'s `time-zone` check confirms the cabinet's zone is the mini's.

**D247. The pot's month is the cabinet's local month, and a zone change can't refill twice or skip a refill.** *(Claude; checks D202.)*
- **The month logic already used local time.** `pot.js` takes the month from `Date`'s local getters (`monthOf`, `nextRefill`), and nothing sets `TZ`, so it follows `/etc/localtime` once the service restarts.
- **Each month gets one refill, whatever the zone:** the refill is keyed by the month string, and `ensureMonth` adds one only if that month has none yet. Changing zone mid-month leaves the month's refill alone and adds no second one. A change across the 1st still gives each month exactly one refill, in either direction. `cabinet/service/test/pot-zone.test.js` runs these cases in separate processes with `TZ` set.
- **What happens to this month's ledger** on the virtual cabinet (read on 2026-11-13 at 03:23 GMT):
  - It has 19 entries: one refill for 2026-11 (2026-11-11 15:09Z), two top-ups, one reset and 15 charges.
  - Every entry's month is the same in New York as in London, so moving to America/New_York changes no month. There's no second November refill, and none is lost.
  - Entries keep the month they were written with, and are never rewritten (D5).
  - The next refill comes at 00:00 on 1 December, New York time (05:00 UTC), not London's midnight.
- **One oddity, only if the zone changes across a 1st:** the entries written in the hours between the two midnights take the month of whichever zone was in force. The balance stays right, because it's always the last entry's. It can't happen this month.

**D248. The coin history shows the cabinet's local day.** *(Claude, 2026-11-13; found while delivering D246.)*
- **D246 alone didn't fix the dates.** The history screen (A2, `historyLines`) took its day from the first 10 characters of each entry's `at`, which is UTC, so it showed the UTC date in any zone.
- **The fix:** `pot.history()` now adds `day` to each entry, the date in the cabinet's local time, using the same `dayOf` as the refill date. The screen shows `day`, falling back to `at` for an older service. The ledger file is unchanged (D5): `day` is worked out when the history is read, not stored.
- **Checked by** `pot-zone.test.js`: in New York, an entry at 03:08Z on the 13th reads as the 12th.

## 2026-11-11 — The Picade's card and bring-up (worker)

Decided by Claude (the SD-card worker) unless marked, after the Picade arrived. Geoff's direction is in [validation-direction.md](validation-direction.md); the checklist is [cabinet-bring-up.md](cabinet-bring-up.md).

**D250. The card is written on the mini by `scripts/cabinet-card/flash.mjs`, and Pi OS's own cloud-init starts the seed.** *(Claude; extends D4, D143.)*
- Same pinned image and SHA-256 as the virtual cabinet (`lock.json`), written raw with `xz -dc | sudo dd`, hashed on the way and read back in full. Then the same seed as `build.mjs` makes, less what only a VM needs (kernel modules, the mini's addresses), on the FAT's `seed/`.
- **How first boot finds it:** the image is trixie with cloud-init (NoCloud from `/boot/firmware`, read from the image and the virtual cabinet's copy, 2026-11-11). The card's `user-data` makes the `cabinet` admin with the Picade's own SSH key, sets hostname, time zone (the mini's) and locale, turns SSH on with no passwords, and in `runcmd` installs and starts `arcade-seed.service`, which runs `provision.sh --profile picade` as on the VM. The virtual cabinet's initramfs path is unchanged.
- **No wizard on the screen:** a stock image runs Pi OS's interactive "rename user" dialog when no user is set. cloud-init's `users:` goes through Pi OS's own `add_user`, which renames the image's first user and masks that dialog (read from `cloudinit/distros/raspberry_pi_os.py`).
- **Safety:** it writes only a whole, physical, removable, non-internal disk on USB or SD, 8–260 GB, writable, not behind the mini's own volumes; shows the disk and each partition; needs the typed phrase `erase diskN NNGB`; and checks it's the same disk just before writing. `--image-file` runs the same steps into a file with no sudo, which is how it's tested (`card.test.mjs`, `image-file.sh`). `user-data` passes the image's own `cloud-init schema`.
- **One restart:** config.txt is read at boot, so when the picade profile changes it, `firstboot.sh` restarts once at the end. An update that changes it (D195) leaves the restart to a person.
- **The clock:** the Pi has no battery clock, so the picade profile waits up to 5 minutes for NTP before apt, which otherwise refuses Release files "not valid yet".

**D251. Wi-Fi: asked at run time, only its WPA key on the card, and that erased at first boot.** *(Claude; the brief's rule.)* The password is read with no echo and kept in memory. The card's `network-config` holds the 64-hex WPA key (PBKDF2 of the password and network name, as `wpa_passphrase` makes; netplan accepts it), with `regulatory-domain` set (`--country`, default US). cloud-init applies it once; the card's own `runcmd` then overwrites the file, so afterwards the key is only in `/etc/netplan` on the cabinet. `--wpa3` is for a WPA3-only network, which can't use a precomputed key: the password itself goes on the card, erased the same way. Nothing is written to the repo, the mini's disk or a log; `image-file.sh` checks the password isn't anywhere in the image or the output.

**D252. A cabinet with no key yet plays offline.** *(Claude; changes D185's "stays down" for the Picade.)* With no `service.json`, the picade profile starts the service with `--offline`, which the service now accepts without `--config` or `--replay`. The shelf, games and guests play; Make says it needs a connection and can't reach the API. `connect-picade.sh` writes the config and restarts the service live. So the card boots to the shelf unattended (the task's goal), and nothing can be spent before Geoff connects it.
- **What the screens say (2026-11-12, the director's ask after the rehearsal):** not "No Wi-Fi", which sent a grown-up looking for a Wi-Fi problem that wasn't there. The service reports `unconnected` beside `offline` when it has no key and isn't replaying, and the launcher shows E11 (shelf header "Not connected"; Make row "Not connected to Claude yet") and E12 on picking Make ("Not connected to Claude yet. A grown-up needs to finish setting up."). Real no-Wi-Fi (E1, E2) is unchanged.

**D253. The picade profile, reviewed against Pimoroni's repo at the pinned commit and its current guide (checked live 2026-11-11).** *(Claude.)* `f97c2ac` is still the repo's latest commit; the overlay's parameters (`__overrides__`) include every one D82 sets. Changed:
- The config.txt block starts with `[all]`, so a stock `[pi5]`/`[cm5]` section can't swallow it (the image ends with `[all]` today; this makes it not matter).
- Pimoroni's installer also writes a udev rule marking `gpio_keys` as a keyboard; the profile now writes the same rule.
- Pimoroni's `asound.conf` sends sound to **card 0**, which a USB mic could take. Ours names the X HAT's card (`sndrpihifiberry`), keeps Pimoroni's dmix and the `PCM` soft volume. Audio input is the speech worker's (D260+).
- Unchanged and still right: build with `dtc` at the pinned commit; `usb_max_current_enable=1`; `dtparam=audio=off` and `vc4-kms-v3d,noaudio`; the key map; `/boot/firmware/overlays`. Pimoroni's installer adds `hdmi_force_hotplug=1`, which KMS ignores; not added. If the panel isn't detected, the fix is `video=HDMI-A-1:1024x768@60D` (checklist C3).
- **Only the hardware can prove:** the overlay on a Pi 5 (its `compatible` list stops at bcm2711; Pimoroni's PR #49 says it works), the DAC's card name, the keys' wiring, the panel's EDID, the power button (tap to start, hold 3 s; whether a tap while running shuts down), temperature with the cooler, and Wi-Fi in the basement.

**D254. The Picade's identity: its own workspace and key, its own SSH key and lock file.** *(Geoff for the workspace and key, 2026-11-11; mechanics by Claude, following D131 and D155.)* Geoff makes a `cabinet-picade` workspace with its spend limit, and a key scoped to it, in the Console. `scripts/cabinet-card/connect-picade.sh` runs `connect-cabinet.sh` with `CABINET=arcade`, `arcade.local`, and the SSH key `flash.mjs` made in `~/game-studio-data/cabinets/arcade/ssh/` (one definition: D259) (never one of the mini's keys; the driver takes `ARCADE_SSH_DIR` and `ARCADE_SSH_KEY_NAME`). Its lock file is `claude-lock.arcade.json`. `connect-cabinet.sh` now also refuses a key for another cabinet's workspace, read from that cabinet's lock file. A new card means new host keys, so `flash.mjs` clears that folder's `known_hosts`.

**D255. Data: the real cabinet starts as a copy of the virtual cabinet's.** *(Geoff, 2026-11-11: the virtual cabinet is a digital twin, kept in sync; supersedes the open part of D150's how.)* The copy and the sync are the twin worker's (D290+). The card itself starts the cabinet with the starter carts only; the copy happens after connecting (checklist E1). A note for the twin worker: `kit-uploads.json`, sessions and the Manager token belong to the virtual cabinet's workspace and pairing, so they shouldn't be copied as they are.

**D256. The bring-up checklist.** *(Claude.)* [cabinet-bring-up.md](cabinet-bring-up.md), in Geoff's order: build (with a no-card power-on that shows the Pi 5's boot diagnostics screen), the card, first boot, Wi-Fi, screen, controls, sound, power button, temperature, the identity, the data, the first make. Each step says what to look for and what to do if it fails, and marks what only the cabinet can prove. USB: screen power and the mic on the black USB 2 ports, the blue USB 3 ports free.

**D257. First boot says on the cabinet's screen what it's doing.** *(Claude; the director's ask, 2026-11-12.)* First boot installs Chromium and its packages from the internet and Moonshine (a 128 MB venv and a 257 MB model) from the card, and the kiosk only starts near the end, so the screen would otherwise sit on a login prompt for many minutes.
- `provision.sh` logs a `== N/8 what` line before each of 8 stages. `firstboot.sh` keeps every line in `seed/provision.log` and puts each stage on tty1: "Setting up the arcade", the step, how many minutes since it was switched on (not a clock time: the Pi has no battery clock, so before NTP answers it shows the image's date; the minutes come from `/proc/uptime` and move every 30 s), and "please leave it switched on", in the console's 32×16 Terminus font (64×24 on 1024×768), with the login prompt stopped and kernel messages quietened. If provisioning fails the screen says "Setup stopped. Tell a grown-up. Details: seed/provision.log"; the next boot runs it again (the seed service runs until `provisioned-version` exists).
- **Timing:** measured so far only off the Pi. On the virtual cabinet, Moonshine's model came down in about 20 s and the first apt pass took about a minute. On the Pi apt goes over the basement Wi-Fi onto the SD card, so expect 10–20 minutes in all. The stage lines carry timestamps, so the first real boot times each stage; the checklist will be updated from it.
- **Speech comes on the card.** `flash.mjs` puts speech's 14 wheels and Moonshine's model on the seed (`speech/wheels`, `speech/models`), each fetched once into `~/game-studio-data/vm/dl/speech/` and checked against its lock's SHA-256 (wheels found on PyPI by that hash). `speech.sh` already installs from there with `--no-index`. So first boot doesn't download them, and a failed download can't stop provisioning before the Picade's own setup. The seed is 324 MiB of the boot partition's 396 MiB free; `flash.mjs` checks the space and stops with `--no-speech-on-card` as the way out.
- **Rehearsed, 2026-11-12** (`scripts/cabinet-card/rehearse.mjs`; the director's ask). `flash.mjs --image-file` wrote the card image, and a throwaway headless QEMU VM on the mini booted it: hvf, 4 cores, 4 GB, user-mode network, a virtio GPU at 1024×768. Debian's pinned arm64 kernel stood in for the Pi's, with an initramfs that only mounts the root and adds that kernel's modules. It plants nothing, so the seed had to come through cloud-init as on the card. The root partition was grown as the Pi's initramfs does. Two runs:
  - **Run 1, as merged:** power-on to cloud-config took 2 min 4 s. cloud-config waited on `systemd-networkd-wait-online`, the stall D244 masks, because that mask lands only in `provision.sh`, after cloud-config. Then `provision.sh` took 30 s, and the shelf came up at 2 min 45 s.
  - **Run 2, fixed:** provisioning started 9 s after power-on. Per stage:

    | Stage | Time |
    |---|---|
    | 1. Clock (waiting for NTP) | 35 s |
    | 2. Browser (apt, 257 MB of packages, 757 MB unpacked) | 32 s |
    | 3. Node | 4 s |
    | 4. The arcade | 4 s |
    | 5. Speech, from the card | 8 s |
    | 6. Cabinet setup | 1 s |
    | 7–8. Starting, finishing | 1 s |

    Then it restarted, booted in 4.1 s, and the shelf was up 2 min 2 s after power-on.
  - On the Pi, stage 2 runs over the basement Wi-Fi and the SD card, so it will be the long one.
- **Found and fixed:**
  - The networkd stall: the card's `bootcmd` now masks and stops `systemd-networkd-wait-online` on first boot.
  - systemd's `[ OK ] Started …` lines printed over the progress screen: `firstboot.sh` turns them off for that boot (`SIGRTMIN+21` to PID 1).
  - `meta-data` said `instance_id`, copied from Pi OS's own template, but cloud-init reads `instance-id`, so every card came up as instance `nocloud`. It's `instance-id` now, and the rehearsal's id was the card's own.
  - D287's settings read printed "No such file or directory" on a new cabinet. It now checks for the file first.
- **Checked and fine:**
  - The admin user is uid 1000, with the mini's key only; root and password logins are off.
  - The rename wizard was masked.
  - Time zone and locale were applied.
  - The Wi-Fi connection was rendered with the 64-hex key. After `network-config` was scrubbed and the cabinet restarted, it was still there, kept by NetworkManager as its own netplan file.
  - The overlay was built at the pinned commit, and config.txt, the udev rule and `asound.conf` were written.
  - The offline service served the shelf, Moonshine loaded in about 0.6 s, the kiosk started on DRM, and a starter game played from the VM's keyboard.
  - The only failed unit was `rpi-eeprom-update`, because a VM has no EEPROM.
- **Rehearsed again from main 8a8a512 (with D246's time zone route) plus this branch's first-boot fixes, 2026-11-12, run 7:**
  - Power-on to first boot's restart took 1 min 28 s. The shelf came up "not connected" 15 s later.
  - First boot logged `=== firstboot exit 0 ===` before its restart. The restart is now scheduled 5 s out (`systemd-run`) instead of `systemctl reboot --no-block`, because run 5 showed the latter stopped the seed unit mid-script ("Terminated", no exit line). The exit line is the record, since the Picade's journal doesn't outlive the restart.
  - The minutes line ("Switched on less than a minute ago.", "Switched on 1 minute ago.") has its own line; "less than a minute" had wrapped at the console's 64 columns.
  - The time zone, through both routes, from the mini's own zone (no `--timezone`): cloud-init set America/New_York on first boot. Provisioning's `step_timezone` (D246) read the same name from the seed, found it already set, and changed nothing. After the restart, `/etc/timezone`, `/etc/localtime` and `timedatectl` all said America/New_York. `flash.mjs` writes both from one value, so they can't differ on a card.
  - Left as it is (cosmetic): systemd's "The system will reboot now!" broadcast shows on the screen for those 5 s.
- **Only the Pi can prove these:**
  - The Pi's own boot: firmware, `cmdline.txt` with `resize`, and its initramfs growing the root.
  - The overlay loading and the buttons (the VM has no X HAT).
  - The DAC card name and sound.
  - The panel's EDID and the screen power.
  - Wi-Fi itself: the country setting, signal in the basement, WPA2 or WPA3.
  - The power button and the gpio-poweroff cut.
  - Temperature.
  - The timings on an SD card.
- **The shelf's wording before connect:** with no key the shelf says "No Wi-Fi" and Make says "Needs Wi-Fi right now" (the service's offline state, D252). The checklist tells Geoff it means "not connected to Claude yet". A distinct message would be a launcher change, offered as a follow-up.

**D258. The Manager's driver keyboard on the Picade is D287's.** *(Claude; replaces this worker's first draft, which put a flag on the card.)* The Manager worker's D287 stands: `arcade-keyd` is installed by the picade profile and runs only while `/etc/arcade/driver-keyboard` says `on`, switched from the mini by `scripts/cabinet-card/driver-keyboard.sh on|off`. Nothing on the card turns it on, so a new cabinet starts with it off. The first run doesn't need it: the cabinet's own controls play, and the Manager watches.

**D259. One place for the Picade's SSH key: `scripts/cabinet-card/picade-ssh.sh`.** *(Claude, at the director's ask.)* It names the host (`arcade.local`), the folder (`~/game-studio-data/cabinets/arcade`, which `GSA_CABINET_DIR` moves) and the key (`ssh/arcade_ed25519`). Shell scripts source it (`connect-picade.sh`, `driver-keyboard.sh`); Node reads it through `scripts/cabinet-card/picade.mjs` (`flash.mjs`, `twin.mjs`, the Manager). `card.test.mjs` fails if any other code spells the folder or the key's name. The twin's way of reaching the Picade is D299's; only where the path comes from changed.

## 2026-11-11 — Real speech on the cabinet (worker; D260–D269 are speech's)

**D260. Real speech replaces the stub behind the Speech interface (D184), from Geoff's answers of 2026-11-11.** *(Geoff's direction; Claude's build.)* Moonshine on the cabinet now; Groq `whisper-large-v3-turbo` wired, and on when Geoff puts a key in with a script. Hold a player button to talk, release to send (D87); the "Is this right? I heard:" confirm (M6) and F1 typing stay as they were. The code is `cabinet/service/src/speech-live.js`, hooked in with one line in `bin/cabinet-service.js`. A cabinet without provisioning's `speech.json` (the mini, tests, replays elsewhere) keeps the stub, and `"speech": "stub"` in the cabinet's config forces it.

**D261. Moonshine `medium-streaming` (English, MIT), pinned and installed by `provision.sh` for both profiles.** *(Claude.)*
- **Why medium:** on 48 TTS clips (12 kid-style game ideas, 4 macOS voices), WER was tiny 38.7%, small 30.4%, medium 23.1%; on the two natural voices medium got 0% and 5%. The rest of its errors are on the two novelty voices (Flo 23%, the robotic Junior 65%). Moonshine's published Pi 5 latency for medium is about 800 ms, which a kid doesn't wait on. The virtual cabinet's own figures are in `docs/speech.md`.
- **Pins:** `cabinet/service/speech/requirements.lock` (14 exact wheels for Python 3.13 arm64, each by SHA-256, installed with `--require-hashes --only-binary :all: --no-deps`) and `models.lock.json` (8 model files from download.moonshine.ai, 267 MB, each by SHA-256). `python3-venv` joins `apt.lock`. `provision.sh` sources `speech.sh`, whose `step_speech` builds a venv named by the lock's hash, fetches the model, proves it loads, then writes `/opt/arcade/speech/speech.json`. A payload may carry the wheels and model, for a cabinet with no internet.
- **How it runs:** one long-lived Python helper (`moonshine_helper.py`) loads the model once at service start and warms up. The service sends it each clip's PCM over a pipe and reads the words back.

**D262. Audio is captured into memory with ALSA's `arecord` and never stored.** *(Claude.)* 16 kHz mono 16-bit, raw on arecord's stdout, from the first capture device ALSA lists (`plughw`, so any USB mic's own rate works), looked up at each hold so a mic plugged in late works. It is capped at 30 s, sent to an engine, then zeroed and dropped. No WAV is written. `speech.jsonl` in the cabinet's logs records which engine answered, the hold and audio lengths, latency and word count, but never the words or the audio. No mic is a silent hold (E9), not a crash.

**D263. With a Groq key, Groq goes first and Moonshine is the fallback.** *(Geoff's answer; Claude's details.)* Groq is skipped when the cabinet is offline, and Moonshine answers when Groq errors, is rate-limited (429) or takes more than 3 s plus 0.1 s per second of audio (6 s until 2026-11-13; shortened after measuring, see docs/speech.md). The key lives in the cabinet's `service.json` (0600, owner arcade) as `groq_api_key`. `scripts/virtual-cabinet/groq-key.sh` puts it there from Geoff's keyboard with no echo, in connect-cabinet.sh's way: a terminal only, never an argument, env var or file on the mini; checked against Groq's model list with the key on stdin; the clipboard cleared after. `--off` removes it. **Before any kid's voice goes to Groq,** Zero Data Retention must be on for Geoff's Groq organization (console.groq.com/settings/data-controls; transcription is ZDR-eligible). Without it, Groq may keep inputs for up to 30 days for abuse monitoring. The script asks first and stops on "no".

**D264. The virtual cabinet's mic is the mini's default input, through virtio sound. D127's USB passthrough can't work here.** *(Claude, with the VM's worker; the steps need the director's go and Geoff present.)* UTM's Apple backend (Virtualization.framework) has no USB passthrough; switching backends would be a rebuild. So `Virtualization.AudioInput` goes to true in the VM's config.plist (false until now, per D141), which feeds the guest the mini's default input: Geoff's AirPods for now (his answer, 2026-11-11), a USB mic later. It needs the VM stopped, UTM quit, and a start with `up.sh`. On that first start macOS will likely ask Geoff to allow UTM the microphone. The Picade takes any USB mic as is. Until someone speaks, `launcher.mjs hear WAV` (or `/api/speech/feed {wav}`) has the next hold hear a clip through the same engines in place of the mic.

**D265. Speech is measured with `cabinet/service/speech/bench.mjs` on clips through the cabinet's own engine code.** *(Claude.)* It reports WER and latency, overall and per voice. The clips come from `scripts/speech/make-clips.sh` (macOS TTS voices). Kids' clips are for the bake-off with Geoff (§3.1): they stay on the cabinet or the mini, are deleted after, and never enter the repo.

**D270. Request screening: a light touch that redirects, never scolds.** *(Geoff, 2026-11-11: "Part of validation but with a very light touch—profanity, racism, bigotry, etc; I'm less concerned about violence but we may later create a rubric to keep an eye on what they're making; machine should not scold when the kid breaches a guardrail, instead offer a close, safe alternative; problem solve, not block".)*
- **What it catches:** profanity, slurs, racism, bigotry, mocking people for who they are, sexual content, hurting real people, hate celebrated. **What passes:** cartoon and game violence (battles, blasters, zombies, bosses, explosions), spooky things, gross-out jokes and silly insults.
- **When:** before a make or a change starts (so before any session or coins), and on a kid's own words during a make: "Something else" (C) on a question, and "change" on the plan. Tile answers A, B and D aren't screened; they're Claude's words.
- **What the kid sees** is E10 (D275), never a refusal.
- A violence rubric, if Geoff wants one later, reads the log (D273); it isn't a gate.

**D271. Two layers: a short word list on the cabinet, then a small model call.** *(Claude.)*
- **The word list** (`src/screening.js`) holds only clear-cut swear words and slurs, matched as whole words after undoing simple letter swaps ("sh1t"). It's free, instant and works offline. Words that are fine in a game (nazi in "fight the robot nazis", body words for gross-out humour) are left to the model.
- **The model** judges everything else and writes the alternative. When it answers, its verdict wins over the list (so "Scunthorpe" and "cocktail" pass either way, and a list false positive can't block).
- **When the model can't answer** (no network, timeout after 6 s, bad output), the list's answer stands. That fails open on purpose: a light touch, with the Studio agent's brief as the second line (D274).
- An alternative is never itself flagged by the list; if the model's would be, a plain safe one replaces it.

**D272. The model: Claude Haiku 5.5, structured output, low effort, the cabinet's own key.** *(Claude.)*
- `claude-haiku-5-5`, `output_config.effort: "low"`, a JSON schema for `{verdict, alternative, why}`, no retries, 6 s timeout. The kid's words go inside `<idea>` tags and the brief says they're only data.
- **Cost per check:** about 700 input tokens and 40 to 400 output tokens (low-effort thinking included) at $0.10/$0.50 per million (list price, checked live 2026-11-11): **$0.0001 to $0.0003 a check**, so well under a cent for a whole make with several typed answers. A live run of the table (D275's tests) will pin the real figure. Each check's real cost, from its usage, is in its log line. It isn't charged to the coin pot.
- It runs through the cabinet service's own client (D131), so it needs nothing new on either cabinet. `config.screening: false` turns the model off; the list stays. Replays (D186) use the list only and spend nothing.
- A model refusal counts as a redirect.

**D273. Every check is logged, with its outcome.** *(Claude.)* `logs/screening.jsonl` on the cabinet: the kid's words, which kind (new, change, answer), the maker, `pass` or `redirected`, the alternative offered, which layer decided, the time taken, and the model's cost and tokens. Picking an offered alternative is logged too (`by: "offered"`), without a second model call. A check that ran out of time is marked `timed_out` (the 6 s stays, the director's call 2026-11-12: a kid shouldn't wait longer, and the agent's brief is the second net). `scripts/screening-summary.mjs` sums the log: checks, passed, redirected, timeouts, other model errors, which layer decided, and the model's cost. Like every kid log, it never enters the repo.

**D274. The Studio agent's brief says the same, for anything that gets past.** *(Claude.)* Its content line now says game violence is fine and, if an idea or answer goes off-limits even mid-game, never to scold, lecture, refuse or say "inappropriate": quietly build the closest safe version, and say so in one friendly line or offer it as a tile. **It needs an `ant apply` in each cabinet's workspace** before a cabinet runs it: until then, the cabinet's brief check (D185) finds the applied agent doesn't match and stops makes as stale. So it's its own commit, deployed with the next apply (the cabinet's key, from Geoff's keyboard, `connect-cabinet.sh`).

**D275. E10 says "How about this?"** *(Claude; replaces the handoff's "Let's pick another idea".)* One friendly line ("Let's make it a little different. How about this?"), the alternative in yellow, and for a new idea "No coins were used." Tiles: **Make this one** (or **Use this one** for an answer), **Say it a new way** (back to the talk screen, F1 still types), **Back to the shelf** (or **Back to the question**, which keeps waiting). ESC does what the last tile does. One alternative, not the handoff's two: it's the closest version of their own idea, and "Say it a new way" covers the rest.

**D276. An answer is screened with the question it answers.** *(Claude, at the director's ask, 2026-11-12.)*
- **The problem:** on the virtual cabinet, a slur typed for "How do you steer the shark?" got an alternative about what the shark calls the fish. It was safe, but it didn't answer the question.
- **The fix:** the service sends the waiting question with the kid's words: the question's text, or for "change" on the plan, "What should be different in this game's plan?" with the plan's summary. The model's brief says an answer's alternative must still answer that question. The question also goes in the log line.
- **Checked:** the table has three answer rows with their questions, and the live run checks that each alternative answers its question. 23 of 23 right, $0.0025 (`~/game-studio-data/vm/verify/screening-2026-11-12/table-live-d276.txt`). The steering answer now reads "You steer the shark by tilting it left and right, and it zooms after the little fish saying "Wheee, come back!"".

**D280. Cabinet Manager v0: one process on the mini, a page on the home network.** *(Claude, Manager worker, 2026-11-11; carries out HANDOFF §3.1 and Geoff's validation direction.)*
- `manager/` in this repo: Node 22's standard library only, no packages. `scripts/manager.sh start` starts it in the background (`stop`, `status`, `url`); no window opens on the mini. It listens on port 8335.
- Four views: the cabinet's **screen** with its controls, **activity**, **coins**, and a **cabinet picker** (virtual, real). Carts, push and updates come later.
- It is never in the play path: the cabinet doesn't know it exists, and every cabinet works with it off. It talks to each cabinet over that cabinet's SSH (the same key and host `drive` uses, D144, D241), through one held connection.

**D281. Watching: the compositor's own screenshots, a few a second, with their age shown.** *(Claude.)*
- The picture is `arcade-screenshot` (grim, D144): what the screen really shows, on both profiles. Measured on the virtual cabinet over a held connection: 30-60 ms a shot. While at least one browser is watching, the Manager takes about 4 a second and sends a frame only when the picture changed; with nobody watching it takes none.
- The page says how fresh it is: the age of the last good shot, turning to a warning past 3 seconds, and "no picture" with the reason when the cabinet can't be reached.
- Not the kiosk's DevTools screencast: only the virtual profile opens that port (127.0.0.1:9222), it shows the page rather than the screen, and the Picade has none.

**D282. Driving: the browser's keys go to the cabinet as a keyboard, pressed and released separately.** *(Claude.)*
- On-screen buttons for the D82 controls (stick, A B X Y, START, ESC, F1, COIN) and Geoff's own keyboard, which sends the same keys (arrows, Z X C V, Enter, Escape, F1, F2). Each key goes down when pressed and up when released, so holds work (hold-to-talk, D87). Every other key on Geoff's keyboard passes through too, so F1's "type it" screen takes typing.
- Keys go through `arcade-keyd` (D144), so they take the kid's path: kernel, compositor, Chromium. A browser that closes or loses focus releases what it was holding.
- **The Picade's driver keyboard is off unless switched on (D287).** While it's off, the Manager watches the real cabinet and the controls are the cabinet's own, and its page says how to switch it on.

**D283. Activity is read from the cabinet's own logs, read-only, and kept nowhere on the mini.** *(Claude.)*
- The Manager reads the tail of each `/var/lib/arcade/logs/*.jsonl` over SSH when the page asks, and joins them as §9.5 says: a make or change (`studio_session`) with who, what was said, each question and answer, ended by, the outcome and game version, its list cost in cents and the coins it was charged (`coin_ledger`, by session id); plays (`play`, `guest_play`); and screened requests (any log whose name says `screen`, so the screening work's log shows up when it exists).
- Nothing is written on the mini: the kids' words travel from the cabinet to Geoff's browser and stay on the cabinet (CLAUDE.md).

**D284. Coins: the D208 endpoints, with the $15 warning before a top-up that passes it.** *(Claude; carries out D205 and D215.)*
- Show, add N with a reason, reset with a reason: the same endpoints and rules as `scripts/coin.mjs`, reached through the held SSH connection (a forwarded port to the service's 127.0.0.1:8330). A top-up that `preview` says passes the workspace's limit needs a second, explicit press.
- The token: the virtual cabinet's is the one `coin.mjs pair` keeps (`~/.config/game-studio-arcade/manager-token`); another cabinet's is `manager-token-<name>` beside it. The Manager can pair (make the cabinet's token if it has none, D208) from the coin page. The token never reaches the browser.

**D285. Who can open the Manager: home-network addresses, with a key, once per browser.** *(Claude.)*
- It answers only loopback, private (10/8, 172.16/12, 192.168/16) and link-local addresses, and only for a Host that is an IP address, `localhost` or a `.local` name (no DNS rebinding).
- **A Manager key** (random, made on first start, `~/.config/game-studio-arcade/manager-web-key`, 0600) opens it. `scripts/manager.sh url` prints the link with the key; opening it sets an HttpOnly, SameSite=Strict cookie for a year, and the key leaves the address bar. Without it a home device (the kids' included) gets "ask a grown-up". Actions need the cookie and a same-origin request.
- Plain HTTP on the home Wi-Fi: someone already on the network who watches the traffic could copy the cookie. Accepted for v0 (the same trust as the cabinet's own LAN service, D7); HTTPS is the step up if wanted.

**D286. Which cabinet: virtual and real by default, overridable in a file.** *(Claude.)*
- `virtual`: the host in `~/game-studio-data/vm/host` (D241) or `arcade-virtual.local`, with the VM's SSH key. `real`: `arcade.local` with the key `flash.mjs` made, `~/game-studio-data/cabinets/arcade/ssh/arcade_ed25519` (D254), as user `cabinet`. `~/game-studio-data/manager/cabinets.json` overrides either or adds one (`{"real": {"host": "…", "key": "…"}}`).
- A cabinet that can't be reached says why (no key, no answer) and the others keep working.

**D287. The Picade gets the driver keyboard too, off by default, switched on from the mini.** *(Director, 2026-11-12, for validation: Geoff drives the real cabinet from the Manager; mechanics by Claude; refines D144 and D282.)*
- The picade profile installs `arcade-keyd` and its unit like the virtual profile, but runs it only while `/etc/arcade/driver-keyboard` says `on`. Nothing on the card or in an update writes that file, so a new Picade starts with it off, and every provisioning run keeps whatever it says. `uinput` is loaded only while it is on.
- `scripts/cabinet-card/driver-keyboard.sh on|off|status` sets it from the mini over the Picade's admin SSH key (D254), and starts or stops the daemon at once. The Manager notices within 20 seconds.
- **How it is protected:** (1) off unless a grown-up switches it on, on the mini; (2) switching it, and every key press, needs the Picade's admin SSH key, which only the mini has: the daemon listens on a root-only socket (0600), never on the network; (3) through the Manager, a press also needs the Manager key and a home-network address (D285); (4) nothing at the cabinet can switch it on, and a kid at the controls is unaffected: the overlay's keys and the driver's reach the same screen; (5) each press is logged in `/run/arcade/keys.log` until the next restart. Switch it off after validation if it is not wanted day to day.

## 2026-11-11 — The virtual cabinet is the real cabinet's digital twin

Geoff, 2026-11-11: "Virtual cabinet should be considered a digital twin and kept in sync; if you need a new instance (eg to test os updates) you can later create one". This changes D150 and D151, and answers virtual-cabinet.md questions 3 and 4 again; the rest of D120-D129 stands. Code: `scripts/twin.mjs`, `cabinet/twin/`.

**D290. The virtual cabinet is the real cabinet's twin; the real cabinet is the truth.** *(Geoff's direction; Claude's wording.)* Once the Picade exists, what the kids do happens there, and the twin on the mini mirrors it. The twin is no longer a cabinet whose data goes its own way (D151's "staging cabinet"): its data follows the Picade's. A different cabinet for risky tests (an OS update, a rebuild) is a new virtual instance made when it's needed, not this one.
- **What changes:** D150 said the virtual cabinet's games move to the Picade's shelf; now the whole data folder does, once (D295), and after that data only flows the other way. D151's "updates are tried there before they reach the Pi" still holds for releases (D296); a test that could harm data goes to a new instance. D155's rule stands: replay data never reaches a live cabinet, and the seed checks it again.

**D291. What "in sync" means.** *(Claude.)* The twin holds the same files as the real cabinet under `/var/lib/arcade` for: `carts/` (every cart folder and the library's git history, so every version), `sessions/`, `logs/` (studio turns, play telemetry, the coin ledger), `guests/` (downloaded games in the data folder), `makers.json`, and `twin-seed.json` (D295). And it runs the same release (D296). In sync = every one of those files is byte-identical and the release names match. Anything new at the top of the data folder is reported as "not covered", so a new kind of data can't go unsynced silently.

**D292. What each cabinet keeps for itself, never copied either way.** *(Claude; keeps D131.)* `/etc/arcade` (the API key, `service.json`, the Manager token) is never read by the sync. In the data folder: `kit-uploads.json` and `kit/` (file ids in its own workspace), `cabinet-state.json` (its first-boot screens and its own workspace's resting month), `studio-run.json`, `studio-left.json`, `studio-results.json` (a make in flight on that cabinet), `chromium/` (cache), and `twin-sync/` (the twin's bookkeeping).

**D293. How it syncs: the mini pulls, append-only.** *(Claude; keeps cabinet independence.)* `node scripts/twin.mjs sync` reads both cabinets over their SSH (as `drive` does), runs a small helper as `arcade` on each (sent on stdin, nothing installed or left on either disk), compares sizes and hashes, and writes only to the twin:
- a file only on the real cabinet is copied;
- a log the real cabinet has grown gets only the new bytes, after checking the twin's copy is exactly its start;
- a file the real cabinet changed (git refs, `makers.json`) replaces the twin's, if the twin hadn't touched it since the last sync;
- every write checks the twin's file is still what the plan saw; one that moved under it is left for the next sync.
The real cabinet is only read. It never knows the mini exists; if either side is off, the sync fails cleanly and the next one catches up (each run compares everything, so there's no queue to lose). It runs when Geoff or a session runs it; a schedule (launchd on the mini) is a later choice.

**D294. Makes on the twin after the real cabinet exists never reach it, and are never deleted.** *(Claude.)* Data only flows real to twin, so nothing made on the twin can reach the Picade. On each sync, any file the twin made or changed itself (it differs from the last sync's baseline in `twin-sync/baseline.json`, or the real cabinet doesn't have it) is moved to `twin-sync/set-aside/<time>/`, with a `set-aside.jsonl` saying why, before the real cabinet's copy goes in. So a test make on the twin plays there until the next sync, then leaves the twin's shelf for that folder. Git objects the real cabinet packs away in a `gc` land there too. `twin.mjs status` lists them as "only on the twin" before a sync. A sync refuses while a make is running on the twin.

**D295. The first sync goes the other way, once: the real cabinet starts as a copy of the twin.** *(Claude; carries out D150 under D290.)* `node scripts/twin.mjs seed --yes` copies the twin's synced files (D291) onto the new Picade, Tester's games and history included, so both start identical.
- It refuses if the real cabinet has any synced file the twin doesn't have, or one that differs, so it can never run over a cabinet the kids have used, and it can't run twice (a half-finished seed can be run again).
- It refuses with replay data on the twin (D155) or a make running on either side.
- **Telling Tester's data apart:** the seed writes `twin-seed.json` on both cabinets: the time, the twin's release, and the cart ids, session ids and maker ids it carried. Everything in that list, or dated before `seeded_at`, is test data (Tester, grown-ups), not the kids'. Tester is also its own maker id in every cart, ledger line and log line.
- It's the one time the mini writes to the real cabinet's data, so it's run with Geoff's yes, at bring-up.

**D296. The twin runs the real cabinet's release.** *(Claude.)* `twin.mjs status` shows both release names (the folder `/opt/arcade/current` points at). Releases still go to the twin first (D151, D195); when the Picade is updated, the twin is brought to the same release with `update-cabinet.mjs`. Sync doesn't update either cabinet's software itself; that stays a deliberate step.

**D297. What's proven, and what needs the Picade.** *(Claude, 2026-11-11.)*
- **Proven here:** `scripts/test/twin.test.mjs` on two data folders: seed, sync, append-only logs, set-aside of twin makes, a race with the twin's service, a real git library through commits and `gc` (`git fsck` clean, every version in the log), the helper as a cabinet runs it (stdin, `data:` import), and the command. Live and read-only: `twin.mjs status` read the virtual cabinet over SSH (189 files, 7 games, nothing "not covered"). A rehearsal pulled the whole virtual cabinet into a folder on the mini as if it were the twin, with the virtual cabinet as the "real" one: 189 files, identical games; a second run had nothing to do.
- **Needs the Picade:** its SSH (host name and key: `drive` uses the virtual cabinet's key today; the SD card work decides the Picade's); `sudo -u arcade` and `/usr/local/bin/node` there, as provisioned; that a seed onto a running Picade service shows the games, makers and pot without a restart (the library, the coin ledger and makers.json are all read per request in the code, D70; not yet seen on a running Picade); a fresh Picade's data folder being empty enough for the seed (if its service writes a log before the seed, the seed refuses and says which file); and the sync over the home Wi-Fi at real sizes.

**D298. Bring-up checks before the seed don't block it.** *(Claude, after the bring-up checklist, D256, put the seed after the Picade's own checks.)* Those checks can leave a few log lines on the Picade before its data is copied. `seed --set-aside-real` moves whatever the Picade holds of its own to `twin-sync/set-aside/<time>/` on the Picade, kept, with `set-aside.jsonl` saying "on the real cabinet before the seed", then copies the twin. It is refused once a seed has happened, so it can never touch the kids' data. Without the flag, the seed refuses and lists the files.

**D299. One command each, on the Picade's own key; what D255 says mustn't move as it is.** *(Claude, at the director's ask, 2026-11-12.)*
- **Reaching the Picade:** `twin.mjs` reaches the real cabinet the way `connect-picade.sh` does: `arcade.local` with the key `flash.mjs` made in `~/game-studio-data/cabinets/arcade/ssh/arcade_ed25519` (`GSA_CABINET_DIR` moves it), and its own `known_hosts` there. So it's `node scripts/twin.mjs seed --yes` once, then `node scripts/twin.mjs sync` (and `status`), with nothing else to type. Without that key it stops and says the card hasn't been written. `--real HOST` only renames the host. The twin gets `drive`'s defaults and never the Picade's settings, even from a shell where `connect-picade.sh`'s variables are exported.
- **Checked against D255:** `kit-uploads.json` (and `kit/`) is never copied (D292). The Manager token is in `/etc/arcade`, which sync never reads. The Picade pairs its own with `coin.mjs pair`. `sessions/` *is* copied, because it holds the games' history (D291), but only as records. The ids are the virtual cabinet's workspace's, so `twin-seed.json` says so. Nothing on the Picade resumes or fetches them: only `studio-run.json` and `studio-left.json` do, and both stay per cabinet. A seed now refuses while either cabinet has a make running or left to collect (`studio-left.json` not empty), and a sync while the twin has one.

## 2026-11-11 — Live paths never run before (validation, D300+)

The director's validation run on the virtual cabinet, as Tester, typed input: walking away, stopping, someone else's own version, a restart mid-build. Screenshots in `~/game-studio-data/vm/verify/live-paths-2026-11-11/`.

**D300. A make that stopped without the kid says what it used, and keeps the idea for a try again.** *(Claude; the handoff's rule for edge screens: say what happened, that the idea is kept, and what it cost.)*
- **Run 1, live:** a question left alone for 10 minutes. At 9 minutes the hint counted down (E7). At 10 the make was released: charged 3c ("walked away"), archived at Anthropic, the request kept in the record. But the screen said only "You were away for a while… Tell me your idea again any time!": no cost, and the kid had to re-tell the idea.
- **Now:** a walk-away's notice carries the idea, and its cost once it's charged. The screen adds "It used N coins (Xc) before it stopped." and "Your idea is saved.", and leads with "Try again, same idea". That tile goes to the coin check, then "Is this right?" with the words filled in, as E3 does.
- **E5** (a restart while Claude was asking) keeps the idea the same way. Its cost isn't known until the session is collected, so its screen doesn't say it.

**D301. Every finished session is archived at Anthropic, a game on the shelf too.** *(The director, 2026-11-11.)* Until now only released, collected and failed sessions were archived (D188, D191, D219). A make that ends normally is now archived too, and the archive is logged as a correction beside its record. Archiving keeps a session's history and stops nothing that's still needed (D5).

**D302. The four live paths, run on the virtual cabinet (2026-11-11/12).** *(Claude, for the director's validation, D300+.)* All typed input, as Tester and Tester2. Cost: 3 + 8 + 13 + 31 = 55c. The cabinet ran the release before D300 and D301.
1. **Walking away at a question** (`sesn_015q41kvq2xBdPu8ExbUqZXj`): at 9 minutes, "Still there? Move the stick! 31". At 10 minutes the make was released: charged 3c ("walked away"), archived, the request kept in the record. The screen's missing cost and idea led to D300.
2. **"Stop making this game" at the plan** (`sesn_012FMPJEshtEr2XeR98QeWFP`). The stop isn't offered during a build, by design (D188). E8 said "It has used 1 coin so far." The stop went quietly to the shelf with Make free. Charged 8c ("stopped") and archived.
3. **Someone else's own version** (`sesn_014bS1GVbeyX28Trw4aAx2fn`). Tester2, as Someone new, went through R1, M2 and R2 ("This is Tester's game. Your changes make a new game, just yours. Tester's stays the same."), then R3 to R8. "Snowball Drop" is a new line, v1, indented under Rock Rain (R9). Charged 13c, about usual against 2. It wasn't archived, because the cabinet's release predates D301.
   - **Fixed:** R8 said "The old game stays the same." because the result entry didn't carry the parent's maker's name. It now says "Tester's game stays the same.", with tests.
4. **The service restarted mid-build** (`systemctl restart arcade-launcher`, not the VM; `sesn_0128Bz363N9gDZpxkErAJ7Gw`).
   - E6 showed "Your game may still finish: look for it on the shelf".
   - The shelf said "Finishing the last game first" for about 3 minutes (D199).
   - Then "New game ready!" appeared. M11 said "It finished while the cabinet was restarting.", with 3 coins (31c).
   - The ledger has "restart, on the shelf". The record says `resumed_after_restart`, and the correction "collected after a service restart", archive ok. The journal has the cut-off, re-attach and collect lines (D191, D199).
   - The run went to Tester2, not Tester: "Who's making?" lists the most recent maker first, and the drive script picked the top row.

## 2026-11-12 — Fixes from the end-to-end run (D303-D307)

From docs/validation-virtual.md, on the director's list.

**D303. The left-tap "fault" wasn't one: every tap lands, on the cabinet and locally.** *(Claude. Corrects the validation write-up's note.)*
- **Locally:** a copy of Candy Cat Drop with logging, in the real launcher in headless Chromium, with real key events.
  - Taps of 80, 5 and 0 ms: all 72 left and right taps moved the piece one cell.
  - Four quick taps (60 ms down, 30 ms apart) moved four cells.
- **On the virtual cabinet** (read-only, playing only), through `drive` and keyd:
  - An in-memory recorder in the kiosk page saw every tap arrive as its own down and up, 60-80 ms long, at least 80 ms apart. The page ran at a steady 60 frames a second (median 17 ms, worst 24 ms).
  - Screenshots 600 ms after each tap, read for the piece's column: every tap moved it exactly one cell, left 5→4→3→2 and right 2→3→4. A screenshot 150 ms after a tap had already moved.
  - Three quick taps moved it as far as the wall allowed.
- **So:** the game, the starter library's repeat (`timers.repeatTick`), the runtime's input and the drive path are all sound. No shelf game is affected.
  - The run's single probe that looked like a lost tap is unexplained, most likely a screenshot taken before the screen had caught up.
  - On review, the run's own board shows its "left x4" pieces did reach the left wall.
- **A guard anyway:** `runtime/test/host.test.js` now proves that a tap whose press and release both fall between two frames still reaches the game once, and that two taps a frame apart are two presses.

**D304. The plan screen never shows frames or milliseconds.** *(Claude.)*
- The live sessions' plans said "dances for 90 frames" and "back at the start 30 frames later".
- **The brief** now says plan rules give times in seconds, never frames or milliseconds, with no code words. That's a brief change; the director reapplies it.
- **And the screen can't show them anyway:** the driver rewrites what `show_plan` sends before it reaches the kid (`studio-kit/cli/src/kidwords.js`).
  - N frames becomes seconds at 60 a second ("1.5 seconds", "half a second", "a split second").
  - Milliseconds become seconds, "pixels per frame" becomes "pixels a second", and a stray "frame" becomes "moment".
  - Each rewrite is noted on the session (`plan_reworded_for_kids`), so the record shows when the brief wasn't followed.
- **Not taken:** handing the plan back to the agent to reword. It costs a turn, and recorded replays can't answer it.

**D305. A few cents read as "less than 1 coin", never "0" or "-0".** *(Claude.)* `usedCoins(cents)` is used everywhere a cost is shown: the coin history ("less than 1 coin (1c), stopped"), results, the shelf's failed-make row, and the walk-away screen.

**D306. Every menu stops at its ends.** *(Claude; D182 left wrapping unsaid.)*
- The shelf, "Who's making?" and the game card stopped at the ends; the question tiles, the plan, "Is this right?", the you-checks and every board's tiles wrapped. In the run, a "down" from "Back to the shelf" wrapped to "Play again" and restarted a game.
- Now all of them stop at their ends. On the plan, up or left is Build it and down is Change it, as its hint says.

**D307. A falling-blocks player for the headless runtime, and what it found in Candy Cat Drop.** *(Claude.)*
- `studio-kit/playtest/bin/stack-bot.js` plays with button presses only (A turns, left and right taps move, up drops), choosing each placement by the usual heuristic (lines, holes, height, bumps). It reads the board from the cart's probe and never pokes.
- **Candy Cat Drop** (Tester's make, now a playtest fixture):
  - 150 pieces cleared 58 lines, reaching level 12 with a score of 37,700.
  - Every clear made a POP and sparkles, and the cat was happy after each.
  - The cat is calm on an empty board and sad when the stack passes 12 rows.
  - The score follows the spec exactly: one row 100 and two rows 300, times the level (+600 at level 2, +2,700 at level 9). The level rises every 5 lines.
  - At game over it reported its score with `g.score` (D215).
  - Version 2 (the party hat) plays the same.
- So the game is correct to the spec. Whether it's fun still needs a person at the controls.

## 2026-11-12 — Claude checks it heard the idea right (D308)

**D308. Claude's first question always restates the idea, as an A/B.** *(Claude's idea from the end-to-end run, the director's go.)*
- In the run, speech-to-text turned "happy when you clear lines" into "after every 20 lines" and "Owen" into "oh and", and the mishearing became a question's option A. "Is this right?" shows the transcript, but a kid skims it.
- **So the first `ask_player` is one short line saying the idea back,** in Claude's words, with any number or name the kid said: "A falling-candy game with a cat who's happy when you clear a line?" A is "Yes, that's it"; B is "Something else".
  - **Always, once:** even when the idea seems clear. It costs one question, and kids like being understood.
  - **B or C means Claude misheard.** C carries the fix in the kid's words; after B, Claude asks what it got wrong. Either way, before any other question.
  - **D still means stop asking:** Claude builds from the idea as it heard it.
  - **Changes and forks too:** the first question restates the change asked for.
- **Where:** the brief (`studio-kit/managed-agent/agents/studio.md`, step 2 and Forks). That's a brief change; the director reapplies the agent. The driver relays it like any question, so the cabinet needs no change.
- **Tests:** `agent-def.test.js` holds the brief to it; `driver.test.js` drives a restate answered by voice and checks the fix reaches Claude word for word and lands on the record.
- **Not taken:** a separate "Did I hear you?" screen on the cabinet. The tiles already do it, and Claude restating in its own words catches more than showing the transcript again.

**D309. On the restate question, B reads "Not quite".** *(Claude, from the live check after the fixes; the director's go.)* D308's B was "Something else", right above C, the cabinet's own "Something else" that opens the mic. The two looked the same, but B sends no words. Now B is "Not quite": Claude then asks what it got wrong, and C still carries the fix in the kid's words. A brief change (`studio.md` step 2); the director reapplies the agent. `agent-def.test.js` checks B's words and that B never repeats C's label.

## 2026-11-13 — The publish gate (D310-D313)

**D310. The cabinet re-tests every made game in its own Chromium before the shelf.** *(Director's brief, 2026-11-12; design by Claude. Builds D8; changes D8's "fast smoke test" for cabinet builds to the full auto rules, as the brief asks.)*
- **What runs:** when a make or a change comes home, makeCart's existing "Checking your game here at home" step validates the cart as before, then the gate plays it. The gate runs the spec's auto rules and the generic checks (`studio-kit/playtest`) in the cabinet's system Chromium, through the browser driver. The gate replaces the node-driver home playtest there, so the kid's wait isn't doubled. Only a pass is committed to the library, so only a pass reaches the shelf.
- **No Playwright on the cabinet:** the harness has a second browser driver (`studio-kit/playtest/src/chromium.js`, `--chromium PATH`). It starts Chromium headless with `--remote-debugging-pipe` and speaks DevTools over the pipe, with no port, no WebSocket and no package. Its reports match Playwright's exactly on three fixtures (a test checks this).
- **Low priority:** each run is a child process (`cabinet/service/bin/gate-run.js`) under `nice -n 19` in its own process group, with its Chromium and a time limit (600 s). Runs go one at a time. Nothing is left running: the service stops its runs when it stops, a run whose service was killed kills its own process group, and Chromium is killed if its parent exits without closing it.
- **Never while a game is being played:** the launcher posts `/api/arcade/playing` when a play starts, every 10 s while it lasts, and when it ends. After 30 s of silence a play stops counting, so a crashed launcher can't hold the gate. A test waits for the play to end. If a play starts mid-test, the run and its Chromium are killed at once, and the test runs again after the play. The log records the seconds waited and the restarts.
- **A game that fails:** outcome `checks_failed`, so nothing is committed and the session's folder keeps everything (D5). The kid gets the E3 result ("Sorry! It didn't come out right", "Try again, same idea"). The make is charged its real cost, as designed (D202: no refunds).
- **The reason, for Geoff:** each failing check's id and reason is in the session record (`playtest.local.gate`) and in `logs/publish_gate.jsonl`. The Manager's Activity shows "cabinet re-test passed in N s" or "kept it off the shelf: R3: …".
- **When the cabinet can't run Chromium,** that's the cabinet's fault, not the game's. The same checks run on the node driver, logged with the reason (`fallback`). A run that couldn't happen at all fails the gate, with the reason.
- **What the kid sees meanwhile:** nothing new. The track's Test step stays lit with "Checking your game here at home", and then the result.
  - **On the virtual cabinet** that wait is 4.5 to 7.6 s per game (median 6.4 s, 16 shelf games, 2026-11-13). The node run it replaces took about 0.25 s, so the gate adds about 6 s.
  - **If the maker is off playing** when the build ends, the test waits for that game to end, then takes those few seconds. Meanwhile "Back to your game" on the shelf shows the same line.
- **A make picked up after a restart** (D191) goes through the same checker, so it's gated and deferred the same way. That closes D191's "not built".
- **Settings** (service config `gate`): `cpu_factor`, `calibrated`, `chromium`, `nice`, `timeout_s`, `watch_s`, `off`. `--no-gate` is for development only. The cabinet's profile (`/etc/arcade/cabinet.conf`) labels results `virtual` or `picade`.

**D311. Until a cabinet is calibrated, frame time never keeps a game off the shelf.** *(Director's instruction, 2026-11-12: "it must not block games on a guessed budget"; Claude.)*
- The budget is the Pi's whole frame (16.7 ms, D64), divided on the virtual cabinet by `gate.cpu_factor`. That's 3 by default: a guess, giving 5.57 ms (D128).
- **Each run still measures, judges and logs frame time.** While the cabinet's `gate.calibrated` isn't true, a frame-time failure is `advisory`: logged, shown in the Manager, never blocking. This holds on the virtual cabinet and on the Picade alike, and on the Picade even its 16.7 ms is unmeasured on a real Pi until bring-up.
- **Calibration (Phase 2):** run `cabinet/vm/guest/gate-shelf.mjs` on the Picade and on the virtual cabinet over the same carts. Set `cpu_factor` from the ratio, then `calibrated: true` on each.
- **On the virtual cabinet now** (2026-11-13), every shelf game's p95 is 1.1 to 1.5 ms, well inside even the guessed 5.57 ms. The worst single frame is 22 to 40 ms: a first-frame or GC spike, which the p95 ignores.

**D312. A downloaded game gets a smoke check, once per version.** *(Director's brief; Claude.)*
- The check (`gate-run.js --guest URL`): its page on the guest server loads, throws no page errors in its first 5 s, and asks for nothing beyond the cabinet's guest origin (`data:` and `blob:` are fine).
- **Results are kept** in the data folder (`gate/guests.json`) by id and `version`. A guest is on the shelf once its version has passed; a new version is checked again. It's still served while unchecked, so it can be checked.
- `/api/guests` says how many are still being checked, and the shelf looks again every 2 s while any are, so a guest appears as soon as it passes. On the virtual cabinet: teti and teti by Geoff pass in 5.5 s each.
- If the check can't run (no Chromium), the guest stays on the shelf, unchecked, and it's tried again at the next start: the cabinet's fault isn't the game's.
- **Not covered:** a guest whose files change without a new `version` isn't re-checked. Updates bump the version (D231).

**D313. What the gate costs, and what it doesn't cover yet.** *(Claude.)*
- **Virtual cabinet, 2026-11-13,** at nice 19, run from `/tmp` without touching the service (16 carts on its shelf, Chromium 156):

| Cart | s | Cart | s | Cart | s | Cart | s |
|---|---|---|---|---|---|---|---|
| apple-catch | 6.8 | cloud-popper | 6.4 | fruit-cat-drop | 6.4 | pepper-bone-catch | 7.6 |
| bee-buzz | 4.8 | comet-dodge | 4.8 | log-hopper | 6.5 | rock-rain | 4.6 |
| candy-cat-drop | 6.3 | frog-flicker | 5.8 | log-hopper-v2 | 6.5 | shark-chomp | 6.1 |
| candy-cat-drop-v2 | 6.4 | penguin-slide | 6.7 | snowball-drop | 4.5 | wall-ball | 6.2 |

- All 16 pass: 96 s for the whole shelf. teti and teti-geoff: 5.5 s each.
- **The Pi will be slower;** how much is what calibration measures.
- **Not built:** the desktop path. `publish_cart` over MCP runs the same gate once MCP exists (HANDOFF §9.4). The gate doesn't re-run when a cabinet update changes the runtime. Games already on the shelf stay there.

## 2026-11-13 — Stop and walk-away, live (D314)

**D314. A make put away while the kid was on the shelf opens its notice from Make.** *(Claude; from the director's live run of D188's two release paths, 2026-11-13.)*
- **Found live:** "Come back later" (E8), then nothing pressed for 10 minutes. At 10 minutes the make was released as D188 says (charged 1c "walked away", archived, `terminated` at Anthropic). The Make tile then read "Your last game was put away", but pressing it went straight to "Who's making?". The notice's own board, with what the make used, "Your idea is saved." and "Try again, same idea" (D300), was only ever shown to a kid still on the question, so a kid who'd walked away to the shelf could never reach their saved idea.
- **Now:** pressing Make while it carries a notice (a walk-away or a restart, E5) opens that notice's board first. "Back to the shelf" marks it seen, and Make is plain again. A browser test walks away to the shelf, lets the clock run out, and opens the notice from Make.
- **Seen and left as they are, for Geoff:** "Stop making this game" is one press, with no "are you sure?", and drops the idea: the kid lands on the shelf with no message, and nothing offers the idea again. The last-minute "Still there?" warning shows only on the question screen, so a kid on the shelf or in a game isn't warned.

**D315. Stop asks first and keeps the idea; the walk-away warning reaches the shelf.** *(Geoff, 2026-11-13, choosing the director's mock-up "Confirm, keep the idea"; Claude's build. Changes D188's quiet stop.)*
- **E13, "Stop making this game?"**: "Stop making this game" on E8 now asks first. It says "Claude stops now. N coins used." (from the live meter; a session that's started always reads at least "Less than 1 coin", D305) and "Your idea is saved for next time." Its tiles are [A] Yes, stop and [B] Keep going, with Keep going lit. The letters are badges, as on the question tiles: the stick still chooses and any button picks the lit tile (D182), so a stray press keeps going. ESC is the same as Keep going, back to the question.
- **After a stop,** the kid lands on the shelf, and Make reads "Your idea is saved". Pressing it opens **E14, "Your idea is saved"**: "You stopped making this game.", the idea in its own words, what it used once charged, and the tiles "Try again, same idea" (to the coin check with the words filled in, as D300's walk-away does) and "New idea" (to "Who's making?", and Make is plain again). ESC keeps the idea on Make. The service's stop now leaves a notice carrying the idea, as a walk-away does (D300, D314). The charge is unchanged: real cost, no refund (D202).
- **The walk-away warning on the shelf:** in the last minute before a release, the shelf's hint line shows the question screen's words, "Still there? Move the stick! N", counting down. Any key on the shelf already restarts the clock (D188), so the words are true there. It isn't shown during a game, which keeps the screen to itself.
- Board tiles can now carry a letter badge (`row`'s `letter`), drawn like the question tiles'.
- Browser tests: stop asks first, keep going and ESC return to the question, then a stop, the idea on Make, ESC keeping it and a try again reaching the coin check; a stop then a new idea; and the shelf's warning. Each fails without the change.

**D316. "Try again, same idea" keeps the idea until the make starts.** *(Found in D315's live check; the director's go, 2026-11-13.)* Choosing "Try again, same idea" used to mark the notice seen at once, so backing out of the coin check left Make plain and the idea gone, after a stop (E14) and after a walk-away (D300) alike. Now the launcher doesn't mark it seen. Backing out leaves Make offering the idea again, and a make that starts clears it, as the service already did for any start. A browser test backs out of the coin check twice after a stop and once after a walk-away, and fails without the change.

## 2026-11-13 — The card carries the keys and the twin's data (SD-card worker)

Geoff, 2026-11-13: "I don't want to have to add the key manually onto the SD card or the cabinet. You should make the SD card carry the key. And be ready the moment it is plugged in." On seeding: "yes -- but you'd better have a plan to push updates to the os cabinet etc -- accessing the sd card will be extremely hard once the cabinet is assembled". The director approved D320-D329 for this. D250-D259 are this worker's earlier block.

**D320. The Picade's identity is made at the flash, not after first boot.** *(Claude; moves D254's connect-picade.sh step before the flash.)*
- `flash.mjs` runs `connect-cabinet.sh --prepare FIFO` before it touches the card. That's the same script and checks as connecting a running cabinet:
  - Geoff pastes the Picade's key (no echo).
  - It names the key's workspace, and refuses the mini's and the virtual cabinet's (D131, D254).
  - It applies the Studio agent there with `claude-lock.arcade.json`.
- Then, instead of SSH to a cabinet, it writes the config into a FIFO that `flash.mjs` made in a private folder and reads into memory.
- With `--prepare` there's no y/n after the plan (the flash already asked to erase the card). So the key is the one thing typed for the identity (the director's point 3).
- **Geoff's one step before the flash** is the Console (checklist D1): the `cabinet-picade` workspace, its spend limit, and a key scoped to it. Only he can make a key. Claude signs in to nothing.
- `connect-picade.sh` stays as a repair tool.

**D321. The Groq key is copied from the virtual cabinet, with no typing.** *(Claude.)*
- Geoff put the Groq key on the virtual cabinet with `groq-key.sh`, which asked about Zero Data Retention then. `flash.mjs` reads it from there over the virtual cabinet's admin SSH, with a new read-only `service-config.mjs groq-key` that prints only the key.
- The key is held in memory and goes straight onto the card: never an argument, a file on the mini or a log line.
- If the virtual cabinet isn't up, has no key, or runs an older release, the flash stops before touching the card and says which. `--no-groq` makes a Moonshine-only card.
- `groq-picade.sh` stays as a repair tool.

**D322. The keys ride on the card only until first boot.** *(Claude.)*
- The card's boot partition gets `seed/cabinet-config.json`: the Anthropic key, agent and environment ids, and the Groq key. It's written straight onto the card's FAT, never into the seed folder on the mini's disk.
- First boot's `step_cabinet_config` (after the carts, before the services) installs it with `service-config.mjs install` into `/etc/arcade/service.json` (owner `arcade`, mode 0600). That also switches the service to `--config`.
- Then it overwrites the card's copy with zeros and removes it, whether the install worked or not. If the install fails, the cabinet plays offline (D252), and the log says why without quoting the file.
- It never replaces a config a cabinet already has.
- **Limits, accepted:** until first boot, anyone holding the card can read the keys (FAT has no permissions), so Geoff keeps the card with him. An SD card's controller may keep old blocks after the overwrite. Both keys can be revoked in their consoles.
- **Rehearsal 8 found a real bug.** `/etc/arcade` doesn't exist yet at that point, so the install crashed and the cabinet came up offline. The fail-soft path worked: the keys were wiped and the shelf played. Fixed (the step makes the folder), and now tested with the real `service-config.mjs`.

**D323. What Geoff types at the flash.** *(Claude, for Geoff to see. Changed by D327 and D329: the Wi-Fi only when there's no file, and nothing about keys; the Picade's key is pasted once into picade-key.sh, before the flash.)*
- **Typed:**
  - the `erase diskN NNGB` phrase (the brief's safety rule for writing a disk);
  - the Wi-Fi name and password;
  - the Picade's key;
  - the mini's password for sudo, which macOS asks for to write a raw disk.
- **Nothing after power-on.**
- A throwaway config (`--cabinet-config-from FILE`) and throwaway twin data (`--twin-dir DIR`) are for rehearsals and tests, on image files only; a card refuses them. With no terminal, an image file needs `--no-identity` or a throwaway config.

**D324. The card carries the twin's data; seeding is part of the flash.** *(Geoff's yes, 2026-11-13; carries out D295 at the flash.)*
- Before touching the card, `flash.mjs` runs the twin's own `seed()` (D295), with a fresh private folder standing in for the Picade. So the rules are exactly `twin.mjs seed`'s:
  - the synced paths only (D291);
  - never keys, the config, the Manager token or `kit-uploads` (D292);
  - no replay data;
  - no seed while a make runs.
- The twin records the seed and its baseline as before.
- The folder is packed as `seed/twin-data.tar.gz` (about 5 MB today), and the folder on the mini is removed even if the flash stops.
- First boot's `step_twin_data` unpacks it into `/var/lib/arcade` before the starter games, only while that folder is empty, and gives it to `arcade`. The card keeps its copy (D5).
- After first boot the Picade is the real one, and `twin.mjs sync` follows it (D290). `twin.mjs seed` remains for a cabinet flashed with `--no-seed`.

**D325. The shelf hears at once when Claude becomes reachable.** *(Claude, from rehearsal 9.)*
- The service checks api.anthropic.com every 20 s, but the screens heard about it only when something else changed. A cabinet whose service starts before its Wi-Fi drew "No Wi-Fi" on the first check and kept it.
- Now a flip in the check sends the state to the screens at once (`studio.refresh()`).
- Rehearsal 10 sampled the check for two minutes: online throughout.

**D326. What the card gives the update worker.** *(Claude; the director asked not to build the update path here.)* From first boot, before any update tooling exists:
- **Admin SSH on the home Wi-Fi.** `cabinet@arcade.local`, sshd enabled, key-only (no passwords, no root). The key is the one `flash.mjs` made on the mini, `~/game-studio-data/cabinets/arcade/ssh/arcade_ed25519` (`picade-ssh.sh`, D259). `cabinet` has passwordless sudo.
- **Releases side by side.** `/opt/arcade/releases/<version>-<hash>`, with `current` pointing at one and old ones kept. Going back is moving the link and restarting `arcade-launcher` and `arcade-kiosk` (D195).
- **Provisioning you can re-run.** `provision.sh` is safe to run again; `update-on-cabinet.sh` already runs it from an update payload, with the data check (D196).
- **Records.** `/etc/arcade/provisioned-version` and `provisioned-commit` say what the card installed. `seed/provision.log` on the boot partition keeps first boot's log, ending in `=== firstboot exit N ===` (D257).
- **The boot config.** `config.txt`'s own block is between `# BEGIN arcade provision` and `# END arcade provision`.
- **Pinned packages.** apt packages are pinned in `apt.lock`, and the image in `lock.json`. An OS update means new pins, tried on the twin first (D151, D296).
- **Not there yet:** an A/B root or any other fallback that survives a bad kernel or bootloader update. With the card hard to reach, that's for the update worker to decide.

**What's proven** (rehearsals 8-10, 2026-11-13; a throwaway Anthropic key, Groq key and twin, never the real ones):
- Power-on to shelf in about 1.5 minutes.
- `firstboot exit 0`, then the one restart.
- "connected" and "wiped" in the log, and the card's copy gone.
- `service.json` owned by `arcade`, 0600, holding the throwaway keys; the service on `--config`, with speech on `groq+moonshine`.
- The twin's game on the shelf, owned by `arcade`.
- The key strings in no other file and in no journal line.
- The admin SSH as D326 describes it.

**Not proven:**
- A real `ant apply` into `cabinet-picade`, and a real make. Those need the real key, which is Geoff's.
- Groq's answer from the Picade, which needs a mic and a real key.
- Everything on the hardware (D253, D257).

**D327. The Wi-Fi can come from a file on the mini.** *(Director's call, 2026-11-13: fewer prompts at the flash; the erase phrase stays.)*
- `flash.mjs` asks for the Wi-Fi as before. But if `~/.config/game-studio-arcade/wifi.json` exists, it uses that instead and says which network. The file is `{"ssid": "...", "password": "..."}`, or `"psk"` with the 64-hex WPA key.
- The file must be a plain file owned by Geoff with mode 0600, or the flash stops and says why (`chmod 600`). Its errors never quote it.
- `--wpa3` needs the password typed, since the file may hold only the key.
- Nothing writes the file: it's Geoff's to make if he wants it.
- So at the flash Geoff types the erase phrase, the Picade's key and the mini's sudo password (D323), plus the Wi-Fi only when there's no file.

**D328. `flash.mjs --check`: the gather steps, writing nothing.** *(Director's ask, 2026-11-13.)* Against the live virtual cabinet it checks:
- the Wi-Fi file, if there is one;
- the Groq key's exit code and shape (the key is never shown, saved or logged);
- the twin data, using the helper's read-only `info` and `manifest` (not `seed()`, which records the seed on the twin): no replay data, no make running, files to copy;
- the pinned image and Node tarball against their hashes.

The Picade's identity isn't checked, because that needs Geoff's key and applies the agent.
- **Run on 2026-11-13 after the virtual cabinet's update:** exit 0 and "Ready to flash". The Groq key was key-shaped; there was no replay data and no make running; 527 files and 17 games to copy, release 0.1.0-de74998c3fef; both pins matched. The output held no `gsk_` string.

**D329. The Picade's key goes in now, not at the flash: `scripts/cabinet-card/picade-key.sh`.** *(Geoff, 2026-11-13, on "you type it once at the flash": "seems like something you should just address now vs wait til later". Supersedes D320's paste at the flash.)*
- **When:** Geoff runs it once, in his own Terminal on the mini, from the main checkout, after making the `cabinet-picade` workspace and its key in the Console.
- **What it does:**
  - It runs `connect-cabinet.sh --prepare`, so the checks are D320's: the key read with no echo, a workspace key only, refusing the mini's and the virtual cabinet's workspaces, and the Studio agent applied there with `claude-lock.arcade.json`.
  - It stores the key, agent, version and environment in `~/.config/game-studio-arcade/cabinets/arcade/identity.json`: folder 0700, file 0600, written in one step. That's beside the mini's other identities (`~/.config/game-studio-arcade/identity` for WIF). Not in the repo, and not in the Keychain, which would put a dialog on Geoff's screen.
  - It proves the identity live: the agent is retrieved at its version, then one session is created against it with a 5-cent cap and no message (so the model never runs), and archived at once.
  - It prints only ok or fail, the workspace id (from the lock file; a workspace key can't read its workspace's name) and the agent version. Any error it prints has key-shaped strings replaced.
- **`picade-key.sh --check`** repeats the proof with the stored identity and asks for nothing.
- **The flash** reads that file and asks nothing about keys. With no file, it says to run `picade-key.sh` first and stops before touching the card. `--prepare-identity` (D320's paste at the flash) stays as a repair path, as does `connect-picade.sh` for a running Picade. `flash.mjs --check` (D328) reports the stored identity too, without its key.
- **The lock file:** `studio-kit/managed-agent/claude-lock.arcade.json` is written in the checkout Geoff runs it from. It holds no secrets and gets committed after his run.
- **Tested:**
  - the file's mode and folder, written in one step;
  - refusals: a readable file, a missing one, an admin key;
  - the live check's calls with a stand-in client: retrieve at the version, a 5-cent cap, no initial events, archived;
  - the key never echoed;
  - `--check` with a throwaway key against the real API: a clean `fail ... 401` with no key in the output, nothing spent.
- **Not tested here:** a real run, which needs Geoff's real key.

## 2026-11-13 — Updating the Picade over the network, with a safe way back (D330-D339)

Geoff, 2026-11-13, on the card: "you'd better have a plan to push updates to the os cabinet etc -- accessing the sd card will be extremely hard once the cabinet is assembled". This adds a rule: **after the first flash, nothing ever needs the card pulled.** Every update can go back by itself, and the cabinet stays reachable over Wi-Fi. The Pi facts used here are in [platform-notes.md](platform-notes.md#updating-a-pi-5-over-the-network-checked-2026-11-13-for-d330-d339).

**D330. One command, or a Manager button, updates the Picade: its cabinet software, the Studio agent's brief, and its OS packages.** *(Director's brief, 2026-11-13; design by Claude.)*
- **The command:** `node scripts/virtual-cabinet/update-cabinet.mjs --picade --os`, run from a clean `main`.
  - It reaches the Picade with its own key (picade-ssh.sh, D259). Without `--picade` it updates the virtual cabinet, as before.
  - **Cabinet software:** the service, launcher, runtime, studio kit, guests and the provisioning script, as in D195. Data and the key are kept.
  - **OS packages,** with `--os` (D335).
  - **The agent's brief:** afterwards, if `studio-kit/managed-agent` differs between the cabinet's last commit and this checkout, it runs `connect-picade.sh --reapply`. That is the Managed Agents apply in the Picade's own workspace, with the key read from the cabinet.
    - If the commit is unknown or was dirty, it reapplies anyway; that changes nothing when the definition is the same.
    - It's skipped while the cabinet isn't connected, and `--no-agent` skips it.
- **What's automatic within an update, and what stays a deliberate command:**

| What | How | Why |
|---|---|---|
| Cabinet software (service, launcher, kit, guests, units, helpers) | Automatic, in every update | Rolls back with its own provisioning (D331) |
| Packages apt.lock pins (Chromium, cage, …) | Automatic, only when apt.lock changes in the repo | Tested on the twin first; copies kept (D335) |
| Other OS packages (security fixes: openssl, curl, tzdata, …) | Automatic with `--os` | `apt-get upgrade` only; copies kept; put back if unhealthy (D335) |
| Agent brief | Automatic when the agent changed | `--reapply`; spends nothing |
| Kernel, boot firmware, initramfs, the Pi's Wi-Fi firmware | **Deliberate:** `scripts/cabinet-card/boot-update.mjs` | Through tryboot, never in an ordinary update (D336) |
| Bootloader (EEPROM) | **Deliberate and by hand, only if Raspberry Pi says a fix needs it** | Its own self-update is masked; a bad flash needs the card (D335) |

- **Never during play or a make (D332).** There is no schedule. An update runs when Geoff runs it, or Claude with his yes. Nothing updates itself.

**D331. A failed software update goes back with that release's own provisioning, not just its link.** *(Claude.)*
- **Before D331:** a rollback pointed `/opt/arcade/current` back at the old release. The newer provisioning's unit files, helpers and settings stayed, so a broken unit file stayed broken.
- **Now:** the cabinet keeps `last-good`, the payload of the last update that came up healthy. A rollback re-runs that payload's provisioning script over the cabinet.
  - On the first update after the card, the card's own seed (`/boot/firmware/seed`) serves as that payload.
  - It uses whichever payload's bundle matches the release it's going back to. With none, it moves the link alone, as before.
- **No network needed:** that provisioning finds its release, Node, speech and packages already there.

**D332. An update never interrupts anyone: it refuses during a make, a game, or a gate check.** *(Director's brief: "Updates never run during play or a make"; Claude.)*
- **The cabinet checks itself,** before it records or changes anything, so the Manager, the command and a script all get the same answer.
- **Busy means:**
  - a make is running, or one is still to be collected (D191);
  - the launcher's play heartbeat is fresh (D310, at most 30 s old);
  - the publish gate is checking a game.
- `GET /api/arcade/playing` on the service answers `{playing, what, gate_busy}`.
- **The result names the reason,** e.g. "a game is being played (teti): nothing was changed". Try again later.
- **A service that doesn't answer isn't busy:** a broken cabinet must still take a fix.

**D333. "Healthy" means the service answers, SSH is running, and the cabinet still reaches its own router.** *(Claude.)*
- **When:** after the software step and after the OS step.
- **The router counts** if it answers a ping, or failing that, ARP. The mini isn't involved: it may be off (cabinet independence).
- **After OS packages changed,** the next boot must reach the router within 10 minutes (`os-watch`), or the packages go back and the cabinet restarts.
  - The only false alarm is a router that's off for those 10 minutes. Then the cabinet ends up on the older packages, which is harmless.
  - The next update clears the watch, since it proves the network.
- **A rollback that leaves no network** restarts NetworkManager. If that isn't enough, it restarts the cabinet on the old packages.

**D334. A power cut at any point in an update puts the cabinet back at the next boot.** *(Claude; the rehearsal found the flaw it fixes.)*
- **The marker:** `/var/lib/arcade-update/pending` is written before the first change, and removed only after `result.json`.
- **At every boot,** `arcade-update-recover.service` runs. If `pending` is there, it:
  - finishes any half-done package install (`dpkg --configure -a`);
  - puts back the package copies;
  - restores the old release with its own provisioning (D331), or keeps the new software if it had already come up healthy;
  - checks the data against the record taken before;
  - writes a `result.json` saying `recovered_at_boot`.
- **An update started while `pending` is there** recovers first, with its own copy of the recovery.
- **Files reach the disk before they're used.** The rehearsal's first power cut left every file the update had just written empty: ext4 had renamed them into place before their contents were on disk. That included the recovery unit, and an empty unit file is a masked unit. Now:
  - the guards are written with flush-then-rename (`put_file`);
  - the update runs `sync` before its first change;
  - provisioning flushes a release, Node, the speech venv and the model files before giving them their final names. Otherwise a cut mid-unpack could leave a named release of empty files, which is never unpacked again.
- **Every cabinet gets the guard.** Every provisioning run installs it, and so does the update itself before it changes anything, so a card flashed without it gets it on the first update.

**D335. OS packages: `apt-get upgrade` only, a copy of every package first, the boot packages held.** *(Claude.)*
- **`upgrade`, never `full-upgrade`,** so nothing is added or removed. A security fix that needs a new package waits for apt.lock.
- **apt.lock's own packages are held during the OS step.** They move only when apt.lock changes in the repo and the software update installs those versions. Otherwise an OS update would move Chromium past its pin, and the next provisioning would fail trying to go back.
- **The boot packages are held all the time:** `linux-image-*`, `linux-headers-*`, `raspi-firmware`, `initramfs-tools*`, `firmware-brcm80211` (the Pi's Wi-Fi chip), `rpi-eeprom`, `raspberrypi-sys-mods`, `rpi-update`.
  - raspi-firmware's hooks overwrite the kernel on the boot partition in place (platform notes), so these move only through D336.
- **A copy of each package first.** Raspberry Pi's archive keeps one version in its index and has no snapshots, so the cabinet makes its own copies:
  - with `dpkg-repack`, installed when first needed, into the update's own folder;
  - a failure puts them back with `dpkg -i`;
  - the same goes for apt.lock packages a software update moves.
- **The bootloader's self-update at boot is masked** (`rpi-eeprom-update.service`). A bad bootloader flash is the one failure that needs the card (Imager's recovery).
  - Update it only by hand, on Raspberry Pi's advice, with nobody playing. There's no command for it yet.
- **It needs 2 GB free,** and stops with nothing changed when there's less.

**D336. The kernel and boot firmware change only through tryboot, into a new folder, and are kept only once the cabinet comes back well.** *(Claude, from Raspberry Pi's docs, checked 2026-11-13.)*
- **Slots without repartitioning.** Each boot setup is its own folder on the boot partition (`arcade-<time>/`). It holds its own kernel, initramfs, device trees, overlays (with the README that makes them per-slot) and cmdline.txt.
  - A block in config.txt picks one slot with `os_prefix`. The firmware ignores a prefix whose kernel or device tree is missing, and falls back to the top of the partition.
  - Raspberry Pi's own A/B layout (`autoboot.txt`, two boot partitions) would mean repartitioning, so the card would come out. Not now (D339).
  - **Space:** a slot holds only the Pi 5's files, about 25 MB: `kernel_2712.img`, `initramfs_2712`, the `bcm2712*.dtb` files, overlays and cmdline.txt.
    - The rehearsal's card had only 115 MB free on its boot partition, because the seed takes 324 MB, mostly speech.
    - So a try first removes every slot except the one config.txt boots, then needs the new slot's size plus 8 MB. Slots are copies of files the packages hold, not anyone's data.
- **A try writes only a new folder and `tryboot.txt`,** then restarts with `reboot '0 tryboot'`: one boot from the new folder.
  - On that boot, `arcade-boot-confirm` waits up to 5 minutes for the router, the service and the kiosk.
  - If all three come up, it keeps the slot by rewriting config.txt's slot block. That is the one write that matters.
  - If not, or if the try hangs, crashes or loses power, the next boot reads config.txt, which still names the last slot, and the boot packages are put back from their copies.
  - The confirm knows a try by `arcade.slot=<id>` in that slot's own cmdline.txt.
- **A hang must turn into a restart.** The slot block sets `kernel_watchdog_timeout=15`, and systemd kicks the watchdog (`RuntimeWatchdogSec=15s`).
  - 🔧 Not confirmed in the docs: that a watchdog reset clears the tryboot flag as "a reset" does. Prove it on the Picade with a deliberately broken try before relying on it.
- **Commands:** `scripts/cabinet-card/boot-update.mjs`, from a Terminal on the mini, never from the Manager. It waits for the outcome and reports it.
  - `adopt`, once after bring-up: puts today's boot files in their own slot, so later package updates never touch what boots.
  - `packages`: lifts the hold, updates the boot packages, copies them into a new slot, and tries it.
  - `status`.
- 🔧 **Not rehearsable in QEMU.** The rehearsal boots Debian's kernel without the Pi's firmware, so only the Picade can prove tryboot itself. The config.txt handling is tested on the mini.

**D337. Proven in a QEMU rehearsal of the card, including a broken update and a power cut.** *(Director's brief; Claude.)*
- **How:** `scripts/cabinet-card/test/update-rehearsal.sh DIR` runs on the card image `flash.mjs` writes, booted with `rehearse.mjs` (unchanged; the port comes from `REHEARSE_SSH_PORT`). It never touches the virtual cabinet or the Picade.
- **The cases:**
  - an update refused during a game;
  - a software and OS update;
  - the network check after the next restart;
  - a broken release plus a broken unit file;
  - a power cut while the new release unpacks, then the same update again;
  - an OS package that breaks the service;
  - an OS package that takes the network away.
- **Data:** a cart and a log of the family's must come through every case.
- **The broken packages** come from a local apt repository on the VM.
- **The boot path,** `scripts/cabinet-card/test/boot-rehearsal.sh DIR`:
  - **Revert:** QEMU has no Pi firmware, so a tryboot restart is a normal restart, which is exactly a try that didn't come up. It must be reported, and config.txt must be untouched.
  - **Keep:** run on a copy of the boot partition, with a command line that names the slot.
- **Results, 2026-11-13,** on a card from this branch rebased on main 0a137ad (the guard installed from first boot): **24/24 update checks and 10/10 boot checks pass.**
- **What the rehearsal found and fixed:**
  - Files written just before a power cut came back empty (D334).
  - The boot partition had only 115 MB free (D336).
  - systemd 257 refuses `systemctl reboot "0 tryboot"` with "Too many arguments". The try now uses `systemctl reboot --reboot-argument="0 tryboot"`. Raspberry Pi's own `reboot '0 tryboot'` still works, since `reboot [ARG]` takes it.
  - The OS step: copying 31 packages first and then upgrading took 66 s.

**D338. The Manager's Software tab: versions, and an Update button.** *(Director's brief; Claude.)*
- **It shows** what the cabinet runs (version and commit, read live) and the mini's checkout commit.
- **The button** runs the same `update-cabinet.mjs` for that cabinet (`real` becomes `--picade`), with a checkbox for OS packages, and shows its output and the cabinet's result.
- **Limits:**
  - one update per cabinet at a time;
  - the cabinet refuses while it's busy (D332);
  - the boot update is never on it (D336);
  - like every Manager POST, it needs the Manager's page (D285).

**D339. What this doesn't cover, and the risk Geoff accepts.** *(Geoff, 2026-11-13, through the director: "Card I have, accept risk"; Claude.)*
- **The card stays as it is.** That means the card Geoff has, the stock two-partition layout, no A/B root, and no high-endurance card. The alternatives were Raspberry Pi's full A/B layout (`autoboot.txt` with two boot partitions and two roots, or Connect's OTA on an `rpi-image-gen` image) and a high-endurance card. Claude recommended the high-endurance card; Geoff chose neither.
- **Still unrecoverable without opening the cabinet and reflashing the card:**
  - **a corrupt root filesystem,** for example from SD card wear or a cut while the OS itself was writing;
  - **a failed bootloader (EEPROM) flash.** Its self-update is masked, and changing it is by hand only, on Raspberry Pi's advice (D335).
- **The fix when that happens:** open the cabinet, reflash, and restore the data from the mini's hourly backup of the Picade (`flash.mjs --from-backup`, D350-D355). The steps are in [cabinet-bring-up.md, Part G](cabinet-bring-up.md#part-g-if-the-card-ever-dies-d339-d354-d355).
- **An NVMe Base** (platform notes) remains the later fix if the card proves fragile.
- **Changing the Wi-Fi network or password over the network:** not built. A wrong one would cut the cabinet off.
- **config.txt changes in a software update** (picade.sh's block) are still written in place and take effect at the next restart, as before (D250). Moving them into a tried slot like D336 is a follow-up.

## 2026-11-13 — The desktop flow: the cabinet's MCP server and the game-studio plugin (D340-D349)

*(Worker, from the director's zoom-out review: HANDOFF §3.1, §8.3, §9.2 and §9.3 were locked, and none of it existed.)*

**D340. The arcade MCP server is a route inside the cabinet service: `POST /mcp` on its loopback port.** *(Claude; carries out §3.1's "the MCP server lives on the cabinet, inside the cabinet service".)*
- `cabinet/service/src/arcade-mcp.js` holds the six tools of §9.2: `list_carts`, `get_cart`, `publish_cart`, `launch_on_cabinet`, `get_activity`, `cabinet_status`. `src/mcp-rpc.js` is a small JSON-RPC core with no packages, shared with the plugin.
- **Protocol, checked against the spec 2026-11-13.** It speaks both eras. Modern (2026-07-28): a version in each request's `_meta`, `server/discover`, `resultType: "complete"`, and error -32022 for an unsupported version. Legacy: `initialize`, `notifications/initialized`, `ping`. Claude Code asks stdio servers for the modern revision first and falls back to the legacy one.
- Streamable HTTP with JSON answers only: no server-sent stream, because no tool needs to push anything.
- It's not in the play path. It reads the library and logs, appends to them, or asks the launcher, and every request is answered on the service's own event loop.

**D341. Who may connect: the mini alone, paired like the Manager.** *(Claude, within the director's brief: "keep it home-network only, paired like the Manager"; for Geoff to see.)*
- **Nothing new listens on the network.** `/mcp` is on the service's `127.0.0.1:8330`, like the Manager's endpoints, reached through the mini's SSH to the cabinet: the Manager's held connection and port forward (`manager/cabinet.mjs`, D280, D286), with the cabinet's own admin key, which only the mini has.
- **Then the Manager's pairing token** (`/etc/arcade/manager-token`, D208, D215), as `Authorization: Bearer`. A cabinet that isn't paired answers 404 there, as for the Manager.
- **No browser can call it.** A request that carries an `Origin` header is refused, so a web page can't reach it through DNS rebinding.
- One token for both the Manager and the desktop. It's the same grown-up on the same mini, and it means one fewer secret to pair. A separate desktop token is a small change if Geoff wants to revoke them separately.

**D342. The plugin's `arcade` server is a bridge on the mini.** *(Claude.)*
- Claude Code starts `game-studio/src/arcade-bridge.js` over stdio. It opens the SSH link at the first call, so Claude Code's start isn't held up, and passes each call to the cabinet unchanged.
- Two conveniences live in the bridge, because only the mini has the folders:
  - `get_cart`'s `into` writes the files to a new local folder, with `.arcade-pulled.json` (id, version, commit), instead of returning them.
  - `publish_cart`'s `dir` packs a local folder as the bundle. Files a cart doesn't hold are listed as `not_sent`. The parent comes from the marker unless one is given, so a pulled game publishes as a change to it.
- `ARCADE_CABINET` picks the cabinet: `virtual` (the default), `real`, or a name in the Manager's `cabinets.json`. `ARCADE_URL` with `ARCADE_TOKEN_FILE` reaches a service directly, for a local copy and the tests.

**D343. publish_cart: a new version through the same checks as a make, never a replacement.** *(Claude; §3.1's never-delete, spec-first and publish gate, D310.)*
- **The bundle:** `{files: [{path, text|base64}]}` holding `spec.md`, `cart.json`, `game.js`, `checks.js`, `NOTICE.md` and `assets/…` only. Paths use safe characters only, with no `..` and no dot-files, at most 300 files and 4 MB. A sent `playtest.json` is dropped: the cabinet writes its own.
- **The cabinet writes the provenance:** maker, with, parent (`id@version`), family and branch, `session_id` (`desk_…`), `origin: "desktop"`, created. Makers must be in the cabinet's `makers.json`. Geoff is a grown-up maker (D236).
- **Lineage works as for a cabinet change** (D206, make.js's ids). The parent's own maker gets the next version of the same line (`<line>-v<n>`). Anyone else gets their own version, a new line in the same family. The parent is never touched.
- **Validate, then the publish gate** (D310: its queue, low priority, waiting while a game is played). Only a pass is copied into the library and committed. A failure is logged and kept in `sessions/<desk_…>/` (D5), and comes back as a tool error naming each failing check, so Claude can fix it and publish again.
- **Logs** (§9.5): a `studio_session` with `origin: "desktop"`, `kind` new or change, `summary`, the spec diff and the gate's result; and a `cart_version` on a commit. The Manager's Activity reads them as it does a make.
- One publish at a time.

**D344. launch_on_cabinet opens a game's how-to-play board, and only from the shelf.** *(Claude, with the director's go for a small launcher hook; for Geoff to see, because it's what the kids see.)*
- **What the kids see is an existing board.** The launcher shows G0 (how to play) for that game, the same board a kid gets by picking it on the shelf, and pressing a button plays it. No new screen.
- **It never interrupts.** The service refuses while a make is running or a game is being played. The launcher refuses on any screen but the shelf, saying which. The tool reports the refusal with its reason.
- **How it works:** the launcher listens on `/api/arcade/launch` (server-sent events) and answers on `/api/arcade/launch/answer`. With no launcher listening, or no answer in 8 s, the launch is refused. The hook is one self-contained block at the end of `launcher/app.js`.
- **For Geoff:** a kid browsing the shelf would see it jump to the launched game's board. That's the flow §8.3 asked for. If it should wait until the shelf has sat untouched for a while, that's a small change.

**D345. A desktop build costs the family's coin pot nothing.** *(Claude; follows §3.1: desktop builds run on Geoff's account with Geoff present.)* The pot reads only `coin_ledger`. A desktop session writes none, and its `list_cost` is null.

**D346. The studio tools: §9.3's four, plus read_kit and play.** *(Claude.)*
- Claude Code names a plugin server's tools `mcp__plugin_game-studio_studio__<tool>`, and the spec allows dots but Claude Code's own names don't. So they're `new_cart`, `validate_cart`, `playtest` and `import_asset` on the `studio` server, which reads as §9.3's `studio.*`.
- `read_kit` gives the same lean context pack a make reads (D160), with the mini's paths.
- `play` serves the folder with the runtime's dev server and opens the browser, keyboard as the joystick: the "local browser" of §3.1's desktop experience, which is quicker than the Manager's simulator for iterating.
- `playtest` is the same harness the gate runs (node by default, `driver: browser` for Playwright's Chromium).
- **`import_asset`:** carts import nothing (D21), so a picture becomes sprite rows to paste into `game.js`, fitted to `size` × `size` (at most 64), each pixel the nearest of the 32 house colours, and transparent below half alpha. It keeps the picture as `assets/<name>.png` and the rows as `assets/<name>.sprite.json`, and adds a NOTICE.md line from `source`. PNG is read directly; anything else goes through macOS's `sips` first.
- The `build-cart` skill is the spec-first loop for Geoff and a kid, with the house rules: inspired-by only, the kids' words stay off the repo, never delete, publish only when Geoff says.

**D347. The plugin's layout, and how it's installed.** *(Claude.)*
- `game-studio/plugin/` is the plugin: `.claude-plugin/plugin.json`, `.mcp.json` (servers `arcade` and `studio`), `skills/build-cart/`, and `bin/run.mjs`.
- The code is in `game-studio/src/`, with tests in `game-studio/test/` (an npm workspace).
- Claude Code may run an installed plugin from its own copy. So `run.mjs` finds the checkout: `GSA_REPO`, else the checkout it sits in, else `~/claude-home/game-studio-arcade`. An installed plugin therefore runs the main checkout's code.
- The servers run on Node 22 (`GSA_NODE` overrides it).
- The repo root is a one-plugin marketplace (`.claude-plugin/marketplace.json`). `claude plugin validate` passes on both.
- **Installing into Geoff's Claude Code is his call** (the director's brief). The command is in `game-studio/README.md`.

**D348. get_activity leaves the kids' words out unless asked for.** *(Director, 2026-11-13, on Claude's note; Claude's mechanics.)*
- §9.2's `get_activity` returns what the logs hold, with the heavy fields (usage, tokens, the spec diff) left out.
- **By default it leaves out the kids' own words:**
  - a cabinet session's `request`;
  - every `said`: question answers, plan changes, you-check notes, screened words;
  - screening's `alternative`, `hits` and `why`.
- What stays is who, when, which game, each question and its A/B options, the choice letter, outcomes and the gate. A desktop session's `request` stays: it's Geoff's summary.
- `include_words: true` brings the words back, and the result says `words: "included"` or `"left out"`. The tool's description says to ask Geoff first.
- Why: those words would otherwise land in Geoff's Claude Code session, on his account, while the Manager only shows them in his browser. The skill and the tool still say never to copy them into the repo.

**D349. What's proven, and what isn't.** *(Claude, 2026-11-13.)*
- **Against the virtual cabinet** (release `0.1.0-f8e4d956bc61`, the director's turn): real Claude Code with the plugin (`claude -p --plugin-dir`, `ARCADE_CABINET=virtual`) ran the flow over the Manager's SSH and token, in 16 turns for $0.84 of Geoff's Claude Code usage:
  - pulled Tester's `bee-buzz` into a folder;
  - changed the spec first (a new R8 for one more life, A1, a v2 Changelog line), then `game.js` and `checks.js`;
  - `validate_cart` and `playtest` passed;
  - `play` returned its URL;
  - `publish_cart` made `bee-buzz-v2`: version 2, parent `bee-buzz@1`, family and branch `bee-buzz`, `origin: desktop`, with geoff, library commit `2709923a`. The cabinet's gate passed it in 9.2 s in its own Chromium.
  - `launch_on_cabinet` was accepted, and `arcade-screenshot` showed G0, "Bee Buzz, by Tester".
- **Before that, on a local copy of the service** with the real gate: the same flow on `penguin-catch`, in 16 turns for $0.47.
- **Tests:** the cabinet side's `test/arcade-mcp.test.js`, the plugin's `game-studio/test/`, and the Manager's desktop row. `claude plugin validate` passes for the plugin and the marketplace.
- **Not proven:**
  - With a kid at the desk, interactively. That's §14's first joint game with Owen.
  - On the Picade, which isn't built.
  - The plugin installed from the marketplace rather than `--plugin-dir`. That's Geoff's install.

## 2026-11-13 — The twin as the Picade's backup (D350–D359)

Geoff kept the card he has and accepted the risk ("Card I have, accept risk"): if the Picade's card dies, it's reflashed and reloaded from the mini. So the mini's copy is the only backup of the kids' games. Code: `scripts/twin-backup/`, `manager/backup.mjs`, `scripts/twin.mjs`.

**D350. An hourly backup on the mini.** *(Claude, at the director's ask.)* A launchd agent (`com.game-studio-arcade.twin-backup`, `scripts/twin-backup/install.sh`) runs `scripts/twin-backup/run.mjs`. It runs every hour and once at load, as a background process at low priority, with no window and no focus. The cabinet is never asked for anything: the mini pulls (D293), so cabinet independence holds. If there's no card yet (no SSH key) or the Picade doesn't answer on port 22 within 5 s, the run records that and exits 0, quietly. A reachable Picade that can't be copied exits 1 and says why in `~/game-studio-data/twin/launchd.log`. Install and uninstall are one script each. Uninstall keeps every copy (D5). Installing it is Geoff's yes, once the Picade is up (bring-up E3).

**D351. The backup is a plain folder on the mini, not only the twin.** *(Claude.)* Each run syncs the Picade into `~/game-studio-data/twin/backup` first, then into the twin VM.
- The folder is written by nothing but sync, so it's a pure copy of the Picade. The twin also holds its own test makes until its next sync (D294), and it isn't there when UTM is off.
- In this folder every file the Picade replaced keeps its older copy in `twin-sync/set-aside/<time>/`, not only files the twin changed: `makers.json`, git refs, a rewritten log. So a card that starts corrupting data can't overwrite the good copy.
- The twin's sync failing (it's off, or making) doesn't fail the backup; the record says so.

**D352. One lock for seed, sync and backup.** *(Claude.)* `~/game-studio-data/twin/lock`, taken by `seed()` (so the flash's seed too, D324), `twin.mjs sync` and the backup. A backup that finds it held records "busy" and waits for the next hour. A seed that finds it held stops and says so. A lock whose process is gone, or that is over 6 hours old, is taken over.

**D353. "Last backup" in the Manager's health (HANDOFF 9.4).** *(Claude.)* The backup writes `~/game-studio-data/twin/backup.json`: its last try (result, message, whether the Picade answered), the last good copy (time, games, files), and the twin's part. The Manager reads it and shows one line under the Picade's screen (not the virtual cabinet's). The line turns red (warn) when the newest copy is over a day old while the cabinet is on, which means the Manager can reach it now or the backup's last try did. It also warns when the job hasn't run for 3 hours while the cabinet is on (not installed, or the mini asleep). A cabinet that's simply off shows its last copy and since when it's been off, without a warning.

**D354. A dead card is rebuilt from the backup folder, through the flash's own seed path.** *(Claude.)*
- `flash.mjs --from-backup` takes the twin's data for the card from `~/game-studio-data/twin/backup` instead of the twin VM, with the same seed rules (D324, D291, D292). It works with `--disk`, unlike `--twin-dir`.
- **The rehearsal** (`scripts/test/twin-restore.test.mjs`, throwaway folders only): a lived-in Picade with a git library of five versions over two games, lineage, a `gc`, makers, two months of a coin ledger written by the service's own pot code, sessions, logs and a downloaded game; two hourly backups; then the card "dies". The data is rebuilt from the backup folder alone through `seed()`, the flash's `tar`, and first boot's `step_twin_data`.
- **What it proved:** every synced file is byte-identical to the Picade at the last backup, and nothing else is there. The library passes `git fsck`, has a clean tree, and every commit is in its log. The shelf reads the same carts with the same makers, parents, families and branches. `makers.json` is identical. The ledger is identical line for line, and the service's own pot code computes the same state.
- **A bug it found, now fixed:** after a `git gc` the library's `refs/heads` is empty, and a file-by-file copy dropped empty folders, so the copy wasn't a git repository. Manifests now carry empty folders, and sync and seed create them. The twin's library today still has its branch as a loose file (checked on the 2026-11-11 pull), so seeds done so far were not affected.

**D355. After a reflash, what comes back.** *(Claude, from D354's rehearsal; answers the director's question.)*
- **The coin pot comes back as it was at the last backup.** The pot is worked out from `logs/coin_ledger.jsonl` alone, plus settings. The flash writes no pot settings, so both cards use the code's defaults. Two things differ:
  - Charges after the last backup are lost, so the pot can read slightly high.
  - A make running when the card died is never collected (`studio-left.json` is the card's own), so its cost is never recorded.
- **The kids' games keep their makers and lineage.** `cart.json` (maker, parent, family, branch, session) and the library's history come back byte for byte, and so does `makers.json`.
- **Not carried, by design (D292):** `cabinet-state.json`, so the welcome screens show once more and a "resting" month is forgotten until the workspace limit refuses again. Also the Manager pairing (re-pair) and `kit-uploads.json` (re-uploaded on the first make).
- **The loss window is the time since the last backup:** an hour normally, longer if the mini slept or the Picade was off the Wi-Fi. A card that still boots should get one more `run.mjs` first.

**D356. `flash.mjs --day-one FILE`, applied to the card's copy only.** *(Claude.)*
- The file is JSON: `{"pot": "full", "hide_makers": ["tester", "tester2"], "shelf": ["teti", "teti-geoff", ...]}`.
- The flash applies it to its snapshot of the twin's data (D324), after `seed()` and before packing. The twin, the backup and the mini keep everything as it was. `twin.mjs sync` later sets the twin's own versions aside (D294), never deleting them.
- The flash stops before touching the card if the file names a game or maker the data doesn't have, so a typo can't silently drop a game.
- **Never with `--from-backup`:** a rebuilt card comes back as it was (D354), so the two together are refused.

**D357. A full pot: the twin's test ledger isn't carried.** *(Claude.)* `logs/coin_ledger.jsonl` is left out of the card's copy. The pot is worked out from that ledger alone (D355), so the Picade starts the month with the service's own refill: 100 coins. The twin keeps its ledger in its records on the mini.

**D358. The shelf and the makers, as D360 marks.** *(Claude.)*
- The card's copy gets `"remove"` lines in `logs/shelf_marks.jsonl`, in the Manager's format:
  - `kind: "maker"` for each hidden maker (`makers.json` itself is never touched);
  - `kind: "game"` for every shelf line not chosen.
- Every mark has `by: "geoff"`, `via: "day-one"`, Geoff's reason, and a trailing newline.
- **Lines, not carts:** a game mark targets a line (a cart's `branch`, or its own id). So one mark hides a game with all its versions, and a kid's own version is a line of its own. A day-one file may name any cart in a line to keep the whole line.
- Everything stays on the card (D5). A grown-up brings a game or maker back from the Manager with a `"restore"` mark.
- **Starters:** the starter games are lines like any other (the twin carries its own copies of them). A shelf list that leaves them out marks them off too.
- **Until the Manager's reader is on main,** the marks are on the card but nothing reads them, so every game and maker still shows.

**D359. Speech's install files leave the card after first boot.** *(Claude, from the update worker's finding.)* Once first boot has succeeded and `/opt/arcade/speech/speech.json` exists, `firstboot.sh` removes `seed/speech` (wheels and model, about 291 MB) from the boot partition. That leaves about 397 MB free there instead of about 115.
- **Safe for a re-run:** a failed first boot keeps the files for its retry. A successful one never runs again (`provisioned-version`). Provisioning run again by an update doesn't use the card's copy: `speech.sh` skips what's installed, and fetches from the internet otherwise.

**Rehearsed on 2026-11-14** (throwaway twin: three games, one with a version on its line, a Tester2 game, Tester and Tester2, and a ledger written by the service's own pot code down to 66 coins):
- **Run 11, day-one** (shelf: teti, teti-geoff, rehearsal-dodge):
  - The pot was 100 coins, with one ledger line (the month's refill).
  - Three marks, owned by `arcade`, all via `day-one` by `geoff`: the makers tester and tester2, and the game line tester2-catch. rehearsal-dodge-v2 stays with its line.
  - `makers.json` was unchanged, and all the games' files were carried.
  - Speech's files were removed (291 MB), leaving 397 MB free on the boot partition. First boot exited 0.
- **Run 12, `--from-backup` from the same folder:**
  - Everything as it was: 66 coins, all four ledger lines, no marks.
  - `--day-one` together with `--from-backup` stopped before writing anything.
- Neither run showed the marks taking effect, since the Manager's reader isn't on main yet.
- **The day-one list** (2026-11-14, the director's recommendation, which Geoff accepted; he can change it from the Manager's Games page) is `docs/day-one.json`:
  - Shelf: teti, teti-geoff, the three starters, and three example lines (candy-cat-drop, cloud-popper, log-hopper).
  - Hidden makers: tester and tester2. Pot: full.
  - `flash.mjs --check --day-one docs/day-one.json` checks a file's ids against the live virtual cabinet with the same planner the flash uses, reading only (the twin helper's `manifest` and `read`).
  - Its run on 2026-11-14 found every id. It gave 8 lines on the shelf and 9 off it (bee-buzz, fly-catcher, frog-flicker, fruit-cat-drop, penguin-slide, pepper-bone-catch, rock-rain, shark-chomp, snowball-drop). The twin's 8342-byte ledger stays on the mini.

**D360. "Remove a game" is off the shelf, kept in the records: an append-only mark beside the logs.** *(Geoff, 2026-11-13: "we need a way to delete games in case I want to get rid of the test games"; he chose "Off the shelf, kept in the records". Mechanics by Claude.)*
- The game disappears from the cabinet for the kids, with every version of it. Nothing is erased (D5): its folders, library commits, makes, plays, coin entries and checks all stay, and the twin and the backup keep it. The Manager can put it back, as it was. Grown-ups only: the Manager, or the MCP tools, both behind the Manager's token.
- **On disk:** `/var/lib/arcade/logs/shelf_marks.jsonl`, one JSON object per line, appended, never rewritten: `{"type":"shelf_mark","id":"sm_<base36 time><random>","at":"<ISO UTC>","kind":"game"|"maker","target":"<id>","action":"remove"|"restore","by":"<who>","via":"manager"|"mcp"|…,"reason":"<text>"}`. The last line for a (kind, target) wins. No file means nothing is off, so a new card needs none. The reader accepts any `via`; the day-one card writes `"day-one"` (D356-D358).
- **Why a log and not a field in `cart.json` or `makers.json`:** a cart's files and its git history stay exactly as made, and a log under `logs/` is what the twin sync grows and never replaces (D291), the backup copies (D351) and the data check holds to only growing (D196). So the twin and the backup follow a removal, and a removal can never lose anything.
- `cabinet/service/src/shelf-marks.js`.

**D361. What leaves out a game that's off the shelf, and what keeps it.** *(Claude.)*
- **Left out:** `/api/carts`, the list the launcher reads, so the shelf, "change this game" and each game's best score (`hideCart` in the player, which still logs plays and serves files). A change whose parent is off is refused (409), should an old screen ask.
- **Kept:** the files and library history; every log; the Manager's Activity; `list_carts` and `get_activity` on the MCP server (`on_shelf: false` and `off_shelf` say why); the twin and the backup.
- **A game is a line** (a cart's branch, or the cart itself: the shelf's rule, HANDOFF §2), so one mark covers v1, v2 and on. A version published later to a line that's off stays off.

**D362. A removed game's other versions: a kid's version stays unless removed itself.** *(Claude; answers the director's question 4.)*
- A version another maker made (D206) is its own line, with `parent` pointing at the game it came from. Removing the game doesn't remove it.
- **On the shelf:** it's no longer indented under the game it came from, because that row is gone. The launcher's `families()` already takes the oldest line left in a family as its main row, so the kid's version shows as its own game, with nothing new in the launcher. Putting the game back indents it again.
- **In the Manager:** the Games page says "a version of rock-rain (that one's off the shelf, so this shows as its own game)". `remove_from_shelf` names the versions that stay (`other_versions_stay`).

**D363. Hiding a maker's name from "Who's making?", the same way.** *(Claude; carries out the director's item 2.)*
- A `kind: "maker"` mark, target a `makers.json` id. `/api/makers` leaves the name out of the list "Who's making?" offers. The maker's games stay on the shelf. `makers.json` is never changed (its own `hidden` field stays as it was, for what set it before).
- `/api/makers` now also returns `names`, every maker's name, so a hidden maker's games still read "by Tester2" on the shelf. The launcher's `nameOf` uses it, which also names a grown-up maker's games (D236) properly. That's the launcher's only change.

**D364. The Manager's Games page, and the MCP tools.** *(Claude.)*
- **Games page:** every game line, on or off the shelf, with who made it, how many versions, when it was last played (and how often), and, if off, when, by whom, how (day-one, mcp) and why. **Remove from shelf** asks once in place ("Remove all 2 versions" / "Keep"); **Put back** doesn't ask. Below: the makers, with **Hide name** and **Put back** (grown-ups and names hidden in `makers.json` have no button), and the history of every mark, newest first.
- The Manager asks the cabinet (`/api/manager/games`, `/games/remove|restore`, `/makers/hide|show`, with the Manager's token); the cabinet keeps the marks. A cabinet whose software is older says so and points at the Software tab.
- **MCP:** `remove_from_shelf {id, reason?, by?}` and `restore_to_shelf`, with any cart id of the game; behind the same token as every arcade tool (D341). `shelf_mark` is one of `get_activity`'s types.

**D365. The Manager's Health page (HANDOFF §9.4).** *(Claude, at the director's ask, for Geoff's "are the mini's tools to manage the cabinet built out?")*
- **What it shows:** the CPU temperature, throttling now and since it started (`vcgencmd get_throttled`, decoded: under-voltage, frequency capped, throttled, soft temperature limit), the Wi-Fi network, signal (0-100 and dBm) and band, free space on `/` and the boot partition, uptime, the software version and profile, whether the launcher and kiosk are running, and the last 12 warnings or errors from their journal.
- **How:** `manager/remote/health.py` is sent over the cabinet's SSH each time and run as root (`sudo -n python3 -`). It only reads, so a cabinet needs nothing new installed. What a cabinet doesn't have (Wi-Fi and temperature on the virtual cabinet) is shown as such, never an error. The service's journal isn't the kids' words: those stay in the logs under `/var/lib/arcade`.
- **Warnings** (`manager/health.mjs`), red when to act now: over 80 °C; throttled now (under-voltage says to look at the power supply); under 1 GB or 10% free on `/`; a service not running. Amber: throttled since it started, under 30 MB on the boot partition, a signal under 40% or -70 dBm. A note at 70 °C.

**D366. The speaker's volume from the Manager, kept across restarts.** *(Claude.)*
- A slider on the Health page sets the X HAT's `PCM` softvol control (D253) on card `sndrpihifiberry`, through `manager/remote/control.sh` (sent each time, run as root). The control appears only once something has played through it, so the script plays a second of silence first if it's missing.
- **Kept across restarts** with `alsactl store`, which Pi OS's `alsa-restore` reads at boot. That's the usual Pi OS path; proving it on the Picade is part of C5.
- Above 80% the page says Pimoroni warns 100% is a bit much. It doesn't cap it: the level is Geoff's.
- The virtual cabinet has no sound card, and the page says so.

**D367. Restart the shelf, restart the cabinet, switch off: one confirm each, refused while busy.** *(Claude; reuses D332.)*
- On the Health page. Each asks once in place, and the request must say it was confirmed.
- **Busy is the update's own check:** `control.sh` sources the cabinet's `/usr/local/lib/arcade-update/update-lib.sh` and calls `busy_reason`. So a make running or still to collect, a game being played, or a gate check all refuse with the same reason the update gives ("a game is being played (teti): nothing was changed"). A cabinet whose software predates that file refuses and says to update first.
- **What each does:** restart the shelf is `systemctl restart arcade-launcher arcade-kiosk` (about 10 s). Restart and switch off run `systemctl reboot` or `poweroff` 2 seconds later, so the answer reaches the Manager first.
- After switch off, the Picade comes back only with its power button, and the virtual cabinet only with `scripts/virtual-cabinet/up.sh`. The confirm says which.

**D368. The Manager always on: a launchd agent, installed by a command, not by default.** *(Claude.)*
- `scripts/manager-launchd/install.sh` installs `com.game-studio-arcade.manager`: Node 22 runs `manager/server.mjs --port 8335` from the checkout it's run from, at login, with no window. KeepAlive restarts it if it stops (at most every 10 s). The log is the same `~/game-studio-data/manager/manager.log`. It refuses to run from a worktree, like the backup's (D350). `uninstall.sh` removes it and keeps the key, the tokens and the log.
- **With the agent in place,** `scripts/manager.sh` defers to launchd: `start` says it's on, `stop` points at `uninstall.sh` (KeepAlive would start it again), `restart` is `launchctl kickstart -k`, and `status` and `url` work as before. Installing stops a Manager that `manager.sh` started, so only one holds the port.

**D369. The real cabinet through every Manager page, and a Picade with no config yet can still pair.** *(Claude.)*
- The `real` cabinet takes its host and key from `scripts/cabinet-card/picade-ssh.sh` (D259), through `picade.mjs`: `arcade.local`, the key `flash.mjs` made, as user `cabinet`. Its token is `~/.config/game-studio-arcade/manager-token-real`.
- **The gap this found:** the service read the Manager's token only beside its `--config` file. A new Picade plays offline with no config until `connect-picade.sh` (D252), so pairing would have made a token the service never read: no Coins, Games or MCP. Now, with no config, it reads `/etc/arcade/manager-token`, the file pairing writes.
- **Tested with a stand-in:** `manager/test/fake-ssh.mjs` plays the Picade's SSH on this machine. It holds the connection, forwards the service port, and runs commands against a temp root. The test walks screen, Activity, pairing, Coins, Games, Health and keys (refused while the driver keyboard is off). It checks every call used the Picade's key and `cabinet@arcade.local`, and that a Picade that doesn't answer says why.
- The first-run steps are in `docs/cabinet-bring-up.md`, "The Manager on the real cabinet, first run".

## 2026-11-14 — Everyday power cuts, and the power button (D371-D374)

The kids will switch the cabinet off at the wall, and Geoff accepted that the card has no fallback (D339). So everything the cabinet writes must survive the plug being pulled at any moment. Director's brief, 2026-11-13. Proved in a QEMU rehearsal of the card (D374).

**D371. Every write the family's data depends on survives a power cut whole.** *(Claude; the rehearsal found each of these.)*
- **The cart library's git** runs with `core.fsync=added` and `core.fsyncMethod=fsync`, through the environment, so the family's `.git/config` is never touched. Covered: objects, refs and the index.
  - Before: a cut mid-make left an empty object file, and `git fsck` failed on the whole library.
- **Creating the library:** `git init`'s own files aren't covered by core.fsync, so the library flushes once after it's made. If a cut ever left `.git/HEAD` empty, git sees no repository; the next make puts HEAD back to `main`, touching nothing else.
- **Whole-file writes are fsync-then-rename** (`studio-kit/cli/src/durable.js`): makers, studio state, results, the run journal, gate results, cabinet state, session records, `cart.json`, the kit cache.
  - Before: a session's `playtest.json`, `local-checks.json` and `cart/cart.json` came back empty.
- **Folders another tool writes are flushed before use** (`syncTree`): the cart a session unpacks with `tar`, and the cart copied into the library, including the desktop publish path.
- **Appends flush,** and never glue a new line onto a torn one: the coin ledger, the play, studio, screening, speech and guest logs. A torn last line stays torn and readers skip it. The kit's `readLog` now skips one instead of throwing.

**D372. The power button: a tap does nothing; holding it about 2 s switches the cabinet off cleanly.** *(Geoff, 2026-11-14, through the director: "Tap ignored, hold to switch off"; Claude.)*
- **What the hardware does** (platform notes): the overlay reports the button as `KEY_POWER`. With stock logind a tap powers off. Switching on is the X HAT's own, and it has its own hard cut after about a 3 s hold.
- **logind can't do it:** its long press is fixed at 5 s (`LONG_PRESS_DURATION`, systemd 257), past the HAT's cut.
- **So:** logind ignores the key (`/etc/systemd/logind.conf.d/arcade-power.conf`). `arcade-powerkey` (Picade profile only) watches every device with KEY_POWER and runs `systemctl poweroff` the moment the button has been held 2 s, without waiting for it to be let go. `/etc/arcade/power-button` (`hold=`, 0.5–2.8 s) changes the time.
- **The race** (🔧, bring-up C6): if the HAT cuts at 3 s and a child holds on, the shutdown may not finish. D371 makes a hard cut safe for the data. If the hard cut comes first on the real cabinet, drop the hold to 1–1.5 s.
- No feedback on the screen yet: "let go when the screen goes dark".

**D373. The browser's disk cache lives in RAM.** *(Claude.)* `--disk-cache-dir=/dev/shm/arcade-chromium-cache`, sparing the card writes for files served from 127.0.0.1. The profile stays on the card: it holds the games' saves (the runtime's `g.save()` is localStorage). Those saves aren't in the data check, the twin or the backup. That's a gap worth closing separately.

**D374. Proven: 20 power cuts at random moments, and the button, on a QEMU copy of the card.** *(Director's brief; Claude.)*
- **The power cuts:** `scripts/cabinet-card/test/power-rehearsal.sh DIR [ROUNDS]` switches the rehearsal cabinet to replay with a throwaway Manager token, so makes run with no API and no spend.
  - Each round runs `power-workload.mjs`: makes through to the shelf, coin top-ups, new makers, plays. It pulls the plug 4–53 s in (QEMU quits, nothing flushed), then boots.
  - `power-check.mjs` then needs: the shelf back; every JSON file parsing and none empty; no broken line except a torn last one; the library passing `git fsck --full` with a clean tree; every cart whole and committed; and everything the service ever acknowledged still there (each made cart with its commit and its charge, each top-up, maker and play).
- **Before the fixes:** round 2 broke the library (an empty git object). After the first fix, round 1 found the empty `.git/HEAD`, then a session's empty `cart.json`.
- **After the fixes (2026-11-14): 20/20 pass.** The shelf was back 6–7 s after each boot, and 193 acknowledgements held: 44 carts, 108 ledger entries, 28 makers. Most cuts landed mid-make, because makes take most of the workload's time.
- **The button:** `scripts/cabinet-card/test/button-rehearsal.sh DIR`, 7/7. Through a virtual KEY_POWER device:
  - a 0.3 s tap was logged and ignored;
  - QEMU's own power button (the kernel's power key) was ignored;
  - a 2.5 s hold powered the guest off cleanly, with no ext4 journal replay at the next boot.
- 🔧 **Only the Picade can show** the HAT's 3 s cut against the shutdown (C6).

## 2026-11-14 — The day-one card (SD-card worker)

Geoff chose a clean start for the kids' first switch-on (through the director, 2026-11-13): a full pot, a short shelf, and no Tester names. The "off the shelf" mark is the Manager worker's (D360). Its format was relayed by the director and confirmed with the Manager worker directly: its reader takes any `via`, and `"by": "geoff"` is right.

**D390. A card with no twin data starts the cart library at first boot, with the starters committed.** *(Claude, from the update worker's finding, 2026-11-14. D390-D399 are this worker's block: D356-D359 are used, D360-D369 are the Manager's, and D370-D379 the update worker's.)*
- **The finding:** provisioning copies the three starters into `/var/lib/arcade/carts`, but the library's git repo only appeared with the first make. The service's `ensureLibrary` commits only its README, and a make commits only its own folder, so the starters stayed untracked for good.
- **Wider than unseeded cards:** the virtual cabinet has the same gap today. Its library holds every made game, but apple-catch, comet-dodge and wall-ball are untracked (read-only look, 2026-11-14).
- **The fix (`cabinet/provision/library.sh`, after `step_carts`):** on a cabinet with no library yet, first boot starts it the service's own way, as `arcade`: the same README, the same "Studio" author, and the same first commit ("Start the dev cart library"). Then it commits each starter as `starter <id> v1 (D161)`. The service's `ensureLibrary` then finds the library ready and changes nothing.
- **A library that's already there is left as it is:** a seeded card (the twin's library), the twin itself, or a re-run.
- **Tested:**
  - the commits and their author;
  - `ensureLibrary` changes nothing afterwards;
  - the same README;
  - a seeded library untouched, with its untracked folder still untracked.
- **Rehearsal 13** (a card with no twin data): the log said "3 starters committed". The library had the four commits by Studio, nothing untracked, and `.git` and README owned by `arcade`. First boot exited 0.
- **Not done, offered:** committing the untracked starters in the twin's library, and so on a seeded card too. That's a small change, but it adds commits to the twin's history, which then reach the Picade by seed and come back by sync. Done once on the twin before the flash, both would match. It's the director's call whether to do it.

**D391. The twin's own starters are committed too: `scripts/virtual-cabinet/commit-starters.sh`.** *(The director's yes, 2026-11-14; Claude.)*
- The virtual cabinet's apple-catch, comet-dodge and wall-ball are untracked in its library (D390). This script commits each one the way first boot now does: `starter <id> v1 (D161)`, by "Studio", as `arcade`, over the twin's admin SSH. Then a card seeded from the twin carries their history too.
- **It only adds commits.** A starter already tracked is left alone, so running it again does nothing. `--dry-run` says what it would do and changes nothing. It refuses while a make is running or still to be collected, because the service commits to the same library.
- **Run it before the flash.** After the Picade exists, a commit on the twin is the twin's own and sync sets it aside (D294).
- **Tested** on a stand-in library: the dry run, three commits after the made game's history, a re-run that does nothing, and the refusal during a make.
- **Live dry run, 2026-11-14:** "would commit 3 starters; untracked now: 3". The real run waits for the director to sequence it.

**D392. The flash day, as a walkthrough: [flash-day.md](flash-day.md).** *(Director's ask, 2026-11-14.)* Linked from the checklist, it covers:
1. picade-key.sh;
2. `flash.mjs --check --day-one docs/day-one.json`, then the flash;
3. card in, mic in, power on, first boot;
4. Manager pairing;
5. the hourly backup's install;
6. the first update and `boot-update.mjs adopt`;
7. the kids' first make.

Each step says what Geoff does, what he'll see, and what Claude does from the mini meanwhile, using the current scripts.

**D393. A cable to the router works too: the card asks for wired Ethernet alongside the Wi-Fi.** *(Director's ask, 2026-11-14, before the first flash.)*
- **The change:** the card's `network-config` now has `ethernets: eth0: {dhcp4: true, optional: true}` beside `wifis`. If the Wi-Fi details are wrong or the basement signal is weak, a cable from the router into the Pi's Ethernet port gets first boot online, and the mini finds the cabinet on `arcade.local`.
  - `optional`: no boot waits for a cable.
  - While a cable is plugged in, NetworkManager prefers it (its default route metrics). The Wi-Fi stays the everyday path.
- **What already worked:** every QEMU rehearsal ran wired-only, through NetworkManager's automatic "Wired connection 1" (rehearsal 1 listed it). So a card written before this change, such as Geoff's first, gets the cable fallback the same way. This makes it the card's own request, not a default.
- **Proven:** the unit test checks the block. The wired-only rehearsal of a card with the block was stopped while Geoff's flash ran, so it hasn't run yet; it's the next rehearsal. mDNS from the mini can't be shown in QEMU's user-mode network, only on the home network.
- **flash-day.md** gains "If it doesn't show up on the network", and its adopt line now says what D336 does: one restart of about a minute, with the slot kept only if Wi-Fi and the shelf come back (bring-up F2).

**D420. Every card starts quiet: the speaker at 30%, stored, and a chosen level is never reset.** *(Geoff's ask, 2026-11-14: the X HAT's speaker is far too loud as it comes, and the screen's own volume buttons do nothing for it. Claude.)*
- **One tool, `arcade-volume`** (`cabinet/provision/files/`, installed in `/usr/local/bin`, run as root): `get`, `default`, `set N` (0 to 100), `up` and `down`. It drives the softvol `PCM` control on card `sndrpihifiberry` (D253) and stores each change with `alsactl store`, as the Manager's slider does (D366).
- **`default` sets 30% only when no level is stored** for the speaker's `PCM` control in `/var/lib/alsa/asound.state` (only the speaker's own block: the mic is a sound card too). A stored level is someone's choice, so it's kept.
- **When it runs:** in the picade profile's `hw_late` (`step_volume`, so an update runs it too), and from `arcade-volume-default.service` at every boot, after `alsa-restore` and before the kiosk. The boot run is the one that counts on a new card: at first boot the DAC isn't there until the restart (D250).
- **A card already running** has a stored level if anything has set one (the card worker set 30% by hand on the first Picade), so an update keeps it.
- **`up` and `down` are for the cabinet's own controls (D421):** steps of 10, down to 0, up to a cap of 60. A level above the cap (set from the Manager) only comes down. The cap is a first guess, to tune by ear on the Picade.
- The Manager's `control.sh` is unchanged and still works on a cabinet without the tool.
- **Tested** with stand-ins for `amixer`, `aplay` and `alsactl` (`scripts/cabinet-card/test/volume.test.mjs`). **Not yet proven on the Picade:** that the boot run sets 30% on a new card, and that `alsa-restore` brings a softvol level back after a restart (D366 left that for the hardware too).

**D421. Open, for Geoff: how the volume is changed at the cabinet.** *(Claude proposes; the choice is Geoff's.)* Three options, mocked up for him 2026-11-14. Each shows a small bar for a second and stops at D420's cap.
1. **The two pink buttons (5 and 6) are quieter and louder, anywhere.** Claude's pick: nothing to remember, works mid-game, and house games never see those buttons (D82). It uses up the spare buttons, and they stop counting as "any button picks" (D182).
2. **Hold COIN and push the stick up or down, anywhere.** Keeps the pink buttons spare. A hidden combination, the stick still moves the player mid-game, and COIN on the shelf would open the pot on letting go.
3. **A Sound tile on the shelf.** Visible and labelled, but only from the shelf, and the largest change to the launcher.
