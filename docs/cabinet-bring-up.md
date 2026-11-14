# Picade bring-up checklist

For Geoff, in the order you'll do it. Each step: **do**, **look for**, **if not**. Written 2026-11-11 (D256).

- 🔧 = only the cabinet itself can prove this.
- ✅ = already checked on the mini (tests or the virtual cabinet); the cabinet just confirms it.

Sources, checked live 2026-11-11: Pimoroni's [Assembling your Picade](https://learn.pimoroni.com/article/assembling-your-picade) (10" 2025 edition, 30 July 2025), [Picade software guide](https://learn.pimoroni.com/article/setting-up-picade) (5 Aug 2025), [pimoroni/picade-hat](https://github.com/pimoroni/picade-hat) at `f97c2ac`, still its latest commit. Background: [platform-notes.md](platform-notes.md#picade-10-inch-2025-edition).

---

**On the day itself:** [flash-day.md](flash-day.md) walks through it in order, from the card reader arriving to the kids' first game.

## The first end-to-end run, short

For when the cabinet is built (Part A). The card carries everything, so the Picade is ready the moment it's switched on: the shelf with the virtual cabinet's games, speech on Groq (Moonshine as the fallback), and Make (D320-D326). Nothing is typed into the cabinet or run against it afterwards. Details are in the parts below.

1. **Once, before the flash (you):**
   - In the Claude Console: the `cabinet-picade` workspace and its spend limit, then a key scoped to it. Copy the key. (D1)
   - In a Terminal window on the mini, from the repo on `main`: `scripts/cabinet-card/picade-key.sh`. Paste the key when it asks (nothing shows). It checks the key's workspace, sets the Studio up there, stores the identity privately on the mini, and proves it with one session that sends no message. Look for `ok   workspace ..., agent version N`. (D329)
