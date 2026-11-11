# g.lib.score: points, lives, saved high score

A score is `{ score, lives, best, newBest, key }`. `g.save()` holds one JSON value per cart; these treat it as an object with named fields, so a high score doesn't overwrite other saved things.

```js
s.sc = score.newScore(g, { lives: 3 });       // in init and at each new game
score.addPoints(s.sc, 100);
if (score.loseLife(s.sc) === 0) { score.commit(g, s.sc); flow.go(s.flow, "over"); }
```

### `score.newScore(g, opts?)`
A fresh score. `opts.lives` defaults to 3; `opts.key` (default `"best"`) is the saved field, so use another key for a separate high score per mode.

### `score.addPoints(sc, points)`
Mutates. Adds (never below 0), raises `best` and sets `newBest` when passed. Doesn't save. Returns the score.

### `score.loseLife(sc, n?)`
Mutates. Takes away 1 or `n`, not below 0. Returns lives left.

### `score.gainLife(sc, n?, max?)`
Mutates. Adds 1 or `n`, capped at `max`. Returns lives.

### `score.isOver(sc)`
True at no lives.

### `score.commit(g, sc)`
Reports the round's score to the cabinet with `g.score` (its post-game screen shows it and the best ever), then saves the high score if it beats the saved one, keeping other fields; returns true if it saved. Call once when the game ends. Checks test it with `t.reset({ keepSave: true })`, and see what was reported with `t.scores()`.

### `score.loadField(g, key, fallback?)`
The saved field, or `fallback` (default null).

### `score.saveField(g, key, value)`
Saves one field, keeping the rest. Throws over 4 KB. Call on events, not every frame.
