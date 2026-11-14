# Libbet and the Magic Floor on the cabinet: where every file comes from

Built by `node scripts/guests/build.mjs` from this folder's `guest.json`; the same inputs give the same files. Nothing loads from the network.

| Files | Origin | Licence |
|---|---|---|
| `play/rom.bin` | Libbet and the Magic Floor by Damian Yerrick: `libbet.gb` from https://github.com/pinobatch/libbet/releases/download/v0.08/libbet.gb, unchanged, sha256 `3607412031c8287cf878299ce96e581e85b852dde703806343b95576fa3ff1a9` | zlib |
| `play/gambatte_libretro.js`, `play/gambatte_libretro.wasm` | RetroArch 1.22.2's web build with the gambatte core, from https://buildbot.libretro.com/stable/1.22.2/emscripten/RetroArch.7z (sha256 `00e17fda8792ee15a9d9ea4fc769e9f937e525c722ae10dabba2c993941f55f4`), unchanged | RetroArch: GPL-3.0-or-later (https://github.com/libretro/RetroArch); gambatte: GPL-2.0 (https://github.com/libretro/gambatte-libretro) |
| `play/cabinet-keys.js`, `play/cabinet-retroarch.js`, `play/game.json`, `play/index.html` | this repo (`scripts/guests/retroarch/`): the page that starts the player with the cabinet's keys | this repo's |

**The game's licence:** zlib.

**Where it's stated:** https://github.com/pinobatch/libbet README, "Legal": "Copyright 2002, 2012 Martin Korth / Copyright 2018, 2024 Damian Yerrick. This program is free software. Permission is granted to use it subject to the terms of the zlib License."

**Source:** https://github.com/pinobatch/libbet
