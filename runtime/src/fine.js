// The glide buffer (D476): the same picture as the framebuffer, on the
// display's own grid. Each game pixel is a k x k block here, so the art stays
// chunky, but a block's position is kept to 1/k of a pixel instead of being
// floored to a whole one. A cart turns it on with g.glide(); the framebuffer in
// gfx.js is still drawn, unchanged, and stays what checks, hashes and saved
// frames see.
import { colorIndex } from "./palette.js";
import { ADVANCE, GLYPH_H, GLYPH_W, LINE_H, glyph, textWidth } from "./font.js";
import { H, W } from "./gfx.js";

/** The biggest k a glide buffer takes: 8 is 2048 x 1536. */
export const MAX_FINE = 8;

/** A whole k from 1 to MAX_FINE; anything else is 1 (no glide buffer). */
export function fineFactor(k) {
  const n = Math.floor(Number(k));
  return n >= 2 && n <= MAX_FINE ? n : 1;
}

function clampScale(scale) {
  const s = Math.floor(scale ?? 1);
  return s < 1 ? 1 : s > 8 ? 8 : s;
}

export class FineBuffer {
  cx = 0;
  cy = 0;
  clipX0 = 0;
  clipY0 = 0;
  clipX1 = 0;
  clipY1 = 0;

  /** @param {number} k buffer pixels per game pixel, 2..MAX_FINE */
  constructor(k) {
    this.k = k;
    this.w = W * k;
    this.h = H * k;
    this.pixels = new Uint8Array(this.w * this.h);
    this.reset();
  }

  reset() {
    this.cx = 0;
    this.cy = 0;
    this.clipX0 = 0;
    this.clipY0 = 0;
    this.clipX1 = this.w;
    this.clipY1 = this.h;
  }

  camera(x = 0, y = 0) {
    this.cx = Math.floor(x * this.k) || 0;
    this.cy = Math.floor(y * this.k) || 0;
  }

  /** The clip is in whole game pixels, as in the framebuffer. */
  clip(x, y, w, h) {
    if (x === undefined) {
      this.clipX0 = 0;
      this.clipY0 = 0;
      this.clipX1 = this.w;
      this.clipY1 = this.h;
      return;
    }
    const k = this.k;
    x = Math.floor(x);
    y = Math.floor(y);
    this.clipX0 = Math.max(0, x) * k;
    this.clipY0 = Math.max(0, y) * k;
    this.clipX1 = Math.min(W, x + Math.floor(w ?? W)) * k;
    this.clipY1 = Math.min(H, y + Math.floor(h ?? H)) * k;
  }

  cls(c = 0) {
    this.pixels.fill(colorIndex(c));
  }

  /** Where game coordinate x lands in the buffer, after the camera. */
  ax(x) {
    return Math.floor(x * this.k) - this.cx;
  }

  ay(y) {
    return Math.floor(y * this.k) - this.cy;
  }

  /** One game pixel: a k x k block with its top-left at buffer px, py. */
  blk(px, py, c) {
    const k = this.k;
    if (px >= this.clipX0 && py >= this.clipY0 && px + k <= this.clipX1 && py + k <= this.clipY1) {
      const p = this.pixels;
      const w = this.w;
      let o = py * w + px;
      if (k === 4) for (let r = 0; r < 4; r++, o += w) p[o] = p[o + 1] = p[o + 2] = p[o + 3] = c;
      else for (let r = 0; r < k; r++, o += w) for (let q = 0; q < k; q++) p[o + q] = c;
    } else this.run(px, 1, py, c);
  }

  /** n game pixels in a row, starting at buffer px, py. */
  run(px, n, py, c) {
    const k = this.k;
    let x0 = px;
    let x1 = px + n * k;
    if (x0 < this.clipX0) x0 = this.clipX0;
    if (x1 > this.clipX1) x1 = this.clipX1;
    if (!(x0 < x1)) return;
    const y0 = Math.max(py, this.clipY0);
    const y1 = Math.min(py + k, this.clipY1);
    for (let y = y0; y < y1; y++) this.pixels.fill(c, y * this.w + x0, y * this.w + x1);
  }

  pset(x, y, c) {
    this.blk(this.ax(x), this.ay(y), colorIndex(c));
  }

