# Cabinet

The software that makes a stock Raspberry Pi OS Lite into a cabinet (D4, D122), and the tools to drive the virtual one. Design: [docs/virtual-cabinet.md](../docs/virtual-cabinet.md). Decisions: D120–D131 and D140–D146 in [docs/decisions.md](../docs/decisions.md).

**Status:** written and unit-tested, but never booted, because UTM still needs clearing (D146). Everything inside the VM is unproven until the first boot. The `picade` profile can't be tested until the Picade arrives.

| Path | What it is |
|---|---|
| `provision/provision.sh` | The script: `--profile picade\|virtual --payload DIR`. Safe to run again |
| `provision/lock.json`, `apt.lock` | Pinned image, kernel, overlay commit and packages |
| `provision/profiles/` | The hardware layer of each profile |
| `provision/files/` | Services and helpers it installs |
| `vm/drive` | The driver: press, hold, type, screenshot over SSH, no window |
| `../scripts/virtual-cabinet/` | Generates the UTM VM (`build.mjs`), starts it (`up.sh`), checks it (`verify.sh`) |

## Bring up the virtual cabinet

Once, on the mini, with Geoff there: `open /Applications/UTM.app`, click Open, quit UTM.

```sh
scripts/virtual-cabinet/up.sh        # builds if needed, starts headless, waits for first-boot provisioning
scripts/virtual-cabinet/verify.sh ~/game-studio-data/vm/verify
```

If bridging on Wi-Fi fails, rebuild with `node scripts/virtual-cabinet/build.mjs --replace --network Shared`, then `up.sh --network Shared`.

To rebuild from scratch and prove it's reproducible, stop the VM (`cabinet/vm/drive ssh sudo poweroff`) and remove it from UTM, then run `build.mjs --replace` and `up.sh`. **`--replace` destroys that VM's disk, carts and logs (D129).** Only use it on a VM with nothing to keep.

After a good boot, pin the packages: `cabinet/vm/drive apt-lock`, put the output in `provision/apt.lock`, and commit.

## Driving the screens

```sh
cabinet/vm/drive press down
cabinet/vm/drive press a
cabinet/vm/drive hold a 2000        # hold-to-talk style
cabinet/vm/drive down a; cabinet/vm/drive up a
cabinet/vm/drive type "make a game"
cabinet/vm/drive screenshot shot.png
```

Keys travel kernel → libinput → compositor → Chromium, as the Picade's do (D144). Screenshots are the compositor's real 1024×768 output.

## Tests

`node --test scripts/virtual-cabinet/test/` covers the generator's disk, kernel, initramfs and config logic.
