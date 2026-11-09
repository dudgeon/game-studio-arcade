# Cabinet service, first slice

The launcher's Studio flow and the process behind it (D180–D187): shelf with the Make tile, who's making, hold-to-talk "tell me", A/B/C/D tiles, the plan, kid-language progress, play, you-check. The Studio session runs through the CLI's `makeCart` and driver, imported rather than copied, so the logs, the library commit and the stale-brief check (D173) are the CLI's own.

```sh
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
# Spend nothing: replay a recorded session (D186). Open http://127.0.0.1:8330/, or drive it:
node cabinet/service/bin/cabinet-service.js --data /tmp/cabinet --replay studio-kit/cli/fixtures/penguin-catch
# Live, on a cabinet:
node cabinet/service/bin/cabinet-service.js --data /var/lib/arcade --config /etc/arcade/service.json
```

| Flag | |
| --- | --- |
| `--config FILE` | the cabinet's config, mode 0600 (below). Required unless replaying |
| `--replay DIR` | a fixture with `events.jsonl`, `report.json` and `cart/`, in place of the API |
| `--pace MS` | replay: wait this long before each tool event; default 150 |
| `--question-timeout S` | seconds a question or plan waits with no key pressed; default 600, or `question_timeout_s` in the config (D188) |
| `--data DIR` | carts, logs, sessions, `makers.json`; default `$GSA_DATA_DIR` or `~/game-studio-data` |
| `--port N`, `--host H` | default 127.0.0.1:8330, which the kiosk opens |
| `--examples` | also shelve `runtime/examples/*` |

The config file, created on the cabinet by Geoff, never in git (D131, D185):

```json
{ "anthropic_api_key": "...", "agent_id": "...", "agent_version": 2, "environment_id": "...",
  "budget_cents": 300, "question_timeout_s": 600, "recheck_s": 60, "players": 1, "console_name": "Quarter Deck", "model": null }
```

`agent_id` and `environment_id` come from `ant apply` in the **cabinet's own workspace**, because a workspace-scoped key can't reach what `claude-lock.json` names. It won't start with a config others can read, or one missing a key or an agent.

## Driving it by script

`scripts/drive.js` runs a script of the same verbs and D82 key names as `cabinet/vm/drive`, in headless Chromium at 1024×768, with no window. Every frame's text is checked, and a run fails on any fault.

```sh
node cabinet/service/scripts/drive.js --script cabinet/service/scripts/flows/penguin.drive \
  --out /tmp/shots --replay studio-kit/cli/fixtures/penguin-catch
node cabinet/service/scripts/contact-sheet.js /tmp/shots        # shots on sheets, to look at
node cabinet/service/scripts/make-stress-fixture.js /tmp/stress # every long string at once, for flows/stress.drive
```

Verbs: `press KEY [MS]`, `hold KEY MS`, `down KEY`, `up KEY`, `type TEXT`, `say TEXT`, `wait SCREEN [PHASE]`, `sleep MS`, `shot NAME`. Keys: `up down left right a b x y q e start enter esc star f1 f2`. `--url` drives a service that's already running, which is how a live build would run. `window.launcher` gives the screen, phase, text boxes and faults.

## The controls

Stick moves the highlight, **any** of the six player buttons or START picks it (D182). ESC goes back; on a question or plan it asks first: keep going, come back later, or stop making this game (D188). On a talk screen: hold any button, talk, let go. F1 types instead (D184). Where words don't fit: stick right opens a reader with all of them (D181).

## Text fitting

All words go through `Painter.box` in `launcher/screens.js`, which uses `launcher/text.js` (D181). To add a string, give it a box and say what a cut means:

- `onCut: "reader"`: a kid must read it to answer; the screen must offer the reader.
- `onCut: "ok"`: a label or a passing line.
- `onCut: "never"`: our own words, which must fit. A cut is a fault.

`test/screens.test.js` puts every string in `test-support/stress.js` in every slot of every screen, and measures real ink from the framebuffer against each box. Add new screens to `viewsWith` there.

## When a make doesn't finish

| What happens | What the kid sees | What's logged in `studio_session` | The session at Anthropic |
|---|---|---|---|
| Nobody answers for 10 minutes (D188) | "Still there? Move the stick!" for the last minute, then a message and the shelf, or a line on the Make tile if they've gone elsewhere | `outcome: "abandoned"`, `ended_by: "timed_out"`, `archive` | Archived, never deleted |
| The kid picks "Stop making this game" (D188) | The shelf | `outcome: "abandoned"`, `ended_by: "stopped"`, `archive` | Archived, never deleted |
| The service restarts mid-build (D189, D191) | "The cabinet is restarting", then "may still finish" and the shelf, then a shelf entry when it's done. A game being played carries on | `outcome: "service_restarted"`, then the usual record with `resumed_after_restart` | Picked back up, within its budget; its cart is checked and committed as usual. Then archived, and that's logged as a correction |
| The service restarts on a question, or one comes up after (D191) | "Tell me your idea again", or a shelf entry saying nobody could answer | `outcome: "service_restarted"`, then `"abandoned"`, `ended_by: "no_one_to_answer"` | Archived, never deleted |

Make is free in every case. How a make ended is its own shelf entry with its maker's name, under Make, until someone opens it (D192).

Files in the data folder: `studio-run.json` exists only while a make runs, and is how a restart finds the make it cut off. `studio-left.json` lists sessions still to collect. `studio-results.json` holds the entries; viewing one stamps it.

## What's stubbed or not here

- **Speech:** a stub fed text or a WAV with a transcript beside it (`src/speech.js`, D184). Real speech is Phase 3. New names are typed. The Picade has no keyboard, so speech must land before kids use it there.
- **Never run against the real API.** The API path is the CLI's `sdkApi`, unchanged, with the key from the config. It's tested on replays only, including archiving a session (D188) and re-attaching to one after a restart (D191), written from the docs and SDK types.
- **Not built:** request screening (Phase 3), forks, launcher sound, gamepads in the launcher's menus, guest players, MCP, Manager API, publish gate.

## Deploying to the virtual cabinet

For whoever owns `cabinet/provision`, once it's booting:

- `arcade-launcher.service`'s `ExecStart` becomes `/usr/bin/node /opt/arcade/current/cabinet/service/bin/cabinet-service.js --data /var/lib/arcade --config /etc/arcade/service.json`. Port and URL stay the same, so the kiosk needs no change.
- The payload needs `cabinet/service`, `runtime`, `studio-kit` and `node_modules`. The playtest needs a Chromium there (Phase 1's open question).
- `/etc/arcade/service.json` must be owned by the `arcade` user, mode 0600.

## Tests

`npm test -w cabinet/service`: `screens.test.js` (fit), `service.test.js` (makers, speech, relay, logs, failures, server), `flow.browser.test.js` (whole flows in headless Chromium against the real service process). No live API calls.
