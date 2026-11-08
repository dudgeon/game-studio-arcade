// @ts-check
// Grids: a board of cells, pieces that move and rotate on it, full rows, and
// one-step grid movement from the stick. Everything is a plain JSON object
// the cart keeps in its state; 0 means an empty cell.

/** A w x h board. `cells[y * w + x]` is 0 when empty, otherwise any number you choose (a color, a kind). */
/** @typedef {{ w: number, h: number, cells: number[] }} Grid */

/** A shape: cells [x, y] inside an n x n box. Rotation turns it inside that box. */
/** @typedef {{ n: number, cells: [number, number][] }} Shape */

/** A shape placed on a grid: its box's top-left is at grid cell x, y. */
/** @typedef {{ shape: Shape, x: number, y: number }} Piece */

/** Offsets tried in order when a rotation doesn't fit where it is. */
/** @type {readonly (readonly [number, number])[]} */
export const KICKS = Object.freeze(
  /** @type {(readonly [number, number])[]} */ ([[0, 0], [-1, 0], [1, 0], [0, -1], [-2, 0], [2, 0]]).map((k) => Object.freeze(k)),
);

/**
 * A new w x h grid with every cell set to `fill` (default 0, empty).
 * @param {number} w
 * @param {number} h
 * @param {number} [fill]
 * @returns {Grid}
 */
export function make(w, h, fill = 0) {
  return { w, h, cells: new Array(w * h).fill(fill) };
}

/**
 * Is cell x, y on the grid?
 * @param {Grid} grid
 * @param {number} x
 * @param {number} y
 */
export function inBounds(grid, x, y) {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < grid.w && y < grid.h;
}

/**
 * The value at cell x, y, or `outside` (default -1) off the grid.
 * @param {Grid} grid
 * @param {number} x
 * @param {number} y
 * @param {number} [outside]
 */
export function get(grid, x, y, outside = -1) {
  return inBounds(grid, x, y) ? grid.cells[y * grid.w + x] : outside;
}

/**
 * Set cell x, y to v. Off-grid cells are ignored.
 * @param {Grid} grid
 * @param {number} x
 * @param {number} y
 * @param {number} v
 */
export function set(grid, x, y, v) {
  if (inBounds(grid, x, y)) grid.cells[y * grid.w + x] = v;
}

/**
 * A shape from rows of characters: "." or " " is empty, anything else is a cell.
 * The box size n is the larger of the row count and the longest row, so pad
 * with "." to choose the turning point.
 * @param {readonly string[]} rows
 * @returns {Shape}
 */
export function shape(rows) {
  /** @type {[number, number][]} */
  const cells = [];
  let n = rows.length;
  rows.forEach((row, y) => {
    n = Math.max(n, row.length);
    for (let x = 0; x < row.length; x++) if (row[x] !== "." && row[x] !== " ") cells.push([x, y]);
  });
  return { n, cells };
}

/**
 * The shape turned clockwise by 90 degrees `turns` times (negative turns go
 * counter-clockwise) inside its n x n box. Returns a new shape; four turns
 * give back the original.
 * @param {Shape} s
 * @param {number} [turns]
 * @returns {Shape}
 */
export function rotate(s, turns = 1) {
  const k = ((turns % 4) + 4) % 4;
  let cells = s.cells.map(([x, y]) => /** @type {[number, number]} */ ([x, y]));
  for (let i = 0; i < k; i++) cells = cells.map(([x, y]) => [s.n - 1 - y, x]);
  return { n: s.n, cells };
}

/**
 * The grid cells [x, y] a shape covers with its box at x, y.
 * @param {Shape} s
 * @param {number} x
 * @param {number} y
 * @returns {[number, number][]}
 */
export function cellsAt(s, x, y) {
  return s.cells.map(([cx, cy]) => [x + cx, y + cy]);
}

/**
 * Does the shape fit with its box at x, y: every cell on the grid and empty?
 * Cells above the top row (y < 0) count as free, so pieces can enter from above.
 * @param {Grid} grid
 * @param {Shape} s
 * @param {number} x
 * @param {number} y
 */
export function fits(grid, s, x, y) {
  for (const [cx, cy] of cellsAt(s, x, y)) {
    if (cx < 0 || cx >= grid.w || cy >= grid.h) return false;
    if (cy >= 0 && grid.cells[cy * grid.w + cx] !== 0) return false;
  }
  return true;
}

