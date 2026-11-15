# Up and Away on the cabinet: where every file comes from

Built by `node scripts/guests/build.mjs` from this folder's `guest.json`; the same inputs give the same files. Nothing loads from the network.

| Files | Origin | Licence |
|---|---|---|
| `play/game.js` | Up and Away by Ross McCormick: `up_and_away-1.p8.png` from https://www.lexaloffle.com/bbs/cposts/up/up_and_away-1.p8.png, exported as a web player by PICO-8 (the cart and PICO-8's player in one file), sha256 `6f64b0fe17f0b9c095c0744d073100e4611b3692be10b48a6aa0231971b5f950` | CC BY-NC-SA 4.0; PICO-8's exported player: Lexaloffle's terms for exports ("You are free to distribute and use exported cartridges and data as you please, provided that you have permission from the cartridge author and contributors") |
| `play/cabinet-keys.js`, `play/index.html` | this repo (`scripts/guests/pico8/`): the page that starts the player with the cabinet's keys | this repo's |

**The game's licence:** CC BY-NC-SA 4.0. Non-commercial, with credit, and a changed version stays under the same licence. The cabinet plays it at home, unchanged; only the page around PICO-8's player is ours.

**Where it's stated:** the cart's post on the Lexaloffle BBS, https://www.lexaloffle.com/bbs/?tid=142710: "License: CC4-BY-NC-SA" (https://creativecommons.org/licenses/by-nc-sa/4.0/).

**Source:** https://www.lexaloffle.com/bbs/?tid=142710

**Credits:** Up and Away by Ross McCormick (rmcco on the BBS), CC BY-NC-SA 4.0, from the Lexaloffle BBS.
