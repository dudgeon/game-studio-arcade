# g.lib.fx: pop-ups, life hearts, title, banner

Screen polish that changes no game state. Keep pop-ups in `s.pops = []`.

```js
fx.tick(s.pops);                                  // top of update, in every mode
fx.pop(s.pops, "+10", thing.x, thing.y, c.yellow); // on an event
// draw:
const art = fx.title(g, "APPLE CATCH", s.sc.best); // title screen
g.spr(s.art.apple, art.cx - 18, art.cy - 18, { scale: 3 });
fx.lives(g, s.sc.lives, g.W - 2, 1);
fx.draw(g, s.pops);
if (s.flow.mode === "over") fx.banner(g, "GAME OVER", s.sc.newBest ? "NEW BEST!" : `SCORE ${s.sc.score}`);
```

### `fx.pop(pops, text, x, y, color, frames?)`
Mutates. Adds a pop-up centered on x that drifts up for `frames` frames (default 30).

### `fx.tick(pops)`
Mutates. One frame; finished pop-ups go. Call once per update.

### `fx.draw(g, pops)`
Draws them, kept on screen.

### `fx.lives(g, n, x, y, color?)`
`n` hearts, 7×6 and 9 apart, right edge at x, top at y; default red, at most 12.

### `fx.title(g, name, best, opts?)`
The whole title's words: name near the top (smaller if long), blinking PRESS START and BEST near the bottom. `opts.color` for the name, `opts.ink` for the small words. Returns `{ cx, cy, h }`, the center and height of the clear space between them: **draw title art there so it can't cover the words.**

### `fx.banner(g, text, sub?, color?)`
A panel mid-screen with big words and an optional line under them.
