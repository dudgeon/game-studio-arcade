---
type: project
title: game-studio-arcade
aliases:
  - game-studio-arcade
  - Quarter Deck
status: active
goal: A basement arcade cabinet where Owen and Alina describe a game out loud, answer Claude's questions with the joystick, and play the new game minutes later
health: on-track — kickoff docs done; Phase 0 waiting on WIF setup
next: Run scripts/setup-anthropic-auth.sh (WIF), then give the go-ahead for Phase 0 code
created: 2026-11-07
repo: https://github.com/dudgeon/game-studio-arcade
---

# game-studio-arcade

## Why

Teach Owen (13) and Alina (10) to work with an agent: state what they want, define requirements, check that the agent met them, then change the approach or the requirement. Learning to code isn't the goal. The arcade makes that loop fun and fast: hold MAKE, say the idea, answer a few tile questions, and play your own game on the shelf. Bigger projects happen with Geoff at the Mac mini and publish to the same cabinet.

## Done when

- [ ] Phase 0: Falling Blocks built by a Managed Agents session from Alina's request, all auto rules passing, playable in a browser; real cost per build measured; Sonnet 5.5 vs Opus 5.5 compared
- [ ] Phase 1: the cabinet service (launcher, cart library, tile relay, logs, MCP, Manager API) and Cabinet Manager v0 running on the mini
- [ ] Phase 2: Picade Max + Pi 5 built, provisioned from the script, MAKE buttons and mic fitted, day-one library on the shelf
- [ ] Phase 3: speech bake-off (Groq vs Moonshine) with the kids' voices; first real kid builds and forks at the cabinet
- [ ] Phase 4: `game-studio` plugin and the desktop flow; the first joint game with Owen published to the cabinet

## Notes

- Brief: docs/HANDOFF.md. Decisions: docs/decisions.md (these win over the brief). Platform facts: docs/platform-notes.md. Current plan: docs/phase-0.md.
- Hardware: Pimoroni Picade Max kit + Raspberry Pi 5 (1280×1024 screen). Not bought yet.
- The cabinet must work with the Mac mini off. Kid builds run in Claude Managed Agents; desktop builds use Geoff's Claude Code.
- Phase 0 budget: $25 total, $3 cap per build.
- Alina's Phase 0 request is a stand-in Claude wrote (docs/phase-0.md). Swap in her real words when we have them.

## Decisions

- 2026-11-07: spec rules come in two kinds: auto (playtest) and you-check (the kid confirms on first play) (D1)
- 2026-11-07: cabinet is a Picade Max + Pi 5 (D2); screen 320×256 with a 32-color palette (D3)
- 2026-11-07: cabinet software is stock Pi OS Lite (trixie) + a provisioning script, not a custom image (D4)
- 2026-11-07: nothing is deleted, including Anthropic-side sessions (D5)
- 2026-11-07: Geoff decides functional constraints; Claude decides implementation and logs it
- 2026-11-07: API auth via Workload Identity Federation with per-device signing keys, not API keys (D15)
