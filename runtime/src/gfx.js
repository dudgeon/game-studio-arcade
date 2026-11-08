// The framebuffer and drawing primitives: 320x256 palette indices (D3).
import { colorIndex } from "./palette.js";
import { ADVANCE, GLYPH_H, GLYPH_W, LINE_H, glyph, textWidth } from "./font.js";

export const W = 320;
export const H = 256;

const SPRITE_CHARS = "0123456789abcdefghijklmnopqrstuv";

/**
 * Parse sprite rows ("0".."9", "a".."v" = palette 0..31; "." or " " = transparent).
 * @param {readonly string[]} rows
 * @returns {Arcade.Sprite}
 */
export function makeSprite(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("g.sprite() needs a non-empty array of row strings");
  const w = rows[0].length;
  const h = rows.length;
  if (w === 0) throw new Error("g.sprite(): rows can't be empty strings");
  const data = new Int8Array(w * h);
  rows.forEach((row, y) => {
    if (typeof row !== "string" || row.length !== w) {
      throw new Error(`g.sprite(): row ${y} is ${row?.length} characters long, expected ${w} (all rows must be the same length)`);
    }
    for (let x = 0; x < w; x++) {
      const ch = row[x].toLowerCase();
      if (ch === "." || ch === " ") data[y * w + x] = -1;
      else {
        const v = SPRITE_CHARS.indexOf(ch);
        if (v < 0) throw new Error(`g.sprite(): row ${y} has "${row[x]}"; use 0-9 and a-v for colors and "." for transparent`);
        data[y * w + x] = v;
      }
    }
  });
  return Object.freeze({ w, h, data });
}

function clampScale(scale) {
  const s = Math.floor(scale ?? 1);
  return s < 1 ? 1 : s > 8 ? 8 : s;
}

export class Framebuffer {
  cx = 0;
  cy = 0;
  clipX0 = 0;
  clipY0 = 0;
  clipX1 = W;
  clipY1 = H;

  constructor() {
    this.pixels = new Uint8Array(W * H);
    this.reset();
  }

  /** Reset camera and clip (done before every draw). */
  reset() {
    this.cx = 0;
    this.cy = 0;
    this.clipX0 = 0;
    this.clipY0 = 0;
    this.clipX1 = W;
    this.clipY1 = H;
  }

  camera(x = 0, y = 0) {
    this.cx = Math.floor(x) || 0;
    this.cy = Math.floor(y) || 0;
  }

  clip(x, y, w, h) {
    if (x === undefined) {
      this.clipX0 = 0;
      this.clipY0 = 0;
      this.clipX1 = W;
      this.clipY1 = H;
      return;
    }
    x = Math.floor(x);
    y = Math.floor(y);
    this.clipX0 = Math.max(0, x);
    this.clipY0 = Math.max(0, y);
    this.clipX1 = Math.min(W, x + Math.floor(w ?? W));
    this.clipY1 = Math.min(H, y + Math.floor(h ?? H));
  }

  cls(c = 0) {
    this.pixels.fill(colorIndex(c));
  }

  /** Plot in screen space (after camera), honoring clip. */
  _plot(x, y, c) {
    if (x >= this.clipX0 && x < this.clipX1 && y >= this.clipY0 && y < this.clipY1) this.pixels[y * W + x] = c;
  }

  pset(x, y, c) {
    this._plot(Math.floor(x) - this.cx, Math.floor(y) - this.cy, colorIndex(c));
  }

  pget(x, y) {
    x = Math.floor(x);
    y = Math.floor(y);
    return x >= 0 && x < W && y >= 0 && y < H ? this.pixels[y * W + x] : 0;
  }

  /** Horizontal span in screen space. */
  _hspan(x0, x1, y, c) {
    if (y < this.clipY0 || y >= this.clipY1) return;
    if (x0 > x1) [x0, x1] = [x1, x0];
    x0 = Math.max(x0, this.clipX0);
    x1 = Math.min(x1, this.clipX1 - 1);
    if (x0 > x1) return;
    this.pixels.fill(c, y * W + x0, y * W + x1 + 1);
  }

