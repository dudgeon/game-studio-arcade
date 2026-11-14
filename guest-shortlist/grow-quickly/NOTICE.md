# Grow Quickly on the cabinet: where every file comes from

Built by `node scripts/guests/build.mjs` from this folder's `guest.json`; the same inputs give the same files. Nothing loads from the network.

| Files | Origin | Licence |
|---|---|---|
| `play/cart.tic` | Grow Quickly by Cong: `grow_quickly.tic` from https://tic80.com/cart/c0d516a377ccdb26ac4b787832da57cb/grow_quickly.tic, unchanged, sha256 `00f2a9c00c6894a12beac88da0857b33b5229acd6b2f385467e42497f9ddea74` | MIT |
| `play/tic80.js`, `play/tic80lua.wasm` | TIC-80 1.4.1's web player for lua carts, from `tic80-v1.4-players.tar.gz` (https://github.com/nesbox/TIC-80/releases/download/v1.4.1/tic80-v1.4-players.tar.gz, sha256 `03e7bef2d061be40632cc70bc50e84c2f2f99c464bf0bcf8fd90d5e715186a4d`), unchanged | MIT (https://github.com/nesbox/TIC-80) |
| `play/cabinet-keys.js`, `play/index.html` | this repo (`scripts/guests/tic80/`): the page that starts the player with the cabinet's keys | this repo's |

**The game's licence:** MIT. The licence text is in `LICENSE.txt`.

**Where it's stated:** https://github.com/cxong/GrowQuickly/blob/master/LICENSE: "MIT License / Copyright (c) 2019 Cong"; the cart's header says "license: MIT License". Made for Ludum Dare 45.

**Source:** https://github.com/cxong/GrowQuickly
