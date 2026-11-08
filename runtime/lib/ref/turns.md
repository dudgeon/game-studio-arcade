# g.lib.turns: take turns, pass the controls, one score each

Games are one player unless the spec says otherwise. When two or more take turns: the cabinet has **one controller** (`g.players` is 1), so with fewer controllers than players everyone plays on controller 1 and a "pass the controls" screen goes up between turns. A turns object `{ count, up, round, rounds, scores, passing, t, pass }` is plain data: `up` is whose turn, `scores[p - 1]` is player p's score.

```js
s.turns = turns.newTurns(2, { rounds: 3 });
// update:
if (turns.waiting(g, s.turns)) return;              // pass screen up: nothing else moves
if (turns.btnp(g, s.turns, "a")) jump(s);
if (fellOff) {
  turns.addScore(s.turns, s.height);
  turns.next(g, s.turns);
  if (turns.isOver(s.turns)) flow.go(s.flow, "over");
}
// draw:
if (turns.drawPass(g, s.turns)) return;
```

Read input through `turns.btn`/`turns.btnp`, not `g.btn(b, 2)`, so a cart works on any number of controllers. Probe `up`, `round`, `scores`, `passing`. Checks run on one controller; `t.reset({ players: 2 })` tries two.

### `turns.newTurns(count?, opts?)`
For `count` players (default 2, at most 8), player 1 up. `opts.rounds`: turns per player, 0 (default) for no limit. `opts.pass`: `"shared"` (default), `"always"` or `"never"`.

### `turns.shared(g, turns)`
True when players share controllers.

### `turns.controller(g, turns, p?)`
The controller player `p` plays on (default whoever is up).

### `turns.btn(g, turns, b)`
True while the player who is up holds `b`. False while the pass screen is up.

### `turns.btnp(g, turns, b)`
The same, on the press.

### `turns.next(g, turns)`
Mutates. Next player, next round after the last; puts up the pass screen. Returns who is up. You reset that player's things.

### `turns.waiting(g, turns, opts?)`
Mutates. Runs the pass screen: call at the top of `update` and return while true. True also on the frame the next player takes over (`opts.buttons`, A or START), after `opts.after` frames (default 30).

### `turns.drawPass(g, turns, opts?)`
Draws the pass screen and returns true if it's up. `opts.names`, `opts.color`, `opts.bg`.

### `turns.addScore(turns, points, p?)`
Mutates. Adds to player `p` (default who's up), not below 0. Returns the score.

### `turns.isOver(turns)`
True once every round is played.

### `turns.winner(turns)`
The highest scorer, or 0 for a tie.
