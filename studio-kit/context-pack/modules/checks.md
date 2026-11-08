# checks.js

One async check per `(auto)` rule, keyed by rule id, written from the spec's words. It imports nothing. A check passes by returning and fails by throwing; the message goes in the report, so it says what was expected and what happened. Each check gets a fresh cart: seed 1, nothing saved, one controller. Keep them short: the bot below is tested, so don't write your own loops.

```js
// @ts-check
const chase = (t) => (p) => t.bot.toward(p.player, t.bot.nearest(p.player, p.fish) ?? p.player, { axis: "x" });

/** @type {Arcade.Checks} */
export default {
  async R1(t) {                                   // R1: holding right moves 3 pixels per frame
    const a = await t.bot.start();
    t.bot.eq((await t.bot.hold("right", 10)).player.x, a.player.x + 30, "x after 10 frames");
  },
  async R3(t) {                                   // R3: catching a fish scores 10
    await t.bot.start();
    await t.poke({ lives: 99 });                  // the rule is about score, not lives
    const p = await t.bot.reach(chase(t), (q) => q.caught >= 1, "a caught fish");
    t.bot.eq(p.score, 10 * p.caught, "score");
  },
};
```

## `t.bot`

- `start(o?)`: title into play: waits the 30 ignored frames, presses START, checks `mode === "play"`. `o.button`, `o.mode`. Returns the probe.
- `hold(buttons, frames)`: hold (`"right"`, `"left up"`, `""`) for exact frames. Returns the probe.
- `press(button, then = 1)`: press for one frame, then run `then` more. Returns the probe.
- `wait(frames)`: run with nothing held. Returns the probe.
- `reach(steer, until, what, o?)`: every `o.every` frames (default 3) hold `steer(p)`, until `until(p)`. Returns the probe. Fails with "the bot couldn't get to <what>" if the mode changes (game over) or `o.max` frames pass (default 3000). `o.anyMode: true` keeps going across a mode change; use it when reaching the mode change itself is the goal.
- `play(steer, { until, max, every, anyMode })`: the same, but returns `{ p, frames, reached }` and never fails.
- `delta(get, { frames = 1, held = "" })`: how much `get(probe)` changes.
- `toward(from, to, { axis, dead = 2 })`, `away(from, threat, { axis })`: the buttons to hold, as a string. Things with `w`/`h` count from their centers.
- `nearest(from, list)`: the closest thing, or null.
- `pathStep(open, from, to)`: first button of the shortest tile walk; `open(x, y)` says what's walkable.
- `ok(cond, why)`, `eq(got, want, what)`, `near(got, want, what, eps?)`: fail with a clear message. `eq` compares arrays and objects too.

## `t`

`t.probe()`, `t.step(n)`, `t.input([{ frames, p1: "right a" }])` (queues; nothing moves until `step`), `t.sounds()` (`[{ frame, kind }]`), `t.frame()` (pixels; rarely needed), `t.reset({ seed?, keepSave?, players? })`. All async: `await` each. Best score: end a game, `await t.reset({ keepSave: true })`, probe `best`.

## `t.poke`: setting up, not testing

`await t.poke({ lives: 99 })` calls the cart's `poke(g, s, o)`. **Use it to keep a bot alive so a check can reach the late game** instead of writing a bot good enough to survive.
- Never poke what the rule is about: a rule about losing lives plays with real lives; a rule about score doesn't poke score.
- Keep the real thing happening: read a speed from real movement, not from a poked or probed number.

## Probe for the rules

Your checks decide what `probe()` must return, and `game.js` then provides it. Counters make checks short and strong: `caught: { fish, boot }`, `landed: { fish, boot }`, `played`, `kinds`. Give things an `id` so a check can follow one across frames. Check accounting across the rule's words: `lives === 99 - landed.fish - caught.boot`.

## Limits and speed

10 s per check on node, 30 s in the browser, 18,000 frames. In the browser each look at the game is slow, so stay under about 1,000 looks per check: with nothing to steer, use `every: 10` or `wait`. Rule ids must match the spec's `(auto)` rules exactly.
