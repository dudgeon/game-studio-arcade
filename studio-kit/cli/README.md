# studio CLI

Plays the cabinet's role from the terminal: one request in, tile questions answered at the keyboard, a cart out (phase-0 task 8, D41–D43).

```sh
node studio-kit/cli/bin/studio.js make "<request>" --maker A [--model claude-opus-5-5]
node studio-kit/cli/bin/studio.js make --answers studio-kit/cli/fixtures/<run>/answers.json --model claude-opus-5-5
```

| Flag | |
| --- | --- |
| `--maker A` | the maker's initial (required, or from the answers file) |
| `--with O` | a second player |
| `--model ID` | per-run model; the agent's default is Sonnet 5.5 |
| `--answers FILE` | replay recorded answers by position (D43); runs out → D |
| `--record FILE` | also save this run's answers here (always saved in the session folder) |
| `--budget-cents N` | the session's hard list-cost cap; default 300 ($3) |
| `--commit-anyway` | commit even if validate or the playtest fails |
| `-v` | show the agent's own messages and debug lines |

Auth (D16, D17): the client comes from `@game-studio-arcade/auth`, which passes the `ant` login profile (`game-studio-arcade`, or `$GSA_PROFILE`) explicitly, so a stray `ANTHROPIC_API_KEY` is ignored.

## What a run does

1. Builds the studio kit; uploads it unless that exact kit is already uploaded.
2. Creates a session from the agent and environment in `studio-kit/managed-agent/claude-lock.json`, with the kit mounted and a budget.
3. Opens the event stream, **then** sends the request.
4. Relays `ask_player` as A/B/C/D (C takes typed text), `show_plan` as build/change, and `tell_player` plus tool activity as one-line progress. After D, any further question is answered D automatically.
5. Reconnects if the stream drops, replaying missed events from the history without repeats. Answers any tool call the stream missed when the session reports `requires_action`.
6. Polls the session's files until `DONE.json` is there and every size in it matches (D19), skipping the session's inputs. Then it downloads every output into `~/game-studio-data/sessions/<id>/` and extracts `cart.tgz`.
7. Runs `validate_cart` and the local playtest. Commits the cart to `~/game-studio-data/carts/` only if both pass.
8. Appends `studio_session` and `cart_version` records to `~/game-studio-data/logs/`, with list cost from the session's `usage.list_cost` (rounded to the cent), `active_seconds`, token counts, wall time, question count and `ended_by`.

Set `GSA_DATA_DIR` to use another data folder.

## Contracts with other packages

- **validate_cart** (task 4): uses `validateRuleCoverage(dir)` from `@game-studio-arcade/spec` (D30, merged). If that package later exports a fuller `validateCart(dir) → {ok, problems}`, the CLI uses it instead. A test runs the real coverage check on the fixture cart.
- **playtest** (task 5): expected as `playtest(dir) → report`, exported from `@game-studio-arcade/playtest`. The report has `rules: [{id, kind, passed, reason}]` and `generic: [{name, passed, reason}]`.

Until the playtest exists, local checks report "unavailable" and nothing is committed without `--commit-anyway`. The adapter is `src/checks.js`, the only file to change if the real names differ.

## Tests

`npm test -w studio-kit/cli` runs a type-check, then `node:test`, against a scripted event stream (`test-support/mock-api.js`, `fixtures/frog-hop/`). They cover:
- the ask_player relay and every tile;
- the plan step with a change;
- progress lines;
- make-it-now;
- the stream opened before sending;
- reconnect, and missed-tool recovery;
- budget_reached, and a stream that never comes back;
- replay running out;
- output lag and download;
- commit with suffixed ids; failing checks;
- complete log records.

The frog-hop stream is hand-written from the docs. Replace it with a recorded stream after the first live session.

## Still needs a live session

- One end-to-end `studio make` of an example-style game (task 8's accept): a playable cart, a passing report, a complete log record.
- Confirm the SDK calls in `src/api.js` (`beta.sessions.*`, `beta.files.list({scope_id, betas})`, `files.download`, `files.upload`) behave as the docs and SDK 1.6.0 types say. Also confirm the SDK resolves the `game-studio-arcade` profile (task 1).
- Record a real event stream as a fixture, and the first live run's answers under `fixtures/` for the task 10 replays.
- `studio fork` (task 11, stretch) isn't built.
