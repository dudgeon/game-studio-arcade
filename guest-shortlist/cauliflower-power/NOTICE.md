# Cauliflower Power on the cabinet: where every file comes from

Built by `node scripts/guests/build.mjs` from this folder's `guest.json`; the same inputs give the same files. Nothing loads from the network.

| Files | Origin | Licence |
|---|---|---|
| `play/cart.tic` | Cauliflower Power by Librorumque: `cauliflower_power.tic` from https://tic80.com/cart/74d69f265855b2a8c38ad45116bf48d7/cauliflower_power.tic, unchanged, sha256 `6aac1e7ce627cf6c239f653d69e5f49edb04c39f8acd2ab12b72f9c0cb0fb52b` | MIT |
| `play/tic80.js`, `play/tic80lua.wasm` | TIC-80 1.4.1's web player for lua carts, from `tic80-v1.4-players.tar.gz` (https://github.com/nesbox/TIC-80/releases/download/v1.4.1/tic80-v1.4-players.tar.gz, sha256 `03e7bef2d061be40632cc70bc50e84c2f2f99c464bf0bcf8fd90d5e715186a4d`), unchanged | MIT (https://github.com/nesbox/TIC-80) |
| `play/cabinet-keys.js`, `play/index.html` | this repo (`scripts/guests/tic80/`): the page that starts the player with the cabinet's keys | this repo's |

**The game's licence:** MIT. The whole licence text is inside the cart.

**Where it's stated:** the cart's own code starts with the full MIT licence text: "MIT LICENSE / Copyright © 2018 Librorumque". A solo Ludum Dare 41 compo entry.

**Source:** https://tic80.com/dev/lrq64/cauliflower_power
