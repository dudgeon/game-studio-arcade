> **Status (2026-11-07):** saved from the kickoff, then updated for the switch to the 10" Picade (D80–D84: hardware, screen size, controls, open questions), then for Geoff's player and MAKE answers (D85, D86) and the Make flow details (D87), back to the shelf and the mic (D88, D89), and the virtual cabinet (D120–D129). Later decisions are in [decisions.md](decisions.md) and verified platform facts in [platform-notes.md](platform-notes.md); where they disagree with this brief, they win.

# game-studio-arcade — Handoff Brief

Written Nov 7, 2026 from two planning sessions (text and voice) between Geoff and Claude.

## 1. What we're building

A small arcade cabinet in Geoff's basement that builds its own games. **The Studio makes the games; the Arcade plays them.**

Milo and Ivy walk up, pick "Make a new game" on the game shelf, say who's making, hold a button and say what they want to play, and answer Claude's questions with the joystick. A few minutes later a new game is on the shelf. They can fork any game ("change this") to make a new version. Bigger projects happen at the Mac mini in a normal Claude Code session with Geoff, then get published to the same cabinet.

**Learning goal.** Not teaching the kids to code. Teaching them to work with an agent: state intent, define requirements, check that the agent met them, then change the approach or change the requirement. Kid-editable code (blocks, MakeCode) is explicitly not a goal.

