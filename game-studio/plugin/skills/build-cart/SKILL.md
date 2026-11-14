---
name: build-cart
description: Make or change a game for the basement arcade cabinet, spec-first, with Geoff and a kid at the Mac mini, then publish it to the cabinet. Use when someone wants to make a new cabinet game, change or remix a game that's on the cabinet's shelf, playtest or play a cart, import a picture as a sprite, or publish or launch a game on the cabinet.
---

# Building a cart, spec-first

A **cart** is one game: a folder with `spec.md` (the source of truth), `cart.json`, `game.js` (the house runtime's `init`/`update`/`draw`), `checks.js` (one check per `(auto)` rule) and `assets/`. Geoff and one of the kids (Owen, 13, or Alina, 10) are at the desk together. The kid decides what the game is. You help them say it clearly, check it, and adjust. They're learning to work with an agent, not to code, so ask them, show them, and let them choose.

Two tool sets:
- **studio** (on the mini): `read_kit`, `new_cart`, `validate_cart`, `playtest`, `play`, `import_asset`.
- **arcade** (on the cabinet, through the Cabinet Manager's connection): `list_carts`, `get_cart`, `publish_cart`, `launch_on_cabinet`, `get_activity`, `cabinet_status`, `remove_from_shelf` and `restore_to_shelf` (a grown-up's "off the shelf", kept in the records, D360).

## The loop

1. **Start.** For a change, find the game with arcade `list_carts` and pull it with `get_cart` (`into`: a new folder). For a new game, `new_cart` from the template the idea fits (`read_kit` lists them), else `blank`. Its `maker` is the kid's maker id from `list_carts`, and `with` is Geoff's (a grown-up maker).
2. **Read little.** `read_kit` gives the catalog. Then read only the guides this game needs (`cart-api`, `checks`, `sprites`, `spec`, a library module).
3. **Spec first.** Change `spec.md` before any code. Pitch in a sentence or two. Rules `R1..Rn`, each checkable: what happens, when (in frames, 60 a second), and what you can see in the game's state. Looks and feelings are `(you check)`. Exact numbers; your guesses go under Assumptions. Add a Changelog line. Rule ids never change and are never reused; a change keeps every inherited rule unless the kid wants it gone. Read the rules back to the kid in plain words before building.
4. **Code from the spec.** Small edits to `game.js`, reusing `g.lib`. Then one check per `(auto)` rule in `checks.js`. No imports, DOM, timers or `Math.random` (use `g.rand`), only the cabinet's buttons, and the screen is `g.W` × `g.H` (256 × 192).
5. **Check.** `validate_cart`, then `playtest`. Fix the code or the check, never weaken a rule to pass. If a rule turns out untestable, make it `(you check)` and say so.
6. **Play it.** `play` opens it in a browser: arrows, Z = A, X = B, C = X, V = Y, Enter = START, Escape = back. Let the kid play and say what to change. Back to step 3.
7. **Pictures.** `import_asset` turns a found picture into sprite rows for `game.js`. Always give `source` (where it came from and its licence). Only use pictures the family may use.
8. **Publish.** arcade `publish_cart` with `dir`, the `maker`, `with`, and a `summary` of what you made together. A pulled folder publishes as a change to its game (its parent comes from the folder). The cabinet validates and re-runs the playtest in its own Chromium before the game reaches the shelf. If it's kept off, read the reasons, fix, and publish again. Nothing is ever replaced: each publish is a new version.
9. **Show it.** `launch_on_cabinet` opens its how-to-play screen on the cabinet, when the cabinet is on its shelf. If someone's playing or making a game there, wait. Don't interrupt them.

## House rules

- **Inspired-by only.** Never copy a real game's name, characters, art, music, levels or look. A falling-blocks game is fine; it isn't called Tetris and doesn't look like it.
- **The kids' words stay on the cabinet.** `get_activity` leaves out what they said there unless you pass `include_words`. Ask Geoff before you do, and never copy their words into a repo, a commit or a file outside the cart.
- **Never delete.** Don't delete cart folders or versions, here or on the cabinet. Make a new folder instead.
- **The cabinet is the kids'.** Publish and launch only when Geoff says to.
