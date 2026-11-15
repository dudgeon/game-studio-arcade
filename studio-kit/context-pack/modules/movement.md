# Movement and depth

How things move is most of how a game feels. These are the house rules; the library does the work. All of it stays in the 8-bit look: chunky pixels, the 32 colors, nothing blurred.

## The rules

1. **Glide.** Call `g.glide()` once in `init`. Positions then keep their fractions on screen, so scrolling and slow movement slide instead of stepping a whole pixel. Keep positions as fractions and draw them as they are; don't round them.
2. **Nothing starts or stops in one frame.** Never `s.x += 2` on a button. Give the thing a speed that builds up and dies away: `motion.drive` for the stick, `motion.move` for gravity and landing, `motion.bounce` for walls. For a thing going to a place, `motion.damp`; for a timed move, `motion.tween`.
3. **Things arrive and leave.** A title drops in (`tween` with `"bounce"` or `"back"`), a pickup pops (`particles.burst`), a score counts up, a new enemy grows from nothing (`zoom` from 0 with `ease`). Nothing just appears.
4. **Squash and stretch.** A jumper stretches going up and squashes on landing: keep a `motion.spring`, kick it on the event, and draw with `zoomX: 1 + q, zoomY: 1 - q, pivot: [0.5, 1]`.
5. **The camera follows.** If the world is bigger than the screen, keep everything in world coordinates and move a `camera`; draw the HUD after `g.camera()`. Add `parallax` layers behind so the world has depth.
6. **A hit shakes.** `camera.shake(g, s.cam)` on damage, a bigger one for an explosion, with a burst of particles and a sound. A fixed-screen game can keep a camera just for the shake.
7. **Animate by distance.** Walk frames from `anim.walk` and distance moved, so feet stop when the walker stops.

Games that move in steps (tile mazes, falling blocks, board games) keep their steps in the rules, and ease only the drawing: `s.drawX = motion.damp(s.drawX, s.x * tile)`.

## Depth: pick one

- **Side or top view, more to it:** `parallax` layers and a `camera`. Start from the `scroller` template.
- **Into the screen** (racing, flying): `floor`. The ground stretches to a horizon and turns under you; things stand on it and grow as they come near. Start from the `racer` template.
- **From inside** (mazes, dungeons, haunted houses): `raycast`. Walls from a text map, things standing in it. Start from the `maze3d` template.
- **Chunky objects that turn** (cars, boats, tanks seen from above): `stack`. Or one sprite with `rot` for something flat.

One of `floor` or `raycast` fills the screen, so use one per scene. All of them are drawn in whole pixels and the 32 colors.

## Rules and checks for movement

- Write the feel as numbers a check can read: "holding right speeds the runner up by 0.2 pixels per frame each frame, up to 2", "the screen never shows past the ends of the world". Probe `vx`, the camera, the angle.
- Speeds are fractions now: compare with `t.bot.near`, not `eq`. Don't write a rule that says "moves 2 pixels per frame" for something that speeds up.
- `g.glide()`, `particles` and `camera.shake` never change what a check sees or what `g.rand` gives next, so adding polish can't break a rule.
- What can only be seen is a `(you check)` rule: "the far hills move slower than the ground".
- A check may `poke` the player to a place to test what happens there; give the camera a moment to catch up before checking the screen.

## Keeping it fast

Drawing is cheap, but not free: one `floor` or `raycast` a frame, at most a few dozen `stack`s, and skip what's off screen (`camera.view`). Glide costs about 3 ms of the cabinet's 16.7 ms frame: on a busy screen with nothing slow-moving, `g.glide(false)`, and `g.glide(true)` again where it matters. Make sprites, textures and maps once in `init`, never in `draw`. The playtest's `frame-time` check says if a frame takes too long.
