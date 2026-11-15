# The Hat Chooses the Wizard on the cabinet: where every file comes from

Built by `node scripts/guests/build.mjs` from this folder's `guest.json`; the same inputs give the same files. Nothing loads from the network.

| Files | Origin | Licence |
|---|---|---|
| `play/rom.bin` | The Hat Chooses the Wizard by Corwin Kuiper and Gwilym Inzani: `the-hat-chooses-the-wizard.gba` from https://github.com/agbrs/agb/releases/download/v0.25.0/examples.zip, unchanged, sha256 `c417f2a110026b3553a9f0f26090b4bbbceeeac1e0c2ebb0f9d786fe2221021b` | MPL-2.0 (code), CC BY-SA 4.0 (art), CC BY 3.0 (music) |
| `play/mgba_libretro.js`, `play/mgba_libretro.wasm` | RetroArch 1.22.2's web build with the mgba core, from https://buildbot.libretro.com/stable/1.22.2/emscripten/RetroArch.7z (sha256 `00e17fda8792ee15a9d9ea4fc769e9f937e525c722ae10dabba2c993941f55f4`), unchanged | RetroArch: GPL-3.0-or-later (https://github.com/libretro/RetroArch); mgba: MPL-2.0 (https://github.com/libretro/mgba) |
| `play/cabinet-keys.js`, `play/cabinet-retroarch.js`, `play/game.json`, `play/index.html` | this repo (`scripts/guests/retroarch/`): the page that starts the player with the cabinet's keys | this repo's |

**The game's licence:** MPL-2.0 (code), CC BY-SA 4.0 (art), CC BY 3.0 (music).

**Where it's stated:** https://lostimmortal.itch.io/the-hat-chooses-the-wizard: "Code license: Mozilla Public License 2.0 (MPL)", "Asset license: Creative Commons Attribution_ShareAlike v4.0 International", and "The music is by Otto Halmén released under creative commons attribution 3.0".

**Source:** https://github.com/agbrs/agb/tree/master/examples/the-hat-chooses-the-wizard

**Credits:** The Hat Chooses the Wizard by Corwin Kuiper and Gwilym Inzani (CC BY-SA 4.0 art). Music: "Sylvan Waltz" by Otto Halmén (CC BY 3.0), https://opengameart.org/content/sylvan-waltz-standard-looped-version.
