// @ts-check
// A first-person maze (D477): walls drawn from a text map by casting one ray per
// screen column. The map is rows of characters, one per tile: "." or a space is
// open, anything else is a wall. Positions are in tiles (1.5, 1.5 is the middle
// of the tile at column 1, row 1); `angle` is radians, 0 facing +x.

/** Where you stand and which way you face; `fov` is the field of view in radians (default 1.15). */
/** @typedef {{ x: number, y: number, angle: number, fov?: number }} Eye */

/** What a ray hit: how far, the wall's character and tile, which face (0 east/west, 1 north/south), and how far along the face (0..1). */
/** @typedef {{ dist: number, cell: string, mx: number, my: number, side: number, u: number }} RayHit */

const OPEN = ". ";

/**
 * The character at tile x, y; off the map is "#".
 * @param {readonly string[]} map @param {number} x @param {number} y
 */
function cellAt(map, x, y) {
  const row = map[y];
  return row === undefined || x < 0 || x >= row.length ? "#" : row[x];
}

/**
 * Is the tile holding the point x, y open (not a wall)?
 * @param {readonly string[]} map @param {number} x @param {number} y
 */
export function open(map, x, y) {
  return OPEN.includes(cellAt(map, Math.floor(x), Math.floor(y)));
}

/** @param {readonly string[]} map @param {number} x @param {number} y @param {number} dx @param {number} dy @param {number} max */
function march(map, x, y, dx, dy, max) {
  let mx = Math.floor(x);
  let my = Math.floor(y);
  const ddx = dx === 0 ? Infinity : Math.abs(1 / dx);
  const ddy = dy === 0 ? Infinity : Math.abs(1 / dy);
  const sx = dx < 0 ? -1 : 1;
  const sy = dy < 0 ? -1 : 1;
  let tx = dx < 0 ? (x - mx) * ddx : (mx + 1 - x) * ddx;
  let ty = dy < 0 ? (y - my) * ddy : (my + 1 - y) * ddy;
  let side = 0;
  let t = 0;
  for (let i = 0; i < 256; i++) {
    if (tx < ty) {
      t = tx;
      tx += ddx;
      mx += sx;
      side = 0;
    } else {
      t = ty;
      ty += ddy;
      my += sy;
      side = 1;
    }
    if (!(t <= max)) break;
    const cell = cellAt(map, mx, my);
    if (!OPEN.includes(cell)) {
      const at = side === 0 ? y + t * dy : x + t * dx;
      let u = at - Math.floor(at);
      if ((side === 0 && dx < 0) || (side === 1 && dy > 0)) u = 1 - u;
      return { t, cell, mx, my, side, u };
    }
  }
  return null;
}

/**
 * Cast one ray from x, y along `angle`: what it hits within `max` tiles (default 32), or null.
 * For line of sight, shots and "what am I looking at".
 * @param {readonly string[]} map @param {number} x @param {number} y @param {number} angle @param {number} [max]
 * @returns {RayHit | null}
 */
export function cast(map, x, y, angle, max = 32) {
  const h = march(map, x, y, Math.cos(angle), Math.sin(angle), max);
  return h && { dist: h.t, cell: h.cell, mx: h.mx, my: h.my, side: h.side, u: h.u };
}

/**
 * Walk a body by dx, dy tiles, sliding along walls it can't pass. `r` is how wide it is (default 0.25 of a tile).
 * Mutates `b.x`, `b.y`; returns true if a wall stopped any of the move.
 * @param {readonly string[]} map @param {{ x: number, y: number }} b @param {number} dx @param {number} dy @param {number} [r]
 */
export function walk(map, b, dx, dy, r = 0.25) {
  const free = (/** @type {number} */ x, /** @type {number} */ y) => open(map, x - r, y - r) && open(map, x + r, y - r) && open(map, x - r, y + r) && open(map, x + r, y + r);
  let blocked = false;
  if (free(b.x + dx, b.y)) b.x += dx;
  else blocked = dx !== 0;
  if (free(b.x, b.y + dy)) b.y += dy;
  else blocked = blocked || dy !== 0;
  return blocked;
}

