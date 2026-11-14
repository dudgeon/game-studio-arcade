## The library: read only what this game needs

Paths are under `/workspace/kit/`. Everything here is tested, so use it instead of writing your own. Each file costs tokens to read, so don't read one you won't use; this page is enough to ask your questions.

<!-- templates -->
### Starting points

Copy one into the cart folder, then change it in small edits; don't rewrite what already works. Each has `spec.md`, `cart.json`, `game.js` (numbers in one `CFG` block), `checks.js`. Under `studio-kit/context-pack/templates/`:

- `catch/`: things fall; catch the good, avoid the bad; lives, speed-up.
- `dodge/`: free movement; things fly at you; lives, safe time, speed-up.
- `maze/`: tile-by-tile walking, walls from a text map, pickups, a timed round.
- `paddle/`: a ball off the walls, a paddle, serves.
- `scroller/`: run and jump through a world wider than the screen: a map, a camera, parallax hills, stars, spikes, a flag.
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

Movement and depth (the `movement` guide says which to use):
- `motion`: speed that builds and dies away, gravity, bouncing, landing on a tile map, easing, springs.
- `camera`: follows through a bigger world; shakes.
- `parallax`: background layers scrolling at different speeds.
- `anim`: which animation frame, by time or distance walked.
- `particles`: sparks, dust, smoke.
- `floor`: a ground in perspective, things standing on it: racing, flying.
- `raycast`: a first-person maze from a text map.
- `stack`: chunky 3D objects from stacked slices, turned to any angle.

### Guides: `studio-kit/context-pack/modules/<name>.md`

- `cart-api`: everything on `g`: drawing, text, colors, input, sound, saves. Read it unless you only change numbers.
- `checks`: `checks.js`, `t`, and the tested bot `t.bot`. Read it before writing checks.
- `sprites`: drawing with `g.sprite` rows, in sizes that read at 256×192.
- `spec`: writing rules a machine or a person can check. Read it when not starting from a template's spec.
- `game-ai`: `g.ai`, for made-up lines (new jokes), choices (a boss's mood) and spoken commands (hold a button and say "fire") while the game is played. Only when it's a strong fit; read it before using or offering it.
- `movement`: how things should move, and depth, in the 8-bit look. Read it for anything that moves freely, scrolls or goes into the screen.

## House rules

- `game.js` is one module that imports nothing: `export default { init(g), update(g, s), draw(g, s), probe(g, s), poke(g, s, o) }`. `checks.js` also imports nothing.
- `cart.json`: `{ "id": "comet-dodge", "title": "Comet Dodge", "players": 1 }`, nothing else; the title matches the spec's. A change that was given a name adds `"version_name"`.
- Lay out from `g.W` and `g.H`, never screen-size numbers, and return them from `probe()`. A text line holds `g.W / 6` characters.
- One player unless the spec says otherwise; more people take turns with `turns`.
- Randomness only from `g` (`g.rand`, `g.rnd`, `g.pick`). No `Math.random`, no clock, no timers, no DOM.
- Probe what the rules talk about (mode, positions, score, lives, counts). Checks read state, not pixels.
- Nothing starts or stops in one frame: speed builds and dies away (`motion`). A world bigger than the screen scrolls (`camera`). A hit shakes.

Not in this library yet: 3D models. Get depth from `parallax`, `floor`, `raycast` or `stack`.
