# game-studio-arcade

A basement arcade cabinet (Raspberry Pi 5) that builds its own games. **The Studio makes the games; the Arcade plays them.** Owen (13) and Alina (10) pick Make on the game shelf, say what they want, answer Claude's questions with the joystick, and a new game lands on the shelf. The learning goal is working with an agent (state intent, define requirements, check them, adjust), not learning to code.

Full brief: [docs/HANDOFF.md](docs/HANDOFF.md). Decision log (wins over the brief): [docs/decisions.md](docs/decisions.md). Verified platform facts: [docs/platform-notes.md](docs/platform-notes.md). Current phase plan: [docs/phase-0.md](docs/phase-0.md).

## Vocabulary

- **Studio**: everything that makes games: Studio sessions, the studio kit, and its front ends (cabinet MAKE flow, Claude Code on the Mac mini, later a browser). Never "Forge".
- **Arcade**: everything that plays games: cabinet, launcher, shelf, players, play telemetry.
- **Cabinet-initiated**: a kid makes or forks a game at the cabinet, solo. The core workflow.
- **Desktop-initiated**: Geoff, with a kid, builds in local Claude Code on the Mac mini and publishes to the cabinet.
- **Cart**: one game. A folder with `spec.md`, `cart.json`, `game.js`, `assets/`.
- **Studio kit**: shared rules and building blocks for every Studio session (spec format, context pack, playtest harness, tools, Claude Code plugin, Managed Agents definitions).
- **House runtime**: our small JavaScript fantasy console (SDK + starter library).
- **Cabinet service**: the single long-running process on the Pi, with an Arcade side and a Studio side.
- **Cabinet Manager**: local web app on the Mac mini (simulator, carts, activity, health, updates).
- **Virtual cabinet**: a second, complete cabinet in an isolated VM on the mini: same OS, script, service, launcher and runtime as the Pi, its own data and API identity ([docs/virtual-cabinet.md](docs/virtual-cabinet.md), D120–D129). Not the Manager's simulator (a quick browser cart player).
- **Shelf**: the launcher's game list; latest version of each branch.
- **Tiles**: the four answers to a Studio question: A, B (Claude's options), C "Something else" (mic), D "Make it now".
- **Publish gate**: the cabinet re-running a cart's playtest before it reaches the shelf.
- **Quarter Deck**: placeholder console name. A config value only; never an identifier, hostname or path.

## Locked decisions (HANDOFF §3.1; propose changes explicitly, don't drift)

- Repo/project name `game-studio-arcade`; "Studio" everywhere.
- **Cabinet independence**: the Pi serves and plays every game locally and works with the Mac mini off. The mini is never in the play path or the cabinet-initiated build path, and the cabinet never uses the mini's resources. The virtual cabinet (D129) leaves this unchanged for the real cabinet: its own independence is logical, since it runs on the mini's hardware.
- Cabinet-initiated builds run in **Claude Managed Agents** (API, commercial terms). Desktop-initiated builds run in local Claude Code on Geoff's account with Geoff present, not through Managed Agents.
- Desktop experience: a Claude Code project that knows the runtime, library and conventions; finds and builds on existing carts; iterates spec → build → test, including in a local browser with keyboard as joystick; imports outside assets; publishes to the cabinet.
- **Cabinet Manager** is a local web app on the mini, not a native Mac app.
- The **MCP server lives on the cabinet**, inside the cabinet service; desktop Claude Code connects to it.
- Cabinet software: Raspberry Pi OS Lite booting to our launcher; one cabinet service; image built by a reproducible script; updates via the Cabinet Manager after first flash.
- Question tiles: A/B by Claude, C opens the mic, D ends questioning and Claude fills gaps. No question cap.
- **Spec first**: each cart's `spec.md` is the source of truth. Turns update the spec; code is generated from it; the playtest checks its rules; forks start from the parent's spec.
- **Never delete data**: persist every version; show latest per branch.
- **Logging from day one**: every kid–Studio turn attributed to its cart, plus play telemetry.
- Tested starter library + lean context pack. Don't overspecify.
- Speech off the mini: Groq Whisper Large v3 Turbo primary, Moonshine on the Pi as backup/offline. Bake off with the kids' voices first.
- House JS runtime; guest players TIC-80, PICO-8, RetroArch homebrew. No MakeCode.
- Inspired-by games only (e.g. Alina's falling-blocks game: no Tetris name or look).
- No approval loop; the activity log is the oversight.
- Existing home mesh Wi-Fi; no Ethernet.
- Hardware: prebuilt only if it ships with a Pi 5; otherwise DIY/kit.
- Cabinet: Pimoroni Picade 10" (1024×768, one player's controls) + Pi 5 8 GB, ordered 2026-11-07 (D80). Screen 256×192 at 4× (D81). Games default to single player, with turns well supported; the controller count is a setting (D85). No physical MAKE button; the Studio starts from the launcher/shelf (D86). Back to the shelf is ESC/Escape, the guest players' default (D88). The mic is a USB mic, Geoff's pick (D89).

## Working agreements

- Spec-first here too: decisions land in `docs/` (and `docs/decisions.md`) before code; keep the brief current.
- Never put the Mac mini in the play path. Never delete cart data; append versions.
- No secrets in git. On the mini, API auth is the `ant` CLI login, profile `game-studio-arcade` (D16). Re-check it with `scripts/setup-anthropic-auth.sh`. Never set `ANTHROPIC_API_KEY` on the mini: it silently overrides the profile. Each cabinet (virtual, then Picade) has its own workspace-scoped API key in its cabinet service config file (0600), read by the service, never an env var on the mini (D131). Credentials never go in git, the launcher, carts or logs.
- The kids' transcripts and logs never enter this repo. No raw audio stored anywhere.
- Check current docs for Anthropic products (Managed Agents, Claude Code plugins) rather than memory; Managed Agents is beta.
- Verify prices, stock and links live before writing them down.
- Resolve questions from context and docs first; ask Geoff when the decision is his.
- Build, test and publish on the Mac mini; no GitHub Actions/CI.
