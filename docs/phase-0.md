# Phase 0 — spike

**Goal:** prove the core loop with no cabinet. A request goes in, Claude asks tile questions, Claude writes `spec.md`, then code, then playtests in a Managed Agents session, and a game comes out that plays in a browser with the keyboard. Along the way we learn what a build really costs and which model to default to.

**Done when** (HANDOFF §14, updated by [decisions.md](decisions.md)):
- Falling Blocks exists as `spec.md` + `game.js` + `checks.js`, built by a Managed Agents session from Alina's request, with every `auto` rule passing.
- It plays in a local browser with the keyboard, and with a USB gamepad if one is plugged in.
- Geoff has played it and answered its `you-check` rules.
- The real list cost, wall time and question count of each build are recorded.
- Sonnet 5.5 and Opus 5.5 have each built it at least twice from the same request and answers.
- Stretch: one fork ("make it lava") end to end.

Spend ceiling for all of Phase 0: **$25** of API list cost (proposed). Each build is capped at $3 by session budget until we have data.

## What I need from Geoff

1. ~~Connect the mini to the Claude API~~. Done 2026-11-07: the CLI browser login is bound to the `game-studio-arcade` workspace, which has a spend limit (D16). Re-check any time with `scripts/setup-anthropic-auth.sh`.
2. ~~Alina's request in her own words~~. Claude wrote a stand-in (below). Swap in her real words whenever you have them.
3. **About 30 minutes for task 10**: answer the tile questions at the terminal (A/B/C/D) for one build, then play the results and rate them. The other builds replay your answers automatically.
4. **A GitHub remote, if you want one**: should I create a private `dudgeon/game-studio-arcade` and push?

Not needed yet: a Groq key (Phase 3). ~~Hardware (Phase 2)~~: done 2026-11-07, Geoff ordered the 10" Picade and a Pi 5 8 GB (D80). Since decided: single player by default, turns well supported, controller count as a setting (D85); Make on the shelf, no button (D86). Still open: the mic (D84), plus the questions D86 lists.

I'll install these on the mini unless you object: `ant` (`brew install anthropics/tap/ant`) and Node 22 (`brew install node@22`, used through `.nvmrc`).

## The Phase 0 request (stand-in for Alina)

Claude made this up. It's meant to sound like a bright 10-year-old speaking into a mic: run-on, enthusiastic, specific about feelings and looks, vague about rules. It's the `request transcript` for every task 10 build:

> "Can you make Tetris but way cuter? Like the blocks are made of candy and when you finish a whole line it goes POP and there's sparkles. And there's a little cat at the bottom and he gets really happy when you clear lines, and sad if it gets too high. And it gets faster but not like super hard right away. And can Owen play too? But not on my side."

What it tests, on purpose:
- **Inspired-by guardrail.** It names Tetris. The result must be her own falling-blocks game (candy theme, its own name), with no Tetris name or look.
- **Looks and feelings → you-check rules.** "Way cuter", sparkles, the happy and sad cat can't be proven by the playtest, so they should become `(you check)` rules (D1).
- **Vague difficulty → a good question.** "Faster but not super hard right away" should prompt an A/B question about the speed curve, or a clear Assumption if she picks D.
- **Scope ambiguity → a good question.** "Can Owen play too? But not on my side" could mean a second board side by side, taking turns, or sharing one board. Claude should ask rather than guess. This is also the first test of more than one player. **Note (D85):** the cabinet has one set of controls and games default to single player, so at the cabinet "can Owen play too" means **taking turns**. The request stays as written: it's still a good test that Claude asks rather than guesses. A good question is now about the kind of turns (e.g. swap after each game, or after each life), and a side-by-side answer only works where the controller setting is above 1 (the desktop). The build should use the library's turn-taking helper once it ships (D85).
- **Things she didn't say.** Controls, what ends the game, scoring and the name are all for Claude to ask about or record as Assumptions.

Recorded tile answers for replays go in `studio-kit/cli/fixtures/` once task 10 runs live. The request is invented, so it can live in the repo; real kid transcripts never do.

## Tasks, in order

