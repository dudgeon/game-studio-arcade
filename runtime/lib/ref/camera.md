# g.lib.camera: follow, bounds, shake

For a world bigger than the screen, and for a shake when something hits. A camera is `{ x, y, ... }` kept in state: the world position of the screen's top-left. Everything in the world keeps world coordinates; only the camera moves.

```js
s.cam = camera.newCamera();                                           // init
camera.follow(g, s.cam, s.cat, { bounds: { x: 0, y: 0, w: WORLD_W, h: g.H } }); // update, after moving
if (hurt) camera.shake(g, s.cam);
// draw:
g.cls(c.sky);
camera.use(g, s.cam);          // world coordinates from here
drawWorld(g, s);
g.camera();                    // screen coordinates again
g.text(`SCORE ${s.sc.score}`, 2, 1, c.white);
```

Return `cam: { x: s.cam.x, y: s.cam.y }` from `probe()` if a rule is about scrolling.

### `camera.newCamera(x?, y?)`
A camera with the screen's top-left at world x, y.

### `camera.follow(g, cam, target, opts?)`
Mutates. One frame toward `target` (anything with `x, y` and maybe `w, h`). The target can move about a zone in the middle of the screen before the camera moves at all; then the camera closes `ease` of the gap each frame, so it trails softly. `opts`: `zoneW`, `zoneH` (default a quarter of the screen; 0 keeps the target dead center), `ease` (default 0.15; 1 is locked on), `bounds` (the world's box `{ x, y, w, h }`; the screen never leaves it).

### `camera.shake(g, cam, amount?, frames?)`
Mutates. Shake by up to `amount` pixels (default 3), dying away over `frames` (default 12). A hit is 3; an explosion 6. It doesn't use `g.rand`, so it never changes the game.

### `camera.use(g, cam)`
In draw: points the screen at the camera, shake included. `g.camera()` resets for the HUD.

### `camera.view(g, cam, margin?)`
The part of the world on screen as a box, grown by `margin`. Skip drawing things outside it: `if (collide.overlap(thing, view))`.
