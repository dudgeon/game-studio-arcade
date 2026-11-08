# Starter library reference

The house starter library gives a cart tested building blocks for collision, grids and rotation, timers, score and lives, and the title → play → game-over flow. A cart never imports it. It's on the console handle as `g.lib` (D50):

```js
const { grid, timers, score, flow, collide } = g.lib;
```

Conventions that hold everywhere:
- **State is plain data you keep.** Every helper that remembers something (a grid, a piece, a timer, a score, a flow) gives you a plain JSON object to keep in your cart's state `s`. The library itself holds nothing between calls. So `probe()` can return these objects as they are, and `reset()` always starts clean.
- **Time is frames.** The clock is 60 frames per second. Tick timers once per `update`. Never use wall time.
- **`g` comes first** when a helper needs input, the frame count or saves. Everything else is pure.
- **Mutating helpers say so.** `tryMove`, `tryRotate`, `place`, `clearRows`, `resolve`, `tick` and the score functions change the object you pass them. The others return new values.

## collide: overlap, plus who destroys whom

A *box* is any object with `x, y, w, h` (top-left corner and size, in pixels). A *thing* is a box with a `kind` string, such as `"bullet"`, `"enemy"` or `"cat"`.

```js
const hitList = collide.resolve(s.things, [
  { a: "bullet", b: "enemy", kill: "both" },
  { a: "enemy", b: "player", kill: "b" },
]);
for (const h of hitList) if (h.b.kind === "enemy") score.addPoints(s.score, 10);
s.things = collide.alive(s.things);
```

### `collide.overlap(a, b)`
Returns true if boxes `a` and `b` overlap. Boxes that only touch along an edge don't count, so two 8-pixel tiles side by side at x=0 and x=8 don't collide. This is the basic test for "did these two things touch". Use it for one-off checks; use `hits` or `resolve` for whole lists.

### `collide.contains(box, px, py)`
Returns true if the point (px, py) is inside the box. The top and left edges count as inside; the bottom and right edges don't, the same as pixels. Use it for a pointer, a bullet treated as a single pixel, or a "standing on this tile?" test.

### `collide.hits(as, bs)`
Returns every overlapping pair `[a, b]` with `a` from list `as` and `b` from list `bs`, in list order. It skips anything with `dead: true`, and never pairs a thing with itself. `hits(list, list)` is therefore safe, though each pair then appears twice, once each way. Use it when you want to decide what happens yourself. `resolve` is the rule-driven version.

### `collide.resolve(things, rules)`
Applies "who destroys whom" rules to one mixed list of things. Each rule `{ a, b, kill }` names two kinds, and `kill` is `"a"`, `"b"`, `"both"` or `"none"` (`"none"` only reports the hit). Rules run in order. For each rule, every live `a`-kind thing that overlaps a live `b`-kind thing is a hit, and the matching things get `dead = true`. Anything killed earlier in the same call takes no further part, so a bullet with `kill: "both"` stops at the first enemy it hits. With `kill: "b"` a laser passes through every enemy it touches. Returns the hits as `{ a, b, rule }`, in order, for score, sound and sparkles. Call it once per update, then drop the dead with `alive`. Spec rules like "a bullet that touches an enemy destroys both" map one-to-one onto rule entries.

### `collide.alive(things)`
Returns a new array of the things whose `dead` isn't true. Call it after `resolve` (or after you set `dead` yourself) so dead things stop being drawn and updated.

## grid: boards, pieces, rotation, full rows

A *grid* is `{ w, h, cells }`, where cell (x, y) is `cells[y * w + x]`. A cell is 0 when empty; otherwise it holds any number you choose, such as a palette color or a kind. A *shape* is `{ n, cells: [[x, y], ...] }` inside an n×n box. A *piece* is `{ shape, x, y }`: a shape whose box has its top-left corner at grid cell (x, y). To draw a grid, loop over its cells and `rectfill` each non-zero one at `(x * size, y * size)`.

