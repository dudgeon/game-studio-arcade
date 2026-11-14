# Cabinet service

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
| `--manager-token T` | the Cabinet Manager's pairing token, or `manager_token` in the config; without one the Manager endpoints are off (D208) |
| `--replay-change DIR` | replay: the fixture a change replays; default `<replay>-change`, else the recorded `log-hopper-change` (D209, D219) |
| `--replay-cost CENTS` | replay: what each session ends up costing, for the pot's edges (L3, L4) |
| `--replay-fail` | replay: no game comes back (E3) |
| `--replay-limit` | replay: the workspace's spend limit refuses the session (L5) |
| `--offline` | Claude can't be reached (E1, E2) |

The config file, created on the cabinet by Geoff, never in git (D131, D185):

```json
{ "anthropic_api_key": "...", "agent_id": "...", "agent_version": 2, "environment_id": "...",
  "budget_cents": 300, "question_timeout_s": 600, "recheck_s": 60, "players": 1, "console_name": "Quarter Deck", "model": null,
  "pot": { "usual_cost_new": 6, "usual_cost_change": 2 }, "manager_token": "..." }
```

`agent_id` and `environment_id` come from `ant apply` in the **cabinet's own workspace**, because a workspace-scoped key can't reach what `claude-lock.json` names. It won't start with a config others can read, or one missing a key or an agent.

## The arcade's boards (D201)

The screens are the design canvas's boards, by id (docs/design/arcade-ux-handoff.md). `launcher/boards.js` draws them, mostly as one generic `board` (blocks above, tiles at the bottom); `launcher/shelf.js` works out the family rows (D206). Every view carries its board id, and `window.launcher.board()` and `.boards()` say which are up and which have been, so scripts can `wait M3`.

| Boards | Built | Driven by |
| --- | --- | --- |
| B1-B4 boot, first boot, new month | yes | `first-boot`, `new-month` |
| S1, S2, S3, R9 shelf, game card | yes | `arcade`, `errors` |
| A1, A2 coin pot, what it paid for | yes | `arcade`, `pot-low`, `new-month` |
| G0-G5 how to play, play, you check, post-game | yes | `arcade`, `first-boot` |
| M1-M11 a new game | yes | `arcade`, `penguin` |
| R1-R8 a change | yes | `arcade`, `pot-low` |
| L1-L5 the pot's limits | yes | `pot-low`, `pot-empty`, `overrun`, `over-usual`, `resting` |
| E1-E9 errors | yes | `offline`, `failed`, `errors` |
| E10 how about this? | built | request screening redirects an idea or a typed answer (D270-D275, `src/screening.js`, `launcher/redirect.js`) |
| Manager coin pot page | no | the Manager isn't built; its API is (below) |

```sh
cd cabinet/service
node scripts/drive.js --script scripts/flows/arcade.drive --out /tmp/boards --replay ../../studio-kit/cli/fixtures/penguin-catch --pace 20
```

A flow's first lines can carry its own service flags (`#! --replay-cost 140`) and a seed for the data folder (`#seed seeds/pot-low.json`: a ledger, makers, whether the first boot was seen).

## The family coin pot (D202-D205, D208, D211)

One pot per cabinet: 100 coins = $10 a month, set back to 100 on the 1st. A make starts only if the pot, in whole coins, holds its usual cost (6 new, 2 change since D214), only the COIN button (F2) starts it, and it's charged its session's real list cost at the end, however it ended. Everything is in `logs/coin_ledger.jsonl`, append only, beside `studio_session.jsonl` and joined to it by session id. `src/pot.js`; the rules' tests are `test/pot.test.js`.

The Cabinet Manager's endpoints, behind its token (`Authorization: Bearer ...`):

| | |
| --- | --- |
| `GET /api/manager/pot` | the pot, the whole ledger, the rules |
| `GET /api/manager/pot/preview?coins=N` | what a top-up would do, and whether the month could pass the workspace's $15 limit |
| `POST /api/manager/pot/topup` | `{coins, reason, by?}`: the reason is shown to the kids in A2 |
| `POST /api/manager/pot/reset` | `{reason, by?}`: back to 100 |

## Score and best (D215)

