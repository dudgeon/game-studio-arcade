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
| `../scripts/virtual-cabinet/` | Generates the UTM VM (`build.mjs`), starts it (`up.sh`), checks it (`verify.sh`) |

## Bring up the virtual cabinet

Once per Mac, with someone there: `open /Applications/UTM.app`, click Open, quit UTM. The first `utmctl` call may ask to control UTM.

```sh
scripts/virtual-cabinet/up.sh        # builds if needed, starts headless, waits for first-boot provisioning
scripts/virtual-cabinet/verify.sh ~/game-studio-data/vm/verify
```

If bridging on Wi-Fi fails: `scripts/virtual-cabinet/rebuild.sh --yes-destroy-this-vm --network Shared`.

A boot that never reaches SSH: stop the VM, then `hdiutil attach` its disk and read `seed/provision.log`, or rebuild with `build.mjs --replace --serial-console` and read it with `serial.sh`. Never leave a serial build unread: it freezes (D148).

To rebuild from scratch and prove it's reproducible: `scripts/virtual-cabinet/rebuild.sh --yes-destroy-this-vm`. **That destroys the VM's disk, carts and logs (D129).** Only use it on a VM with nothing to keep.

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

## Running a whole flow

```sh
# On a fresh cabinet: the Studio flow, on replay. It makes a real cart and a maker, so it runs once per build.
node cabinet/vm/flow.mjs --script cabinet/service/scripts/flows/penguin.drive --out ~/game-studio-data/vm/verify/studio
node cabinet/vm/flow.mjs --script cabinet/vm/flows/typing.drive --out /tmp/typing  # typing checks; keeps no maker
node cabinet/vm/flow.mjs --script cabinet/vm/flows/play.drive --out /tmp/play      # any time
```

Same verbs as `cabinet/service/scripts/drive.js`, plus `expect TEXT`. It reports fit faults, cut text and page errors, and exits non-zero on any fault or error.

## Tests

`node --test scripts/virtual-cabinet/test/lib.test.mjs` covers the generator's disk, kernel, initramfs and config logic.