### 0. Repo scaffolding
npm workspaces (`runtime`, `studio-kit/*`, later `cabinet/*` and `manager`), TypeScript, Node 22 pinned (D9), `node:test` for unit tests (no test framework to ship into the offline sandbox), `.gitignore` (`.env`, `node_modules`, build output), `.env.example`, a README pointing at the docs.
*Accept:* `npm install && npm test` passes on Node 22, and `git status` is clean after a build.

### 1. Probe session (auth done, D16)
**Done 2026-11-07** (D17–D19): `studio-kit/auth`, `studio-kit/probe`, findings in platform-notes.md. The sandbox has Playwright **1.56.0**.

First, auth plumbing (D16): `ant` already uses the `game-studio-arcade` profile. Add a shared `credentials()` helper for our TypeScript code that relies on the SDK's profile resolution. It should fail with a clear message pointing at `scripts/setup-anthropic-auth.sh`, and refuse to run if `ANTHROPIC_API_KEY` is set. Confirm the SDK actually picks up the profile.

In `studio-kit/managed-agent/`: a minimal environment (`networking: {type: limited}`, no hosts) and a throwaway agent, applied with `ant apply`, plus one session that reports:
- Node version, and the **exact Playwright version** and where it lives (global npm path, `require.resolve`)
- the Chromium version, and that headless Chromium launches offline
- that outbound network is blocked
- the `/mnt/session/uploads` and `/mnt/session/outputs` round trip, with a tarball mounted, extracted and an output listed and downloaded
- **where a session's list cost is reported** (session object or usage fields), so we can log real cost

*Accept:* `ant` and the SDK both authenticate through the `game-studio-arcade` profile, the findings are added to [platform-notes.md](platform-notes.md), the local Playwright is pinned to the sandbox's version in `package.json`, and the probe cost is under $0.50.

### 2. House runtime v0 (`runtime/`)
- A 320×256 canvas with integer scaling and a fixed 32-color palette (D3). **Revised by D81 after task 2 shipped: 256×192, 4× to the Picade's 1024×768.** The resize is a follow-up change to the runtime, routed by the director.
- A host page that runs a cart in a sandboxed iframe (D13).
- Input mapping from keyboard and the Gamepad API to the cabinet's buttons: per player, stick plus A B X Y and START; ★ is reserved. *(D85, later: the number of controllers becomes a setting, 1 on the cabinet; routed to the runtime worker.)*
- Palette-indexed sprites from inline pixel strings, the built-in bitmap font, a 4-voice chip synth (WebAudio), and `g.save()`/`g.load()`.
- The cart API is `init / update / draw` with a deterministic test hook (D10): `step(n)`, `input(script)`, `probe()`, frame capture.
- Shipped as plain JS with `.d.ts` types, so carts are JS and the agent can type-check with `tsc --checkJs` offline.

*Accept:* a hello-world cart runs at 60 fps in Chrome on the mini with the keyboard. Unit tests cover input mapping, the palette and determinism (the same seed and input give the same frame hash).

### 3. Starter library, Falling Blocks subset (`runtime/lib/`)
Collision (overlap, plus who destroys whom); grid movement and rotation; score, lives and high score through `g.save`; title → play → game-over flow; timers. Each piece has unit tests and a one-paragraph reference entry.
*Accept:* tests pass, and every exported function appears in the library reference.

### 4. Spec format (`studio-kit/spec/`)
- A `spec.md` template following §7: Pitch, Rules, Controls, Look & sound, Assumptions, Changelog.
- Rules are tagged `(auto)` or `(you check)` (D1).
- A short guide to writing checkable rules, with good and bad examples, and the `checks.js` format (D11).
- A parser that extracts rule ids and kinds, used by validate and playtest.

*Accept:* the parser round-trips the template and the example carts, and `validate_cart` flags any `auto` rule that has no matching check.

### 5. Playtest harness (`studio-kit/playtest/`)
Playwright pinned to the sandbox version. It loads a cart headless, runs each check in `checks.js` plus the generic checks (D11), and captures key frames as PNG. It writes `playtest.json` with per-rule pass/fail and a reason, generic results, frame-time stats and errors. It must run identically on the mini and in the sandbox, using the preinstalled Playwright there and never installing one.
*Accept:* a deliberately broken cart fails the right rules with readable reasons, and the same cart gives the same report on the mini and in a sandbox session.