**People and machines.** Geoff (GitHub: `dudgeon`) develops on an always-on Mac mini (Apple silicon, 32 GB) in his office. The cabinet is a Pimoroni Picade (10" display) with a Raspberry Pi 5 8 GB, both ordered 2026-11-07 (D80), in the basement on the home mesh Wi-Fi.

## 2. Vocabulary

- **Studio**: everything that makes games. Studio sessions (an agent building or forking a cart against its spec), the studio kit, and the Studio's front ends: the cabinet's Make flow, Claude Code on the Mac mini, and later a browser front end. Replaces the earlier name "the Forge".
- **Arcade**: everything that plays games: the cabinet, launcher, shelf, game players, play telemetry.
- **Cabinet-initiated**: a kid makes or forks a game at the cabinet, solo. The core workflow.
- **Desktop-initiated**: Geoff, with a kid, builds or changes a game in local Claude Code on the Mac mini and publishes it to the cabinet.
- **Cart**: one game. A folder with `spec.md`, `cart.json`, `game.js`, `assets/`.
- **Studio kit**: shared rules and building blocks for every Studio session: spec format, context pack, playtest harness, tools, the Claude Code plugin, the Managed Agents definitions.
- **House runtime**: our small JavaScript fantasy console (SDK plus starter library). Ships on the cabinet; used by every playtest.
- **Cabinet service**: the single long-running process on the cabinet's Pi, with an Arcade side and a Studio side.
- **Cabinet Manager**: local web app on the Mac mini: simulator, carts, activity, cabinet health, updates.
- **Virtual cabinet**: a second, complete cabinet in an isolated VM on the Mac mini, running the same OS, provisioning script, cabinet service, launcher and runtime as the Pi, with its own cart library, logs and API identity ([virtual-cabinet.md](virtual-cabinet.md), D120–D129). Not the Manager's simulator, which is a quick cart player in a browser for iterating on one game.
- **Shelf**: the launcher's game list. Shows the latest version of each branch.
- **Tiles**: the four on-screen answers to a Studio question: A, B, C, D.
- **Publish gate**: the cabinet re-running a cart's playtest before it reaches the shelf.
- **Quarter Deck**: placeholder console name. Must be a config value (the kids will rename it). Never use it as an identifier.

## 3. Decisions

### 3.1 Locked (Geoff decided)

- **Names**: repo and project are `game-studio-arcade`. "Studio" replaces "Forge" everywhere.
- **Cabinet independence**: the Pi serves and plays every game locally. Play never touches the Mac mini, and the cabinet must never consume the mini's resources. The cabinet works with the mini switched off.
- **Cabinet-initiated builds**: Studio sessions run in Claude Managed Agents (Claude API, commercial terms). Minimize Mac mini involvement, ideally zero. Cost is secondary.
- **Desktop-initiated builds**: local Claude Code on Geoff's account, with Geoff present or operating. Not routed through Managed Agents.
- **Desktop experience**: a new Claude Code project knows the runtime, library and conventions; can find and build on existing carts; iterates spec, build and test, including in a local browser with the keyboard standing in for the joystick; can pull in outside assets such as an image found online; then publishes to the cabinet, where the cart can be played and forked like any other.
- **Cabinet Manager**: a local web app on the Mac mini, not a native Mac app. Simulator, cart library with push/pull/launch, activity dashboard, cabinet health, "update cabinet software". Goal: take a game as close to end to end as possible without walking to the basement, with no pile of CLI tools for cart management.
- **MCP**: the MCP server lives on the cabinet, inside the cabinet service. Desktop Claude Code connects to it.
- **Cabinet software**: Raspberry Pi OS Lite, booting straight to our launcher as the main screen. Emulators and guest players launch from it. One cabinet service. The whole image is built by a script and is reproducible. After the first flash, updates come from the Cabinet Manager, not reflashing.
- **Question tiles**: keep the AskUserQuestion mental model. A and B are written by Claude. C "Something else" opens the mic for spoken direction. D "Make it now" ends questioning, and Claude fills the gaps with sensible assumptions. Mostly multiple choice. No cap on the number of questions; tune later. D is the escape hatch.
- **Workflow**: spec first. Each cart keeps a durable `spec.md` as its intent artifact. Conversation turns update the spec; code is generated from the spec; the playtest checks the spec's rules; forks start from the parent's spec. The spec is the source of truth and survives lost context.
- **Versioning**: never delete data. Persist every version's artifacts. Show only the latest version of each branch and collapse older ones. Expanding a branch and returning to a checkpoint comes later.
- **Logging**: required from day one. Every kid–Studio turn, attributed to the cart it produced, plus play telemetry, so we can see which prompts led to which games and whether those games get played.
- **Building blocks**: a tested starter library and a lean context pack, so common mechanics (collision, which object destroys which) aren't re-derived every build. Don't overspecify; the joy is in totally different game ideas.
- **Speech**: not on the Mac mini; low latency is critical. Primary: Groq Whisper Large v3 Turbo. Backup and offline: Moonshine on the Pi 5. Test both with the kids' voices before committing.
- **Runtime**: house JavaScript console. Guest players: TIC-80, PICO-8, RetroArch for homebrew, each as a web player in the kiosk (D380–D389; TIC-80 and RetroArch built with six games on the shelf, PICO-8 proven; the shortlist is in [guest-players.md](guest-players.md)). MakeCode is out.
- **Game sources**: homebrew and fantasy-console games, plus kid-built "inspired-by" games. Ivy asked for Tetris; it becomes her own falling-blocks game, with no Tetris name or look.
- **Approval**: no approval loop. Kid-made games go straight to the shelf. May revisit.
- **Network**: the cabinet works on the existing home mesh Wi-Fi. No Ethernet and no console-specific network gear.
- **Console name**: configurable and not critical path. Placeholder: Quarter Deck.
- **Hardware rule**: buy prebuilt only if it ships with a Pi 5. If it would need a board swap, go DIY or kit. Control brand doesn't matter much. Small, tabletop or wall-hung.

### 3.2 Proposed (Claude's suggestions; confirm or improve)

- The Arcade and Studio split of the cabinet service in §4.
- A "Here's the plan" screen after questions: the spec's rules in plain words, with build or change.
- The runtime limits in §7.
- The `ask_player` custom tool in §9.1.
- Default build model `claude-sonnet-5-5`, compared against `claude-opus-5-5` in Phase 0.
- A per-build spending cap via Managed Agents session budgets, set from Phase 0 data.
- Screening each request with a small, fast model before a build starts.
- Nightly backup of the cabinet's cart library to a private GitHub repo.
- Every game passes the publish gate on the cabinet before the shelf: its auto rules in the cabinet's own Chromium, at low priority, never during play (D310-D313). Desktop publishes too, once MCP exists.
- No raw audio stored; transcripts are kept.
- Optional quiet hours: make and fork off, play on.
- TypeScript and Node across runtime, service, launcher and Manager.
- The repo layout in §6, interfaces in §9, library list in §10.

### 3.3 Open

- ~~Which cabinet (§13).~~ Picade 10" + Pi 5 8 GB, ordered 2026-11-07 (D80).
- ~~Second player~~: games default to single player, with turns well supported; the controller count is a setting; external controllers later (D85).
- ~~The MAKE (★) button~~: no physical button assumed; the Studio starts from the launcher/shelf (D86).
- The mic: a USB mic, Geoff is choosing one (D89). No external USB on the case.
- ~~Opened by D86~~: hold a button to talk, a "Make a new game" tile, and an open list of makers (D87). ~~How a kid gets back to the shelf from a game~~: press ESC (Escape), the guest players' default (D88).
- Speech bake-off results.
- Default build model and per-build cap.
- Starter library v1 contents.
- A kid-friendly spec view (roadmap; readable without dumbing it down).

## 4. Architecture

```
CLOUD
  Groq: speech to text (Whisper v3 Turbo)       <- audio from cabinet
  Claude Managed Agents: Studio sessions        <- sessions from cabinet
    agent + environment defined in this repo
    studio kit attached to each session
    playtest on the preinstalled Playwright + Chromium
  GitHub (private): nightly cart-library backup <- from cabinet

CABINET  (Raspberry Pi 5, basement, mesh Wi-Fi)
  Launcher (full-screen browser): shelf, Make flow, tiles
  House runtime (browser) | native RetroArch, TIC-80, PICO-8
  Cabinet service
    Arcade side: local web server, git cart library, play log,
                 MCP server, Manager API, backup
    Studio side: session orchestrator, tile relay (ask_player),
                 guardrails, publish gate
  Controls: 1 stick, 6 buttons, 4 utility buttons (X HAT, as a keyboard;
            D82), mic; controller count is a setting, 1 today (D85);
            Make is on the shelf, no button (D86)

MAC MINI  (office)
  Cabinet Manager (local web app) -> cabinet Manager API
    simulator, carts, activity, health, updates
  Claude Code (Geoff's account) + game-studio plugin -> cabinet MCP
    local dev server, local playtest, asset import
  Virtual cabinet (isolated VM, D120-D129): the same cabinet stack as
    the Pi, own data and identity; reached only over the network,
    like the real cabinet (Manager API, arcade MCP)
```

Placement rules:
- If the kids are only playing, only the cabinet is active.
- A Wi-Fi drop slows a build or delays a log sync. It never stops a game.
- The Mac mini is never in the cabinet's play path or its cabinet-initiated build path.
- The virtual cabinet runs on the mini's hardware, so its independence is logical, not physical: no mini software is in its play or build path, but it can't run with the mini off. The rules above still govern the real cabinet unchanged (D129).

## 5. Platform facts (checked Nov 7, 2026; re-verify, Managed Agents is in beta)

- Beta header `managed-agents-2026-04-01` on all requests; the SDKs add it.
- An agent is a Markdown file with YAML frontmatter (name, model, tools, system prompt), created with `ant apply`. An environment is a YAML file applied the same way. IDs land in `claude-lock.json`. Environments aren't versioned, so keep both files in git.
- Built-in toolset `agent_toolset_20260401`: bash, read, write, edit, glob, grep, web_fetch, web_search. Disable the web tools for Studio sessions.
- Events stream over SSE. Send `user.message`; receive `agent.message`, `agent.tool_use`, `session.status_idle`.
- **Questions to the player**: Managed Agents has no AskUserQuestion. Use a custom tool (`type: custom`, with `input_schema`). The agent emits `agent.custom_tool_use` (`id`, `name`, `input`). The session goes `session.status_idle` with `stop_reason.type: requires_action`. The client replies with `user.custom_tool_result` (`custom_tool_use_id`, `content`). No answer timeout is documented. Runtime is billed only while the session is running, so waiting for a kid is free.
- **Cloud sandbox**: Ubuntu 24.04, x86_64, up to 8 GB RAM, up to 10 GB disk. Node 20/21/22 (22 default). Playwright (Node and Python) with Chromium preinstalled at `/opt/pw-browsers`; `PLAYWRIGHT_BROWSERS_PATH` is set. Use the preinstalled Playwright, because installing another version breaks the browser lookup. Pin the local playtest harness to the sandbox's Playwright version.
- **Networking**: `type: limited` with no `allowed_hosts` means no outbound network, and attached files stay available. `packages` (apt, npm, pip…) need `allow_package_managers: true` and are cached per environment. With Node, Playwright and Chromium preinstalled, Studio sessions can likely run fully offline.
- **Files**: upload with the Files API, then mount through session `resources` (`type: file`, `file_id`, optional `mount_path`; lands under `/mnt/session/uploads/`). Max 500 files per session; mounts are read-only; archives can be extracted with bash, so ship the studio kit and parent carts as tarballs. The agent writes outputs to `/mnt/session/outputs/`; list them with `files.list(scope_id=<session id>)` plus the beta header, then download. Outputs can lag a few seconds after the session goes idle.
- **Budgets**: a per-session hard dollar cap: `budget: {type: "limit", max_list_cost: {amount: "<whole cents>", currency: "USD"}}`. At the cap the session idles with `stop_reason: budget_reached` and can be raised or resumed. There are no session-level token or turn caps, so we enforce turn limits ourselves if we want them.
- **Pricing**: runtime $0.08 per session-hour while running. Sonnet 5.5: $2 in / $10 out per million tokens (cache read $0.10). Opus 5.5: $4 / $20 (cache read $0.20). Groq `whisper-large-v3-turbo`: $0.04 per hour of audio. Rough guess: $0.50–$2 per new game, forks less. Measure it.
- **Accounts**: Claude consumer products, including Claude Code on Geoff's login and Claude Code cloud sessions, are 18+ with no parental-consent path. The kids never use Geoff's login solo. Cabinet solo use goes through the API and must follow Anthropic's Guidelines for Organizations Serving Minors (disclose AI, age-appropriate safeguards). Claude Code Remote Control needs a claude.ai subscription login, so it only applies to desktop sessions.

## 6. Repo layout (proposed)

```
game-studio-arcade/
  CLAUDE.md
  docs/HANDOFF.md      this brief
  docs/decisions.md    running decision log
  runtime/             house console: SDK + starter library
  studio-kit/
    spec/              spec.md template, guide to writing checkable rules
    context-pack/      short catalog, guides read on demand, 4 templates and a blank start (D160, D161)
    playtest/          Playwright harness: scripted input, frames, per-rule JSON report
    tools/             new_cart, validate_cart, import_asset
    managed-agent/     agent .md, environment.yaml, kit packaging, claude-lock.json
  cabinet/
    service/           Arcade side + Studio side; launcher/ inside it is the cabinet screen's UI (D180, D183)
    image/             reproducible Pi OS Lite build: kiosk, systemd, players
  manager/             Cabinet Manager web app + menu bar launcher
  game-studio/         Claude Code plugin "game-studio" (plugin/: skill build-cart, servers arcade + studio; src/: their code; D347)
  carts-examples/      Falling Blocks and other seed carts
```

The live cart library is its own git repo on the Pi, not part of this repo. The kids' transcripts and logs stay on the cabinet and its private backup, never in this repo.

## 7. Cart format

```
carts/sloth-snacks/
  spec.md        source of truth
  cart.json      id, title, maker, with, parent (cart@version or null),
                 session_id, origin (cabinet|desktop), players, created,
                 version and, when its maker named it, version_name (D472)
  game.js        house runtime: init / update / draw
  assets/        sprites and sounds in house palette and sizes
  playtest.json  last report: per-rule pass/fail, fps, errors
```

`spec.md` sections:

```md
# <Title>          maker · parent · session
## Pitch           one or two sentences
## Rules           R1..Rn, each checkable by the playtest
## Controls        stick + A B X Y per player, START; ★ is reserved for the cabinet
                   (single player by default; turns when more play, D85)
## Look & sound
## Assumptions     A1..An: Claude's gap-fills, especially after "make it now"
## Changelog       v1, v2…: what changed in the spec and why
```

Runtime limits (proposed; now 256×192 and 32 colors, D3 and D81), enforced by the SDK so anything that runs in the simulator runs on the cabinet: 256×240, a fixed 16-color palette, the cabinet's buttons only, a 4-voice chip synth, no network, no DOM access, persistence only through `g.save()`.

## 8. Flows

### 8.1 Cabinet-initiated: new game

1. The kid picks the "Make a new game" tile on the shelf and says who's making: a known name, or a new one (D87). On the "tell me" screen they hold a player button, talk, and let go to send (D87). The Pi records only while the button is held, sends the audio to Groq, and shows the transcript for confirmation (retry allowed).
2. The Studio side screens the request, then creates a Managed Agents session with the kid brief, context pack, studio kit tarball and spending cap.
3. Claude calls `ask_player`. The tile relay renders A and B plus C and D (C: hold a button and talk, D87). Each answer becomes a spec line. Repeat until Claude is satisfied or the kid picks D.
4. (Proposed) "Here's the plan": the spec's rules in plain words; build, or change a rule.
5. Claude writes code from the spec. The playtester checks every rule; Claude fixes and retests. The cabinet shows progress in kid language, and the kid can play something else meanwhile.
6. On pass, the cabinet service downloads the outputs, validates them, commits the cart, and puts it on the shelf with the maker's initial. Play is local from then on.

### 8.2 Cabinet-initiated: fork

1. The kid selects a cart and chooses to change it (D87 keeps "pick a game, then change it"; the exact button is set with the launcher), then says who's making.
2. A new version is created with maker, parent pointer and originating session. The original is never modified.
3. The kid states the change. The session gets the parent's spec, code and original conversation, and asks only about what's ambiguous, with the same tiles.
4. Claude edits the spec first, then the code, reusing library pieces. When the plan is agreed and the change is the maker's own next version, Claude asks what to call it on the same tiles: two names, "Something else" to say one, and D as "You pick" (D471). The name shows in place of "v3"; the number stays as the order (D472, D474).
5. The playtest runs the new rules and every inherited rule.
6. On pass, the fork appears under its parent. On repeated failure: a plain-language message, the original untouched, and the attempt kept in the logs (spec, code, report).

### 8.3 Desktop-initiated

1. Geoff and a kid start Claude Code in a new cart project with the `game-studio` plugin.
2. Optionally pull an existing cart from the cabinet (`arcade.get_cart`, `into` a folder) and build on it.
3. Iterate `spec.md`, then code, then `studio.playtest`. Play it with `studio.play` in a local browser with the keyboard (or in the Cabinet Manager's simulator). Import found images with `studio.import_asset`.
4. Publish with `arcade.publish_cart` (`dir` the folder): cart, lineage, session summary, `origin: desktop`. The cabinet validates it and re-runs the playtest (the publish gate) before it reaches the shelf, as a new version (D343).
5. `arcade.launch_on_cabinet` opens its how-to-play screen on the cabinet, only while the cabinet is on its shelf (D344).

## 9. Interfaces (first sketch; refine in Phases 0–1)

### 9.1 `ask_player` custom tool (Studio sessions)

```yaml
- type: custom
  name: ask_player
  description: >
    Ask the player one short multiple-choice question about the game.
    Give exactly two options. The cabinet adds "Something else" and "Make it now".
  input_schema:
    type: object
    properties:
      question: { type: string, description: "Short, kid-friendly; fits one screen line" }
      option_a: { type: string }
      option_b: { type: string }
    required: [question, option_a, option_b]
```

Result content (JSON text): `{"choice":"A"}`, `{"choice":"B"}`, `{"choice":"C","said":"<transcript>"}`, or `{"choice":"D"}`. **D means: ask no more questions in this build; record assumptions in the spec and build.**

The Studio agent has three more custom tools (D41, D471): `show_plan`, `tell_player`, and `name_version` (`option_a`, `option_b`, `pick`), which asks a version's name on the same board, with D reading "You pick". Its result carries the name: `{"choice":"A","name":"Faster logs"}`.

### 9.2 Arcade MCP server on the cabinet (name: `arcade`)

`list_carts`, `get_cart(id, ref)`, `publish_cart(bundle, parent?, maker, with?, summary)` (runs the publish gate), `launch_on_cabinet(id)`, `get_activity(filter)`, `cabinet_status()`.

Built (D340-D344): `POST /mcp` inside the cabinet service, on its loopback port, behind the Manager's pairing token, and reached only through the mini's SSH (the Manager's connection). On the mini, the plugin's `arcade` server is a bridge that adds `get_cart(into)` and `publish_cart(dir)` for local folders.

### 9.3 Studio plugin tools on the Mac mini (`game-studio`)

`studio.new_cart(from?, id, maker, with?)`, `studio.playtest(path, rules?)`, `studio.import_asset(file, size)`, `studio.validate_cart(path)`. The `build-cart` skill explains working spec-first on a cart.

Built (D346): the `studio` server's `new_cart`, `playtest`, `import_asset` and `validate_cart` (Claude Code shows them as `mcp__plugin_game-studio_studio__<tool>`), plus `read_kit` (the context pack) and `play` (a local browser, keyboard as joystick).

### 9.4 Manager API (cabinet service to Cabinet Manager)

Carts list/pull/push, launch, activity query, health (online, Wi-Fi signal, software version, last backup, builds today and cost), software update. Paired once with a shared token. Use a stable hostname not tied to the console name, e.g. `arcade.local`.

### 9.5 Logging schema (minimum)

- `studio_session`: id, origin, maker, with (maker ids from the cabinet's `makers.json`, guests included, D87), request transcript, turns `[{question, option_a, option_b, choice, said}]`, ended_by (`answers` or `make_it_now`), spec diff, playtest results, list cost, outcome.
- `cart_version`: cart_id, version, parent, session_id, commit sha, created.
- `play`: cart_version, player side, start, duration, early_quit.

The Manager's Activity view joins these: request → session → cart version → plays.

## 10. Starter library v1 (proposed; confirm)

Collision (overlap, plus who destroys whom); gravity, jump, platforms; grid movement and rotation; tile maps and a scrolling camera; spawners and waves; particles; timers and tweening; score, lives, high scores; title → play → game-over flow; turn taking for more than one player, built for any number of controllers (D85); chip-synth sound effects and jingles; sprite and palette helpers.

Context pack (D160–D166): a short catalog the agent always reads, modules and guides it fetches only when a game needs them, and four tested templates plus a blank start. Keep it lean. Use the logs to promote helpers Claude keeps rewriting.

## 11. Safety and kids

- Disclose AI on the first make screen ("I'm Claude, an AI").
- Studio sessions: one cart in scope, web tools disabled, no network, a spending cap per build.
- Kid brief in the agent's system prompt: audience the two kids, content rules, plain voice.
- Screen each request before starting a session; redirect off-limits ideas with a friendly alternative.
- Keys (Anthropic, Groq) live only in the cabinet service's config. Never in the launcher, carts, logs or git.
- No approval loop, by decision. The activity log is the oversight mechanism.
- Review Groq's data-retention settings before sending the kids' audio. Don't keep raw audio.

## 12. Day-one library

PICO-8 community carts, TIC-80 Surf mode, and freely distributable homebrew under RetroArch. Famous 8-bit games become first build prompts: falling blocks (Ivy's), a platformer, an aim-and-shoot, a top-down adventure.

## 13. Hardware (prices checked live Nov 7, 2026)

**Chosen and ordered 2026-11-07 (D80): Pimoroni Picade with 10" display ($349.95, PiShop US) + Raspberry Pi 5 8 GB ($175.00, PiShop US).** 10" 1024×768 IPS (4:3), one player (joystick, 6 player buttons, 4 utility buttons), Picade X HAT for controls, sound and USB-C power, desk-sized (310 × 260 × 250 mm). Still needed: a USB-C supply (5 V/5 A), an Active Cooler, a microSD card and a USB mic. Details in [platform-notes.md](platform-notes.md#picade-10-inch-2025-edition).

The shortlist before the switch, kept for the record:


1. **Quarterless 24" Wall Arcade — $1,099**, free shipping. Raspberry Pi 5, 128 GB microSD, 24" monitor, 2 players, French cleats or bartop, 23" W × 11.5" D × 24.5" H, 45 lb, 2 external USB ports, built-in speakers, lit marquee. Made to order, ships in 5–7 business days, 1-year parts warranty. Joystick brand not stated; reviews mention bat-top sticks and lit buttons. Ships with a large preloaded library (reviews say Batocera); we flash our own card and keep theirs in the box. A 27" version is $1,295.
2. **Pimoroni Picade Max kit — $569.95** at PiShop US (in stock), $561 at Pimoroni US. No Pi included. 19" 1280×1024 IPS (5:4), 1–2 players, designed for the Pi 5, bartop only. Add a Pi 5 (PiShop, in stock: 4 GB $110, 8 GB $175) and a microSD card: about $680–$745.

Dropped: Ourcades (its two-player cabinet now lists at $2,149). Either way, add a MAKE button per side and a USB mic. (The Max was chosen first, D2, then replaced by the 10" Picade, D80. MAKE buttons were later dropped, D86.)

## 14. Build plan

**Phase 0 — spike (a weekend).**
- `runtime/` v0: fixed-resolution canvas, input mapping (keyboard and gamepad), sprites, text, simple sound.
- The library pieces Falling Blocks needs: collision, grid and rotation, score, game flow.
- `studio-kit/spec` template, and a rule format the playtest can check.
- `studio-kit/playtest` on Playwright, pinned to the sandbox's version: headless load, scripted and random input, frame capture, per-rule results as JSON.
- `studio-kit/managed-agent`: agent and environment files (limited networking, no hosts), `ask_player`, kit tarball upload, session budget.
- A CLI driver that plays the cabinet's role: it prints each question and Geoff types A, B, C or D.

*Done when:* Falling Blocks exists as `spec.md` plus `game.js`, every rule passes, it plays in a browser with the keyboard, real cost per build is recorded, and Sonnet 5.5 vs Opus 5.5 has been compared once. Stretch: one fork ("make it lava") end to end.

**Phase 1 — cabinet service and Cabinet Manager (2–3 weekends), in the virtual cabinet.** Develop and run the service in the virtual cabinet on the mini (virtual-cabinet.md steps V0–V2; production play on the real cabinet never depends on the mini): launcher, local server, git cart library, tile relay, logs, MCP, Manager API. Manager v0: simulator, carts, activity, push. The publish gate drives the system Chromium over its DevTools pipe, with no Playwright, at low priority and deferred while a game is being played (built 2026-11-13, D310-D313; speed still needs the Pi).

**Phase 2 — hardware bring-up (on arrival).** Hardware ordered 2026-11-07 (D80). The software already runs in the virtual cabinet on the same script, so this phase is the hardware layer (virtual-cabinet.md V3): assemble the Picade (check the edition, fit the Active Cooler), the same script with the `picade` profile on a new card, the overlay and key map (D82, D83), the X HAT's DAC and speaker, the panel and power button, the USB mic in the case (D89), basement Wi-Fi, Manager pairing, the day-one library, and calibrating the publish gate against the virtual cabinet (D128).

**Phase 3 — voice and kid builds (2 weekends).** Groq vs Moonshine bake-off with both kids' recordings; guardrails; first real cabinet-initiated builds and forks.

**Phase 4 — desktop flow (ongoing).** `game-studio` plugin, asset import, publish gate; first joint game with Milo.

**Later.** Kid-friendly spec view, checkpoint browser, a browser front end for the Studio, optional approval toggle, per-cart tuning knobs.

## 15. Working agreements for Claude in this repo

- Work spec-first here too: decisions land in `docs/` before code, and this brief stays current.
- Treat §3.1 as settled. To change a locked decision, propose it explicitly to Geoff; don't drift.
- The cabinet must work with the Mac mini off. Never put the mini in the play path.
- Never delete cart data; append versions.
- No secrets in git. Use a gitignored `.env` locally; keys on the Pi live in the service config only.
- Keep the kids' transcripts and logs out of this repo. Don't store raw audio.
- Check current docs for Anthropic products (Managed Agents, Claude Code plugins) instead of relying on memory.
- Verify prices, stock and links live before writing them anywhere.
- Resolve questions from context and docs before asking Geoff; ask when the decision is his.

## 16. Sources (public; fetch these to verify)

- Managed Agents overview: https://platform.claude.com/docs/en/managed-agents/overview
- Quickstart: https://platform.claude.com/docs/en/managed-agents/quickstart
- Tools and custom tools: https://platform.claude.com/docs/en/managed-agents/tools
- Events and custom tool calls: https://platform.claude.com/docs/en/managed-agents/events-and-streaming
- Environments: https://platform.claude.com/docs/en/managed-agents/environments
- Cloud sandbox reference: https://platform.claude.com/docs/en/managed-agents/cloud-sandboxes-reference
- Files: https://platform.claude.com/docs/en/managed-agents/files
- Budgets: https://platform.claude.com/docs/en/managed-agents/budgets
- Pricing (incl. Managed Agents): https://platform.claude.com/docs/en/about-claude/pricing
- Claude Code programmatic use: https://code.claude.com/docs/en/headless
- Guidelines for organizations serving minors: https://support.claude.com/en/articles/9307344-responsible-use-of-anthropic-s-models-guidelines-for-organizations-serving-minors
- Groq speech-to-text: https://console.groq.com/docs/speech-to-text
- Moonshine Voice announcement: https://gigazine.net/gsc_news/en/20260225-moonshine-voice (find the official repo)
- TIC-80: https://github.com/nesbox/TIC-80
- PICO-8 manual: https://www.lexaloffle.com/dl/docs/pico-8_manual.html
- Quarterless wall arcade: https://quarterless.com/products/black-and-white-wall-arcade
- Picade 10" (chosen): https://www.pishop.us/product/picade-with-10-inch-display/ and https://shop.pimoroni.com/products/picade
- Picade X HAT and driver: https://shop.pimoroni.com/products/picade-x-hat-usb-c and https://github.com/pimoroni/picade-hat
- Picade guides: https://learn.pimoroni.com/article/assembling-your-picade and https://learn.pimoroni.com/article/setting-up-picade
- Picade Max (replaced): https://www.pishop.us/product/picade-max/ and https://shop.pimoroni.com/en-us/products/picade-max
- Raspberry Pi 5: https://www.pishop.us/product/raspberry-pi-5-8gb/ and https://www.pishop.us/product/raspberry-pi-5-4gb/
