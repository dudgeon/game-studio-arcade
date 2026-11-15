# g.lib.motion: speeding up, slowing down, falling, bouncing

Nothing should start or stop in one frame. A *body* is `{ x, y, vx, vy, w, h }` kept in state: `x, y` its top-left, `vx, vy` pixels per frame. Positions are fractions; draw them as they are (with `g.glide()` they slide smoothly).

```js
const MOVE = { max: 2.5, accel: 0.3, friction: 0.25 };
s.ship = motion.body(20, 80, 12, 12);                       // init
const st = motion.stick(g);                                  // update
motion.drive(s.ship, st.x, st.y, MOVE);                      // speeds up, coasts to a stop
motion.move(s.ship);
motion.bounce(s.ship, { x: 0, y: 10, w: g.W, h: g.H - 10 }, 0); // 0: stop at the edges

// A jumper on a text map of 8-pixel tiles: stick steers, gravity pulls, "#" is solid.
const solid = (x, y, w, h) => motion.mapHit(MAP, 8, x, y, w, h);
motion.drive(s.cat, st.x, null, MOVE);
const hit = motion.move(s.cat, { gravity: 0.3, solid });
if (hit.y === 1) s.onGround = true;                          // landed
if (g.btnp("a") && s.onGround) s.cat.vy = -5;
```

### `motion.body(x, y, w?, h?)`
A body standing still.

### `motion.stick(g, p?)`
The stick as `{ x, y }`, each -1, 0 or 1.

### `motion.drive(b, dx, dy, opts?)`
Mutates. Steers speed toward `dx * max` by `accel` a frame while pushed, back to 0 by `friction` when not. `opts`: `max` 2, `accel` 0.25, `friction` 0.2. Pass `null` for an axis to leave it alone (y under gravity).

### `motion.move(b, opts?)`
Mutates. One frame: adds `gravity` to `vy` (up to `maxFall`, default 8), then moves. With `solid(x, y, w, h)`, it stops flush against what's solid and returns `{ x, y }` saying which side it hit: `y === 1` landed, `y === -1` bumped its head, `x` -1 or 1 a wall. `bounce` 0..1 makes it bounce off instead. Never tunnels.

### `motion.bounce(b, box, bounciness?)`
Mutates. Keeps a body inside `box`, turning its speed round at the edges: 1 keeps all of it, 0 stops it, default 0.7. Returns `{ x, y }` as `move` does.

### `motion.mapHit(rows, tile, x, y, w, h, solid?)`
True if the box touches a solid tile of a text map (`rows`, `tile` pixels a character). `solid` is the characters that count, default `"#"`. Off the map is open.

### `motion.approach(v, target, step)`
`v` moved toward `target` by at most `step`: a steady change.

### `motion.damp(v, target, rate?)`
`v` moved `rate` (default 0.15) of the way to `target`: fast, then gentle, and it arrives. For anything that should glide to a place: `s.x = motion.damp(s.x, goal)`.

### `motion.ease(t, kind?)`
A curve from 0 to 1 for `t` from 0 to 1. Kinds: `linear`, `in` (starts slow), `out` (ends slow), `inOut` (default), `back` (overshoots, settles), `bounce` (lands and bounces), `elastic` (wobbles).

### `motion.tween(a, b, frame, frames, kind?)`
Where a move from `a` to `b` is, `frame` frames into `frames`. A title dropping in: `y = motion.tween(-20, 40, s.t, 40, "bounce")`.

### `motion.spring(sp, target, stiffness?, damping?)`
Mutates `sp = { x, v }` one frame toward `target` and returns `sp.x`; it overshoots and settles. Kick it with `sp.v += 0.3`. Squash and stretch: keep `s.sq = { x: 0, v: 0 }`, kick on landing, `motion.spring(s.sq, 0)` each update, and draw with `{ zoomX: 1 + s.sq.x, zoomY: 1 - s.sq.x, pivot: [0.5, 1] }`.

### `motion.lerp(a, b, t)`
The value `t` of the way from `a` to `b`.

### `motion.clamp(v, lo, hi)`
`v` kept between `lo` and `hi`.