### 6. Context pack (`studio-kit/context-pack/`)
The library reference, about six short recipes (e.g. "thing A destroys thing B", "grid piece rotation", "title/play/over flow"), and **three tiny example carts that are not falling-blocks games** (D12): a dodge game, a paddle game and a collect game. Each example passes its own playtest. Target size: small enough to read fully in one go (≤ ~15k tokens).
*Accept:* all three examples pass, and the token count of the pack is recorded.

### 7. Studio agent (`studio-kit/managed-agent/`)
- `studio.agent.md`: the kid brief (ages 10 and 13, content rules, plain voice), the spec-first workflow, the `ask_player` tool (§9.1), and the D-meaning ("ask no more questions; record assumptions").
- Web tools disabled. Model set per run.
- `environment.yaml` (limited, no hosts).
- A packaging script that builds the studio kit tarball (runtime, library, spec tools, playtest harness, context pack), uploads it with the Files API, and mounts it per session. Also try attaching the context pack as an agent-level custom skill instead, and keep whichever works better.
- `claude-lock.json` committed.

*Accept:* `ant apply` is idempotent (no duplicate agents), and a session can extract the kit and run the playtest on an example cart.

### 8. CLI driver (`studio-kit/cli/`, plays the cabinet's role)
- `studio make "<request>" --maker A [--model …] [--answers file]`.
- Opens the SSE stream before sending (platform-notes), then relays each `ask_player` as a question with `A) … B) … C) Something else D) Make it now`; C takes typed text.
- Shows the "Here's the plan" step (the spec's rules in plain words: build, or change a rule), then prints progress in kid language.
- On finish it downloads the outputs, runs `validate_cart` and the local playtest, and commits the cart to the dev cart library (D14). It also writes `studio_session` and `cart_version` log records (§9.5) with real list cost, time, the question count and `ended_by`.
- `--answers` replays a recorded answer file for fair model comparison.
- `studio fork <cart> "<change>"` is the stretch.

*Accept:* one end-to-end build of an example-style game from the terminal produces a playable cart, a passing report and a complete log record.

### 9. Local player
A tiny dev server and page that lists the dev cart library and plays a cart with keyboard or gamepad, then asks its `you-check` rules after the first play and logs the answers. This page grows into the Cabinet Manager's simulator in Phase 1.
*Accept:* Falling Blocks (task 10) plays from the list, and its you-check answers land in the log.

### 10. Falling Blocks and the model comparison
- Geoff runs `studio make` with Alina's request on Sonnet 5.5 and answers live; the answers are recorded.
- Replay the same request and answers: Sonnet ×1 more, Opus ×2.
- For each run, record list cost, wall time, question count, auto-rule pass on the first try versus after fixes, and the size of `game.js`. Geoff's 1–5 rating ("would Alina play this?") goes in too.

*Accept:* `docs/phase-0-results.md` has the table and a recommendation for the default model and per-build cap, recorded in `decisions.md`.

### 11. Stretch: fork
`studio fork falling-blocks "make it lava"` starts from the parent's spec, code and turns. Claude edits the spec first, then the code, and the playtest runs the new rules plus all inherited ones. The parent is untouched.
*Accept:* the fork commits as a new cart with `parent` set, and the parent's files are byte-identical.

## Risks to watch

- **Self-graded tests.** The same agent writes the code and its checks, so checks can drift toward whatever the code does. Mitigations in Phase 0:
  - rules are fixed in the spec before code;
  - `validate_cart` requires one check per auto rule;
  - generic checks are ours, not the agent's;
  - Geoff reads the checks of the first builds.

  If the checks are weak, try a separate checker (a multiagent subagent that writes checks from the spec alone).
- **Cost variance.** The first builds may run into fix loops, so the $3 cap stops runaways. Watch whether builds hit it.
- **Pi performance** isn't tested until Phase 2. D8's gate and the frame-time stats in `playtest.json` give early warning.
