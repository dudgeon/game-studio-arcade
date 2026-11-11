# A downloaded falling-blocks game for the cabinet: shortlist

Phase 1 of `tasks/ship-a-high-quality-tetris-like-game-on-the-cabinet.md`. Researched and run 2026-11-11. Nothing was installed on either cabinet, and the virtual cabinet's VM was left alone.

The house rule "inspired-by, no Tetris name or look" covers games the Studio makes. For a downloaded game, this report states each one's licence and whether it uses the Tetris name or trade dress.

## How each was run

- **Web builds** ran in headless Chromium (Playwright 1.56.0) at 1024×768, driven with the D82 keys. That's the kiosk route.
- **Native arm64 builds** ran in a throwaway Debian 13.7 trixie arm64 VM. It was qemu with HVF, headless, with no window on the mini's screen, and is not the virtual cabinet. Each game ran under Xvfb at 1024×768, with keys sent by `xdotool` and screenshots taken with `import`. That covers the same OS and architecture as the Pi. It doesn't cover the Pi's GPU or speed: rendering was software (llvmpipe).
- **Not checked:** sound output (audio went to a dummy device in every run), and anything on a real Pi 5.

## Shortlist

### 1. Apotris (recommended)

![Apotris web build: mode list, Marathon setup, start, play with ghost piece, pause menu](falling-blocks/apotris-web.png)
![Apotris native arm64 build on trixie](falling-blocks/apotris-arm64-trixie.png)

- **What it is:** the most polished open-source block stacker found. It began on the Game Boy Advance and now also runs on PC and web. It has 14 modes (Marathon, Sprint, Dig, Ultra, Blitz, Zen and others) and a CPU Battle. It plays with a modern feel: hold, a 5-piece next queue, a ghost piece, and configurable rotation and handling. It has tracker music and sound effects, a skin and colour editor, and pixel art that suits a 4:3 cabinet.
- **Source:** gitea.com/akouzoukos/apotris. Downloads are at akouzoukos.com/apotris/downloads. The latest is **v4.2.0**, with the last commit on 2026-10-20.
- **Licence:**
  - **Code:** AGPL-3.0.
  - **Libraries:** SDL2, Tilengine, SoLoud, libopenmpt and others; their licence files ship in the release's `license/` folder.
  - **Music:** tracker modules from The Mod Archive, credited to their composers. I didn't check each track's licence. Mod Archive modules carry their own terms, and many have none stated.
- **Tetris name and look:** the name ends in "-tris", and the pieces use the guideline colours (cyan I, yellow O, purple T and so on). **Tetris Holding's counsel filed a DMCA takedown against it on itch.io on 2023-05-05** (itch.io/takedowns/1499978): a copyright claim that it "reproduces copyrightable expression" from Tetris. The developer has said the GitHub repository was taken down too. The project now lives on Gitea and its own site, and it's still actively developed. On a private home cabinet the practical risk is small. It is still a game the Tetris owners have challenged, which is Geoff's call.
- **Seen running:**
  - **Web build:** the title screen, menus, Marathon setup, play (ghost, hold box, next queue, score and timer) and its pause menu.
  - **Native `Apotris` binary, Linux arm64:** on trixie it needed nothing beyond the base system, with no missing libraries per `ldd`. It reached the title screen and Marathon play. The README asks for glibc 2.38 or later, and trixie has 2.41.
- **How it would run on the cabinet:** either route works.
  - **(a) Web build in the kiosk:** `Apotris.js` plus its wasm and data, served locally by the cabinet service.
  - **(b) Native arm64 binary:** launched in place of the kiosk.
  - (a) fits the launcher as it is today. (b) means a second program on the screen.
- **Input:**
  - **Defaults:** the web build's menus use W A S D, with Return to confirm and Backspace to cancel. In play, W A S D moved and rotated pieces; I didn't map every default.
  - **Remapping needed:** the arrows, then Z/X to rotate, C to hold, ↑ to hard drop, Enter to pause, and a cancel key on one of the buttons. Apotris has in-game key binding and keeps it in its save. So it's set once and shipped as a starting save, with no code change.
  - **Escape:** it opens Apotris's own pause menu. The launcher must catch Escape first (see below).
- **Two players:** up to five online, and GBA link-cable play. No same-screen two-player. Turns work: each kid plays a Marathon or Sprint and compares the score.
- **Kid suitability:** nothing unsuitable seen. It's abstract. Some modes (Master, Death) are very hard, but they're labelled.

### 2. Tera: Mind Over Matter (PICO-8)

![Tera: title, then play with hold, ghost and next queue](falling-blocks/tera-pico8.png)

