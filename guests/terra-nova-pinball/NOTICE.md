# Terra Nova Pinball on the cabinet: where every file comes from

Built by `node scripts/guests/build.mjs` from this folder's `guest.json`; the same inputs give the same files. Nothing loads from the network.

| Files | Origin | Licence |
|---|---|---|
| `play/game.js` | Terra Nova Pinball by Matt Sutton: `terra_nova_pinball-2.p8.png` from https://www.lexaloffle.com/bbs/cposts/te/terra_nova_pinball-2.p8.png, exported as a web player by PICO-8 (the cart and PICO-8's player in one file), sha256 `e3a3f523c399745190b5060ddc331eb0aa883597305194494cc924779e5a194c` | CC BY-NC-SA 4.0; PICO-8's exported player: Lexaloffle's terms for exports ("You are free to distribute and use exported cartridges and data as you please, provided that you have permission from the cartridge author and contributors") |
| `play/cabinet-keys.js`, `play/index.html` | this repo (`scripts/guests/pico8/`): the page that starts the player with the cabinet's keys | this repo's |

**The game's licence:** CC BY-NC-SA 4.0. Non-commercial, with credit, and a changed version stays under the same licence. The cabinet plays it at home, unchanged; only the page around PICO-8's player is ours.

**Where it's stated:** the cart's post on the Lexaloffle BBS, https://www.lexaloffle.com/bbs/?tid=49068: "License: CC4-BY-NC-SA" (https://creativecommons.org/licenses/by-nc-sa/4.0/).

**Source:** https://www.lexaloffle.com/bbs/?tid=49068

**Credits:** Terra Nova Pinball by Matt Sutton (xietanu on the BBS), CC BY-NC-SA 4.0, from the Lexaloffle BBS.
