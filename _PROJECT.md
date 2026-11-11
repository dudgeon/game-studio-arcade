---
type: project
title: game-studio-arcade
aliases:
  - game-studio-arcade
  - Quarter Deck
status: active
goal: A basement arcade cabinet where Owen and Alina describe a game out loud, answer Claude's questions with the joystick, and play the new game minutes later
health: on-track — Phase 0 stack built and measured (agent v2 live; fetch on demand, templates, frozen checks); virtual cabinet booting; Studio screens in progress; Picade 10" ordered
next: Finish the launcher Studio screens and virtual cabinet V0, then run a full build driven through the cabinet UI; task 10 (Falling Blocks with Geoff) after that
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
- **Restart the virtual cabinet when it drops off the network:** when the VM is running but the mini can't reach it, the director may shut it down cleanly and start it again with no window (utmctl, only while UTM is already running), then check its data files, without asking each time. (Geoff, 2026-11-11)

## Done

- 2026-11-08: [tasks/phase-0-task-0-2-repo-scaffolding-and-house-runtime-v0.md](tasks/phase-0-task-0-2-repo-scaffolding-and-house-runtime-v0.md): npm workspaces on Node 22 and the house runtime v0 (now 256×192), deterministic test hook, sandboxed frame; 60 fps checked headless only
- 2026-11-08: [tasks/phase-0-task-1-credentials-helper-and-probe-session.md](tasks/phase-0-task-1-credentials-helper-and-probe-session.md): auth through the ant profile (D16/D17) and a $0.003 sandbox probe: Playwright 1.56.0, Node 22.22, network blocked
- 2026-11-08: [tasks/phase-0-task-3-starter-library-falling-blocks-subset.md](tasks/phase-0-task-3-starter-library-falling-blocks-subset.md): starter library as g.lib (collide, grid, timers, score, flow) with an agent-facing reference
- 2026-11-08: [tasks/phase-0-task-5-playtest-harness.md](tasks/phase-0-task-5-playtest-harness.md): playtest harness with node and browser drivers; sandbox parity matched exactly
- 2026-11-08: [tasks/full-validate-cart.md](tasks/full-validate-cart.md): validate_cart covering rule coverage, cart.json, the D13 lint and a cart type check
- 2026-11-08: [tasks/phase-0-task-4-spec-format-and-parser.md](tasks/phase-0-task-4-spec-format-and-parser.md): spec template, checkable-rules guide, parser with byte-exact round-trip
- 2026-11-08: [tasks/phase-0-tasks-7-8-studio-agent-definition-and-cli-driver.md](tasks/phase-0-tasks-7-8-studio-agent-definition-and-cli-driver.md): Studio agent v2 live, `studio make` end to end, frozen checks (D44/D46/D49), stale-brief check, model comparison (Sonnet looks like the default)
- 2026-11-08: [tasks/token-breakdown-of-the-penguin-catch-build.md](tasks/token-breakdown-of-the-penguin-catch-build.md): where a 68c build's money goes, plus a re-measuring script
- 2026-11-08: [tasks/redesign-the-library-catalog-fetch-on-demand-templates.md](tasks/redesign-the-library-catalog-fetch-on-demand-templates.md): catalog, modules on demand, four templates plus blank; 57c down to 40c, or 29c from a template
- 2026-11-08: [tasks/phase-0-task-6-context-pack-and-example-carts.md](tasks/phase-0-task-6-context-pack-and-example-carts.md): the context pack, later restructured by the library redesign
- 2026-11-08: [tasks/players-setting-and-turn-based-helpers-in-the-runtime.md](tasks/players-setting-and-turn-based-helpers-in-the-runtime.md): controller count as a setting (1-8), g.lib.turns
- 2026-11-08: [tasks/switch-cabinet-to-picade-10-inch-check-specs-and-update-the.md](tasks/switch-cabinet-to-picade-10-inch-check-specs-and-update-the.md): plan moved to the Picade 10"; screen 256x192 at 4x; launcher decisions D85-D88
- 2026-11-08: [tasks/fix-flaky-playtest-parity-test.md](tasks/fix-flaky-playtest-parity-test.md): parity test made reliable (D65)
- 2026-11-08: [tasks/docs-tidy-from-the-completeness-audit.md](tasks/docs-tidy-from-the-completeness-audit.md): stale doc lines fixed
- 2026-11-08: [tasks/get-established-as-director-and-split-phase-0-work.md](tasks/get-established-as-director-and-split-phase-0-work.md): director set up, Phase 0 split across workers

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
- 2026-11-08: virtual cabinet users: Geoff with a kid; cabinets (virtual and Picade) sign in with a workspace-scoped API key each, stored only on the cabinet (Geoff)
- 2026-11-08: checks are frozen once written from the spec: a failing check means fix the game; a check may change only after the spec rule or an Assumption changes first, shown in the plan and logged (Geoff, after the first live build bent its checks to fit the game)
- 2026-11-08: virtual cabinet V0 approved: install UTM, download pinned Pi OS Lite and Debian arm64 images, one ~32 GB VM, headless; ask before any window (Geoff)
- 2026-11-08: library direction: a medium model (Sonnet) fetches context from the library as needed; the library is built for expressiveness and token efficiency, grows over time (e.g. 3D navigation), and offers a few templates plus a start-from-scratch option. Measure the Penguin Catch build's tokens first, then redesign (Geoff)
- 2026-11-08: the next game build runs fully from the virtual cabinet's own interface, once the stack is ready (Make tile, who's making, hold-to-talk, tiles, plan, progress, play, you-check), driven by Claude to pressure-test the UI Alina will see: text overruns, layout, and whether the Studio's output works there (Geoff)
- 2026-11-08: model comparison adds Haiku 5.5: run Opus and Haiku comparisons (Geoff, after the token breakdown put the same build at about 4.5c on Haiku vs 68c on Sonnet)
- 2026-11-08: when a check contradicts the unchanged spec's own words (a check bug), the agent fixes the check, quoting the rule; it's logged as a check bug and shown in the build summary. Changing what a rule means still needs the spec changed first (Geoff)
- 2026-11-08: a check-bug fix that tests less of its rule must say which words are no longer tested; such a rule is flagged in the build summary and becomes a you-check question on first play (Geoff)
- 2026-11-08: Studio builds fetch modules on demand and start from a template when the kid's idea fits one, else from blank; templates get some visual polish (pop-ups, life icons) (Geoff, D166/D169)
- 2026-11-08: virtual cabinet: its games move to the Picade's shelf when it arrives; it stays as a staging cabinet afterwards; bridged on home Wi-Fi; keyboard for now, with an arcade controller Geoff plans to buy usable for testing (Geoff)
- 2026-11-08: Falling Blocks (task 10) keeps the stand-in request for Alina (Geoff)
- 2026-11-09: virtual cabinet Console setup: workspace `cabinet-virtual` capped at $10 a month; its key is a service account key if the Console offers them, otherwise a personal key linked to Geoff; never expires (Geoff)
- 2026-11-09: the shelf keeps the three starter games but drops their "1 to check" label (Geoff)
