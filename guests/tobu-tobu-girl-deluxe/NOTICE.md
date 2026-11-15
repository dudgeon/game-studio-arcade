# Tobu Tobu Girl Deluxe on the cabinet: where every file comes from

Built by `node scripts/guests/build.mjs` from this folder's `guest.json`; the same inputs give the same files. Nothing loads from the network.

| Files | Origin | Licence |
|---|---|---|
| `play/rom.bin` | Tobu Tobu Girl Deluxe by Tangram Games: `tobudx.gb` from https://raw.githubusercontent.com/gbdev/database/41454fd5b371475fa761003e05ca129a8c513ebb/entries/tobutobugirldeluxe/tobudx.gb, unchanged, sha256 `0a0e8018dbbc8d7f8cd99f05e7cdc7b4cc9e358ecfe9377ebfb2291a84c6e310` | MIT (code), CC BY 4.0 (images, text, sound and music) |
| `play/gambatte_libretro.js`, `play/gambatte_libretro.wasm` | RetroArch 1.22.2's web build with the gambatte core, from https://buildbot.libretro.com/stable/1.22.2/emscripten/RetroArch.7z (sha256 `00e17fda8792ee15a9d9ea4fc769e9f937e525c722ae10dabba2c993941f55f4`), unchanged | RetroArch: GPL-3.0-or-later (https://github.com/libretro/RetroArch); gambatte: GPL-2.0 (https://github.com/libretro/gambatte-libretro) |
| `play/cabinet-keys.js`, `play/cabinet-retroarch.js`, `play/game.json`, `play/index.html` | this repo (`scripts/guests/retroarch/`): the page that starts the player with the cabinet's keys | this repo's |

**The game's licence:** MIT (code), CC BY 4.0 (images, text, sound and music).

**Where it's stated:** https://github.com/SimonLarsen/tobutobugirl-dx README: "The source code for Tobu Tobu Girl is licensed under the MIT License." and "All assets (images, text, sound and music) are licensed under the Creative Commons Attribution 4.0 International License". The ROM is the same file as the official one at https://tangramgames.itch.io/tobu-tobu-girl-deluxe.

**Source:** https://github.com/SimonLarsen/tobutobugirl-dx

**Credits:** Tobu Tobu Girl Deluxe by Tangram Games: Simon Larsen (code, art), Lukas Erritsø Hansen (art), potato-tan (music). CC BY 4.0 for the assets.
