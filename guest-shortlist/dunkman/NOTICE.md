# Dunkman on the cabinet: where every file comes from

Built by `node scripts/guests/build.mjs` from this folder's `guest.json`; the same inputs give the same files. Nothing loads from the network.

| Files | Origin | Licence |
|---|---|---|
| `play/cart.tic` | Dunkman by Cong: `dunkman.tic` from https://tic80.com/cart/f92628f40b881fe353b2f4aab258ab9b/dunkman.tic, unchanged, sha256 `11d3104f8cad190759179d50d15134cb1933c7bbbd66941728745b7918038229` | MIT |
| `play/tic80.js`, `play/tic80moon.wasm` | TIC-80 1.4.1's web player for moon carts, from `tic80-v1.4-players.tar.gz` (https://github.com/nesbox/TIC-80/releases/download/v1.4.1/tic80-v1.4-players.tar.gz, sha256 `03e7bef2d061be40632cc70bc50e84c2f2f99c464bf0bcf8fd90d5e715186a4d`), unchanged | MIT (https://github.com/nesbox/TIC-80) |
| `play/cabinet-keys.js`, `play/index.html` | this repo (`scripts/guests/tic80/`): the page that starts the player with the cabinet's keys | this repo's |

**The game's licence:** MIT. The licence text is in `LICENSE.txt`.

**Where it's stated:** https://github.com/cxong/Dunkman/blob/master/LICENSE: "MIT License / Copyright (c) 2020 Cong"; the cart's header says "license: MIT License". A Ludum Dare 46 compo entry.

**Source:** https://github.com/cxong/Dunkman