A game reports a round's final score with `g.score(n)`, which the starter library's `score.commit` does for it. The launcher sends the play's scores with its play record. The post-game screen shows "Score: 120. Best: 340." (or "A new best!"), with the best taken from the play log for the game's line. A game that reports nothing shows no score line.

## Changes (D206, D209)

`POST /api/studio/start` with `parent` makes a change. The game's maker gets the next version (`<line>-v<n>`); anyone else gets their own version, a new line in the same family. The parent is never touched.

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

## You-check

A made game asks its `(you check)` rules after a play, and the shelf says how many are left. A starter game, one with no `maker` in its `cart.json`, does neither (D193).

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

Make is free in every case, except while a make a restart cut off is still being collected: then it waits, and says so (D199). The service's journal has a line for each restart, re-attach and collect. How a make ended is its own shelf entry with its maker's name, under Make, until someone opens it (D192).

Files in the data folder: `studio-run.json` exists only while a make runs, and is how a restart finds the make it cut off. `studio-left.json` lists sessions still to collect. `studio-results.json` holds the entries; viewing one stamps it.

## Guest games (D230–D236)

Downloaded web games sit on the shelf after the carts. Each is a folder in the repo's `guests/` (or `<data>/guests/`) with `guest.json`, `play/` and a `NOTICE.md` of every file's licence (D231). The service serves them on their own origin, `guest_port` in the cabinet config or `--guest-port` (default 8340), with a script that turns Escape into "back to the shelf" before the game sees it (D232). The launcher plays one in a focused full-screen iframe and logs the play to `logs/guest_play.jsonl`. Code: `src/guests.js`, `launcher/guests.js`; tests: `test/guests*.test.js`. The first guest is teti (`guests/teti`, D233).

A version of a guest is its own folder whose `guest.json` names its `maker`, `parent` and `family`; the shelf indents it under the original (D234). `guests/teti-geoff` is Geoff's teti that keeps score. A guest reports a round's score by posting `{gsa: "score", n}` to the launcher; the play log keeps it, and G6 shows the score and the best (D235). A grown-up maker is added only by `node scripts/maker.mjs add-grown-up NAME` on the mini (token-gated, like coin.mjs); the service never writes `makers.json` itself, and the kids' who's-making list leaves grown-ups out (D236).

**Guests that need a player (D380–D387):** a TIC-80 cart or a homebrew ROM is a guest folder too. Its `play/` holds TIC-80's web player or RetroArch's web build with one core, the game's file, and a page that starts it with the cabinet's keys. `guest.json`'s `player` says which. `node scripts/guests/build.mjs GUEST_DIR` builds the folder from pinned downloads (`scripts/guests/players.lock.json`). Candidates wait in `guest-shortlist/` until Geoff picks; see [docs/guest-players.md](../../docs/guest-players.md). The smoke check also requires such a guest to draw something (D383). Tests: `test/players.browser.test.js`, `scripts/guests/test/guests.test.mjs`.

## The publish gate (D310-D313)

Before a made game goes on the shelf, the cabinet re-tests it itself (`src/gate.js`, `bin/gate-run.js`). It runs the spec's auto rules and the generic checks in the cabinet's own Chromium, through the playtest harness's pipe driver (no Playwright). Each run is its own process under `nice -n 19`, one at a time. A test waits while a game is being played (the launcher's `/api/arcade/playing` heartbeat), and one already running when a play starts is stopped and run again afterwards.

A failing game stays off the shelf: the kid sees E3, the make is charged, and each reason goes in the session record and `logs/publish_gate.jsonl`. A downloaded game gets a smoke check per version (it loads, no page errors, nothing fetched off the cabinet) before it shows (D312). Frame time is measured and logged, but blocks only once the cabinet's config says `gate.calibrated: true` (D311).

On the virtual cabinet a game takes 4.5 to 7.6 s (D313). `node cabinet/vm/guest/gate-shelf.mjs` on a cabinet times the gate over its whole shelf. `--no-gate` is for development only.

## The arcade MCP server (D340-D346)

