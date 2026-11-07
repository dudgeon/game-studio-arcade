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
