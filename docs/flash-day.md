# Flash day: from the card reader to the kids' first game

For Geoff, in order, on the day. Each step says **what you do**, **what you'll see**, and **what Claude does from the mini meanwhile**. The full bring-up checklist, including building the cabinet and what to do when something fails, is [cabinet-bring-up.md](cabinet-bring-up.md); this page is the day itself. (D392)

Before the day: the cabinet is built ([cabinet-bring-up.md](cabinet-bring-up.md) Part A, with the [wiring diagram](hardware/picade-wiring.png)), and the virtual cabinet on the mini is running.

---

## 1. Once, before anything else: the Picade's key

**You:**
1. In the Claude Console, check the `cabinet-picade` workspace and its spend limit. Then [create a key](https://platform.claude.com/settings/keys) named `arcade`, scoped to `cabinet-picade`, expiry Never. Copy it.
2. In a Terminal window on the mini, from the repo on `main`:
   ```
   scripts/cabinet-card/picade-key.sh
   ```
   Paste the key when it asks; nothing shows.

**You'll see:** the workspace it belongs to, the Studio being set up there, then `ok   workspace wrkspc_…, agent version N: a session started against the Studio agent and was archived (no message, nothing spent)`. If it says `fail`, the line says why; tell Claude.

**Claude, meanwhile:** commits `studio-kit/managed-agent/claude-lock.arcade.json` (no secrets in it) once you're done.

## 2. The card reader arrives: check, then flash

**You:** put the microSD card in the reader, and the reader in the mini. Then, in the Terminal window:
```
node scripts/cabinet-card/flash.mjs --check --day-one docs/day-one.json
```

**You'll see:** a list of `ok` lines, then **Ready to flash**:
- the Groq key is found (not shown);
- the twin's games are there, and no make is running;
- the day-one shelf: the games that show, the games carried off the shelf, Tester and Tester2 hidden, a full pot;
- the Picade's identity from step 1;
- the pinned image and Node.

Any `NO` line says what's missing. Fix that first; Claude can help.

Then:
```
node scripts/cabinet-card/flash.mjs --list
node scripts/cabinet-card/flash.mjs --disk diskN --day-one docs/day-one.json
```
Use the `diskN` that `--list` says can be written.

**You'll see, and type:**
1. The card's name, size and partitions, then `Type "erase diskN NNGB" to erase it`. Type exactly that.
2. The Wi-Fi name and password (nothing shows). If `~/.config/game-studio-arcade/wifi.json` exists, it uses that instead and says which network.
3. Lines as it gathers, all before touching the card:
   - the Picade's identity;
   - the Groq key copied from the virtual cabinet;
   - the twin's data;
   - `day-one: pot full …; 2 makers off "Who's making?"; 8 games on the shelf …`.
4. The mini's own password, for sudo.
5. It writes about 3 GB, reads it back, adds the setup files, and ejects. About 5 minutes.

Nothing about keys is typed. If it stops, the card hasn't been touched; read the reason.

**Claude, meanwhile:** nothing on the cabinets. It can watch the log with you if you paste it.

## 3. Card in, power on, wait

**You:** card into the Pi from underneath. Plug your USB mic into a black USB 2 port. Plug in the power and tap the power button.

**You'll see:**
- boot text, and a restart or two while the Pi grows its card;
- then, in large letters, **Setting up the arcade**, with `Step N/8`, what it's doing, and **Switched on N minutes ago**. The browser step is the long one, over the basement Wi-Fi.
- **Done. Restarting...**, then one restart by itself;
- the first-time welcome ("How it works", then the coin pot);
- **the shelf**, with a full pot of 100 coins and the day-one games;
- **Make a new game: Tell Claude your idea**, already connected, with no typing on the cabinet.

In the rehearsals this took about 2 minutes; on the Pi expect several times that. If the screen says **Setup stopped**, tell Claude: a power cycle runs it again, and the log is on the card.

**Claude, from the mini, meanwhile:** once `arcade.local` answers, it checks over the Picade's own SSH key:
- the service is live with its key;
- speech is Groq plus Moonshine;
- the shelf and marks are as planned;
- first boot's log ends in `firstboot exit 0`;
- the keys are gone from the card.

## 4. Pair the Manager

**You:** on the mini, `scripts/manager.sh url` gives the Manager's link; open it in your browser (once per browser). Pick **Real cabinet (Picade)**, go to the coin page, and press **Pair**.

**You'll see:** the Picade's screen in the Manager (watch only; its driver keyboard stays off unless you turn it on, D287), its coin pot at 100, and its Activity.

**Claude, meanwhile:** confirms the pairing from the Manager's side, and that the Games page shows the day-one shelf (the test games off it, Tester and Tester2 off "Who's making?").

## 5. Start the hourly backup

**You (or Claude, with your yes):**
```
scripts/twin-backup/install.sh
```

**You'll see:** the backup's launchd agent installed. Its first run copies the Picade into `~/game-studio-data/twin/backup` and on into the twin. After that it runs every hour, in the background with no window. The Manager's health shows "Last backup".

**Claude, meanwhile:** checks the first backup's result in `~/game-studio-data/twin/backup.json`, and `node scripts/twin.mjs status`: the twin now follows the Picade (D290).

## 6. The first update, and adopt

So that every later update goes over the network and the card never has to come out again (D330, D336).

**You (or Claude, with your yes), from a clean `main`:**
```
node scripts/virtual-cabinet/update-cabinet.mjs --picade --os
node scripts/cabinet-card/boot-update.mjs adopt
```

**You'll see:**
- **The update:** it refuses if anyone is playing or making. Otherwise it brings the cabinet software, the agent's brief and the OS packages up to date, checks the cabinet is healthy (the service, SSH, its router), and keeps the old release to go back to.
- **adopt:** it puts today's boot files in their own slot, so later package updates never touch what boots (D336). It restarts the Picade once, which takes about a minute, and keeps the slot only if the cabinet comes back with its Wi-Fi and the shelf (bring-up F2). If not, the next boot goes back to how it was.

**Claude, meanwhile:** reads both reports. If either goes back, it says why before anything else is tried.

## 7. Remote access: sign Tailscale in, once

So the mini can reach the cabinet from anywhere, even when `arcade.local` doesn't answer (D397). First boot has already installed Tailscale and left it waiting for a sign-in. The sign-in is yours to do: no script signs in to anything.

**Claude:** runs `sudo tailscale up --hostname=arcade --ssh=false --accept-dns=false` on the Picade and gives you the link it prints.

**You:**
1. Open the link, sign in with the Tailscale account the mini uses, and approve the machine `arcade`.
2. If the mini isn't on Tailscale yet, install the Tailscale app on it and sign in to the same account.
3. In the Tailscale admin console, turn off key expiry for `arcade`, so the cabinet never drops off the tailnet by itself.

**You'll see:** `arcade` in the Tailscale app's list of machines.

**Claude, meanwhile:** reaches the cabinet as `arcade` (or at its 100.x address) with the Picade's own SSH key. Tailscale SSH stays off (`--ssh=false`), and so does MagicDNS on the cabinet, so playing never depends on Tailscale.

## 8. The kids make a game

**You, with Owen or Alina:**
1. From the shelf: stick and **A** on **Make a new game**.
2. Pick their name (or add it).
3. **Hold a player button and talk**, and let go to send.
4. Answer each question with the stick and **A** (**D** is "Make it now").
5. The game lands on the shelf. Play it. **ESC** goes back to the shelf.

**You'll see:** the coin check, Claude's questions on the tiles, the progress screen, then the new game on the shelf, marked NEW, with its coins taken from the pot.

**Claude, from the mini, meanwhile:** watches on the Manager (Real cabinet) and reads the make's log and cost. Afterwards it checks that the backup picked the game up within the hour.

---

## If it doesn't show up on the network

If first boot can't join the Wi-Fi (a wrong name or password, or a weak signal in the basement), the cabinet can't install, and the mini can't find it on `arcade.local`.

**You:**
1. Plug an Ethernet cable from the router (or a mesh point's Ethernet port) into the Pi's Ethernet port. It's reachable on the assembled cabinet.
2. Power-cycle the cabinet: hold the power button about 3 seconds to switch off, then tap it to switch on.

**You'll see:** first boot carries on over the cable. A card written before this change also gets the cable through NetworkManager's own automatic wired connection; cards from now on also ask for it themselves (D393).

**Claude, meanwhile:** finds it on `arcade.local` over its own key, then tells you whether the Wi-Fi joined too.
- If the Wi-Fi didn't join, the fix is to re-write the card with the right Wi-Fi details.
- Or keep the cable: while a cable is plugged in, the cabinet prefers it over the Wi-Fi.

## If the Wi-Fi is lost later

Once the cabinet has its Wi-Fi software (D410-D416), a lost Wi-Fi needs no cable and no card.

- **It usually fixes itself.** The cabinet keeps trying its saved networks for ever, and after a few minutes restarts its own Wi-Fi parts. Games play on meanwhile.
- **The shelf says which problem it is:** "No Wi-Fi" is the cabinet off the network; "No internet" is the cabinet on the Wi-Fi with the router's internet down.
- **To pick or change the network at the cabinet:** on the shelf, hold **ENT and COIN together for 3 seconds**. Choose the network with the stick, type its password on the on-screen keyboard (A types, B deletes, X changes the page, 1UP joins), and the screen says whether it worked, with the cabinet's address. A network is only ever added: the old one is never forgotten.
- **From the mini,** Claude finds the cabinet by `arcade.local`, then the router's name for it, then the last address that worked (`scripts/cabinet-card/picade-connect.sh --where`).

**No router cable nearby?** Run a cable straight from the mini's Ethernet port to the Pi's. Cards from D398 on never stop asking for an address on that cable and always keep a link-local address, so Claude reaches the Pi at `fe80::…%en0` with no router in between. The Pi's USB-C port is a network port as well (D396), but **only through a VBUS (power) blocker**: the X HAT already powers the Pi, and the mini mustn't power it too.

**If anything goes wrong on the day:** stop, and tell Claude what the screen says.
- The repair tools are `connect-picade.sh` (the Picade's key or agent) and `groq-picade.sh` (the Groq key).
- A dead card is rebuilt from the backup with `flash.mjs --disk diskN --from-backup` (D354). That's never a day-one card: it comes back as it was.
