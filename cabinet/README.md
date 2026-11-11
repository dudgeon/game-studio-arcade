# Cabinet

The software that makes a stock Raspberry Pi OS Lite into a cabinet (D4, D122), and the tools to drive the virtual one. Design: [docs/virtual-cabinet.md](../docs/virtual-cabinet.md). Decisions: D120–D131 and D140–D146 in [docs/decisions.md](../docs/decisions.md).

**Status:** the virtual cabinet runs the cabinet service, on replay until it has a key (D154). No VM window yet (D141), so nobody can sit and play at it. The `picade` profile has never run: it needs the Picade.

| Path | What it is |
|---|---|
| `provision/provision.sh` | The script: `--profile picade\|virtual --payload DIR`. Safe to run again |
| `provision/lock.json`, `apt.lock` | Pinned image, kernel, overlay commit and packages |
| `provision/profiles/` | The hardware layer of each profile |
| `provision/files/` | Services and helpers it installs |
| `vm/drive` | The driver: press, hold, type, screenshot over SSH, no window |
| `../scripts/virtual-cabinet/` | Generates the UTM VM (`build.mjs`), starts it (`up.sh`), updates it (`update-cabinet.mjs`), checks it (`verify.sh`) |

## Connect the virtual cabinet to Claude

Until this is done, the virtual cabinet replays a recorded make and spends nothing. Geoff does these once. Page names checked against the docs on 2026-11-08 (D131, D155).

