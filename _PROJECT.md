---
type: project
title: game-studio-arcade
aliases:
  - game-studio-arcade
  - Quarter Deck
status: active
goal: A basement arcade cabinet where Owen and Alina describe a game out loud, answer Claude's questions with the joystick, and play the new game minutes later
health: on-track — auth works (ant CLI login, D16); runtime, library, spec, validator, playtest, player and offline CLI on main; context pack being fixed; Picade 10" ordered
next: Land the context pack, then a first live `studio make` and task 10 (Falling Blocks with Geoff); design the virtual cabinet on the mini
created: 2026-11-07
repo: https://github.com/dudgeon/game-studio-arcade
---

# game-studio-arcade

## Why

Teach Owen (13) and Alina (10) to work with an agent: state what they want, define requirements, check that the agent met them, then change the approach or the requirement. Learning to code isn't the goal. The arcade makes that loop fun and fast: pick Make on the shelf, say the idea, answer a few tile questions, and play your own game on the shelf. Bigger projects happen with Geoff at the Mac mini and publish to the same cabinet.

## Done when

- [ ] Phase 0: Falling Blocks built by a Managed Agents session from Alina's request, all auto rules passing, playable in a browser; real cost per build measured; Sonnet 5.5 vs Opus 5.5 compared
- [ ] Phase 1: the cabinet service (launcher, cart library, tile relay, logs, MCP, Manager API) and Cabinet Manager v0 running on the mini
- [ ] Phase 2: Picade 10" + Pi 5 built (hardware ordered 2026-11-07), provisioned from the script, mic fitted, Make entry in the launcher, day-one library on the shelf
- [ ] Phase 3: speech bake-off (Groq vs Moonshine) with the kids' voices; first real kid builds and forks at the cabinet
- [ ] Phase 4: `game-studio` plugin and the desktop flow; the first joint game with Owen published to the cabinet

## Notes

- Brief: docs/HANDOFF.md. Decisions: docs/decisions.md (these win over the brief). Platform facts: docs/platform-notes.md. Current plan: docs/phase-0.md.
- Hardware: Pimoroni Picade with 10" display (1024×768, one player) + Raspberry Pi 5 8 GB, both ordered 2026-11-07 (D80). Still to sort: power supply, Active Cooler, microSD, mic. Single player by default with turns (D85); no physical MAKE button (D86).
- The cabinet must work with the Mac mini off. Kid builds run in Claude Managed Agents; desktop builds use Geoff's Claude Code.
- Phase 0 budget: $25 total, $3 cap per build.
- Alina's Phase 0 request is a stand-in Claude wrote (docs/phase-0.md). Swap in her real words when we have them.

## Director

- **Merge and push checked work:** when a worker's branch passes the director's own checks (tests run by the director, deliverable read), the director may merge it into main and push main to the private GitHub repo without asking each time, and lists each merge in its digest. (Geoff, 2026-11-07)

## Done

- 2026-11-08: [tasks/phase-0-task-0-2-repo-scaffolding-and-house-runtime-v0.md](tasks/phase-0-task-0-2-repo-scaffolding-and-house-runtime-v0.md): npm workspaces on Node 22 and the house runtime v0 (now 256×192), deterministic test hook, sandboxed frame; 60 fps checked headless only
- 2026-11-08: [tasks/phase-0-task-1-credentials-helper-and-probe-session.md](tasks/phase-0-task-1-credentials-helper-and-probe-session.md): auth through the ant profile (D16/D17) and a $0.003 sandbox probe: Playwright 1.56.0, Node 22.22, network blocked
- 2026-11-08: [tasks/phase-0-task-3-starter-library-falling-blocks-subset.md](tasks/phase-0-task-3-starter-library-falling-blocks-subset.md): starter library as g.lib (collide, grid, timers, score, flow) with an agent-facing reference
- 2026-11-08: [tasks/phase-0-task-5-playtest-harness.md](tasks/phase-0-task-5-playtest-harness.md): playtest harness with node and browser drivers; sandbox parity matched exactly
- 2026-11-08: [tasks/full-validate-cart.md](tasks/full-validate-cart.md): validate_cart covering rule coverage, cart.json, the D13 lint and a cart type check

## Decisions

- 2026-11-07: spec rules come in two kinds: auto (playtest) and you-check (the kid confirms on first play) (D1)
- 2026-11-07: cabinet is a Picade Max + Pi 5 (D2); screen 320×256 with a 32-color palette (D3). Superseded the same day by D80/D81
- 2026-11-07: cabinet is the 10" Picade + Pi 5 8 GB, ordered (D80); screen 256×192 at 4× (D81); controls send the runtime's P1 keys (D82)
- 2026-11-07: cabinet software is stock Pi OS Lite (trixie) + a provisioning script, not a custom image (D4)
- 2026-11-07: nothing is deleted, including Anthropic-side sessions (D5)
- 2026-11-07: Geoff decides functional constraints; Claude decides implementation and logs it
- 2026-11-07: API auth via Workload Identity Federation with per-device signing keys, not API keys (D15). Superseded: WIF is unavailable on an Individual org, so the mini uses the ant CLI login (D16, Geoff)
- 2026-11-07: director may merge checked worker branches into main and push (standing rule in ## Director)
- 2026-11-08: players: games default to single player; the starter library supports turn-based play well as an optional mechanic; the number of controllers is a configuration setting, ready for any number later; external controllers come later (Geoff, answering D84)
- 2026-11-08: MAKE: a physical MAKE button isn't assumed; starting a Studio session can live in the launcher / game shelf (Geoff, answering D84)
- 2026-11-08: mic: not chosen; research an XLR jack on the front with an XLR gooseneck mic (Geoff)
- 2026-11-08: Studio mic is hold-a-button-to-talk while the "tell me" screen is up; Make is a "Make a new game" tile in the game list; picking Make asks who's making, listing existing names plus a new-name slot for friends (Geoff, answering D86)
- 2026-11-08: build a virtual cabinet on the mini, as faithful as practical and logically isolated from the mini, for use until the Picade arrives (Geoff)
- 2026-11-08: back to the shelf: press ESC (the Escape key), the guest players' own default, not an invented mechanism (Geoff)
- 2026-11-08: mic: a USB mic for now; Geoff will find one that fits the cabinet (the researched picks didn't integrate well with the hardware)