Desktop Claude Code on the mini reaches the cabinet through the `game-studio` plugin (`game-studio/`). `POST /mcp` (`src/arcade-mcp.js`, with the JSON-RPC core in `src/mcp-rpc.js`) is on the service's own loopback port, behind the Manager's token, so only the mini can call it, over its SSH (D341). Requests with an `Origin` header are refused.

| Tool | |
| --- | --- |
| `list_carts` | every version in the library, with `on_shelf` for the latest of each line, and the makers |
| `get_cart` | a cart's files, now or at a library commit (`ref`) |
| `publish_cart` | `{bundle, parent?, maker, with?, summary}`: validate, then the publish gate, then a new folder and commit. The cabinet writes the provenance (`origin: desktop`, `desk_…` session). Lineage follows a cabinet change. A failure is kept in `sessions/` and logged. |
| `launch_on_cabinet` | the game's G0 board, only from the shelf; refused while a make is running or a game is being played (D344) |
| `get_activity` | the logs, newest first, filtered by type, cart, maker or time |
| `cabinet_status` | online, release, profile, what's running, the gate |
| `remove_from_shelf` | `{id, reason?, by?}`: the game's whole line off the kids' shelf, kept in the records (D360-D362) |
| `restore_to_shelf` | `{id, reason?, by?}`: back on the shelf |

The launcher listens on `GET /api/arcade/launch` and answers on `POST /api/arcade/launch/answer`. Tests: `test/arcade-mcp.test.js`.

## Off the shelf, kept in the records (D360-D363)

A grown-up takes a game, with every version of it, off the kids' shelf, or a maker's name off "Who's making?", from the Cabinet Manager's Games page or the MCP tools. Nothing is erased (D5). The mark is a line in `logs/shelf_marks.jsonl` (`src/shelf-marks.js`): the last line for a game or maker wins, and no file means nothing is off. The cart's files and library history are never touched, so the records, the activity log, the twin and the backup keep the game, and Put back restores it as it was.

- **Left out:** `/api/carts` (so the shelf, "change this game" and the best scores), and `/api/makers`. A change of a game that's off is refused (409).
- **Kept:** the files and git history, every log, the Manager's activity, `list_carts` (with `off_shelf`), and the twin sync and backup (it's a log, D291).
- **A kid's version** of a removed game is its own line and stays. The shelf then shows it as its own game, no longer indented (the launcher's `families()` takes the oldest line left as the family's main row).
- Manager endpoints: `GET /api/manager/games`, `POST /api/manager/games/remove|restore`, `POST /api/manager/makers/hide|show`. Tests: `test/shelf-marks.test.js`.

## What's stubbed or not here

- **Speech:** a stub fed text or a WAV with a transcript beside it (`src/speech.js`, D184). Real speech is Phase 3. New names are typed. The Picade has no keyboard, so speech must land before kids use it there.
- **Never run against the real API.** The API path is the CLI's `sdkApi`, unchanged, with the key from the config. It's tested on replays only, including archiving a session (D188) and re-attaching to one after a restart (D191), written from the docs and SDK types.
- **Not built:** launcher sound, gamepads in the launcher's menus, a PICO-8 guest (designed, waiting for Geoff's PICO-8: D386), `studio fork` on the desktop CLI.
- **Score and best on G4:** not shown. A game's saves live inside its own sandboxed frame, and nothing reads them out yet.
- **The workspace limit's refusal (L5)** is recognised by a guessed error wording; no limit has been hit to check it against.

## Deploying to the virtual cabinet

For whoever owns `cabinet/provision`, once it's booting:

- `arcade-launcher.service`'s `ExecStart` becomes `/usr/bin/node /opt/arcade/current/cabinet/service/bin/cabinet-service.js --data /var/lib/arcade --config /etc/arcade/service.json`. Port and URL stay the same, so the kiosk needs no change.
- The payload needs `cabinet/service`, `runtime`, `studio-kit` and `node_modules`. The playtest needs a Chromium there (Phase 1's open question).
- `/etc/arcade/service.json` must be owned by the `arcade` user, mode 0600.

## Tests

`npm test -w cabinet/service`: `screens.test.js` (fit), `service.test.js` (makers, speech, relay, logs, failures, server), `flow.browser.test.js` (whole flows in headless Chromium against the real service process). No live API calls.
