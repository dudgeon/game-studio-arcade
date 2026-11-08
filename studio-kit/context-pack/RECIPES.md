# Recipes

Each recipe goes from a spec rule to the code, the probe and the check. The functions are in `runtime/lib/REFERENCE.md`; the named cart shows the whole thing.

## 1. Title → play → game over

> At 0 lives the game-over screen shows within 30 frames.

```js
flow.tick(s.flow);
if (s.flow.mode !== "play") {
  if (flow.startPressed(g, s.flow)) {
    if (s.flow.mode === "title") newGame(g, s);   // fresh score, positions, timers
    flow.go(s.flow, s.flow.mode === "title" ? "play" : "title");
  }
  return;
}
if (score.loseLife(s.sc) === 0) { score.commit(g, s.sc); flow.go(s.flow, "over"); }
```

Probe `mode`. Every check starts on the title, so begin with `start(t)`: `t.step(31)` (START is ignored for 30 frames), press START for 1 frame, `t.step(2)`. All three carts.

## 2. Thing A destroys thing B

> Touching a comet takes away one life and removes that comet. For the next 90 frames comets can't hurt the ship.

```js
timers.tick(s.safe);                                   // one-shot timer(90), done = not safe
const hits = collide.resolve([s.ship, ...s.things], [{ a: "comet", b: "ship", kill: s.safe.done ? "a" : "none" }]);
if (hits.length && s.safe.done) { g.sfx("hit"); timers.restart(s.safe); score.loseLife(s.sc); }
s.things = collide.alive(s.things);
```

One rule entry per "who destroys whom" sentence; blink in `draw` while safe. Probe `lives` and `safe`; check by steering into a comet (recipe 6). `carts/dodge`.

## 3. Spawn things and get harder

> Comets start at 1 pixel per frame and get 0.5 faster every 600 frames of play, up to 3.

Write the curve as one function, `speedAt(played) = min(3, 1 + 0.5 * floor(played / 600))`, and count play frames in state (`g.frame` doesn't restart with a new game). Spawn on a looping timer at `x: g.W`; drop things once off screen. Check real movement: probe, `t.step(1)`, probe. `carts/dodge`.

## 4. Bounce a ball

> The ball bounces off the top, bottom and right walls and never goes past them.

```js
b.x += b.vx; b.y += b.vy;
if (b.y < TOP) { b.y = TOP; b.vy = -b.vy; }
if (b.y > g.H - B) { b.y = g.H - B; b.vy = -b.vy; }
if (b.vx < 0 && collide.overlap(b, pad)) { b.x = pad.x + pad.w; b.vx = -b.vx; }
```

Clamp when you flip, or the ball sticks in the wall; bounce off the paddle only when moving toward it. Check frame by frame that the ball stays inside and `vy` flips at each wall. `carts/paddle`.

## 5. Grid movement and pieces

> Tapping a direction moves the gardener one tile; holding it repeats after 12 frames, then every 6.

Size the board from the screen, `grid.make(Math.floor(g.W / T), Math.floor((g.H - TOP) / T))`, then move when `timers.repeatTick(s.rep, step !== null)` fires for `step = grid.stickStep(g, 1, true)` and the target is `grid.inBounds`. Pieces on a board use `shape`, `tryMove`, `tryRotate`, `place` and `clearRows` (REFERENCE.md). Probe positions and counts, not the whole board. `carts/collect`.

## 6. Checks that play the game

> Stepping onto a gem adds 10 to the score.

A check is a tiny bot: read the probe, pick the input, step a few frames, repeat until it happens or a frame limit runs out.

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
```

Error messages say what was expected and what happened. Saved best: end a game, `await t.reset({ keepSave: true })`, probe `best`. Sounds: `(await t.sounds()).length`. Screen size: `p.W`, `p.H`.