  /** The framebuffer's line, as blocks: its shape is in whole game pixels from the first end. */
  line(x0, y0, x1, y1, c) {
    c = colorIndex(c);
    const k = this.k;
    const ax = this.ax(x0);
    const ay = this.ay(y0);
    const ex = Math.round((this.ax(x1) - ax) / k);
    const ey = Math.round((this.ay(y1) - ay) / k);
    const dx = Math.abs(ex);
    const dy = -Math.abs(ey);
    const sx = ex > 0 ? 1 : -1;
    const sy = ey > 0 ? 1 : -1;
    let err = dx + dy;
    let px = 0;
    let py = 0;
    for (let i = 0; i <= dx - dy + 1 && i < 4096; i++) {
      this.blk(ax + px * k, ay + py * k, c);
      if (px === ex && py === ey) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        px += sx;
      }
      if (e2 <= dx) {
        err += dx;
        py += sy;
      }
    }
  }

  rect(x, y, w, h, c) {
    w = Math.floor(w);
    h = Math.floor(h);
    if (w <= 0 || h <= 0) return;
    c = colorIndex(c);
    const k = this.k;
    const ax = this.ax(x);
    const ay = this.ay(y);
    this.run(ax, w, ay, c);
    this.run(ax, w, ay + (h - 1) * k, c);
    for (let j = 1; j < h - 1; j++) {
      this.blk(ax, ay + j * k, c);
      this.blk(ax + (w - 1) * k, ay + j * k, c);
    }
  }

  rectfill(x, y, w, h, c) {
    w = Math.floor(w);
    h = Math.floor(h);
    if (w <= 0 || h <= 0) return;
    c = colorIndex(c);
    const k = this.k;
    const x0 = Math.max(this.ax(x), this.clipX0);
    const x1 = Math.min(this.ax(x) + w * k, this.clipX1);
    if (!(x0 < x1)) return;
    const y0 = Math.max(this.ay(y), this.clipY0);
    const y1 = Math.min(this.ay(y) + h * k, this.clipY1);
    for (let yy = y0; yy < y1; yy++) this.pixels.fill(c, yy * this.w + x0, yy * this.w + x1);
  }

  circ(x, y, r, c) {
    c = colorIndex(c);
    const k = this.k;
    const ax = this.ax(x);
    const ay = this.ay(y);
    r = Math.floor(r);
    if (r < 0) return;
    let px = r;
    let py = 0;
    let err = 1 - r;
    while (px >= py) {
      for (const [dx, dy] of [[px, py], [py, px], [-py, px], [-px, py], [-px, -py], [-py, -px], [py, -px], [px, -py]]) {
        this.blk(ax + dx * k, ay + dy * k, c);
      }
      py++;
      if (err < 0) err += 2 * py + 1;
      else {
        px--;
        err += 2 * (py - px) + 1;
      }
    }
  }

  circfill(x, y, r, c) {
    c = colorIndex(c);
    const k = this.k;
    const ax = this.ax(x);
    const ay = this.ay(y);
    r = Math.floor(r);
    if (r < 0) return;
    let px = r;
    let py = 0;
    let err = 1 - r;
    while (px >= py) {
      this.run(ax - px * k, 2 * px + 1, ay + py * k, c);
      this.run(ax - px * k, 2 * px + 1, ay - py * k, c);
      this.run(ax - py * k, 2 * py + 1, ay + px * k, c);
      this.run(ax - py * k, 2 * py + 1, ay - px * k, c);
      py++;
      if (err < 0) err += 2 * py + 1;
      else {
        px--;
        err += 2 * (py - px) + 1;
      }
    }
  }

  /**
   * @param {string | number} s
   * @param {Arcade.TextOptions} [opts]
   */
  text(s, x, y, c = 5, opts = {}) {
    s = String(s);
    c = colorIndex(c);
    const k = this.k;
    const scale = clampScale(opts.scale);
    const width = textWidth(s, scale);
    let off = 0;
    if (opts.align === "center") off = -Math.floor(width / 2);
    else if (opts.align === "right") off = -width;
    const ax = this.ax(x) + off * k;
    let ly = this.ay(y);
    for (const line of s.split("\n")) {
      let lx = ax;
      for (const ch of line) {
        const rows = glyph(ch);
        for (let gy = 0; gy < GLYPH_H; gy++) {
          const bits = rows[gy];
          if (!bits) continue;
          for (let gx = 0; gx < GLYPH_W; gx++) {
            if (!(bits & (1 << (GLYPH_W - 1 - gx)))) continue;
            if (scale === 1) this.blk(lx + gx * k, ly + gy * k, c);
            else for (let sy = 0; sy < scale; sy++) this.run(lx + gx * scale * k, scale, ly + (gy * scale + sy) * k, c);
          }
        }
        lx += ADVANCE * scale * k;
      }
      ly += LINE_H * scale * k;
    }
    return width;
  }

  /**
   * @param {Arcade.Sprite} s
   * @param {Arcade.SprOptions} [opts]
   */
  spr(s, x, y, opts = {}) {
    if (!s || !s.data) throw new Error("g.spr() needs a sprite made with g.sprite()");
    const k = this.k;
    const scale = clampScale(opts.scale);
    const ax = this.ax(x);
    const ay = this.ay(y);
    const solid = opts.color === undefined ? -1 : colorIndex(opts.color);
    for (let sy = 0; sy < s.h; sy++) {
      const ry = opts.flipY ? s.h - 1 - sy : sy;
      for (let sx = 0; sx < s.w; sx++) {
        const rx = opts.flipX ? s.w - 1 - sx : sx;
        const v = s.data[ry * s.w + rx];
        if (v < 0) continue;
        const c = solid >= 0 ? solid : v;
        if (scale === 1) this.blk(ax + sx * k, ay + sy * k, c);
        else for (let j = 0; j < scale; j++) this.run(ax + sx * scale * k, scale, ay + (sy * scale + j) * k, c);
      }
    }
  }
}
