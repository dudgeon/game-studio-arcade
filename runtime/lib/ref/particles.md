# g.lib.particles: sparks, dust, smoke, confetti

Little dots that fly out and fade, for a hit, a pickup, a landing, an explosion. Keep them in `s.bits = []`. They use their own dice, not `g.rand`, so adding a burst never changes the game or its checks.

```js
particles.tick(s.bits);                                          // top of update, in every mode
particles.burst(g, s.bits, coin.x + 4, coin.y + 4, { colors: [c.yellow, c.gold] });           // a pickup
particles.burst(g, s.bits, x, y, { n: 30, speed: 3.5, life: 45, size: 3, colors: [c.red, c.orange, c.yellow] }); // an explosion
particles.burst(g, s.bits, cat.x + 6, cat.y + 12, { n: 5, speed: 1, angle: -Math.PI / 2, spread: 2, colors: [c.silver] }); // dust on landing
// draw, after camera.use so they sit in the world:
particles.draw(g, s.bits);
```

### `particles.burst(g, list, x, y, opts?)`
Mutates. Adds a burst at x, y. `opts`: `n` how many (12), `speed` pixels a frame at most (2), `life` frames (30), `colors` a list shared out at random (white), `size` pixels (1), `gravity` added to the fall each frame (0.05; 0 floats, negative rises like smoke), `drag` kept speed each frame (0.98), `angle` and `spread` in radians to aim them (default every direction; `angle: -Math.PI / 2` is up).

### `particles.tick(list)`
Mutates. One frame; finished particles go. Call once per update.

### `particles.draw(g, list)`
Draws them. Big ones shrink as they die.

### `particles.MAX`
400: the most a list holds. A burst past it is cut short.
