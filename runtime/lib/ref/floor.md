# g.lib.floor: a ground in perspective

The ground stretches away to a horizon and turns under you, with sprites standing on it: racers, flying games, anything "into the screen". The world is flat and measured in the floor picture's pixels. A *view* is `{ x, y, angle }` kept in state: a place on the floor and the way you face, in radians (0 faces +x, a quarter turn is `Math.PI / 2`). Optional: `height` above the ground (16; lower feels faster), `horizon` screen row (40% down), `fov` (1.2).

```js
const TILES = { g: [/* 8 rows of 8 */], r: [...], w: [...] };      // grass, road, white line
const MAP = ["gggrrggg", "gggrwggg", ...];                         // one character per tile
s.ground = floor.texture(g, MAP, TILES);                           // init: one big picture, repeats for ever
s.view = { x: 30, y: 200, angle: -Math.PI / 2, height: 12 };

s.view.angle += st.x * 0.03;                                       // update: turn, then go forward
s.view.x += Math.cos(s.view.angle) * s.speed;
s.view.y += Math.sin(s.view.angle) * s.speed;

floor.sky(g, s.view, [c.blue, c.sky, c.ice], s.art.hills);         // draw
floor.draw(g, s.view, s.ground, { fog: 40, haze: c.ice });         // fades into the sky's lowest band
floor.sprites(g, s.view, s.trees, { far: 160 });                   // [{ spr, x, y }]
g.spr(s.art.car, g.W / 2 - 12, g.H - 40);                          // the player, drawn flat on top
```

To know what you're driving on, read the map: `MAP[Math.floor(y / 8)]?.[Math.floor(x / 8)]`, wrapping x and y by the picture's size, since the floor repeats.

### `floor.texture(g, map, tiles)`
One big sprite from a small map: each character of `map` is a tile, `tiles` gives each character's rows. Tiles are square and all the same size. Once, in init. A 16×16 map of 8×8 tiles is plenty.

### `floor.draw(g, view, tex, opts?)`
Draws the ground from the horizon down. `opts.fog` is a distance in floor pixels. With `opts.haze`, a color, the ground is clear up to `fog`, then fades into that color in a dither, and is all haze at four times `fog`: by day, use the sky's lowest band. Without `haze`, the ground gets a step darker every `fog`: for night. Either hides the far shimmer and adds depth; leave `fog` out for neither. Draws in screen coordinates and resets the camera.

### `floor.sky(g, view, colors, strip?)`
The sky above the horizon: `colors` as even bands from the top down, then an optional `strip` sprite (hills, a skyline; any width, it repeats) sitting on the horizon and sliding as you turn.

### `floor.sprites(g, view, things, opts?)`
Draws things standing on the floor, far ones first, each shrunk by distance with its feet on the ground. A thing is `{ spr, x, y }` in floor coordinates, plus `zoom` to make it bigger and `flipX`. `opts.fog` darkens far ones a step per that distance; `opts.far` leaves out anything farther (with haze, four times its `fog`).

### `floor.project(g, view, x, y)`
Where a place on the floor is on screen: `{ x, y, zoom, depth }` (`y` is where it touches the ground, `zoom` the size of a floor pixel there, `depth` how far), or null when it's behind you. For drawing anything yourself, or deciding what's close.
