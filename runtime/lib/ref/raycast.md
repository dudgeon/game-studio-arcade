# g.lib.raycast: a first-person maze

Walk through a maze and see it from inside. The map is rows of characters, one per tile: `.` or a space is open, anything else is a wall. Positions are in tiles, so `{ x: 1.5, y: 1.5 }` is the middle of the tile at column 1, row 1. An *eye* is `{ x, y, angle }` kept in state; `angle` is radians (0 faces +x, a quarter turn is `Math.PI / 2`).

```js
const MAP = ["########", "#......#", "#.BB.#.#", "#......#", "########"];
s.walls = { "#": g.sprite(BRICK), B: g.sprite(BOOKS) };           // init: 16x16 pictures read well
s.eye = { x: 1.5, y: 1.5, angle: 0 };
s.turn = 0; s.go = 0;

const st = motion.stick(g);                                        // update: ease the turn and the walk
s.turn = motion.approach(s.turn, st.x * 0.045, 0.006);
s.go = motion.approach(s.go, -st.y * 0.06, 0.008);
s.eye.angle += s.turn;
raycast.walk(MAP, s.eye, Math.cos(s.eye.angle) * s.go, Math.sin(s.eye.angle) * s.go);

raycast.draw(g, s.eye, MAP, s.walls, { floor: c.forest, ceil: c.navy, things: s.gems }); // draw
```

Game rules use tiles too: a gem is picked up when `Math.hypot(gem.x - eye.x, gem.y - eye.y) < 0.5`. Probe `eye` and the things.

### `raycast.draw(g, eye, map, walls, opts?)`
Draws the whole view. `walls` gives each wall character its sprite; a character with none uses the first. `opts`: `floor` and `ceil` are a color or a tile sprite (default slate and night); `fog` is tiles of distance per step darker (default 4, 0 for none); `things` is a list of `{ spr, x, y }` in tiles standing in the maze, hidden where walls are in front, with `size` in tiles tall (default 1) and `lift` tiles off the floor. Draws in screen coordinates and resets the camera; draw the HUD after.

### `raycast.walk(map, body, dx, dy, r?)`
Mutates `body.x`, `body.y` by dx, dy tiles, sliding along walls. `r` is the body's half-width (default 0.25). Returns true if a wall stopped any of it. Works for the eye and for anything else that walks.

### `raycast.open(map, x, y)`
Is the tile holding the point open? Off the map is wall.

### `raycast.cast(map, x, y, angle, max?)`
One ray: `{ dist, cell, mx, my, side, u }` for the first wall within `max` tiles (default 32), or null. For "can it see me": the wall toward the player is farther than the player.
