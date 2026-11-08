# g.lib.grid: boards, pieces, rotation, full rows

A *grid* is `{ w, h, cells }`, cell (x, y) at `cells[y * w + x]`, 0 for empty, otherwise any number you choose. A *shape* is `{ n, cells: [[x, y], ...] }` in an n×n box. A *piece* is `{ shape, x, y }`, the box's top-left at grid cell (x, y). Draw by looping cells and `rectfill`ing the non-zero ones.

```js
s.board = grid.make(10, 20);
s.piece = { shape: grid.shape([".#.", "###", "..."]), x: 3, y: -1 };
if (timers.repeatTick(s.leftRep, g.btn("left"))) grid.tryMove(s.board, s.piece, -1, 0);
if (g.btnp("a")) grid.tryRotate(s.board, s.piece, 1);
```

### `grid.make(w, h, fill?)`
A new grid, filled with `fill` (default 0).

### `grid.inBounds(grid, x, y)`
True for a whole-number cell on the grid.

### `grid.get(grid, x, y, outside?)`
The cell, or `outside` (default -1) off the grid, so `get(...) === 0` treats edges as walls.

### `grid.set(grid, x, y, v)`
Sets a cell. Off-grid writes are ignored.

### `grid.stickStep(g, p?, held?)`
Player `p`'s stick as one step `[dx, dy]`, or null. Uses `btnp` (one per press) unless `held`, then `btn`, so slow that with `timers.repeat`. Up beats down beats left beats right.

### `grid.shape(rows)`
A shape from rows of characters: `"."` or space is empty, anything else a cell. `n` is the larger of the rows and the longest row; pad with `"."` to choose the pivot.

### `grid.rotate(shape, turns?)`
A new shape turned clockwise `turns` times (default 1; negative is counter-clockwise). Doesn't check the board.

### `grid.cellsAt(shape, x, y)`
The grid cells `[x, y]` the shape covers with its box at (x, y).

### `grid.fits(grid, shape, x, y)`
True if on empty cells and inside the left, right and bottom walls. Above the top row counts as free.

### `grid.tryMove(grid, piece, dx, dy)`
Mutates. Moves if it fits; true if moved. False from `(0, 1)` means landed.

### `grid.KICKS`
Frozen list of `[dx, dy]` that `tryRotate` tries by default. `[[0, 0]]` means no kicks.

### `grid.tryRotate(grid, piece, turns?, kicks?)`
Mutates. Turns the piece, trying each kick; true if it turned.

### `grid.dropDistance(grid, piece)`
Rows it can fall before landing. Add to `piece.y` for an instant drop.

### `grid.place(grid, piece, v)`
Mutates. Writes the piece's cells with `v`. Returns how many fell above the top row; over 0 usually means game over.

### `grid.fullRows(grid)`
Indices of rows with no empty cell, top to bottom.

### `grid.clearRows(grid, rows?)`
Mutates. Removes the rows (default all full), moves the rest down, adds empties at the top. Returns how many.
