# g.lib.collide: overlap, plus who destroys whom

A *box* has `x, y, w, h` (top-left, pixels). A *thing* is a box with a `kind` string.

```js
const hits = collide.resolve(s.things, [
  { a: "bullet", b: "enemy", kill: "both" },
  { a: "enemy", b: "player", kill: "b" },
]);
for (const h of hits) if (h.b.kind === "enemy") score.addPoints(s.sc, 10);
s.things = collide.alive(s.things);
```

### `collide.overlap(a, b)`
True if two boxes overlap. Touching edges don't count.

### `collide.contains(box, px, py)`
True if the point is inside. Top and left edges are in; bottom and right are out.

### `collide.hits(as, bs)`
Every overlapping pair `[a, b]`, skipping `dead: true` and a thing with itself. `hits(list, list)` gives each pair twice.

### `collide.resolve(things, rules)`
Mutates. Runs rules `{ a, b, kill }` in order over one mixed list; `kill` is `"a"`, `"b"`, `"both"` or `"none"` (just reports). Each hit sets `dead = true` on what it kills; the dead take no further part. Returns `{ a, b, rule }` per hit. Call once per update, then `alive`. One rule entry per "who destroys whom" sentence in the spec.

### `collide.alive(things)`
A new array without the dead.