**In the [Claude Console](https://platform.claude.com):**

1. **Make the workspace.** On [Workspaces](https://platform.claude.com/settings/workspaces), click **Create workspace**, name it `cabinet-virtual`, pick a color, and click **Create workspace**.
2. **Cap its spending.** Still on **Workspaces**, select `cabinet-virtual`, then click **Spend limits** in the panel that opens. Set it to **$10 a month**, Geoff's choice (D157). The cabinet also caps each make at about $3 (a session can overshoot by one model request), so $10 is about three makes at worst. Measured builds cost 30–60¢, so it's more like 15–30 in practice.
3. **Make its key** (Geoff's choices, D158).
   - **Who owns it.** Open [Service accounts](https://platform.claude.com/settings/service-accounts). If that page is there and lets you create one, make `arcade-virtual`, then pick **Add to workspace** in its menu and add it to `cabinet-virtual` (as **Workspace Developer**, if it asks for a role). The key's owner is that service account. If the page is missing or won't let you make one, the owner is you. Expect that on an Individual account, and don't convert the account for this.
   - **The key.** On [API keys](https://platform.claude.com/settings/keys), click **Create key** and name it `arcade-virtual`. Set **Linked account** to the owner above, **scope it to the `cabinet-virtual` workspace**, and set the expiration to **Never**. If **Linked account** only offers you, that settles it: the owner is you.
   - Copy the key when it's shown. Don't paste it anywhere else, including a chat with Claude.

**At the mini, in a Terminal window** (not with Claude Code's `!`, so the key can't land in a chat):

4. **Connect it:** on a current `main`, from the repo, run `scripts/virtual-cabinet/up.sh` if the VM isn't running, then `scripts/virtual-cabinet/connect-cabinet.sh`. Paste the key when asked; nothing shows as you paste. Check the workspace it names, read the plan, and answer `y`. It clears the key from the clipboard.
5. **Tell Claude it's done.** Claude commits `studio-kit/managed-agent/claude-lock.arcade-virtual.json` (no secrets in it) and runs the first live make when you and the director say so.

The soak (`soak.sh`, D156) restarts the VM while it runs. If one is going, tell Claude first: a restart in the middle of step 4 would make it fail, though running it again is safe.

Geoff does this once. Later fixes use the update below, which keeps the key, carts and logs. The Console shows a key only once, and a rebuild removes it from the cabinet, so after a rebuild this needs a new key.

To undo: on **API keys**, disable or delete the key. The cabinet's Make stops working, and nothing else changes.

If the script says it can't reach the cabinet or can't write its config, the mini's path to the VM has dropped (D156). These gaps usually last under a minute, and running it again is safe, so wait a minute and try again. If it still can't, restart the VM: `/Applications/UTM.app/Contents/MacOS/utmctl stop arcade-virtual`, then `scripts/virtual-cabinet/up.sh`, and run step 4 again.

After the Studio agent changes: `scripts/virtual-cabinet/connect-cabinet.sh --reapply`, which reuses the key on the cabinet.

## Update the cabinet

```sh
node scripts/virtual-cabinet/update-cabinet.mjs    # from a clean checkout of main
```

This is how fixes reach a running cabinet (D195). Its data and key stay as they are, the version moves, and the old release is kept. A game being played is interrupted when the service restarts. It refuses while a make is running or one is still to be collected. The cabinet checks every data file and the config before and after (D196): logs may only grow, everything else must be byte-identical. It rolls back if the service doesn't return.

To go back by hand: on the cabinet, `ls /opt/arcade/releases`, point `/opt/arcade/current` at the older one, and restart `arcade-launcher` and `arcade-kiosk`.

## Add coins or reset the pot

Until the Cabinet Manager exists, a grown-up does it from the mini (D215). The reason is shown to the kids in the coin history (A2).

```sh
node scripts/coin.mjs pair                      # once: the cabinet makes its Manager token, and a copy is kept in ~/.config/game-studio-arcade/
node scripts/coin.mjs show                      # the pot, this month's makers, the latest entries
node scripts/coin.mjs add 20 "Owen helped clean the basement"
node scripts/coin.mjs reset "Fresh start after the fix"
```

`add` warns, and stops unless given `--yes`, when the month could pass the workspace's real $15 limit (D211). It goes through the cabinet's own SSH (`cabinet/vm/drive`), and the token only ever travels on stdin.

## Bring up the virtual cabinet

Once per Mac, with someone there: `open /Applications/UTM.app`, click Open, quit UTM. The first `utmctl` call may ask to control UTM.

```sh
scripts/virtual-cabinet/up.sh        # builds if needed, starts headless, waits for first-boot provisioning
scripts/virtual-cabinet/verify.sh ~/game-studio-data/vm/verify
```

If bridging on Wi-Fi fails: `scripts/virtual-cabinet/rebuild.sh --yes-destroy-this-vm --network Shared`.

A boot that never reaches SSH: stop the VM, then `hdiutil attach` its disk and read `seed/provision.log`, or rebuild with `build.mjs --replace --serial-console` and read it with `serial.sh`. Never leave a serial build unread: it freezes (D148).

**Rebuilding isn't how to ship a fix.** `scripts/virtual-cabinet/rebuild.sh --yes-destroy-this-vm` destroys the VM's disk, carts, logs and key (D129). Use it only for a broken VM with nothing to keep, or to prove the build is reproducible.

After a good boot, pin the packages: `cabinet/vm/drive apt-lock`, put the output in `provision/apt.lock`, and commit.

## Driving the screens

```sh
cabinet/vm/drive press down
cabinet/vm/drive press a
cabinet/vm/drive hold a 2000        # hold-to-talk style
cabinet/vm/drive down a; cabinet/vm/drive up a
cabinet/vm/drive type "make a game"
cabinet/vm/drive screenshot shot.png
cabinet/vm/drive run my-script.sh    # run a local script on the cabinet
```

Keys travel kernel → libinput → compositor → Chromium, as the Picade's do (D144). Screenshots are the compositor's real 1024×768 output.

The mini can lose the cabinet for about 40 seconds at a time (D156). `drive` and `flow.mjs` wait that out, for up to `ARCADE_RIDE_S` seconds (default 300). Each key has an id, so it lands exactly once (D195), and steps can finish late. `drive ssh` and `drive run` don't repeat.

Bridged on Wi-Fi, that path can also stay lost until a restart (D240). So the mini drives the cabinet over a second, private card on macOS's shared network (D241), and the home network still sees it bridged. `up.sh` writes that card's address to `~/game-studio-data/vm/host`, and everything here uses it. To give the existing VM that card without rebuilding it:

```sh
scripts/virtual-cabinet/mini-link.sh --check   # "has it" or "doesn't have it"
# stop the VM and quit UTM, then:
scripts/virtual-cabinet/mini-link.sh           # edits only UTM's config, keeping a copy beside it
scripts/virtual-cabinet/up.sh
```

The cabinet records its own paths (D242): `sudo journalctl -u arcade-netwatch` on it, kept across restarts.

## Running a whole flow

```sh
# On a fresh cabinet: the Studio flow, on replay. It makes a real cart and a maker, so it runs once per build,
# and the cabinet can't be connected to Claude until it's rebuilt (D155).
node cabinet/vm/flow.mjs --script cabinet/service/scripts/flows/penguin.drive --out ~/game-studio-data/vm/verify/studio
node cabinet/vm/flow.mjs --script cabinet/vm/flows/typing.drive --out /tmp/typing  # typing checks; keeps no maker
node cabinet/vm/flow.mjs --script cabinet/vm/flows/play.drive --out /tmp/play      # any time
```

Same verbs as `cabinet/service/scripts/drive.js`, plus `expect TEXT`, `expect-sel N`, `home` and `repeat N` ... `end`. It reports fit faults, cut text, page errors and how the keys added up, and exits non-zero on any fault, error or mismatch.

`cabinet/vm/flows/gap-walk.drive` is a long walk where every press is checked against the screen, for proving the driver across gaps.

## Tests

`npm test` runs these with the rest: `scripts/virtual-cabinet/test/lib.test.mjs` covers the generator's disk, kernel, initramfs and config logic. `connect.test.mjs` runs `connect-cabinet.sh` end to end with stand-ins, a fake key and no VM.

Run by hand, because they need the cabinet:
- `scripts/virtual-cabinet/test/connect-vm.sh`: the connect path on a real cabinet. **It leaves a fake key, so rebuild afterwards.**
- `scripts/virtual-cabinet/verify.sh`: the whole cabinet, safe to repeat.
- `scripts/virtual-cabinet/test/update-vm.sh`: the in-place update on a real cabinet, with a stand-in key, cleaning up after itself.
- `scripts/virtual-cabinet/soak.sh`: bridged network reachability from both sides (D156), restarting but never rebuilding.
- `scripts/virtual-cabinet/gap-measure.sh`: where the gaps live, and whether a held connection rides them. Changes nothing.
- `scripts/virtual-cabinet/path-soak.sh OUT HOURS`: the private card against the bridged path, every 5 s, plus the cabinet's own record (D243). Changes nothing.

`link.test.mjs` covers the private card's config, lease lookup, `mini-link.sh`, and the profile's keyfile and firewall. `netwatch.test.mjs` runs `arcade-netwatch` against stand-ins for `ip`, `arping` and `ping`.
