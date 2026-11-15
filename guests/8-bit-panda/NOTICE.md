# 8 Bit Panda on the cabinet: where every file comes from

Built by `node scripts/guests/build.mjs` from this folder's `guest.json`; the same inputs give the same files. Nothing loads from the network.

| Files | Origin | Licence |
|---|---|---|
| `play/cart.tic` | 8 Bit Panda by Bruno Oliveira: `8_bit_panda.tic` from https://tic80.com/cart/b88b74e7a6f923251de764d89d6f3507/8_bit_panda.tic, unchanged, sha256 `e0d94db2984675ed3669267db2e57b9d602a0a56a9d24fc1e9d9d6009aaeef53` | Apache-2.0 |
| `play/tic80.js`, `play/tic80lua.wasm` | TIC-80 1.4.1's web player for lua carts, from `tic80-v1.4-players.tar.gz` (https://github.com/nesbox/TIC-80/releases/download/v1.4.1/tic80-v1.4-players.tar.gz, sha256 `03e7bef2d061be40632cc70bc50e84c2f2f99c464bf0bcf8fd90d5e715186a4d`), unchanged | MIT (https://github.com/nesbox/TIC-80) |
| `play/cabinet-keys.js`, `play/index.html` | this repo (`scripts/guests/tic80/`): the page that starts the player with the cabinet's keys | this repo's |

**The game's licence:** Apache-2.0. Copyright (c) 2017 Bruno Oliveira. The licence text is in `LICENSE.txt`.

**Where it's stated:** https://github.com/btco/panda/blob/master/README.md: "This software is distributed under the Apache License, version 2.0." The art and music are the author's own, made in TIC-80 (same README).

**Source:** https://github.com/btco/panda
