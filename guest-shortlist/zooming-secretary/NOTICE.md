# Zooming Secretary on the cabinet: where every file comes from

Built by `node scripts/guests/build.mjs` from this folder's `guest.json`; the same inputs give the same files. Nothing loads from the network.

| Files | Origin | Licence |
|---|---|---|
| `play/rom.bin` | Zooming Secretary by Shiru and PinWizz: `Zooming_Secretary.nes` from https://shiru.untergrund.net/files/nes/zooming_secretary.zip, unchanged, sha256 `315adee10052367298959d55256e9f2621381da9f7c839f50832e13516b61770` | CC BY (Creative Commons Attribution; the manual gives no version number) |
| `play/nestopia_libretro.js`, `play/nestopia_libretro.wasm` | RetroArch 1.22.2's web build with the nestopia core, from https://buildbot.libretro.com/stable/1.22.2/emscripten/RetroArch.7z (sha256 `00e17fda8792ee15a9d9ea4fc769e9f937e525c722ae10dabba2c993941f55f4`), unchanged | RetroArch: GPL-3.0-or-later (https://github.com/libretro/RetroArch); nestopia: GPL-2.0 (https://github.com/libretro/nestopia) |
| `play/cabinet-keys.js`, `play/cabinet-retroarch.js`, `play/game.json`, `play/index.html` | this repo (`scripts/guests/retroarch/`): the page that starts the player with the cabinet's keys | this repo's |

**The game's licence:** CC BY (Creative Commons Attribution; the manual gives no version number).

**Where it's stated:** the game's own manual.pdf, in the author's zip: "It is free of charge, released under Creative Commons Attribution license"; its cover: "CC BY 2011 Alexei Bespalko and Shiru".

**Source:** https://shiru.untergrund.net/files/src/zooming_secretary_src.zip

**Credits:** Zooming Secretary by Shiru (code, sound) and Alexei "PinWizz" Bespalko (graphics), CC BY 2011.
