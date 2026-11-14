## The library: read only what this game needs

Paths are under `/workspace/kit/`. Everything here is tested, so use it instead of writing your own. Each file costs tokens to read, so don't read one you won't use; this page is enough to ask your questions.

<!-- templates -->
### Starting points

Copy one into the cart folder, then change it in small edits; don't rewrite what already works. Each has `spec.md`, `cart.json`, `game.js` (numbers in one `CFG` block), `checks.js`. Under `studio-kit/context-pack/templates/`:

- `catch/`: things fall; catch the good, avoid the bad; lives, speed-up.
- `dodge/`: free movement; things fly at you; lives, safe time, speed-up.
- `maze/`: tile-by-tile walking, walls from a text map, pickups, a timed round.
- `paddle/`: a ball off the walls, a paddle, serves.
- `blank/`: title, play, game over, best score, a dot. Use it when the idea fits none of the others.

Choose only after you've finished asking: the one the player's idea fits, otherwise `blank`. Its rules and numbers are defaults that the player's answers override. Read only its files.
<!-- /templates -->
<!-- no-templates
### Starting point

`studio-kit/context-pack/templates/blank/`: title, play, game over, best score, a dot, in `spec.md`, `cart.json`, `game.js`, `checks.js`. Copy it into the cart folder and build the game from there.
no-templates -->

### Library modules, `g.lib.<name>`: `runtime/lib/ref/<name>.md`

- `collide`: box overlap; "who destroys whom" rules over a list of things.
- `flow`: title, play, game-over screens.
- `fx`: pop-ups, life hearts, a title screen with space for art, a game-over panel. The templates use it.
- `grid`: boards and tiles, walking a stick step, pieces, rotation, full rows.
- `score`: points, lives, saved high score.
- `timers`: frame timers, spawners, held-button repeat.
- `turns`: two or more people taking turns on one controller.

### Guides: `studio-kit/context-pack/modules/<name>.md`

- `cart-api`: everything on `g`: drawing, text, colors, input, sound, saves. Read it unless you only change numbers.
- `checks`: `checks.js`, `t`, and the tested bot `t.bot`. Read it before writing checks.
- `sprites`: drawing with `g.sprite` rows, in sizes that read at 256×192.
- `spec`: writing rules a machine or a person can check. Read it when not starting from a template's spec.

## House rules

- `game.js` is one module that imports nothing: `export default { init(g), update(g, s), draw(g, s), probe(g, s), poke(g, s, o) }`. `checks.js` also imports nothing.
- `cart.json`: `{ "id": "comet-dodge", "title": "Comet Dodge", "players": 1 }`, nothing else; the title matches the spec's. A change that was given a name adds `"version_name"`.
- Lay out from `g.W` and `g.H`, never screen-size numbers, and return them from `probe()`. A text line holds `g.W / 6` characters.
- One player unless the spec says otherwise; more people take turns with `turns`.
- Randomness only from `g` (`g.rand`, `g.rnd`, `g.pick`). No `Math.random`, no clock, no timers, no DOM.
- Probe what the rules talk about (mode, positions, score, lives, counts). Checks read state, not pixels.

Not in this library yet: nothing here does 3D or scrolling worlds, so build those from `g` directly and keep them simple.
