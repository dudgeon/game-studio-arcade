// Drawing that isn't a straight copy (D475, D477): sprites turned and zoomed,
// and textured rows and columns for floors and walls. Written once against a
// buffer's block interface (k, w, pixels, clip, ax, ay, blk), so the framebuffer
// (k = 1) and the glide buffer (k > 1) draw the same shape: always whole game
// pixels, sampled nearest, so it stays pixel art.
import { colorIndex, shadeTable } from "./palette.js";

/**
 * @typedef {{
 *   k: number, w: number, pixels: Uint8Array,
 *   clipX0: number, clipY0: number, clipX1: number, clipY1: number,
 *   ax(x: number): number, ay(y: number): number, blk(px: number, py: number, c: number): void,
 * }} Blocks
 */

const MAX_ZOOM = 64;
const EPS = 1e-9;

function clampScale(scale) {
  const s = Math.floor(scale ?? 1);
  return s < 1 ? 1 : s > 8 ? 8 : s;
}

/** Does a g.spr() call need this path? */
export function isXform(opts) {
  return opts.rot !== undefined || opts.zoom !== undefined || opts.zoomX !== undefined || opts.zoomY !== undefined || opts.pivot !== undefined || opts.shade !== undefined;
}

/**
 * A sprite turned by `rot` and zoomed, about its pivot. With no turn and no
 * zoom it draws exactly what the plain path draws.
 * @param {Blocks} buf
 * @param {Arcade.Sprite} s
 * @param {number} x
 * @param {number} y
 * @param {Arcade.SprOptions} opts
 */
export function sprX(buf, s, x, y, opts) {
  if (!s || !s.data) throw new Error("g.spr() needs a sprite made with g.sprite()");
  const scale = clampScale(opts.scale);
  const zoom = Number(opts.zoom ?? 1);
  const zx = Math.min(MAX_ZOOM, scale * zoom * Number(opts.zoomX ?? 1));
  const zy = Math.min(MAX_ZOOM, scale * zoom * Number(opts.zoomY ?? 1));
  if (!(zx > 0 && zy > 0)) return;
  const rot = Number(opts.rot) || 0;
  const pvx = opts.pivot ? Number(opts.pivot[0]) : 0.5;
  const pvy = opts.pivot ? Number(opts.pivot[1]) : 0.5;
  if (!Number.isFinite(pvx + pvy)) return;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const w = s.w;
  const h = s.h;
  // The pivot in texels, and in game pixels from the sprite's top-left. The zoom doesn't move it.
  const ppx = w * pvx;
  const ppy = h * pvy;
  const ox = ppx * scale;
  const oy = ppy * scale;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < 4; i++) {
    const tx = ((i & 1 ? w : 0) - ppx) * zx;
    const ty = ((i & 2 ? h : 0) - ppy) * zy;
    const dx = tx * cos - ty * sin + ox;
    const dy = tx * sin + ty * cos + oy;
    if (dx < minX) minX = dx;
    if (dx > maxX) maxX = dx;
    if (dy < minY) minY = dy;
    if (dy > maxY) maxY = dy;
  }

  const k = buf.k;
  const A = buf.ax(x);
  const B = buf.ay(y);
  // Only the game pixels whose block can touch the clip.
  const i0 = Math.max(Math.floor(minX + EPS), Math.ceil((buf.clipX0 - A - k + 1) / k));
  const i1 = Math.min(Math.ceil(maxX - EPS) - 1, Math.floor((buf.clipX1 - 1 - A) / k));
  const j0 = Math.max(Math.floor(minY + EPS), Math.ceil((buf.clipY0 - B - k + 1) / k));
  const j1 = Math.min(Math.ceil(maxY - EPS) - 1, Math.floor((buf.clipY1 - 1 - B) / k));
  if (!(i0 <= i1 && j0 <= j1)) return;

  const ia = cos / zx;
  const ib = sin / zx;
  const ic = -sin / zy;
  const id = cos / zy;
  const solid = opts.color === undefined ? -1 : colorIndex(opts.color);
  const shade = opts.shade === undefined ? null : shadeTable(opts.shade);
  const flipX = !!opts.flipX;
  const flipY = !!opts.flipY;
  const data = s.data;
  for (let j = j0; j <= j1; j++) {
    const dy = j + 0.5 - oy;
    for (let i = i0; i <= i1; i++) {
      const dx = i + 0.5 - ox;
      const tu = Math.floor(dx * ia + dy * ib + ppx + EPS);
      const tv = Math.floor(dx * ic + dy * id + ppy + EPS);
      if (tu < 0 || tu >= w || tv < 0 || tv >= h) continue;
      const v = data[(flipY ? h - 1 - tv : tv) * w + (flipX ? w - 1 - tu : tu)];
      if (v < 0) continue;
      const c = solid >= 0 ? solid : v;
      buf.blk(A + i * k, B + j * k, shade ? shade[c] : c);
    }
  }
}

/**
 * A row of `n` game pixels from x, y, each taken from the sprite at (u, v),
 * which moves by (du, dv) per pixel and wraps round the sprite's edges.
 * @param {Blocks} buf
 * @param {Arcade.Sprite} tex
 * @param {number} x @param {number} y @param {number} n
 * @param {number} u @param {number} v @param {number} du @param {number} dv
 * @param {number} [shade] steps darker, 0..5
 */