  line(x0, y0, x1, y1, c) {
    c = colorIndex(c);
    x0 = Math.floor(x0) - this.cx;
    y0 = Math.floor(y0) - this.cy;
    x1 = Math.floor(x1) - this.cx;
    y1 = Math.floor(y1) - this.cy;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    // Bound the walk so a wild coordinate can't hang the frame.
    for (let i = 0; i <= dx - dy + 1 && i < 4096; i++) {
      this._plot(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  rect(x, y, w, h, c) {
    w = Math.floor(w);
    h = Math.floor(h);
    if (w <= 0 || h <= 0) return;
    c = colorIndex(c);
    const x0 = Math.floor(x) - this.cx;
    const y0 = Math.floor(y) - this.cy;
    const x1 = x0 + w - 1;
    const y1 = y0 + h - 1;
    this._hspan(x0, x1, y0, c);
    this._hspan(x0, x1, y1, c);
    for (let yy = y0 + 1; yy < y1; yy++) {
      this._plot(x0, yy, c);
      this._plot(x1, yy, c);
    }
  }

  rectfill(x, y, w, h, c) {
    w = Math.floor(w);
    h = Math.floor(h);
    if (w <= 0 || h <= 0) return;
    c = colorIndex(c);
    const x0 = Math.floor(x) - this.cx;
    const y0 = Math.max(Math.floor(y) - this.cy, this.clipY0);
    const y1 = Math.min(Math.floor(y) - this.cy + h, this.clipY1);
    for (let yy = y0; yy < y1; yy++) this._hspan(x0, x0 + w - 1, yy, c);
  }

  circ(x, y, r, c) {
    c = colorIndex(c);
    const cx = Math.floor(x) - this.cx;
    const cy = Math.floor(y) - this.cy;
    r = Math.floor(r);
    if (r < 0) return;
    let px = r;
    let py = 0;
    let err = 1 - r;
    while (px >= py) {
      for (const [ax, ay] of [[px, py], [py, px], [-py, px], [-px, py], [-px, -py], [-py, -px], [py, -px], [px, -py]]) {
        this._plot(cx + ax, cy + ay, c);
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
    const cx = Math.floor(x) - this.cx;
    const cy = Math.floor(y) - this.cy;
    r = Math.floor(r);
    if (r < 0) return;
    let px = r;
    let py = 0;
    let err = 1 - r;
    while (px >= py) {
      this._hspan(cx - px, cx + px, cy + py, c);
      this._hspan(cx - px, cx + px, cy - py, c);
      this._hspan(cx - py, cx + py, cy + px, c);
      this._hspan(cx - py, cx + py, cy - px, c);
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
    const scale = clampScale(opts.scale);
    const width = textWidth(s, scale);
    let ox = Math.floor(x);
    if (opts.align === "center") ox -= Math.floor(width / 2);
    else if (opts.align === "right") ox -= width;
    let ly = Math.floor(y) - this.cy;
    for (const line of s.split("\n")) {
      let lx = ox - this.cx;
      for (const ch of line) {
        const rows = glyph(ch);
        for (let gy = 0; gy < GLYPH_H; gy++) {
          const bits = rows[gy];
          if (!bits) continue;
          for (let gx = 0; gx < GLYPH_W; gx++) {
            if (!(bits & (1 << (GLYPH_W - 1 - gx)))) continue;
            if (scale === 1) this._plot(lx + gx, ly + gy, c);
            else for (let sy = 0; sy < scale; sy++) this._hspan(lx + gx * scale, lx + gx * scale + scale - 1, ly + gy * scale + sy, c);
          }
        }
        lx += ADVANCE * scale;
      }
      ly += LINE_H * scale;
    }
    return width;
  }

  /**
   * @param {Arcade.Sprite} s
   * @param {Arcade.SprOptions} [opts]
   */
  spr(s, x, y, opts = {}) {
    if (!s || !s.data) throw new Error("g.spr() needs a sprite made with g.sprite()");
    const scale = clampScale(opts.scale);
    const x0 = Math.floor(x) - this.cx;
    const y0 = Math.floor(y) - this.cy;
    const solid = opts.color === undefined ? -1 : colorIndex(opts.color);
    for (let sy = 0; sy < s.h; sy++) {
      const ry = opts.flipY ? s.h - 1 - sy : sy;
      for (let sx = 0; sx < s.w; sx++) {
        const rx = opts.flipX ? s.w - 1 - sx : sx;
        const v = s.data[ry * s.w + rx];
        if (v < 0) continue;
        const c = solid >= 0 ? solid : v;
        if (scale === 1) this._plot(x0 + sx, y0 + sy, c);
        else for (let k = 0; k < scale; k++) this._hspan(x0 + sx * scale, x0 + sx * scale + scale - 1, y0 + sy * scale + k, c);
      }
    }
  }
}

/** 64-bit-ish hash of a framebuffer (two 32-bit FNV-1a variants), as 16 hex chars. */
export function hashPixels(pixels) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < pixels.length; i++) {
    const v = pixels[i];
    h1 = Math.imul(h1 ^ v, 0x01000193);
    h2 = Math.imul(h2 ^ (v + i), 0x5bd1e995);
    h2 ^= h2 >>> 15;
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}
