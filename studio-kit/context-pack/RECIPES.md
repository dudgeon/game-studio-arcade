# Recipes

Each recipe goes from a spec rule to the code, the probe and the check. The library functions are explained in `runtime/lib/REFERENCE.md`; the example carts show each recipe in a whole game.

## 1. Title → play → game over

> R4 (auto): At 0 lives the game-over screen shows within 30 frames.

```js
// update
flow.tick(s.flow);
if (s.flow.mode !== "play") {
  if (flow.startPressed(g, s.flow)) {
    if (s.flow.mode === "title") newGame(g, s);   // fresh score, positions, timers
    flow.go(s.flow, s.flow.mode === "title" ? "play" : "title");
  }
  return;
}
// …play…
if (score.loseLife(s.sc) === 0) { score.commit(g, s.sc); flow.go(s.flow, "over"); }
```

Probe `mode: s.flow.mode`. Every check starts on the title, so begin with:

```js
async function start(t) {
  await t.step(31);                                   // START is ignored for 30 frames
  await t.input([{ frames: 1, p1: "start" }]);
  await t.step(2);
}
```

Draw each mode in `draw` by switching on `s.flow.mode`. Example: all three carts.

## 2. Thing A destroys thing B

> R3 (auto): Touching a comet takes away one life and removes that comet. For the next 90 frames comets can't hurt the ship.

```js
s.safe = timers.timer(90); s.safe.done = true;        // in newGame: not safe yet
// update
timers.tick(s.safe);
const hits = collide.resolve([s.ship, ...s.things], [{ a: "comet", b: "ship", kill: s.safe.done ? "a" : "none" }]);
if (hits.length && s.safe.done) { g.sfx("hit"); timers.restart(s.safe); score.loseLife(s.sc); }
s.things = collide.alive(s.things);
// draw: blink while safe
if (s.safe.done || g.frame % 8 < 4) g.rectfill(s.ship.x, s.ship.y, 8, 8, g.colors.sky);
```

One rule entry per "who destroys whom" sentence. Probe `lives` and `safe: !s.safe.done`. Check by steering into a comet (recipe 6) until `lives` drops. Example: `carts/dodge`.

## 3. Spawn things and get harder over time

> R5 (auto): Comets start at 1 pixel per frame and get 0.5 faster every 600 frames of play, up to 3.

```js
const speedAt = (played) => Math.min(3, 1 + 0.5 * Math.floor(played / 600));
// update
s.played += 1;
if (timers.tick(s.spawn)) s.things.push({ kind: "comet", x: g.W, y: TOP + g.rnd(g.H - TOP - 8), w: 8, h: 8 });
for (const c of s.things) c.x -= speedAt(s.played);
s.things = s.things.filter((c) => c.x > -8);           // drop what left the screen
```

Count play frames in state (not `g.frame`, which doesn't restart with a new game). Write the curve as one function so the rule and the code read the same. Check by measuring real movement: probe a thing, `t.step(1)`, probe again. Example: `carts/dodge`.

## 4. Bounce a ball

> R2 (auto): The ball bounces off the top, bottom and right walls and never goes past them.

```js
b.x += b.vx; b.y += b.vy;
if (b.y < TOP) { b.y = TOP; b.vy = -b.vy; }
if (b.y > g.H - B) { b.y = g.H - B; b.vy = -b.vy; }
if (b.vx < 0 && collide.overlap(b, pad)) { b.x = pad.x + pad.w; b.vx = -b.vx; g.sfx("blip"); }
if (b.x < -B) { s.ball = null; timers.restart(s.serve, 60); }   // missed: serve again later
```

Clamp the position when you flip the velocity, or the ball sticks in the wall. Only bounce off the paddle when moving toward it. Probe the ball's `x, y, vx, vy`. Check frame by frame that it stays inside and that `vy` flips at each wall. Example: `carts/paddle`.

## 5. Grid movement, pieces and rotation

> R1 (auto): Tapping a direction moves the gardener one tile. Holding it moves one more tile after 12 frames, then one every 6 frames.

```js
s.board = grid.make(Math.floor(g.W / T), Math.floor((g.H - TOP) / T));   // size from the screen
s.rep = timers.repeat(12, 6);
// update
const step = grid.stickStep(g, 1, true);
if (timers.repeatTick(s.rep, step !== null) && step && grid.inBounds(s.board, s.x + step[0], s.y + step[1])) {
  s.x += step[0]; s.y += step[1];
}
```

For pieces on a board use `grid.shape`, `grid.tryMove`, `grid.tryRotate` (with wall kicks), `grid.place` and `grid.clearRows`; REFERENCE.md has the loop. Probe cell positions and counts (`fullRows(board).length`), not the whole board. Example: `carts/collect`.

## 6. Checks that play the game

> R2 (auto): Stepping onto a gem adds 10 to the score, and a new gem appears on another tile.

A check is a tiny bot: read the probe, choose the input, step a few frames, repeat until something happens or a frame limit runs out.

```js
async function chase(t, max, done) {
  for (let n = 0; n < max; n += 2) {
    const p = await t.probe();
    if (done(p)) return p;
    const c = p.comets[0];
    await t.input([{ frames: 2, p1: c ? (c.y > p.ship.y ? "down" : "up") : "" }]);
    await t.step(2);
  }
  return t.probe();
}
const p = await chase(t, 1200, (p) => p.lives < 3);
if (p.lives !== 2) throw new Error(`the first comet should cost one life, lives are ${p.lives}`);
```

- Say what was expected and what happened in every error message.
- A saved best score: finish a game, then `await t.reset({ keepSave: true })` and probe `best`.
- A sound: `(await t.sounds()).length > 0` after the event.
- Never hardcode the screen size; use `p.W` and `p.H` from the probe.
