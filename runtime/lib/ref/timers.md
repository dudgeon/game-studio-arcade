# g.lib.timers: frame counts, repeats

Time is frames, 60 per second. Keep timers in state and tick each once per update; ticking twice runs it double speed.

```js
s.fall = timers.timer(timers.seconds(0.8), true);   // in init
if (timers.tick(s.fall)) drop(s);                   // in update
timers.restart(s.fall, Math.max(6, s.fall.len - 4)); // faster
```

### `timers.seconds(s)`
Seconds to whole frames.

### `timers.timer(frames, loop?)`
A timer `{ len, left, loop, done }` that fires after `frames` frames. Looping suits spawners; one-shot suits delays and safe time.

### `timers.tick(t)`
Mutates. One frame; true on the frame it fires. A one-shot sets `done`, then stays false.

### `timers.restart(t, frames?)`
Mutates. Start over, clearing `done`, optionally with a new length.

### `timers.progress(t)`
0 (just started) to 1 (fired), for animations.

### `timers.every(g, n, offset?)`
True once every `n` console frames. Cosmetic only, since `g.frame` doesn't restart with a new game.

### `timers.repeat(delay?, rate?)`
An auto-repeat `{ delay, rate, held }`: fires on the press, again after `delay` frames (default 12), then every `rate` (default 4). One per button.

### `timers.repeatTick(r, down)`
Mutates. Feed it whether the button is down, every update, even when up. True on frames to act. Letting go resets it.