2. **Flash, at the mini.** The virtual cabinet must be running (the card copies its Groq key and its games). Put the card in the mini's reader. In a Terminal window, in the repo on `main`:
   `node scripts/cabinet-card/flash.mjs --check` first: it says whether everything the card needs is there, and writes nothing. Then `node scripts/cabinet-card/flash.mjs --list`, then `node scripts/cabinet-card/flash.mjs --disk diskN --day-one docs/day-one.json` with the disk it names (`--day-one`: Geoff's clean start, a full pot, the chosen shelf and the Tester makers hidden; D356-D358. Claude writes that file with the list Geoff confirms).
   It asks, in this order:
   - the `erase diskN NNGB` phrase it shows;
   - the Wi-Fi name and password (nothing shows), unless `~/.config/game-studio-arcade/wifi.json` holds them (D327);
   - then the mini's own password, for sudo to write the card.

   Nothing about keys: the Picade's identity (from step 1), the Groq key and the virtual cabinet's games, makers, coin history and logs come across by themselves. About 5 minutes; it ejects the card. (Part B)
3. **Card into the Pi** from underneath. **Plug your USB mic into a black USB 2 port.** Power on.
4. **Wait for the shelf.** In the rehearsals (a VM on the mini, wired) it took 2 minutes. On the Pi, over the basement Wi-Fi onto the SD card, expect several times that, mostly the browser step. The screen shows "Setting up the arcade" with each step and restarts once by itself. Then you get the first-time welcome, and the shelf with the virtual cabinet's games and **"Make a new game: Tell Claude your idea"**. (Part C)
5. **Make a game with the cabinet's own controls:** stick and **A** to pick Make and your name; **hold a player button and talk**, let go to send; answer each question with the stick and A (D is "Make it now"); play the new game; **ESC** back to the shelf. Claude watches from the mini on the Manager (`scripts/manager.sh url`, Real cabinet) and reads the logs. (E2) The Manager only watches the Picade: its driver keyboard stays off unless you switch it on with `scripts/cabinet-card/driver-keyboard.sh on` (D287).

Afterwards, Claude commits `studio-kit/managed-agent/claude-lock.arcade.json` (no secrets in it), and from then on the twin follows the Picade: `node scripts/twin.mjs sync`. Updates reach the Picade over the network (its admin SSH is up from first boot); the card isn't touched again.

---

## Part A: build it (start now, no software needed)

Allow 2–3 hours. Tools: a cross-head screwdriver and a flat one 2.5 mm or smaller. Tweezers help. A second pair of hands helps with the screen and marquee.

**A1. Check the edition** 🔧
- Do: look at the box.
- Look for: a pink "designed for Raspberry Pi 5" sticker. That's the 2025 edition, the one the guide and our setup assume.
- If not: stop and tell Claude. An older edition (square PICO-8 sticker) has a different guide and isn't promised to fit a Pi 5 with cooler.

**A2. Check the parts you bought** 🔧
- microSD card: 16 GB or more (32–64 GB is ideal). The card script refuses anything under 8 GB or over 260 GB.
- Power supply: USB-C, 5 V / 5 A (the official 27 W Pi 5 supply). It plugs into the **X HAT's** USB-C, never the Pi's own port.
- Active Cooler: the official Pi 5 one.

**A3. Follow Pimoroni's guide** 🔧 ([link](https://learn.pimoroni.com/article/assembling-your-picade)), with these extra checks at the steps named:

- **Feet and brackets:** screw heads always outside the cabinet, nuts inside.
- **Active Cooler, before the Pi goes on its standoffs:** peel the thermal pads' film, push both pins through the Pi's holes until they click, and plug the fan's lead into the Pi 5's small 4-pin **FAN** socket on the board. It's optional in the guide, but we want it: one user saw about 85 °C under the HAT without one.
- **Pi on the base:** the microSD slot sits over the cutout. Leave the card out for now; it goes in from underneath later.
- **Booster header:** push it onto the Pi's 40 pins and check it isn't one pin off at either end (count the empty pins: there should be none). Then the four 17 mm standoffs, then the X HAT. The HAT must not touch the cooler.
- **Speaker:** red to **+**, black to **−** on SPEAKER. Tug each wire: the screw must grip bare metal, not the insulation. Don't press the paper cone.
- **Screen:** don't over-tighten anything touching acrylic: it cracks. The keypad ribbon goes **under** the grey clips at both ends ("you might still get it to fit but it won't work").
- **HDMI:** micro-HDMI into **HDMI-0**, the port next to the Pi's USB-C. The other one gives a black screen.
- **Screen power (micro-USB → USB-A):** plug the USB-A end into one of the Pi's **black USB 2 ports**. See A4.
- **Power button:** one wire pair from LED 1/2 to the HAT's **LED** header, the other from **C/NO** to the HAT's **ON** header. Check no spade connectors on the back of the button touch each other.
- **Joystick:** the white plug only fits one way on the stick. At the HAT, wire **1 (GND)** goes to the GND-marked pin of **JOYSTICK**.
- **Buttons and black buttons: wire them as in the printable diagram, [hardware/picade-wiring.png](hardware/picade-wiring.png)** (SVG beside it). Pimoroni's guide says any socket works "as we'll be remapping the inputs in software later on". That's true, and ours are already set (D82), so wiring to the diagram means nothing needs changing later.
  - Coloured buttons, looking down with the joystick on the left: near row blue = **1 (A)**, yellow = **2 (B)**; far row blue = **3 (X)**, yellow = **4 (Y)**; pink far = 5, pink near = 6 (spares). The number is the HAT socket marked 1 to 6. Each two-pin plug fits either way round.
  - Black buttons: front left = **1UP** (START), front right = **COIN** (spend coins), left side = **ESC** (back to the shelf; on a side so it isn't hit mid-game), right side = **ENT** (type instead of talking; rarely used).
- If a button ends up in a different socket, don't rewire: tell Claude which button does what, and the map changes in software.
- **Last:** check every spade connector, and that no bare metal touches other metal.

**A4. USB ports: what goes where** 🔧

The Pi 5 has two **blue USB 3** ports and two **black USB 2** ports.

| Port | Use |
|---|---|
| black USB 2 | screen power (from the driver board) |
| black USB 2 | the USB mic, when it moves to the cabinet |
| blue USB 3 | free (a USB stick, a controller later) |

Why black for the mic: a mic needs nothing faster than USB 2, and USB 3 ports and cables can put noise on 2.4 GHz Wi-Fi, which the cabinet relies on. The mic's cable has to leave the case: past the back panel, or through a hole in panel F later (see [hardware-mic.md](hardware-mic.md)). For now your USB mic stays on the mini for the virtual cabinet; the speech worker sets up the cabinet's side.

**A5. First power-on, with no card** 🔧 (this proves power, screen and cooler before any software)
- Do: back panel off so you can see in. USB-C supply into the X HAT. Tap the power button.
- Look for: the Pi's red/green LED, the cooler spinning up, and on the screen the Pi 5's **boot diagnostics screen** (Raspberry Pi logo, a QR code, and lines about not finding boot media). That screen means power, HDMI-0, the panel and its power are all right.
- If the screen flashes on and off: expected for now. It's the Pi limiting USB current to the screen; the card's setup adds `usb_max_current_enable=1`, which fixes it.
- If the screen stays black: check HDMI-0 (not HDMI-1), the LVDS ribbon (blue side, grey tab down), and the screen's micro-USB.
- If nothing lights: check the supply goes into the HAT, and the booster header isn't a pin off.
- Then: hold the power button about 3 seconds to switch off, or unplug (there's nothing to damage with no card in).

---

## Part B: the card (when Claude says the script is ready)

**B1. Write the card on the mini** ✅ (script tested by writing a card image file; never yet a real card)
- Claude, or the director, asks you first: writing a card erases it.
- In a **Terminal window** on the mini, from the repo on a clean `main`:
  ```
  node scripts/cabinet-card/flash.mjs --list
  node scripts/cabinet-card/flash.mjs --disk disk4
  ```
  (use the disk `--list` says can be written).
- It shows the card's name, size and partitions, and asks you to type something like `erase disk4 32GB`. Anything else stops it.
- It asks for the home Wi-Fi name, then the password (nothing shows as you type). The password is never stored: only the Wi-Fi key derived from it goes on the card, and the card deletes that file on first boot.
- It reads the Picade's identity that `picade-key.sh` stored (D329; if there's none it says to run that first, before touching the card), copies the Groq key from the virtual cabinet, and takes the virtual cabinet's games, makers, coin history and logs by the twin's rules (never keys or tokens). Nothing about keys is typed.
- All of that is gathered before the card is touched: if anything stops, the card is as it was.
- sudo asks for the mini's password to write the card. It writes about 3 GB, reads it back to check, adds the setup files and the keys, and ejects.
- The keys are on the card's boot partition only until first boot, which moves them into the cabinet's own config (owner `arcade`, mode 0600) and overwrites them with zeros. Until then, keep the card with you.
- If the virtual cabinet isn't running, it stops and says so before touching the card. `--no-groq`, `--no-seed` and `--no-identity` leave those parts off (see D320-D324).
- If it refuses the card: it says why (internal disk, not a card reader, too big, read-only switch). Read the reason before trying anything else.

**B2. Card into the Pi** 🔧
- Power off. Card in from underneath, contacts facing the Pi's board.

---

## Part C: first boot (unattended, about 10–25 minutes)

**C1. Power on and wait** 🔧
- Look for, in order: text scrolling, a reboot or two (the Pi grows its partition), then **"Setting up the arcade"** in large letters with the step it's on (8 steps: the clock, the screen and browser, Node, the arcade, speech, the cabinet's buttons and sound, starting, finishing) and how many minutes since it was switched on (D257). The browser step downloads from the internet and is the slow one; speech comes from the card. If it says **"Setup stopped"**, tell Claude; a power cycle runs it again from where it can.
- It restarts once by itself at the end (so the Picade driver and screen power take effect), then **the shelf** appears: the cabinet's game list. Claude checks it from the mini over SSH.
- If it never reaches the shelf after 30 minutes: tell Claude. The log is on the card's boot partition at `seed/provision.log` (readable on the mini), and on the cabinet over SSH.

**C2. Wi-Fi in the basement** 🔧
- On the mini: `ping arcade.local`. Claude checks it joined the home Wi-Fi, the signal level, and that it can reach the internet but not the mini (the cabinet never uses the mini, D7).
- If it can't be found: the Wi-Fi name or password was wrong, or the basement is out of range. Re-writing the card is the fix for the first; a mesh point nearer the basement for the second.
- If the network is **WPA3-only**, the precomputed key can't work: re-write the card with `--wpa3`, which puts the password itself on the card (still erased at first boot). Most mesh systems run WPA2/WPA3 mixed, which the default handles.

**C3. Screen** 🔧
- Look for: the shelf filling the 10" screen with no black bars and sharp, square pixels (1024×768, D81).
- If the screen flashes: the config line didn't apply. Claude checks `/boot/firmware/config.txt`.
- If it's black or the wrong size: Claude forces 1024×768 on HDMI-0 (`video=HDMI-A-1:1024x768@60D` in cmdline.txt). Not set by default because it can confuse the screen if the panel reports itself correctly, which it should.

**C4. Controls** 🔧 ✅ (the key map is tested against the runtime's keys; the overlay's wiring isn't)
- On the shelf: joystick moves the selection in all four directions; **A** picks; **ESC** goes back to the shelf from a game; **1UP** is START; **ENT** and **COIN** do their launcher jobs.
- If one joystick direction works and the opposite doesn't, or they're swapped: turn the JOYSTICK plug on the HAT round 180° (Pimoroni's own fix).
- If a button does nothing: reseat its spade connectors. If it does the wrong thing: tell Claude which button sends what; the map is in software (D82, `cabinet/provision/profiles/picade.sh`).
- Claude can watch the raw key presses over SSH while you press each one.

**C5. Sound** 🔧
- Look for: a game's sound from the speaker.
- Pimoroni warns 100% is "a bit much". Claude sets the level with you over SSH (the `PCM` control); tell Claude what level the kids should get.
- If silent: speaker wires (+/−, bare metal gripped), then Claude checks the X HAT's sound card shows up as `sndrpihifiberry`.

**C6. Power button** 🔧
- Tap to switch on: should start the Pi (one Pi 5 user found this unreliable; if so, the HAT's own "switch" button or replugging the supply also works).
- Hold 3 s to shut down: the screen goes off and, a few seconds later, the HAT cuts power.
- **Watch for:** if a quick tap while it's running shuts it down, a kid can switch it off by accident. Tell Claude; it can ignore short presses and shut down only on a long one.

**C7. Temperature** 🔧
- Claude reads the Pi's temperature after a few games and during a make. Under 80 °C is fine; the Pi slows itself at 85 °C.

---

## Part D: the cabinet's own Claude identity (D131, D254, D320)

Like the virtual cabinet's, but its **own new workspace and key**, so its spending is capped and counted on its own. You make them once, before the flash; the flash does the rest.

**D1. In the Claude Console, before the flash** (you)
1. [Workspaces](https://platform.claude.com/settings/workspaces) → **Create workspace**, name it `cabinet-picade`.
2. Select it → **Spend limits** → set the monthly limit you want for the real cabinet.
3. [API keys](https://platform.claude.com/settings/keys) → **Create key**, name `arcade`, **scoped to `cabinet-picade`**, expiry **Never**. Owner: a service account if the Console offers one, else you (as for the virtual cabinet, D158). Copy it, and paste it only into `scripts/cabinet-card/picade-key.sh` (in a Terminal window on the mini). It stores the identity in `~/.config/game-studio-arcade/cabinets/arcade/identity.json` (mode 0600; never the repo) and proves it live. `picade-key.sh --check` proves it again any time (D329).

**D2. Repair tools, only if something needs changing later** (in a Terminal window on the mini):
- `scripts/cabinet-card/connect-picade.sh`: a new key or workspace for the Picade, over its SSH; `--reapply` after the Studio agent changes.
- `scripts/cabinet-card/groq-picade.sh`: a new Groq key; `--off` takes it off (Moonshine carries on).

---

## Part E: the data, and the first real make

**E1. The twin's data** (D290-D299, D324)
- The card carries the virtual cabinet's games, makers, coin history and logs as they were at the flash (Geoff's yes, 2026-11-13). First boot puts them in place before the starter games. Nothing on either cabinet is deleted (D5); keys, config and the Manager token never move.
- **Look for:** the virtual cabinet's games on the Picade's shelf (Tester's included; `twin-seed.json` lists them as test data).
- From then on the Picade is the real one and the twin follows it: `node scripts/twin.mjs sync` (and `status`).

**E2. First make on the cabinet** 🔧
- With a kid, from the shelf: Make → answer with the stick and buttons → a game lands on the shelf → play it.
- Claude watches from the mini (logs, temperature, timing) and records the result for the validation run.

**E3. Turn on the hourly backup** (D350, with your yes)
- The card is the only place the kids' games live until they're copied. So once the Picade is on the Wi-Fi, the mini copies them every hour.
- **Do** (on the mini, from the main checkout): `scripts/twin-backup/install.sh`. It runs once straight away, then every hour, with no window. Undo with `scripts/twin-backup/uninstall.sh` (the copies stay).
- **Look for:** in the Cabinet Manager, under the Picade's screen, "Last backup N minutes ago (N games, N files)". It turns red if the newest copy is over a day old while the Picade is on.
- **If not:** `cat ~/game-studio-data/twin/backup.json` and `~/game-studio-data/twin/launchd.log` say why. The first run may ask macOS for **Local Network** access for `node`: allow it.

---

## Part F: updates over the Wi-Fi, before the cabinet is closed up (D330-D339)

After this part, nothing needs the card again. Claude does each step with your yes, from the mini, when nobody's playing.

**F1. First network update** ✅ rehearsed
- **Do:** `node scripts/virtual-cabinet/update-cabinet.mjs --picade --os`, or the Manager's Software tab → Update, with "OS packages too".
- **Look for:** "updated", every data file kept, and the number of OS packages. The shelf restarts once.
- **If not:** the result says why. The cabinet goes back by itself.

**F2. Put today's boot files in their own slot** 🔧
- **Do:** `node scripts/cabinet-card/boot-update.mjs adopt`. The Picade restarts once (about a minute) and keeps the slot only if it comes back with Wi-Fi and the shelf.
- **Look for:** "kept arcade-…", and the shelf back on the screen.
- **If not:** it says what happened and the Picade is on its old boot. Tell Claude.

**F3. Prove the way back on the real hardware** 🔧 (Claude, with your yes; about 10 minutes)
- **Restart:** `sudo systemctl reboot` over SSH. Look for the shelf, and `boot-update.mjs status` naming the same slot.
- **A try that must fail:** a deliberately broken slot. Its kernel command line points at a root that doesn't exist, so it hangs. Look for the hardware watchdog restarting the Pi within about a minute, back on the old slot, with a result saying the try didn't come up. This is the one thing the QEMU rehearsal can't show (D336).
- **Power:** switch the Picade off at the wall during an update (F1 again with a changed checkout). Switch on: look for the shelf, and a result saying "recovered at boot".

## Part G: if the card ever dies (D339, D354, D355)

Updates can always go back by themselves (Part F). Two failures can't: a corrupt root filesystem (SD card wear) and a failed bootloader flash. Geoff kept the card he has and accepted that risk (2026-11-13). The sign is a Picade that never reaches the shelf and never answers `node scripts/cabinet-card/boot-update.mjs status`, even after a power cycle and a few minutes' wait. If it does answer, it isn't this: tell Claude.

The Picade is then rebuilt from the mini's hourly backup (E3).

**What comes back, and what doesn't (D355):**
- **Back exactly as they were at the last backup:**
  - every game and every version, with its maker and its lineage (which game it changed, its line);
  - the makers list;
  - the coin pot. It's worked out from the coin history, which comes back line for line.
  - play, make and screening logs;
  - downloaded games.
- **Lost:** anything after the last backup, normally under an hour of use. A make that was running when the card died is never collected and its cost isn't recorded, so the pot may show a coin or two more than it really had.
- **Made fresh by the new card, as at the first flash:**
  - the Manager pairing (`node scripts/coin.mjs pair`);
  - the welcome screens, which show once more.

**G1. Save the last hour, if you can.** If the Picade still boots at all, even badly, Claude runs one more backup first: `node scripts/twin-backup/run.mjs`. It only reads the Picade.
- Seed, sync and backup share one lock (`~/game-studio-data/twin/lock`, D352). If an hourly run holds it, this backup, a `twin.mjs` sync, or the flash's own seed in G4 stops with "busy". Wait a minute and run it again.

**G2. Check the copy.** In the Manager, "Last backup" should name the time and the number of games you expect. `ls ~/game-studio-data/twin/backup/carts` lists them.

**G3. The Picade's identity.** It's stored privately on the mini (D329), so the new card gets the same one.
- **Check it still works:** `scripts/cabinet-card/picade-key.sh --check`, which asks for nothing.
- **The old card still holds the key** (in its `/etc/arcade/service.json`). If the old card leaves the house, or the check fails:
  - on [API keys](https://platform.claude.com/settings/keys), **disable** the old `arcade` key;
  - make a new one scoped to `cabinet-picade` (as in D1);
  - run `scripts/cabinet-card/picade-key.sh` with it.

**G4. Write a new card from the backup.** Open the cabinet and take the card out from underneath. Use a new card if the old one is suspect.
- **Do:** as in step 2 of "The first end-to-end run": `flash.mjs --check`, `flash.mjs --list`, then `flash.mjs --disk diskN --from-backup`.
- **Where the games come from:** with `--from-backup` the flash takes them from the mini's backup of the Picade, not from the virtual cabinet, which may hold test games of its own (D354). Everything else about the flash is as in Part B.
- **The admin SSH:** the flash writes the Picade's SSH key again in `~/game-studio-data/cabinets/arcade/ssh/`. The new card has new host keys, so Claude clears the old `arcade.local` line from that folder's `known_hosts` before connecting.

**G5. First boot, as in Part C.** It puts the games in place before the starter games, as in E1.
- **Look for:** the kids' games on the shelf with their names, and the same coins as the Manager showed before.
- **Then Part F again:** F1, the update to the latest `main`, and F2, `boot-update.mjs adopt`.
- **After that:** pair the Manager again (`node scripts/coin.mjs pair`), and the hourly backup simply carries on.

**G6. Put the cabinet back together.**

---

## What Claude has checked before the hardware

- ✅ The card script's safety checks: refuses internal disks, the mini's own disks, disk images, partitions, read-only cards, and sizes outside 8–260 GB; needs a typed phrase naming the disk and size; re-checks it's the same card just before writing.
- ✅ A full write to a card **image file** through the same steps: the pinned image, read back byte for byte, the seed and setup files on the boot partition, no Wi-Fi password anywhere on it or in the output.
- ✅ The Picade's config.txt lines on a copy of the image's own config.txt: one block, under `[all]`, every key D82 names, audio lines off.
- ✅ The first-boot setup (cloud-init) reviewed against the image's own cloud-init and Raspberry Pi's user-rename code: the admin user is made the way Raspberry Pi's own tool expects, so no "rename user" wizard appears on the screen.
- ✅ **A full rehearsal of first boot** (2026-11-12): the card image `flash.mjs` writes, booted in a throwaway VM on the mini with Debian's kernel standing in for the Pi's (`scripts/cabinet-card/rehearse.mjs`). cloud-init made the admin user and masked the wizard, the seed ran `provision.sh --profile picade` with speech from the card, the progress screen showed each step, it restarted once, and the offline shelf came up and played a starter game. Power-on to shelf: 2 minutes. The Wi-Fi settings survived the restart. Four things it found are fixed (D250, D257).
- ✅ **A card that carries the keys and the twin's data** (2026-11-13, throwaway keys and a throwaway twin, never the real ones):
  - First boot put the keys into `service.json` (owner `arcade`, 0600) and wiped them from the card.
  - It put the twin's game on the shelf and came up connected (Claude reachable), with speech on Groq plus Moonshine.
  - The keys were in no other file and no log.
  - The admin SSH (key only) was up for updates.
- 🔧 Everything in Parts A and C: power, the overlay on a Pi 5, the panel, the DAC, the buttons' wiring, the power button, Wi-Fi in the basement, temperature, and the first boot itself.