- **What it is:** a PICO-8 cart by tesselode with its own name, look and music. It has hold (Z+X), a ghost piece, a 3-piece next queue, lock delay and a timer. It's small and charming, with one main mode, and less depth than Apotris.
- **Source:** lexaloffle.com/bbs/?pid=161139 (cart `teramom`). Last updated v1.2, 2019-03-06.
- **Licence:** CC BY-NC-SA 4.0, the BBS default, covering the code and assets in the cart. Non-commercial use is fine for a home cabinet.
- **Tetris name and look:** neither. It has its own name and style, and blue and navy pixel art.
- **Seen running:** in the BBS web player in headless Chromium, through its title, options and play. It was not run in PICO-8 itself.
- **How it would run on the cabinet:** in Geoff's PICO-8 (the guest player planned in platform-notes), or as an HTML export served locally in the kiosk.
- **Input:** PICO-8's keys are already the cabinet's P1 keys: arrows, Z and X. Hold is Z+X. Escape stops PICO-8 and drops to its console, so the launcher has to take over there (already noted in platform-notes).
- **Two players:** no.
- **Kid suitability:** fine.

### 3. Techmino

![Techmino on arm64 trixie: language screen, an error box about its AI library, play](falling-blocks/techmino-arm64-trixie.png)

- **What it is:** the most feature-rich open-source stacker. It has dozens of modes, puzzles and battles against an AI, and online play. It's built on LÖVE.
- **Source:** github.com/26F-Studio/Techmino. Latest release v0.17.21 (2024-08-08), last push 2026-11-10.
- **Licence:** LGPL-3.0 for the game and code (`legals.md`), with fonts under the SIL OFL. Its music is by the studio and contributors; I didn't check each track.
- **Tetris name and look:** its legal notice says it is "not a fan game of Tetris". It uses guideline-style colours.
- **Seen running:** `Techmino_Bare.love` on trixie's own `love` 11.5. It reached the language screen, the main menu and play.
- **Why it ranks third:**
  - **Menus need a pointer.** The language screen ignored the arrows and Enter, and clicks from `xdotool` didn't register under Xvfb either.
  - **Its 16:9 layout is cut off on the left at 1024×768.**
  - **The `.love` lacks the arm64 build of its AI library.** It shows an error box ("architecture: unknown").
  - **It's dense, with many menus, which is a lot for a 10-year-old with a stick.**

## Looked at and dropped

| Game | Why not |
|---|---|
| teti (MIT, web) | Code is MIT, but its sounds are TETR.IO's and its music is commercial Touhou arrangements (its own `info.md`). Its site sits behind a Cloudflare bot check. |
| Cambridge (MIT, LÖVE) | Its `SOURCES.md` says many backgrounds and all of its music are unlicensed placeholders. Some backgrounds are "Black Death Village" and battle paintings. It's TGM-style and hard. |
| Quadrapassel (GPL-2+, Debian package) | It installs from apt, but it's a desktop GTK app with no hold. It crashed under Xvfb after the first key. |
| Extreme Tetrom (PICO-8, GPL-2/CC BY-NC-SA) | Built to be extremely hard. |
| Tetr.js | No licence stated. |

## What the cabinet lacks to shelve a downloaded game

Guest players aren't built (decisions.md, "Stubbed or not here"). Today the shelf only lists house carts, and the launcher plays a cart through `createHost`. That host runs the cart in a sandboxed iframe while the launcher keeps focus and forwards input, which is how Escape always reaches the launcher. A downloaded web game reads the keyboard itself, so focus has to be inside its page, and the launcher would never see Escape.

**The smallest way to get Apotris onto the shelf (Phase 2):**

1. **Shelf entry:** a guest entry kind, for example `kind: "web"`, with a title and a local folder. It lists alongside carts, and a play is logged the same way: `/api/plays`, with the end recorded as "star" or "back".
2. **Files:** the Apotris web build is placed under the cabinet's data by the provisioning script, pinned to v4.2.0 by checksum, with its AGPL source tarball alongside it. Under the AGPL, the source has to be on offer. The cabinet service serves the folder same-origin.
3. **Launcher:** for a web entry, it opens the page in a full-screen iframe on the same origin. Before the game's scripts run, it adds a capture-phase `keydown` listener on the iframe's window. That listener swallows Escape and ends the play, back to the shelf. Same-origin is what makes this possible without changing the game.
4. **Controls:** a starting save with the D82 key bindings, made once in Apotris's own settings.

That's one entry kind, one static route, one launcher branch and a data file. Native players (PICO-8, the native Apotris binary) are a bigger job (the launcher handing the screen to another program), and aren't needed for this game.

## Recommendation

**Apotris, through its web build in the kiosk.** It's the best of the three on everything the brief asked for: modern feel, sound, modes that grow with Owen and Alina, and a 4:3 pixel look. It also fits the launcher's existing web path with the least new code. The one thing to weigh is that the Tetris owners have issued a takedown against it before.

**If that's a no, Tera** has clean licensing and its own look, but it's a smaller game.
