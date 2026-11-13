# Picade bring-up checklist

For Geoff, in the order you'll do it. Each step: **do**, **look for**, **if not**. Written 2026-11-11 (D256).

- 🔧 = only the cabinet itself can prove this.
- ✅ = already checked on the mini (tests or the virtual cabinet); the cabinet just confirms it.

Sources, checked live 2026-11-11: Pimoroni's [Assembling your Picade](https://learn.pimoroni.com/article/assembling-your-picade) (10" 2025 edition, 30 July 2025), [Picade software guide](https://learn.pimoroni.com/article/setting-up-picade) (5 Aug 2025), [pimoroni/picade-hat](https://github.com/pimoroni/picade-hat) at `f97c2ac`, still its latest commit. Background: [platform-notes.md](platform-notes.md#picade-10-inch-2025-edition).

---

## The first end-to-end run, short

For when the cabinet is built (Part A). Details for each step are in the parts below.

1. **Card into the mini's reader.** In a Terminal window, in the repo on `main`:
   `node scripts/cabinet-card/flash.mjs --list`, then `node scripts/cabinet-card/flash.mjs --disk diskN` with the disk it names.
   Type the `erase diskN NNGB` phrase it shows, the Wi-Fi name, the Wi-Fi password (nothing shows), then the mini's password for sudo. About 5 minutes (the first time it also fetches speech's files, about 300 MB, once); it ejects the card. (Part B)
2. **Card into the Pi** from underneath. **Plug your USB mic into a black USB 2 port.** Power on.
3. **Wait for the shelf.** In the rehearsal (a VM on the mini, wired, 2026-11-12) it took 2 minutes; on the Pi, over the basement Wi-Fi onto the SD card, expect several times that, mostly the browser step. The screen shows "Setting up the arcade" with each step, restarts once by itself, then shows the first-time welcome and the shelf. Until step 5 the shelf says **"Not connected"** and Make says **"Not connected to Claude yet"**: that's expected. (If it says "No Wi-Fi", that one is a real Wi-Fi problem: see C2.) (Part C)
4. **Console:** make the `cabinet-picade` workspace, its spend limit, and a key scoped to it. (D1)
5. **Terminal:** `scripts/cabinet-card/connect-picade.sh`, paste the key, check the workspace, answer `y`. (D2)
6. **Claude, with your yes:** `node scripts/twin.mjs seed --yes` copies the virtual cabinet's games and history onto the Picade (add `--set-aside-real` if the checks left log lines on it). It reaches the Picade with the SSH key step 1 made, in `~/game-studio-data/cabinets/arcade/ssh/`. (E1)
7. **Make a game with the cabinet's own controls:** stick and **A** to pick Make and your name; **hold a player button and talk**, let go to send; answer each question with the stick and A (D is "Make it now"); play the new game; **ESC** back to the shelf. Claude watches from the mini on the Manager (`scripts/manager.sh url`, Real cabinet) and reads the logs. (E2) The Manager only watches the Picade: its driver keyboard stays off unless you switch it on with `scripts/cabinet-card/driver-keyboard.sh on` (D287).

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
- **Buttons:** the six coloured buttons into HAT inputs 1–6, in this order so the console matches our key map (D82): **1 = A, 2 = B, 3 = X, 4 = Y, 5 and 6 = spare**. Pimoroni says any order works, and it does, but writing down which button went where now saves guessing later.
- **Black buttons:** two front, two sides, into **ENT, ESC, 1UP, COIN**. Write down which button is which: ESC is "back to the shelf" (D88), 1UP is START, COIN adds a coin.
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
- sudo asks for the mini's password to write the card. It writes about 3 GB, reads it back to check, adds the setup files, and ejects.
- If it refuses the card: it says why (internal disk, not a card reader, too big, read-only switch). Read the reason before trying anything else.

**B2. Card into the Pi** 🔧
- Power off. Card in from underneath, contacts facing the Pi's board.

---

## Part C: first boot (unattended, about 10–25 minutes)