```js
s.board = grid.make(10, 20);
s.piece = { shape: grid.shape([".#.", "###", "..."]), x: 3, y: -1 };
// in update:
if (timers.repeatTick(s.leftRep, g.btn("left"))) grid.tryMove(s.board, s.piece, -1, 0);
if (g.btnp("a")) grid.tryRotate(s.board, s.piece, 1);
if (timers.tick(s.fall) && !grid.tryMove(s.board, s.piece, 0, 1)) {
  const over = grid.place(s.board, s.piece, s.color) > 0;
  const lines = grid.clearRows(s.board);
}
```

### `grid.KICKS`
The default list of `[dx, dy]` offsets `tryRotate` tries, in order, when a turned piece doesn't fit where it is: in place, one left, one right, one up, two left, two right. It's frozen. Pass your own list to `tryRotate` for different behaviour; `[[0, 0]]` means no kicks at all.

### `grid.make(w, h, fill?)`
Returns a new w×h grid with every cell set to `fill` (default 0, empty). Keep it in state. It's plain JSON, so `probe()` can return it, or a summary of it such as the filled-cell count or `fullRows`, for checks.

### `grid.inBounds(grid, x, y)`
Returns true if (x, y) is a whole-number cell on the grid. Use it before reading neighbours, or to keep a grid-walking player on the board.

### `grid.get(grid, x, y, outside?)`
Returns the value at cell (x, y), or `outside` (default -1) when the cell is off the grid. Because -1 isn't 0, "is this cell free?" checks (`get(...) === 0`) treat the edges as walls without a separate bounds test.

### `grid.set(grid, x, y, v)`
Sets cell (x, y) to `v`. Off-grid writes are ignored silently, so pre-filling levels or spawning blocks near the edge can't throw.

### `grid.shape(rows)`
Builds a shape from rows of characters, written like a sprite: `"."` or a space is empty, and any other character is a cell. The box size `n` is the larger of the number of rows and the longest row, and rotation turns the shape inside that box. Pad with `"."` to choose where it pivots: `["....", "####", "....", "...."]` makes a 4-long bar that turns around the middle of a 4×4 box. Make shapes once, in `init` or as constants.

### `grid.rotate(shape, turns?)`
Returns a new shape turned clockwise by 90° `turns` times (default 1; negative turns go counter-clockwise) inside its n×n box. Four turns give back the original, and `rotate(s, 1)` followed by `rotate(.., -1)` undoes itself. It doesn't check the board: use `tryRotate` to turn a piece in play, and `rotate` to build a shape's other orientations ahead of time or to draw a preview.

### `grid.cellsAt(shape, x, y)`
Returns the grid cells `[x, y]` the shape covers when its box sits at (x, y). Use it to draw a piece (`for (const [cx, cy] of grid.cellsAt(p.shape, p.x, p.y)) g.rectfill(...)`) and in `probe()` to show checks where a piece is.

### `grid.fits(grid, shape, x, y)`
Returns true if the shape, with its box at (x, y), lies entirely on empty cells and inside the left, right and bottom walls. Cells above the top row (y < 0) count as free, so a new piece can start partly above the board. This is the test behind `tryMove`, `tryRotate` and `dropDistance`. Call it yourself to check a spawn point, for example "game over if the new piece doesn't fit".

### `grid.tryMove(grid, piece, dx, dy)`
Moves the piece by (dx, dy) if it fits there, changing `piece.x` and `piece.y`, and returns true. Otherwise it leaves the piece alone and returns false. A false from `tryMove(board, p, 0, 1)` means the piece has landed. Pair it with `timers.repeat` for held left and right, and with a falling timer for gravity.

### `grid.tryRotate(grid, piece, turns?, kicks?)`
Turns the piece by `turns` quarter-turns clockwise (default 1; -1 is counter-clockwise). If the turned shape doesn't fit in place, it tries each `[dx, dy]` in `kicks` (default `KICKS`) and uses the first that fits. It changes `piece.shape` (and x, y if kicked) and returns true. If nothing fits, the piece is unchanged and it returns false, which is a good moment for a "bonk" sound.