/**
 * Draw the view from `eye`: ceiling, floor, walls, then `things` standing in the maze, hidden behind walls.
 * `walls` gives each wall character its picture (any size; 16x16 reads well); a character with none uses the first.
 * Options: `floor` and `ceil` are a color or a tile sprite; `fog` is how many tiles before things get a step darker
 * (default 4, 0 for none); `things` are `{ spr, x, y }` in tiles, with `size` in tiles tall (default 1) and `lift`
 * tiles off the floor (default 0). Draws in screen coordinates and resets the camera.
 * @param {Arcade.G} g @param {Eye} eye @param {readonly string[]} map @param {Readonly<Record<string, Arcade.Sprite>>} walls
 * @param {{ floor?: Arcade.Color | Arcade.Sprite, ceil?: Arcade.Color | Arcade.Sprite, fog?: number,
 *   things?: readonly { spr: Arcade.Sprite, x: number, y: number, size?: number, lift?: number }[] }} [o]
 */
export function draw(g, eye, map, walls, o = {}) {
  const W = g.W;
  const H = g.H;
  const half = H / 2;
  const plane = Math.tan((eye.fov ?? 1.15) / 2);
  const f = W / 2 / plane;
  const dirX = Math.cos(eye.angle);
  const dirY = Math.sin(eye.angle);
  const plX = -dirY * plane;
  const plY = dirX * plane;
  const fog = o.fog ?? 4;
  const shadeAt = (/** @type {number} */ d) => (fog > 0 ? Math.floor(d / fog) : 0);
  const fallback = Object.values(walls)[0];
  if (!fallback) throw new Error("raycast.draw() needs at least one wall picture");
  g.camera();

  // Ceiling and floor: a flat color, or a tile picture laid out in perspective, row by row.
  const flat = (/** @type {Arcade.Color | Arcade.Sprite | undefined} */ v, /** @type {number} */ y, /** @type {Arcade.Color} */ c) => g.rectfill(0, y, W, half, typeof v === "number" ? v : c);
  flat(o.ceil, 0, g.colors.night);
  flat(o.floor, half, g.colors.slate);
  for (const [tex, top] of /** @type {[Arcade.Color | Arcade.Sprite | undefined, boolean][]} */ ([[o.ceil, true], [o.floor, false]])) {
    if (!tex || typeof tex === "number") continue;
    for (let r = Math.ceil(half); r < H; r++) {
      const z = f / 2 / (r + 0.5 - half);
      const x0 = eye.x + z * (dirX - plX);
      const y0 = eye.y + z * (dirY - plY);
      const sx = (z * 2 * plX) / W;
      const sy = (z * 2 * plY) / W;
      g.texRow(tex, 0, top ? H - 1 - r : r, W, (x0 + sx / 2) * tex.w, (y0 + sy / 2) * tex.h, sx * tex.w, sy * tex.h, shadeAt(z));
    }
  }

  // Walls: one ray per column. `depth` keeps how far each column's wall is, for the things.
  const depth = new Array(W).fill(Infinity);
  for (let x = 0; x < W; x++) {
    const cam = (2 * (x + 0.5)) / W - 1;
    const h = march(map, eye.x, eye.y, dirX + plX * cam, dirY + plY * cam, 64);
    if (!h) continue;
    depth[x] = h.t;
    const tex = walls[h.cell] ?? fallback;
    const tall = f / Math.max(h.t, 0.01);
    g.texCol(tex, x, half - tall / 2, Math.ceil(tall), h.u * tex.w, 0, tex.h / tall, h.side + shadeAt(h.t));
  }

  // Things, far ones first, a column at a time so walls in front hide them.
  const seen = [];
  const inv = 1 / (plX * dirY - dirX * plY);
  for (const t of o.things ?? []) {
    const rx = t.x - eye.x;
    const ry = t.y - eye.y;
    const d = inv * (-plY * rx + plX * ry);
    if (d > 0.15) seen.push({ t, d, side: inv * (dirY * rx - dirX * ry) });
  }
  seen.sort((a, b) => b.d - a.d);
  for (const { t, d, side } of seen) {
    const unit = f / d;
    const tall = unit * (t.size ?? 1);
    const wide = (tall * t.spr.w) / t.spr.h;
    const left = (W / 2) * (1 + side / d) - wide / 2;
    const top = half + unit / 2 - unit * (t.lift ?? 0) - tall;
    const shade = shadeAt(d);
    for (let x = Math.max(0, Math.ceil(left - 0.5)); x < W && x + 0.5 < left + wide; x++) {
      if (d < depth[x]) g.texCol(t.spr, x, top, Math.floor(tall), Math.min(t.spr.w - 1, ((x + 0.5 - left) / wide) * t.spr.w), 0, t.spr.h / tall, shade);
    }
  }
}