**C1. Power on and wait** 🔧
- Look for, in order: text scrolling, a reboot or two (the Pi grows its partition), then **"Setting up the arcade"** in large letters with the step it's on (8 steps: the clock, the screen and browser, Node, the arcade, speech, the cabinet's buttons and sound, starting, finishing) and the time it started (D257). The browser step downloads from the internet and is the slow one; speech comes from the card. If it says **"Setup stopped"**, tell Claude; a power cycle runs it again from where it can.
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

## Part D: the cabinet's own Claude identity (D131, D254)

Like the virtual cabinet's, but its **own new workspace and key**, so its spending is capped and counted on its own.

**D1. In the Claude Console** (you)
1. [Workspaces](https://platform.claude.com/settings/workspaces) → **Create workspace**, name it `cabinet-picade`.
2. Select it → **Spend limits** → set the monthly limit you want for the real cabinet.
3. [API keys](https://platform.claude.com/settings/keys) → **Create key**, name `arcade`, **scoped to `cabinet-picade`**, expiry **Never**. Owner: a service account if the Console offers one, else you (as for the virtual cabinet, D158). Copy it; don't paste it anywhere else.

**D2. On the mini, in a Terminal window** (not Claude Code's `!`):
```
scripts/cabinet-card/connect-picade.sh
```
- Paste the key (nothing shows). It names the workspace; check it's `cabinet-picade`'s. It refuses the mini's workspace and the virtual cabinet's. Read the plan, answer `y`.
- Look for: "Done. The cabinet is live in workspace …". Until this, the cabinet plays games but Make waits, showing it needs a connection (D252).
- Then tell Claude: it commits `studio-kit/managed-agent/claude-lock.arcade.json` (no secrets in it).

---

## Part E: data, then the first real make

**E1. Copy the twin's data** (D290-D298)
- The real cabinet starts as a copy of the virtual cabinet's games, logs and makers (Geoff, 2026-11-11). After D2, before E2. Nothing on either cabinet is deleted (D5); keys and config never move.
- **Do** (Claude, with your yes): `node scripts/twin.mjs status`, then `node scripts/twin.mjs seed --yes`. If the checks above left log lines on the Picade, the seed lists them and stops; `--set-aside-real` moves them aside on the Picade first (kept).
- **Look for:** the virtual cabinet's games on the Picade's shelf (Tester's included; `twin-seed.json` lists them as test data), and `status` saying "In sync".
- **If not:** tell Claude. From then on the twin follows the Picade: `node scripts/twin.mjs sync`.

**E2. First make on the cabinet** 🔧
- With a kid, from the shelf: Make → answer with the stick and buttons → a game lands on the shelf → play it.
- Claude watches from the mini (logs, temperature, timing) and records the result for the validation run.

---

## What Claude has checked before the hardware

- ✅ The card script's safety checks: refuses internal disks, the mini's own disks, disk images, partitions, read-only cards, and sizes outside 8–260 GB; needs a typed phrase naming the disk and size; re-checks it's the same card just before writing.
- ✅ A full write to a card **image file** through the same steps: the pinned image, read back byte for byte, the seed and setup files on the boot partition, no Wi-Fi password anywhere on it or in the output.
- ✅ The Picade's config.txt lines on a copy of the image's own config.txt: one block, under `[all]`, every key D82 names, audio lines off.
- ✅ The first-boot setup (cloud-init) reviewed against the image's own cloud-init and Raspberry Pi's user-rename code: the admin user is made the way Raspberry Pi's own tool expects, so no "rename user" wizard appears on the screen.
- ✅ **A full rehearsal of first boot** (2026-11-12): the card image `flash.mjs` writes, booted in a throwaway VM on the mini with Debian's kernel standing in for the Pi's (`scripts/cabinet-card/rehearse.mjs`). cloud-init made the admin user and masked the wizard, the seed ran `provision.sh --profile picade` with speech from the card, the progress screen showed each step, it restarted once, and the offline shelf came up and played a starter game. Power-on to shelf: 2 minutes. The Wi-Fi settings survived the restart. Four things it found are fixed (D250, D257).
- 🔧 Everything in Parts A and C: power, the overlay on a Pi 5, the panel, the DAC, the buttons' wiring, the power button, Wi-Fi in the basement, temperature, and the first boot itself.
