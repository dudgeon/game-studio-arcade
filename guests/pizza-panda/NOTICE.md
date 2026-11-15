# Pizza Panda on the cabinet: where every file comes from

Built by `node scripts/guests/build.mjs` from this folder's `guest.json`; the same inputs give the same files. Nothing loads from the network.

| Files | Origin | Licence |
|---|---|---|
| `play/game.js` | Pizza Panda by Andrew Anderson: `pizza_panda-2.p8.png` from https://www.lexaloffle.com/bbs/cposts/pi/pizza_panda-2.p8.png, exported as a web player by PICO-8 (the cart and PICO-8's player in one file), sha256 `f837b757d344a5ab259fc6dded967207bbff56e7a9bb49bb758c9d77538673a7` | CC BY-NC-SA 4.0; PICO-8's exported player: Lexaloffle's terms for exports ("You are free to distribute and use exported cartridges and data as you please, provided that you have permission from the cartridge author and contributors") |
| `play/cabinet-keys.js`, `play/index.html` | this repo (`scripts/guests/pico8/`): the page that starts the player with the cabinet's keys | this repo's |

**The game's licence:** CC BY-NC-SA 4.0. Non-commercial, with credit, and a changed version stays under the same licence. The cabinet plays it at home, unchanged; only the page around PICO-8's player is ours.

**Where it's stated:** the cart's post on the Lexaloffle BBS, https://www.lexaloffle.com/bbs/?tid=54289: "License: CC4-BY-NC-SA" (https://creativecommons.org/licenses/by-nc-sa/4.0/). The author's own source is MIT too: https://github.com/andmatand/pizza-panda/blob/master/LICENSE.

**Source:** https://www.lexaloffle.com/bbs/?tid=54289

**Credits:** Pizza Panda by Andrew Anderson (kittenm4ster on the BBS), CC BY-NC-SA 4.0 on the BBS, MIT in his own repo.