### `grid.dropDistance(grid, piece)`
Returns how many rows the piece can fall before it lands (0 if it's already resting). `piece.y += grid.dropDistance(board, piece)` is an instant drop. Drawing the piece's cells at `piece.y + dropDistance` gives a landing preview.

### `grid.place(grid, piece, v)`
Writes the piece's cells into the grid with value `v`, so the piece becomes part of the board. Cells above the top row are dropped, and their count is returned. More than 0 means the stack has reached the top, which is the usual game-over test. Make the next piece after placing.

### `grid.fullRows(grid)`
Returns the row indices, top to bottom, that have no empty cell. Call it before `clearRows` when you want to flash or sparkle the rows first, or to score by how many rows cleared at once. Probe it in checks such as "a full row disappears".

### `grid.clearRows(grid, rows?)`
Removes the given rows (default: every full row), moves everything above them down, and adds empty rows at the top. Changes the grid in place and returns how many rows it removed. Duplicate or out-of-range indices are ignored. For a "pop" effect: `const rows = grid.fullRows(b)`, animate for a few frames with a timer, then `grid.clearRows(b, rows)`.

### `grid.stickStep(g, p?, held?)`
Reads player `p`'s stick (default 1) as one grid step, `[dx, dy]`, or null when there's no input. By default it uses `g.btnp`: one step per press, which suits menus and step-by-step movers. With `held` true it uses `g.btn` and steps every frame the stick is down, so slow it with a timer or use `timers.repeat`. Up beats down beats left beats right, so a diagonal gives a single axis. Use it for a grid-walking player, a menu cursor, or a piece-moving direction.

## timers: frame counts, repeats, blinking

```js
s.fall = timers.timer(timers.seconds(0.8), true);   // in init
if (timers.tick(s.fall)) grid.tryMove(...);           // in update
timers.restart(s.fall, Math.max(6, s.fall.len - 4));  // speed up
```

### `timers.seconds(s)`
Converts seconds to frames at 60 frames per second, rounded to a whole frame. Write durations in seconds when the spec does ("the speed goes up every 30 seconds"), so the code reads like the rule.

### `timers.timer(frames, loop?)`
Returns a timer `{ len, left, loop, done }` that fires after `frames` frames (at least 1). With `loop` true it fires every `frames` frames, forever, which suits gravity, spawners and blinking. Otherwise it fires once and sets `done`, which suits delays, invulnerability after a hit, and how long a pop animation lasts. Keep it in state and `tick` it once per update.

### `timers.tick(t)`
Advances the timer one frame and returns true on the frame it fires. A looping timer starts its next run; a one-shot timer sets `done` and returns false from then on. Call it exactly once per update for each running timer. Calling it twice makes time run double speed.

### `timers.restart(t, frames?)`
Starts the timer over, clearing `done`, optionally with a new length. Use it to rearm a one-shot timer, or to change speed: `restart(s.fall, s.fall.len - 2)` makes pieces fall faster from the next step.

### `timers.progress(t)`
Returns how far through its current run the timer is, from 0 (just started) to 1 (fired). Use it to drive animations from a timer: the size of a growing sparkle, a flash that fades, a countdown bar.

### `timers.every(g, n, offset?)`
Returns true once every `n` frames of the console clock (`g.frame % n === offset`). It's for cosmetic rhythms that don't need their own state, such as a sparkle every 8 frames. For blinking "PRESS START", `g.frame % 60 < 30` is simpler. Use a real `timer` for anything a rule depends on, since `g.frame` doesn't restart when a new game does.

### `timers.repeat(delay?, rate?)`
Returns an auto-repeat `{ delay, rate, held }` for a held button or direction. It fires on the press, then again after `delay` frames (default 12), then every `rate` frames (default 4). This is the familiar "tap to nudge, hold to slide" feel for moving a piece or a cursor. Keep one per button you need it on, per player.

### `timers.repeatTick(r, down)`
Feed it the repeat and whether its button is down this frame (`g.btn("left", p)`). It returns true on the frames the action should happen. Letting go resets it, so the next press fires at once. Call it once per update per repeat, even when the button is up.

## score: points, lives, saved high score

`g.save()` keeps one JSON value per cart. These helpers treat it as an object with named fields, so the high score can share the save with other things (settings, unlocked levels) without overwriting them.

```js
s.score = score.newScore(g, { lives: 3 });       // in init, and at each new game
score.addPoints(s.score, 100 * lines);
if (score.loseLife(s.score) === 0) { score.commit(g, s.score); flow.go(s.flow, "over"); }
```

### `score.loadField(g, key, fallback?)`
Returns the saved value under `key`, or `fallback` (default null) if nothing is saved, the save isn't an object, or the field is missing. Use it to read any saved setting, e.g. `loadField(g, "level", 1)`.

### `score.saveField(g, key, value)`
Saves `value` under `key` and keeps every other field already saved. If the existing save isn't an object, it's replaced with `{ [key]: value }`. Throws, like `g.save`, if the result isn't JSON or is over 4 KB. Saving writes storage, so call it on events (a game ends, a setting changes), never every frame.

### `score.newScore(g, opts?)`
Returns a fresh score `{ score: 0, lives, best, newBest: false, key }` for a new game. `lives` defaults to 3. `best` is the high score saved under field `key` (default `"best"`; use another key, such as `"best2"`, for a separate high score per mode). Call it in `init` and again whenever a new game starts, so `best` always reflects the save. For two players, keep one score each; with the same key they share one high score.

### `score.addPoints(sc, points)`
Adds points to the score (negative points take some away, but never below 0) and returns the new score. When the score passes `best`, it raises `best` and sets `newBest` to true, so the HUD can show the live high score and celebrate. It doesn't save; call `commit` when the game ends.

### `score.loseLife(sc, n?)`
Takes away one life, or `n`, never going below 0, and returns the lives left. 0 means game over: commit the score and go to the game-over screen.

### `score.gainLife(sc, n?, max?)`
Adds one life, or `n`, capped at `max` if given, and returns the lives now. Use it for a bonus life every so many points or for a pickup.

### `score.isOver(sc)`
Returns true when no lives are left. It's handy in `probe()` and in update guards.

### `score.commit(g, sc)`
Saves the score as the new high score if it beats the one already saved, keeping other saved fields, and returns true if it saved. Call it once when the game ends, not every frame. Saved high scores persist across restarts and power cycles, so checks can test "the high score survives a restart" with `t.reset({ keepSave: true })`.

## flow: title → play → game over

A flow is `{ mode, t, prev }`. `mode` is the current screen (any string you like: "title", "play", "over", "paused"), `t` counts frames since entering it, and `prev` is the screen before. In `update` and `draw`, switch on `s.flow.mode`.

```js
flow.tick(s.flow);
switch (s.flow.mode) {
  case "title": if (flow.startPressed(g, s.flow)) { newGame(g, s); flow.go(s.flow, "play"); } break;
  case "play":  playUpdate(g, s); break;
  case "over":  if (flow.startPressed(g, s.flow)) flow.go(s.flow, "title"); break;
}
```

### `flow.newFlow(mode?)`
Returns a flow starting on `mode` (default `"title"`). Keep it in state and expose `mode` from `probe()`, so checks can assert things like "pressing START on the title starts the game" or "losing the last life shows game over".

### `flow.go(flow, mode)`
Switches to `mode`, remembers the old one in `prev`, and resets `t` to 0. Going to the mode you're already in restarts its count. Reset the game state (new score, empty board) yourself when entering play.

### `flow.tick(flow)`
Counts one frame in the current mode and returns the count. Call it once at the top of `update`. Use `flow.t` for timed screens, such as returning to the title after 10 seconds of game over (`if (s.flow.t > timers.seconds(10)) flow.go(s.flow, "title")`) or a "READY?" pause before play starts.

### `flow.startPressed(g, flow, opts?)`
Returns which player pressed to start: 1, 2, or 0 for nobody. Presses in the first `after` frames of the mode (default 30, half a second) are ignored, so a kid still mashing buttons when the game ends doesn't skip the game-over screen. `buttons` defaults to START and A, and `players` to both. If both press on the same frame, player 1 wins. Returning the player lets "whoever presses starts" or "press to join" work with no extra code.
