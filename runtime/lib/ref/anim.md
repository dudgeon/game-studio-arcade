# g.lib.anim: which frame to show

Keep an animation's sprites in a list; these pick the index. `t` is a frame count: `g.frame`, or frames since something started.

```js
s.art.run = RUN.map((rows) => g.sprite(rows));                 // init: 4 frames
s.walked += Math.abs(s.cat.vx);                                 // update
g.spr(s.art.run[anim.walk(4, s.walked)], s.cat.x, s.cat.y, { flipX: s.left });
g.spr(s.art.coin[anim.loop(4, g.frame, 6)], coin.x, coin.y);    // spins on its own
g.spr(s.art.boom[anim.once(5, g.frame - b.born, 4)], b.x, b.y);
```

### `anim.loop(n, t, every?)`
Round and round `n` frames, a new one every `every` game frames (default 8).

### `anim.once(n, t, every?)`
Plays through once and holds the last frame.

### `anim.done(n, t, every?)`
True once a `once` animation has finished, to remove the thing.

### `anim.pingpong(n, t, every?)`
There and back: 0 1 2 1 0 1. For breathing and bobbing.

### `anim.walk(n, distance, stride?)`
A new frame every `stride` pixels moved (default 6), so feet keep pace at any speed and stop when the walker stops. `distance` is the total moved so far.
