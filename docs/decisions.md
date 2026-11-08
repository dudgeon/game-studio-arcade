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

**D20. TypeScript 6 (pure JS) for type-checking; no bundler.** *(Claude, scaffolding+runtime worker; implements Phase 0 task 0.)*
- The repo is plain ES modules on Node 22. TypeScript only type-checks JS (`tsc --checkJs`, `noEmit`) against hand-written `.d.ts` files. Nothing is compiled, so `npm run build` leaves `git status` clean.
- Pinned to `typescript@6.0.3`, not 7.x. TypeScript 7 is the native compiler and installs one platform binary, so a kit packed on the mini (darwin-arm64) wouldn't run in the x86 sandbox or on the Pi. 6.x is pure JS and runs anywhere offline.
- Root `npm test` = type-check, then each workspace's `node:test` suite.

**D30. The `spec.md` line format, rule ids, and how `checks.js` is read.** *(Claude, Phase 0 task 4; settles the §7 details.)*
- The title line is `# <Title>`, followed by one byline: `maker: <initial> · with: <initial or —> · parent: <cart@version or —> · session: <id or —>`. `cart.json` stays the machine record; the byline is for people.
- Sections are `##` headings in the order Pitch, Rules, Controls, Look & sound, Assumptions, Changelog. A missing or out-of-order section is an error. An unknown section is kept as written and reported as a warning.
- A rule is one list item: `- R<n> (auto): <text>` or `- R<n> (you check): <text>`. Indented lines continue the rule. Assumptions are `- A<n>: <text>`; changelog entries are `- v<n>: <text>`.
- Ids are stable for the life of a cart and its forks: never renumbered, never reused. A removed rule leaves a gap, and the Changelog says why. A fork adds rules after the parent's highest id.
- `checks.js` must be self-contained (no `import`); everything it needs comes through the test handle `t`. `validate_cart` reads its keys by importing it in a child Node process with the permission model on (read access to the cart folder only, no child processes or workers) and a 5-second timeout. Node 22's permission model doesn't block the network, so this limits, not seals; the playtest harness is where checks really run.
- Coverage rules: every `auto` rule needs a check (error); a check with no matching rule, or on a `you check` rule, is an error too, since it means the spec and checks have drifted.
