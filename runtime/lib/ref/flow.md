# g.lib.flow: title → play → game over

A flow is `{ mode, t, prev }`: the current screen (any string), frames since entering it, and the screen before. Switch on `s.flow.mode` in `update` and `draw`; probe `mode`.

```js
flow.tick(s.flow);
if (s.flow.mode !== "play") {
  if (flow.startPressed(g, s.flow)) {
    if (s.flow.mode === "title") newGame(g, s);
    flow.go(s.flow, s.flow.mode === "title" ? "play" : "title");
  }
  return;
}
```

### `flow.newFlow(mode?)`
A flow on `mode` (default `"title"`).

### `flow.go(flow, mode)`
Mutates. Switch to `mode`, set `prev`, reset `t`. You reset the game state yourself.

### `flow.tick(flow)`
Mutates. Count one frame; call once at the top of `update`. Returns `t`.

### `flow.startPressed(g, flow, opts?)`
Which player pressed to start (1, 2…), or 0. Presses in the first `opts.after` frames (default 30) are ignored, so checks wait 31 frames (`t.bot.start` does). `opts.buttons` defaults to START and A; `opts.players` to every controller.