export function texRow(buf, tex, x, y, n, u, v, du, dv, shade) {
  if (!tex || !tex.data) throw new Error("g.texRow() needs a sprite made with g.sprite()");
  const k = buf.k;
  const A = buf.ax(x);
  const B = buf.ay(y);
  const y0 = Math.max(B, buf.clipY0);
  const y1 = Math.min(B + k, buf.clipY1);
  if (!(y0 < y1)) return;
  const i0 = Math.max(0, Math.ceil((buf.clipX0 - A - k + 1) / k));
  const i1 = Math.min(Math.floor(n) - 1, Math.floor((buf.clipX1 - 1 - A) / k));
  if (!(i0 <= i1)) return;
  const w = tex.w;
  const h = tex.h;
  const data = tex.data;
  const table = shadeTable(shade);
  const p = buf.pixels;
  const stride = buf.w;
  if (k === 1) {
    const o = y0 * stride + A;
    for (let i = i0; i <= i1; i++) {
      let tu = Math.floor(u + i * du) % w;
      let tv = Math.floor(v + i * dv) % h;
      if (tu < 0) tu += w;
      if (tv < 0) tv += h;
      const c = data[tv * w + tu];
      if (c >= 0) p[o + i] = table[c];
    }
    return;
  }
  // The glide buffer: draw the first buffer row of the blocks, then copy it down. A row with a
  // transparent pixel can't be copied whole, so that one is drawn block by block.
  const o0 = y0 * stride;
  let holes = false;
  for (let i = i0; i <= i1; i++) {
    let tu = Math.floor(u + i * du) % w;
    let tv = Math.floor(v + i * dv) % h;
    if (tu < 0) tu += w;
    if (tv < 0) tv += h;
    const c = data[tv * w + tu];
    if (!(c >= 0)) {
      holes = true;
      continue;
    }
    const col = table[c];
    const xs = Math.max(A + i * k, buf.clipX0);
    const xe = Math.min(A + i * k + k, buf.clipX1);
    for (let xx = xs; xx < xe; xx++) p[o0 + xx] = col;
    if (holes) for (let yy = y0 + 1; yy < y1; yy++) for (let xx = xs; xx < xe; xx++) p[yy * stride + xx] = col;
  }
  if (holes) {
    // Blocks before the first hole have only their first row: finish them.
    for (let i = i0; i <= i1; i++) {
      let tu = Math.floor(u + i * du) % w;
      let tv = Math.floor(v + i * dv) % h;
      if (tu < 0) tu += w;
      if (tv < 0) tv += h;
      const c = data[tv * w + tu];
      if (!(c >= 0)) break;
      const col = table[c];
      const xs = Math.max(A + i * k, buf.clipX0);
      const xe = Math.min(A + i * k + k, buf.clipX1);
      for (let yy = y0 + 1; yy < y1; yy++) for (let xx = xs; xx < xe; xx++) p[yy * stride + xx] = col;
    }
    return;
  }
  const xs = Math.max(A + i0 * k, buf.clipX0);
  const xe = Math.min(A + i1 * k + k, buf.clipX1);
  for (let yy = y0 + 1; yy < y1; yy++) p.copyWithin(yy * stride + xs, o0 + xs, o0 + xe);
}

/**
 * A column of `n` game pixels down from x, y, taken from the sprite's column
 * `u` starting at row `v`, which moves by `dv` per pixel. Both wrap.
 * @param {Blocks} buf
 * @param {Arcade.Sprite} tex
 * @param {number} x @param {number} y @param {number} n
 * @param {number} u @param {number} v @param {number} dv
 * @param {number} [shade] steps darker, 0..5
 */
export function texCol(buf, tex, x, y, n, u, v, dv, shade) {
  if (!tex || !tex.data) throw new Error("g.texCol() needs a sprite made with g.sprite()");
  const k = buf.k;
  const A = buf.ax(x);
  const B = buf.ay(y);
  const xs = Math.max(A, buf.clipX0);
  const xe = Math.min(A + k, buf.clipX1);
  if (!(xs < xe)) return;
  const j0 = Math.max(0, Math.ceil((buf.clipY0 - B - k + 1) / k));
  const j1 = Math.min(Math.floor(n) - 1, Math.floor((buf.clipY1 - 1 - B) / k));
  if (!(j0 <= j1)) return;
  const w = tex.w;
  const h = tex.h;
  let tu = Math.floor(u) % w;
  if (tu < 0) tu += w;
  if (!(tu >= 0)) return;
  const data = tex.data;
  const table = shadeTable(shade);
  const p = buf.pixels;
  const stride = buf.w;
  for (let j = j0; j <= j1; j++) {
    let tv = Math.floor(v + j * dv) % h;
    if (tv < 0) tv += h;
    const c = data[tv * w + tu];
    if (!(c >= 0)) continue;
    const col = table[c];
    if (k === 1) {
      p[(B + j) * stride + xs] = col;
      continue;
    }
    const ys = Math.max(B + j * k, buf.clipY0);
    const ye = Math.min(B + j * k + k, buf.clipY1);
    if (xe - xs === 4) {
      for (let o = ys * stride + xs, end = ye * stride; o < end; o += stride) p[o] = p[o + 1] = p[o + 2] = p[o + 3] = col;
      continue;
    }
    for (let yy = ys; yy < ye; yy++) {
      const o = yy * stride;
      for (let xx = xs; xx < xe; xx++) p[o + xx] = col;
    }
  }
}