/**
 * Move the piece by dx, dy if it fits there. Returns true if it moved.
 * @param {Grid} grid
 * @param {Piece} piece
 * @param {number} dx
 * @param {number} dy
 */
export function tryMove(grid, piece, dx, dy) {
  if (!fits(grid, piece.shape, piece.x + dx, piece.y + dy)) return false;
  piece.x += dx;
  piece.y += dy;
  return true;
}

/**
 * Turn the piece `turns` quarter-turns clockwise (default 1; -1 is
 * counter-clockwise). If it doesn't fit in place, tries each offset in
 * `kicks` (default KICKS: in place, left, right, up, two left, two right).
 * Returns true if it turned; otherwise the piece is unchanged.
 * @param {Grid} grid
 * @param {Piece} piece
 * @param {number} [turns]
 * @param {readonly (readonly [number, number])[]} [kicks]
 */
export function tryRotate(grid, piece, turns = 1, kicks = KICKS) {
  const next = rotate(piece.shape, turns);
  for (const [dx, dy] of kicks) {
    if (fits(grid, next, piece.x + dx, piece.y + dy)) {
      piece.shape = next;
      piece.x += dx;
      piece.y += dy;
      return true;
    }
  }
  return false;
}

/**
 * How many rows the piece can fall before it lands (0 if it's resting).
 * Use it for a hard drop (`piece.y += dropDistance(...)`) or a ghost preview.
 * @param {Grid} grid
 * @param {Piece} piece
 */
export function dropDistance(grid, piece) {
  let d = 0;
  while (fits(grid, piece.shape, piece.x, piece.y + d + 1)) d++;
  return d;
}

/**
 * Write the piece into the grid with value v (it becomes part of the board).
 * Cells off the grid, such as above the top, are dropped. Returns how many
 * cells were above the top row (y < 0): more than 0 usually means game over.
 * @param {Grid} grid
 * @param {Piece} piece
 * @param {number} v
 */
export function place(grid, piece, v) {
  let above = 0;
  for (const [x, y] of cellsAt(piece.shape, piece.x, piece.y)) {
    if (y < 0) above++;
    else set(grid, x, y, v);
  }
  return above;
}

/**
 * The indices of rows with no empty cell, top to bottom.
 * @param {Grid} grid
 * @returns {number[]}
 */
export function fullRows(grid) {
  /** @type {number[]} */
  const rows = [];
  for (let y = 0; y < grid.h; y++) {
    let full = true;
    for (let x = 0; x < grid.w; x++) if (grid.cells[y * grid.w + x] === 0) { full = false; break; }
    if (full) rows.push(y);
  }
  return rows;
}

/**
 * Remove the given rows (default: every full row) and drop the rows above
 * them down; empty rows come in at the top. Returns how many rows were removed.
 * Call `fullRows` first if you want to flash the rows before clearing them.
 * @param {Grid} grid
 * @param {readonly number[]} [rows]
 */
export function clearRows(grid, rows = fullRows(grid)) {
  const gone = new Set(rows.filter((y) => Number.isInteger(y) && y >= 0 && y < grid.h));
  if (gone.size === 0) return 0;
  /** @type {number[]} */
  const kept = [];
  for (let y = 0; y < grid.h; y++) if (!gone.has(y)) kept.push(...grid.cells.slice(y * grid.w, (y + 1) * grid.w));
  grid.cells = new Array(gone.size * grid.w).fill(0).concat(kept);
  return gone.size;
}

/**
 * One grid step from the stick this frame, as [dx, dy], or null. Uses
 * `g.btnp` (one step per press); pass `held` true to use `g.btn` instead
 * (one step every frame the stick is held; pair it with a timer to slow it).
 * Up beats down and left beats right, so diagonals give one axis.
 * @param {Arcade.G} g
 * @param {Arcade.Player} [p]
 * @param {boolean} [held]
 * @returns {[number, number] | null}
 */
export function stickStep(g, p = 1, held = false) {
  const on = held ? (/** @type {Arcade.Button} */ b) => g.btn(b, p) : (/** @type {Arcade.Button} */ b) => g.btnp(b, p);
  if (on("up")) return [0, -1];
  if (on("down")) return [0, 1];
  if (on("left")) return [-1, 0];
  if (on("right")) return [1, 0];
  return null;
}
