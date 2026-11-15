# game-studio-arcade

A desk-sized arcade cabinet that builds its own games. A kid picks **Make** on the game shelf, holds a button and says what game they want, answers Claude's questions with the joystick, and a few minutes later the new game is on the shelf, ready to play. **The Studio makes the games; the Arcade plays them.**

The point is for kids to practise working with an agent: say what you want, check that you got it, then change the request or the approach. Learning to code is not the point.

This README walks you through building your own, in order. Each step links into [docs/](docs/) for the detail. If a doc and this README disagree, the doc wins, and [docs/decisions.md](docs/decisions.md) (the decision log, cited as D1, D2, …) wins over both.

**Contents**

1. [What it is, and what you need](#1-what-it-is-and-what-you-need)
2. [The Mac side](#2-the-mac-side)
3. [Anthropic: Console, workspaces, sign-in, Managed Agents](#3-anthropic-console-workspaces-sign-in-managed-agents)
4. [Speech: Groq, with Moonshine offline](#4-speech-groq-with-moonshine-offline)
5. [The virtual cabinet](#5-the-virtual-cabinet)
6. [The real cabinet](#6-the-real-cabinet)
7. [Running it](#7-running-it)
8. [Making games at the desk](#8-making-games-at-the-desk)
9. [Safety and privacy](#9-safety-and-privacy)
10. [Map of the repo, and licences](#10-map-of-the-repo-and-licences)

---

## 1. What it is, and what you need

There are three pieces:

- **The cabinet.** A Raspberry Pi 5 in a Pimoroni Picade 10" case. It boots straight to a launcher with the shelf, plays every game locally, and works with the Mac switched off. When a kid makes a game, the cabinet itself starts a session in [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview), using its own API key and its own spend limit. Speech goes to Groq, or to Moonshine on the Pi when it's offline.
- **The Mac.** It writes the cabinet's microSD card, pushes updates over Wi-Fi, runs the **Cabinet Manager** (a local web app for the screen, coins, health, games and activity), backs the cabinet up every hour, and hosts a **virtual cabinet**: a full second cabinet in a VM, used for testing.
- **The desk.** Claude Code on the Mac, with this repo's `game-studio` plugin, for bigger projects with a grown-up. It publishes to the cabinet.

The Mac is never needed to play or to make a game at the cabinet. Background: [docs/HANDOFF.md](docs/HANDOFF.md) (the original brief) and [CLAUDE.md](CLAUDE.md) (vocabulary and the decisions that are fixed).

### Hardware

Prices change, so check the current price before you buy. Part numbers and the reasons for each part are in [docs/platform-notes.md](docs/platform-notes.md#picade-10-inch-2025-edition) and [docs/cabinet-bring-up.md](docs/cabinet-bring-up.md) (A2).

| Part | Notes |
|---|---|
| Pimoroni Picade with 10" display, **2025 edition** (the box has a pink "designed for Raspberry Pi 5" sticker) | 1024×768 screen, one joystick, 6 player buttons, 4 black utility buttons, the Picade X HAT (controls, sound, power). The Pi isn't included. |
| Raspberry Pi 5, 8 GB | |
| Official Raspberry Pi 27 W USB-C supply (5 V / 5 A) | It plugs into the **X HAT's** USB-C port, never the Pi's own. |
| Official Raspberry Pi 5 Active Cooler | Optional in Pimoroni's guide; we want it. |
| microSD card, 16 GB or more (32–64 GB is ideal) | The card script refuses anything under 8 GB or over 260 GB. |
| A USB microphone | Into one of the Pi's black USB 2 ports. Options compared in [docs/hardware-mic.md](docs/hardware-mic.md). |
| A Mac with Apple silicon, and a microSD card reader | The virtual cabinet needs Apple's Virtualization framework (through UTM). Budget about 4 cores, 8 GB of RAM and up to 32 GB of disk for the VM while it runs. |
| Optional: an Ethernet cable | A fallback if the cabinet can't join the Wi-Fi on first boot. |

### Accounts

- **Claude Console** ([platform.claude.com](https://platform.claude.com)): API access for Managed Agents, with a workspace and spend limit for each cabinet. See [section 3](#3-anthropic-console-workspaces-sign-in-managed-agents).
- **Claude Code**, for the desk (section 8) and, if you like, for running this guide with Claude's help.
- **Groq** ([console.groq.com](https://console.groq.com)): speech to text. Optional. Without it, Moonshine on the Pi does everything.
- **Tailscale**: optional, for reaching the cabinet from outside the home network.
- **PICO-8**: optional. You need your own licence to export PICO-8 carts as guest games (section 7).

### Rough running costs

These figures were measured in this repo in November 2026 at list prices. Check the current prices on [Anthropic's pricing page](https://platform.claude.com/docs/en/about-claude/pricing) and Groq's before you rely on them.

- **A new game** on Sonnet 5.5 (the Studio agent's model) has cost about 30–80¢. The cabinet caps each make at about $3. Details: [docs/phase-0-results.md](docs/phase-0-results.md), [docs/cost-penguin-catch.md](docs/cost-penguin-catch.md).
- **Managed Agents session runtime** is billed per session-hour while a session is running, on top of tokens. A make runs for minutes, so this is under 1¢ per make.
- **Screening a kid's request** with Haiku costs a fraction of a cent per check. A turn of **open chat** with a game character costs about 0.02¢.
- **Groq speech** is billed per hour of audio with a 10-second minimum per request: about $0.0001 for each time a kid holds the button.
- **The coin pot** turns the budget into something the kids can see: by default 100 coins = $10 a month, and each make is charged what it really cost (D202–D211). You set the workspace's real spend limit in the Console; ours are $10 a month for the virtual cabinet and $15 for the real one.
- **The Mac and UTM** cost nothing extra.

---

## 2. The Mac side

You need:

- **Node 22**, exactly (`engines` is `>=22 <23`): `brew install node@22`, then put it first on your `PATH`.
- **The `ant` CLI**, for the Claude API and `ant apply`: `brew install anthropics/tap/ant` ([install options](https://platform.claude.com/docs/en/managed-agents/quickstart)).
- **UTM**, for the virtual cabinet: `brew install --cask utm`, then **open it once by hand**. A freshly installed UTM is quarantined, and every script call hangs on macOS's first-open dialog until you answer it ([platform-notes](docs/platform-notes.md#utm-on-the-mini-checked-2026-11-08-utm-508)).
- **xz**, used to unpack the Raspberry Pi OS image: `brew install xz`.
- **Claude Code**, for the desk: [claude.com/claude-code](https://claude.com/claude-code).
- Optional: **QEMU** (`brew install qemu`) for `scripts/cabinet-card/rehearse.mjs`, which boots a written card image in a throwaway VM.

Clone and test:

```sh
git clone https://github.com/dudgeon/game-studio-arcade.git ~/claude-home/game-studio-arcade
cd ~/claude-home/game-studio-arcade
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
npm ci
npm test        # type-check (tsc --checkJs), then every workspace's node:test suite and the scripts' tests
```

Any folder works, but `~/claude-home/game-studio-arcade` is where the desk plugin looks if `GSA_REPO` isn't set (section 8). `npm run build` type-checks and runs any build steps, and leaves `git status` clean.

Copy `.env.example` to `.env` for local settings (the `ant` profile name, the data folder). It holds no secrets. Data the scripts write goes to `~/game-studio-data`, never the repo.

**Run every script from a clean checkout of `main`.** The scripts refuse or warn otherwise, because what lands on a cabinet is whatever is checked out.

---

## 3. Anthropic: Console, workspaces, sign-in, Managed Agents

### 3.1 Workspaces and spend limits

In the [Claude Console](https://platform.claude.com), on [Workspaces](https://platform.claude.com/settings/workspaces), create one workspace for each identity:

| Workspace | Used by | Spend limit |
|---|---|---|
| `game-studio-arcade` | the desk: the Mac's own sign-in, `studio` CLI runs, and applying the agent from the Mac | your choice |
| `cabinet-virtual` | the virtual cabinet | ours is $10 a month |
| `cabinet-picade` | the real cabinet | ours is $15 a month |

Select each workspace and set its monthly limit under **Spend limits**. Each cabinet having its own workspace means its spending is capped and counted on its own (D131). The scripts refuse a cabinet key that belongs to the desk's workspace or to the other cabinet's.

### 3.2 How the Mac signs in: the `ant` CLI profile, no key

The Mac signs in through the browser with the `ant` CLI, under a profile named `game-studio-arcade` and bound to that workspace. No API key is created or pasted.

```sh
scripts/setup-anthropic-auth.sh
```

It opens the browser (choose the `game-studio-arcade` workspace), activates the profile, and checks that the Claude API and Managed Agents both answer. To skip the workspace picker, run it with `GSA_WORKSPACE_ID=wrkspc_…`. Running it again just re-checks the sign-in.

> **Never set `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`) in your shell on the Mac.** It silently overrides the profile, so the Mac would act in whatever workspace that key belongs to. The script warns if it finds one.

### 3.3 Cabinets get workspace-scoped keys

A cabinet runs unattended, so it uses an API key scoped to its own workspace. The key lives only in the cabinet's service config (`/etc/arcade/service.json`, owned by the `arcade` user, mode 0600). It is never an environment variable, a file in the repo, or a log line.

You create each key in the Console ([API keys](https://platform.claude.com/settings/keys) → **Create key**, scoped to the cabinet's workspace, no expiry) and paste it only into the script that asks for it, in a Terminal window. **Don't use Claude Code's `!` prefix for these scripts, and don't paste a key into a chat.** The scripts read the key with no echo and pass it on stdin. Sections 5 and 6 say which script to use.

### 3.4 Workload Identity Federation (not used yet)

[scripts/wif/](scripts/wif/README.md) has tooling to give each device its own signing key in place of an API key. It needs a Console *organization* account and the Admin API, which Individual accounts don't have, so it is parked (D15). Only `identity.mjs` has been tested end to end; `provision.mjs` has never completed a run. If your account is an organization, the WIF README says how to try it.

### 3.5 The Studio agent (Managed Agents)

Managed Agents is **in beta**. It needs the `managed-agents-2026-04-01` beta header, which the SDKs and `ant` add for you, and its behaviour may change between releases. Read the current docs rather than trusting this summary:

- [Overview](https://platform.claude.com/docs/en/managed-agents/overview) and [quickstart](https://platform.claude.com/docs/en/managed-agents/quickstart)
- [Defining an agent](https://platform.claude.com/docs/en/managed-agents/agent-setup) and [environments](https://platform.claude.com/docs/en/managed-agents/environments)
- [`ant apply`](https://platform.claude.com/docs/en/cli-sdks-libraries/cli/apply)
- [Pricing](https://platform.claude.com/docs/en/about-claude/pricing) (tokens plus session runtime)

Everything about the agent is in [studio-kit/managed-agent/](studio-kit/managed-agent/README.md), as an `ant apply` project:

| File | What it is |
|---|---|
| `agents/studio.md` | The agent. The frontmatter is its config (model, tools, web tools off); the body is its system prompt, the brief for making games with kids. |
| `agents/tools/*.json` | Custom tools: `ask_player`, `show_plan`, `tell_player`, `name_version`. |
| `environments/studio.yaml` | The cloud sandbox: `limited` networking with no allowed hosts, so it has no network at all. |
| `claude-lock.json` | The desk workspace's lock file: what `ant apply` created there. |
| `claude-lock.arcade-virtual.json`, `claude-lock.arcade.json` | Each cabinet's own lock file, in its own workspace. |

**The lock files in this repo are ours.** They name our workspaces and agents, which aren't yours. Move or delete all four `claude-lock*.json` files before your first apply, and commit your own once `ant apply` writes them. The scripts check workspaces against them.

Apply the agent to the desk workspace first. The cabinet scripts read the desk's workspace from `claude-lock.json` so they can refuse to use it.

```sh
cd studio-kit/managed-agent
ant --profile game-studio-arcade apply --dry-run agents/studio.md environments/studio.yaml   # first time: name the files
ant --profile game-studio-arcade apply agents/studio.md environments/studio.yaml
# afterwards, bare apply updates what the lock file tracks:
ant --profile game-studio-arcade apply --dry-run
ant --profile game-studio-arcade apply
```

- Use bare `apply` after the first time, not `apply .`, because `.` walks the folder for new resources (D173).
- Re-running with no changes should report nothing to do.
- Commit `claude-lock.json`. Lock files hold IDs but no secrets.
- `node studio-kit/cli/bin/studio.js check-brief` says whether the applied agent matches the files.

You never run `ant apply` for a cabinet by hand. The cabinet scripts do it in that cabinet's workspace, with its key and its own lock file. When `agents/studio.md` changes, `update-cabinet.mjs` re-applies it on each cabinet's next update (or use `connect-cabinet.sh --reapply` / `connect-picade.sh --reapply`).

The kit the agent works from (the runtime, spec, tools, playtest and context pack) is packed by `npm run pack-kit -w studio-kit/managed-agent` and uploaded when a session needs it. You can try a whole make from the terminal with `node studio-kit/cli/bin/studio.js make "<request>" --maker A`; see [studio-kit/cli/README.md](studio-kit/cli/README.md). That spends real money in the desk workspace.

---

## 4. Speech: Groq, with Moonshine offline

A kid holds a player button and talks, and lets go to send. The clip goes to Groq's `whisper-large-v3-turbo` when the cabinet has a key and is online. Moonshine runs on the cabinet itself and answers whenever Groq can't: offline, an error, a rate limit, or too slow. Moonshine is always installed, so with no Groq key it does everything. Audio is never written anywhere. Details: [docs/speech.md](docs/speech.md).

To turn Groq on:

1. In the Groq console, **Settings → Data Controls** ([console.groq.com/settings/data-controls](https://console.groq.com/settings/data-controls)), turn on **Zero Data Retention** before any child's voice is sent. Without it, Groq may keep requests for up to 30 days for abuse monitoring.
2. Create a Groq API key.
3. For the virtual cabinet, in a Terminal window: `scripts/virtual-cabinet/groq-key.sh`. It asks about ZDR, then for the key (no echo), checks the key with Groq, and puts it in the cabinet's config. `--off` removes it.
4. For the real cabinet, you normally do nothing: the card copies the virtual cabinet's Groq key (section 6). To change it later: `scripts/cabinet-card/groq-picade.sh` (or `--off`).

---

## 5. The virtual cabinet

A full second cabinet in a UTM VM on the Mac. It has the same Raspberry Pi OS Lite image, provisioning script, service, launcher and runtime as the Pi, plus its own data and its own API identity. Use it to try everything before the hardware arrives, and keep it afterwards as the real cabinet's **twin**. The card for the real cabinet is seeded from it. Design: [docs/virtual-cabinet.md](docs/virtual-cabinet.md). Tools: [cabinet/README.md](cabinet/README.md).

### Build and start

```sh
scripts/virtual-cabinet/up.sh
```

On the first run it generates the VM from the pinned lock file (`scripts/virtual-cabinet/build.mjs`, output in `~/game-studio-data/vm/`), starts it headless, and waits for first-boot provisioning to finish. macOS may ask once whether the script may control UTM: allow it. Then check it:

```sh
scripts/virtual-cabinet/vm-state.sh                        # started, stopped, absent, or utm-not-running
scripts/virtual-cabinet/verify.sh ~/game-studio-data/verify # checks it over SSH; screenshots go to that folder
```

Until it has a key, the virtual cabinet replays a recorded make and spends nothing.

To hear the Mac's microphone, make your USB mic the Mac's default input, then run `scripts/virtual-cabinet/mic.sh on`. `rebuild.sh --yes-destroy-this-vm` rebuilds the VM from scratch and **destroys its games and logs**. Normally you update it instead.

### Connect it to Claude

1. In the Console: the `cabinet-virtual` workspace and its spend limit (3.1), then a key scoped to it.
2. In a Terminal window, from the repo on `main`:

   ```sh
   scripts/virtual-cabinet/connect-cabinet.sh
   ```

   Paste the key when asked; nothing shows. It names the key's workspace, shows the `ant apply` plan for that workspace, and asks `y`. It then puts the key in the cabinet's config and writes `studio-kit/managed-agent/claude-lock.arcade-virtual.json`. Commit that file.
3. Turn speech on: `scripts/virtual-cabinet/groq-key.sh` (section 4).
4. Pair the Manager: `node scripts/coin.mjs pair`.

Each Console page, click by click: [cabinet/README.md](cabinet/README.md#connect-the-virtual-cabinet-to-claude).

### Update it

```sh
node scripts/virtual-cabinet/update-cabinet.mjs
```

This puts this checkout's cabinet software on the running cabinet and keeps its games, logs and key. It refuses during a make, a game or a gate check. The cabinet checks every data file before and after, and rolls itself back if it isn't healthy afterwards. If `agents/studio.md` changed, it re-applies the brief in the cabinet's workspace.

---

## 6. The real cabinet

Follow [docs/cabinet-bring-up.md](docs/cabinet-bring-up.md) from unboxing to the first make (do, look for, if not). On the day itself, use [docs/flash-day.md](docs/flash-day.md). The outline:

### 6.1 Build it (2–3 hours)

Follow Pimoroni's [Assembling your Picade](https://learn.pimoroni.com/article/assembling-your-picade) with the extra checks in bring-up **Part A**. The main ones:

- Fit the Active Cooler and plug its fan into the Pi's FAN socket.
- Micro-HDMI goes into **HDMI-0**, next to the Pi's USB-C.
- Screen power goes into a black USB 2 port.
- **The 27 W supply goes into the X HAT's USB-C**, not the Pi's.
- **Wire the buttons as in [docs/hardware/picade-wiring.png](docs/hardware/picade-wiring.png)** (SVG beside it). The software's button map already expects that wiring (D82). If a button ends up elsewhere, change the map rather than rewiring.

Then power on with no card in. The Pi's boot diagnostics screen means power, HDMI and the panel are all right (A5).

### 6.2 The cabinet's identity, once, before the flash

1. In the Console: the `cabinet-picade` workspace and its spend limit, then a key scoped to it (bring-up **Part D**).
2. In a Terminal window on the Mac, from the repo on `main`:

   ```sh
   scripts/cabinet-card/picade-key.sh
   ```

   Paste the key when asked. It checks the key's workspace, applies the Studio agent there (writing `claude-lock.arcade.json`; commit it), stores the identity privately on the Mac (`~/.config/game-studio-arcade/cabinets/arcade/`, mode 0600, never the repo), and proves it with a session that sends no message. Look for `ok   workspace …, agent version N`. `picade-key.sh --check` proves it again later without asking for anything.

### 6.3 Write the card

The virtual cabinet must be running, because the card copies its Groq key and its games, makers, coin history and logs. Put the microSD card in the Mac's reader. In a Terminal window, from a clean `main`:

```sh
node scripts/cabinet-card/flash.mjs --check     # what it would gather; writes nothing
node scripts/cabinet-card/flash.mjs --list      # which disks it could write, and why the others are refused
node scripts/cabinet-card/flash.mjs --disk diskN
```

- It asks you to type `erase diskN NNGB` exactly.
- It asks for the Wi-Fi name and password, which are never stored. Only the derived Wi-Fi key goes on the card, and first boot deletes it. If `~/.config/game-studio-arcade/wifi.json` (mode 0600) holds them, it uses that instead.
- It asks for the Mac's password, so sudo can write the card.
- It writes and verifies about 3 GB, then ejects. About 5 minutes.
- Everything is gathered before the card is touched, so if anything stops, the card is unchanged.

**A clean start for the first switch-on (`--day-one`).** By default the card brings the virtual cabinet's shelf across as it is, test games included. A day-one file picks which games show, refills the pot and hides makers from "Who's making?". [docs/day-one.json](docs/day-one.json) is ours. Write your own with the ids from your virtual cabinet, then pass it to both commands: `flash.mjs --check --day-one FILE`, then `flash.mjs --disk diskN --day-one FILE`.

Other options are in the header of `scripts/cabinet-card/flash.mjs`:

- `--country` (default `US`), `--timezone`, `--locale`.
- `--wpa3` for a WPA3-only network.
- `--no-groq` (Moonshine only), `--no-seed` (no twin data), `--no-identity` (starts offline).

### 6.4 First boot

Put the card in from underneath, plug the USB mic into a black USB 2 port, and power on. The screen shows **Setting up the arcade** with each of its 8 steps and restarts once by itself. Then you get the welcome and the shelf, with **Make a new game** already connected. In a VM rehearsal this took 2 minutes. On a Pi over Wi-Fi, expect 10–25 minutes. If the screen says **Setup stopped**, a power cycle carries on, and the log is on the card's boot partition at `seed/provision.log`.

### 6.5 Finding it on the network

The cabinet is `arcade.local`:

```sh
ping arcade.local
scripts/cabinet-card/picade-connect.sh --where   # tries arcade.local, the router's name for it, then the last address that worked
```

Its admin SSH (key only) is up from first boot, with a key the card script made in `~/game-studio-data/cabinets/arcade/ssh/`. If it never shows up:

- **Wrong Wi-Fi details or no signal:** plug an Ethernet cable into the Pi and power-cycle it. To fix the Wi-Fi, write the card again with the right details.
- **Wi-Fi lost later:** the cabinet keeps retrying on its own. At the cabinet, holding **ENT + COIN** for 3 seconds on the shelf opens a network picker.

Both are in [flash-day.md](docs/flash-day.md#if-it-doesnt-show-up-on-the-network).

### 6.6 Tailscale (optional)

First boot installs a pinned Tailscale and leaves it waiting for a sign-in. No script signs in to anything, and play never depends on it (D397).

1. Over SSH, run `sudo tailscale up --hostname=arcade --ssh=false --accept-dns=false` on the cabinet. It prints a link.
2. Open the link and approve the machine in your Tailscale account.
3. Turn off key expiry for `arcade` in the Tailscale admin console.

The Mac then also reaches it as `arcade` over the tailnet, using the same SSH key. See [flash-day.md §7](docs/flash-day.md#7-remote-access-sign-tailscale-in-once).

### 6.7 The twin and the hourly backup

Until it's copied, the card is the only place the kids' games live. Once the cabinet is on the Wi-Fi, install the hourly backup **from your main checkout**, not a worktree:

```sh
scripts/twin-backup/install.sh      # runs once now, then every hour, no window; undo with uninstall.sh
```

It copies the real cabinet into `~/game-studio-data/twin/backup`, then on into the virtual cabinet. From then on the virtual cabinet follows the real one:

```sh
node scripts/twin.mjs status    # what differs; reads both, writes nothing
node scripts/twin.mjs sync      # pull the real cabinet's data into the twin, append-only
```

Nothing is ever deleted on either side. If the card dies, write a new one from the backup with `flash.mjs --disk diskN --from-backup` (bring-up **Part G**).

---

## 7. Running it

### The shelf

The joystick moves, **A** picks, **ESC** (black button on the left side) goes back to the shelf from any game, **1UP** is START, **COIN** spends coins, and **ENT** types with the stick instead of talking. **Make a new game** starts the Studio:

1. Pick your name. For a new name, hold a button and say it.
2. Hold a player button and describe the game.
3. Answer each question with the stick. A and B are Claude's options, C is "Something else" (talk again), and D is "Make it now".
4. Play the game it makes.

Each version of every game is kept, and the shelf shows the latest of each.

### The Cabinet Manager

A local web app on the Mac, on port 8335. It shows each cabinet's screen and has Coins, Health (temperature, throttling, Wi-Fi, disk), Speaker volume, Games (take a game off the shelf or put it back), Activity (every make, with its cost) and Software (updates).

```sh
scripts/manager-launchd/install.sh   # keep it always on (from the main checkout); or: scripts/manager.sh start
scripts/manager.sh url               # the link with the Manager's key; open it once per browser
```

Pick **Real cabinet (Picade)** at the top, then press **Pair** on the Coins page the first time. The Manager only watches the real cabinet. To press its buttons from the Mac, turn on `scripts/cabinet-card/driver-keyboard.sh on` (and `off` afterwards). First-run walkthrough: [bring-up, "The Manager on the real cabinet"](docs/cabinet-bring-up.md#the-manager-on-the-real-cabinet-first-run-d369).

### Coins and makers

The coin pot is the kids' visible budget: 100 coins a month by default, and each make costs what it really cost. A grown-up adds coins from the Manager's Coins page or with `coin.mjs`, which talks to the virtual cabinet by default:

```sh
node scripts/coin.mjs show                  # the pot, this month's makers, the last entries
node scripts/coin.mjs add 20 "birthday"     # adds coins; the reason shows in the kids' coin history
node scripts/coin.mjs reset "new month"     # back to 100
```

Makers are the names on "Who's making?". A kid normally adds their own at the cabinet. From the Mac:

```sh
node scripts/maker.mjs list
node scripts/maker.mjs add NAME                          # a kid maker, as the cabinet's "Someone new" makes
node scripts/maker.mjs add-grown-up NAME                 # named in logs, not offered to the kids
node scripts/maker.mjs --cabinet real list               # the real cabinet instead of the virtual one
```

### Updates over Wi-Fi

After the first boot, the card never needs to come out again. Run updates from a clean `main` when nobody is playing:

```sh
node scripts/virtual-cabinet/update-cabinet.mjs --picade --os   # software, OS packages, and the agent's brief if it changed
node scripts/cabinet-card/boot-update.mjs adopt                 # once, after the first update: today's boot files get their own slot
```

- The Manager's **Software** tab runs the same update.
- An update keeps every data file and the key, and rolls itself back if the cabinet isn't healthy afterwards.
- The kernel and boot firmware only change with `boot-update.mjs` (`status`, `packages`), through the Pi's tryboot. A boot that fails reverts on its own.

Details: bring-up **Part F**, and the [update section of cabinet/README.md](cabinet/README.md#update-the-cabinet).

### Guest games

Alongside the games the kids make, the shelf has free "guest" games: open-source web games, TIC-80 carts, homebrew Game Boy/GBA/NES ROMs in RetroArch's web build, and PICO-8 carts. Each one lives in `guests/<id>/` with a `guest.json` that records its source, licence and credits, and a `play/` folder that's committed, so the cabinet never downloads anything.

- **To add one:** write `guests/<id>/guest.json`, then run `node scripts/guests/build.mjs guests/<id>`. It fetches the pinned file, checks its SHA-256, and builds `play/` with the pinned player from [scripts/guests/players.lock.json](scripts/guests/players.lock.json). Commit the folder, then update the cabinet.
- **Licences:** use only games whose licence allows redistribution, and record it. `scripts/guests/test/guests.test.mjs` checks every guest's licence fields. Carts with no stated licence are left out.
- **PICO-8:** you need your own PICO-8 licence. Put the macOS app at `~/game-studio-data/pico8/PICO-8.app`; `build.mjs` uses it to make PICO-8's own web export. The PICO-8 program itself never goes in git or on a cabinet. Lexaloffle allows exported carts to be distributed with the cart author's permission. Most BBS carts are CC BY-NC-SA 4.0, which is fine for home play: credited, unchanged, never sold.
- [guest-shortlist/](guest-shortlist/) holds games that were checked but aren't on the shelf. To add one, move its folder into `guests/` with `git mv`.

The candidates, and why some were left out: [docs/guest-players.md](docs/guest-players.md).

---

## 8. Making games at the desk

For bigger projects, a grown-up and a kid work in Claude Code on the Mac and publish to the cabinet. This uses your own Claude Code account, not the cabinet's key. The `game-studio` plugin gives Claude Code two MCP servers and a skill:

- **`arcade`**: the cabinet's tools, running on the cabinet itself (`list_carts`, `get_cart`, `publish_cart` through the publish gate, `launch_on_cabinet`, `get_activity`, …).
- **`studio`**: tools on the Mac (`new_cart`, `validate_cart`, `playtest`, `play` in a browser with the keyboard as joystick, `import_asset`, `read_kit`).
- **`build-cart`**: the skill. Work spec first with the kid, then check, play, publish and launch.

Before it works, the cabinet must be paired with the Manager (`node scripts/coin.mjs pair` for the virtual cabinet, **Pair** in the Manager for the real one), and the Mac must have the cabinet's SSH key.

Install it from your clone. The repo is a one-plugin marketplace:

```sh
claude plugin marketplace add ~/claude-home/game-studio-arcade
claude plugin install game-studio@game-studio-arcade
```

The installed plugin runs the code in your checkout, so pull there to update it. If your clone isn't at `~/claude-home/game-studio-arcade`, set `GSA_REPO` to its path in the environment Claude Code starts in. To try it without installing, run `claude --plugin-dir <your clone>/game-studio/plugin`.

**Which cabinet it talks to.** In order:

1. `ARCADE_CABINET`, if it's set in the environment Claude Code started in.
2. A `.arcade-cabinet` file holding one word (`real` or `virtual`), in the project folder or any folder above it.
3. Otherwise, the virtual cabinet.

For example, `echo real > .arcade-cabinet` makes the project folder use the real cabinet. In a session, `use_cabinet` switches, and every result names the cabinet that answered.

**Publish and launch.** Ask Claude to make or change a game with the kid. When it's ready, `publish_cart` sends it through the cabinet's publish gate: the cabinet re-runs the game's playtest before it reaches the shelf. `launch_on_cabinet` then starts it on the cabinet's screen. A game made at the desk appears on the shelf like any other, credited to its maker. To credit a kid, add them first with `maker.mjs add NAME`. Details: [game-studio/README.md](game-studio/README.md).

---

## 9. Safety and privacy

- **Kid screening** (D270–D276): a kid's request, and their own words during a make, are checked before anything starts or any coins are spent. The check is a short word list on the cabinet, then a small Haiku call. It's a light touch. It catches profanity, slurs, bigotry and sexual content, lets cartoon game violence through, and **redirects with a close, safe alternative instead of scolding**. Every check is logged on the cabinet.
- **Open chat with game characters** has its own twelve rules ([docs/game-ai.md](docs/game-ai.md)):
  - The cabinet owns the mic, not the game.
  - The kid's words are screened going in, and the character's reply is screened before the kid sees it.
  - If the screening can't run, the game uses a fallback line: it fails closed.
  - The characters never ask for anything personal, say they're made up if asked, and point a worried kid to a trusted grown-up.
  - Nothing carries over from one play to the next.
- **No raw audio is kept anywhere.** Each clip lives in memory while it's transcribed, then it's zeroed and dropped. The speech log records lengths and timings, never the words. Turn on Groq's Zero Data Retention before any child's voice is sent.
- **Managed Agents sessions are stored by Anthropic.** They aren't eligible for Zero Data Retention, so session transcripts persist until you delete them ([overview, Beta access](https://platform.claude.com/docs/en/managed-agents/overview#beta-access)). The Studio's sandbox has no network.
- **Keys never go in carts, git, the launcher or logs.** Each cabinet's key is only in its 0600 service config. On the card it sits on the boot partition only until first boot moves it and zeroes the copy, so keep the card with you until then. The Mac signs in with the `ant` profile. Never set `ANTHROPIC_API_KEY`. Run key scripts in a Terminal window, not through a chat.
- **The kids' data stays at home.** Their games, transcripts and logs live on the cabinet and in the Mac's backup, never in this repo. The activity log, readable in the Manager, is how a grown-up keeps an eye on things. There's no approval step.

---

## 10. Map of the repo, and licences

| Path | What it is |
|---|---|
| [runtime/](runtime/README.md) | The house runtime: a small JavaScript fantasy console (256×192) that every made game runs on, with its starter library. |
| [studio-kit/](studio-kit/) | What every Studio session builds with: [spec](studio-kit/spec/README.md) format, [playtest](studio-kit/playtest/README.md) harness, [context pack](studio-kit/context-pack/README.md), [managed-agent](studio-kit/managed-agent/README.md) definition, [cli](studio-kit/cli/README.md), local [player](studio-kit/player/README.md). |
| [cabinet/](cabinet/README.md) | What makes stock Raspberry Pi OS Lite into a cabinet: the provisioning script and profiles (`provision/`), the cabinet service and launcher (`service/`), the twin (`twin/`), and the VM driver (`vm/`). |
| [manager/](manager/) | The Cabinet Manager web app. |
| [game-studio/](game-studio/README.md) | The desk plugin for Claude Code. |
| [guests/](guests/), [guest-shortlist/](guest-shortlist/) | Third-party games on the shelf, and the ones waiting. |
| `scripts/` | `setup-anthropic-auth.sh`, `wif/`, `virtual-cabinet/` (build, connect, update the VM), `cabinet-card/` (flash, identity, repair, boot updates), `guests/`, `twin.mjs` and `twin-backup/`, `coin.mjs`, `maker.mjs`, `manager.sh` and `manager-launchd/`. |

| Doc | Read it for |
|---|---|
| [docs/HANDOFF.md](docs/HANDOFF.md) | The original brief. |
| [docs/decisions.md](docs/decisions.md) | Every decision, numbered. It wins over the brief. |
| [docs/platform-notes.md](docs/platform-notes.md) | Platform facts checked against live docs: Managed Agents, the Picade, UTM, Groq, PICO-8. |
| [docs/cabinet-bring-up.md](docs/cabinet-bring-up.md), [docs/flash-day.md](docs/flash-day.md) | Building and bringing up the real cabinet. |
| [docs/virtual-cabinet.md](docs/virtual-cabinet.md) | The virtual cabinet's design. |
| [docs/speech.md](docs/speech.md), [docs/hardware-mic.md](docs/hardware-mic.md) | Speech, and choosing a mic. |
| [docs/game-ai.md](docs/game-ai.md) | AI inside games: lines, choices, open chat and its rules. |
| [docs/guest-players.md](docs/guest-players.md) | Guest games and their licences. |
| [docs/phase-0.md](docs/phase-0.md), [docs/phase-0-results.md](docs/phase-0-results.md), [docs/round-two-plan.md](docs/round-two-plan.md) | Plans and measured results, costs included. |

### Licences

**This repo's own code:** MIT, see [LICENSE](LICENSE). It covers this repo's own code and docs, not the bundled third-party games below.

**Bundled third-party games** (`guests/`). Each folder's `guest.json` and `NOTICE.md` give the source, credits and the full licence details. These licences cover those games only, not this repo.

| Game | Author | Player | Licence |
|---|---|---|---|
| teti (`teti`, and a changed version, `teti-geoff`) | TitanPlayz100 | web | MIT; bundled fonts SIL OFL 1.1, pixi.js MIT |
| 8 Bit Panda | Bruno Oliveira | TIC-80 | Apache-2.0 |
| Cauliflower Power | Librorumque | TIC-80 | MIT |
| Grow Quickly | Cong | TIC-80 | MIT |
| Tobu Tobu Girl Deluxe | Tangram Games | RetroArch (Game Boy Color) | code MIT; images, text, sound and music CC BY 4.0 |
| The Hat Chooses the Wizard | Corwin Kuiper and Gwilym Inzani | RetroArch (GBA) | code MPL-2.0; art CC BY-SA 4.0; music CC BY 3.0 |
| Zooming Secretary | Shiru and PinWizz | RetroArch (NES) | CC BY (the game's manual gives no version) |
| Pizza Panda | Andrew Anderson | PICO-8 | CC BY-NC-SA 4.0 (MIT in the author's own repo) |
| Terra Nova Pinball | Matt Sutton | PICO-8 | CC BY-NC-SA 4.0 |
| Zip Zapper | ejreyes | PICO-8 | CC BY-NC-SA 4.0 |
| Up and Away | Ross McCormick | PICO-8 | CC BY-NC-SA 4.0 |
| Just One Boss | bridgs | PICO-8 | CC BY-NC-SA 4.0 |

**The players** are pinned in [scripts/guests/players.lock.json](scripts/guests/players.lock.json): TIC-80 1.4.1 (MIT) and RetroArch 1.22.2 (GPL-3.0-or-later). The PICO-8 carts are PICO-8's own web exports, which include Lexaloffle's player, and are distributed as Lexaloffle allows for exported carts. The CC BY-NC-SA games are non-commercial: don't sell them or a cabinet that bundles them.
