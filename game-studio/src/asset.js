// studio import_asset (HANDOFF §9.3, D346): a found picture becomes a house sprite. Carts import nothing (D21),
// so a sprite is rows of palette characters in game.js: `g.sprite([...])`, `0`-`9` and `a`-`v` for colors
// 0-31 and `.` for transparent. The picture is shrunk to fit size × size, each pixel mapped to the nearest of
// the 32 house colors (D3), and mostly-transparent pixels left out.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { RGB } from "../../runtime/src/palette.js";

const CHARS = "0123456789abcdefghijklmnopqrstuv";
export const MAX_SPRITE = 64;

/**
 * Decode a PNG: 8-bit gray, RGB, palette (1, 2, 4 or 8 bit), gray+alpha or RGBA, not interlaced.
 * Anything else throws, and importAsset converts it with macOS's sips first.
 * @param {Buffer} buf
 * @returns {{ width: number, height: number, rgba: Uint8Array }}
 */
export function decodePng(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  let interlace = 0;
  /** @type {Buffer | null} */
  let plte = null;
  /** @type {Buffer | null} */
  let trns = null;
  /** @type {Buffer[]} */
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const kind = buf.toString("latin1", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (kind === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      type = data[9];
      interlace = data[12];
    } else if (kind === "PLTE") plte = data;
    else if (kind === "tRNS") trns = data;
    else if (kind === "IDAT") idat.push(data);
    else if (kind === "IEND") break;
  }
  if (!width || !height) throw new Error("PNG has no IHDR");
  if (interlace) throw new Error("interlaced PNG");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels || (type !== 3 && depth !== 8) || (type === 3 && ![1, 2, 4, 8].includes(depth))) throw new Error(`PNG type ${type} at ${depth} bits`);
  if (width * height > 4096 * 4096) throw new Error("picture too large");
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = Math.max(1, (channels * depth) / 8);
  const stride = Math.ceil((width * channels * depth) / 8);
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let add = 0;
      if (f === 1) add = a;
      else if (f === 2) add = b;
      else if (f === 3) add = (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = (line[i] + add) & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (type === 3) {
        const bits = depth;
        const idx = (line[(x * bits) >> 3] >> (8 - bits - ((x * bits) & 7))) & ((1 << bits) - 1);
        out[o] = plte?.[idx * 3] ?? 0;
        out[o + 1] = plte?.[idx * 3 + 1] ?? 0;
        out[o + 2] = plte?.[idx * 3 + 2] ?? 0;
        out[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
      } else {
        const p = x * channels;
        const g = line[p];
        out[o] = type === 0 || type === 4 ? g : line[p];
        out[o + 1] = type === 0 || type === 4 ? g : line[p + 1];
        out[o + 2] = type === 0 || type === 4 ? g : line[p + 2];
        out[o + 3] = type === 4 ? line[p + 1] : type === 6 ? line[p + 3] : 255;
      }
    }
    prev = line;
  }
  return { width, height, rgba: out };
}

/** The nearest house color to r, g, b (a weighted RGB distance, close to how eyes judge it). */
export function nearestColor(/** @type {number} */ r, /** @type {number} */ g, /** @type {number} */ b) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < RGB.length; i++) {
    const [R, G, B] = RGB[i];
    const rm = (r + R) / 2;
    const d = (2 + rm / 256) * (r - R) ** 2 + 4 * (g - G) ** 2 + (2 + (255 - rm) / 256) * (b - B) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * A picture as sprite rows that fit size × size, keeping its shape.
 * @param {{ width: number, height: number, rgba: Uint8Array }} img @param {number} size
 */
export function toSpriteRows(img, size) {
  const scale = Math.min(size / img.width, size / img.height, 1);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  /** @type {string[]} */
  const rows = [];
  for (let y = 0; y < h; y++) {
    let row = "";
    const y0 = Math.floor((y * img.height) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * img.width) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.width) / w));
      // Box average over the source pixels this one covers, weighted by their alpha.
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy++)
        for (let sx = x0; sx < x1; sx++) {
          const o = (sy * img.width + sx) * 4;
          const al = img.rgba[o + 3];
          r += img.rgba[o] * al;
          g += img.rgba[o + 1] * al;
          b += img.rgba[o + 2] * al;
          a += al;
          n++;
        }
      row += a / n < 128 ? "." : CHARS[nearestColor(r / a, g / a, b / a)];
    }
    rows.push(row);
  }
  return rows;
}

/** A name for a sprite constant: "Cat Face.png" -> CAT_FACE. @param {string} name */
export const constName = (name) =>
  name
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "_$1")
    .toUpperCase() || "SPRITE";

/** File name for the asset: "Cat Face.png" -> cat-face. @param {string} name */
const fileName = (name) =>
  name
    .replace(/\.[a-z0-9]+$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "sprite";

/**
 * Import a picture into a cart: assets/<name>.png (the picture as found, as PNG), assets/<name>.sprite.json
 * (the rows), and a NOTICE.md line saying where it came from. Returns the code to paste into game.js.
 * @param {{ file: string, cart: string, size: number, name?: string, source?: string }} o
 */
export function importAsset(o) {
  const size = Math.round(Number(o.size));
  if (!(size >= 1 && size <= MAX_SPRITE)) throw new Error(`size is the sprite's largest side in pixels, 1 to ${MAX_SPRITE} (the screen is 256 × 192)`);
  const file = path.resolve(o.file);
  if (!fs.existsSync(file)) throw new Error(`no file at ${file}`);
  const cart = path.resolve(o.cart);
  if (!fs.existsSync(path.join(cart, "spec.md"))) throw new Error(`${cart} has no spec.md: give the cart folder`);
  let png = fs.readFileSync(file);
  /** @type {{ width: number, height: number, rgba: Uint8Array }} */
  let img;
  try {
    img = decodePng(png);
  } catch {
    // JPEG, GIF, WebP, HEIC, an interlaced or 16-bit PNG: macOS converts it (sips ships with it).
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gsa-asset-")), "in.png");
    try {
      execFileSync("sips", ["-s", "format", "png", "-s", "formatOptions", "default", file, "--out", tmp], { stdio: "ignore" });
      png = fs.readFileSync(tmp);
      img = decodePng(png);
    } catch (e) {
      throw new Error(`can't read ${path.basename(file)} as a picture (${/** @type {Error} */ (e).message})`);
    }
  }
  const rows = toSpriteRows(img, size);
  const base = fileName(o.name ?? path.basename(file));
  const assets = path.join(cart, "assets");
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(assets, `${base}.png`), png);
  fs.writeFileSync(path.join(assets, `${base}.sprite.json`), JSON.stringify({ from: path.basename(file), size, width: rows[0].length, height: rows.length, rows }, null, 2) + "\n");
  const source = (o.source ?? "").trim() || "source not given: say where it came from and its licence before publishing";
  fs.appendFileSync(path.join(cart, "NOTICE.md"), `${fs.existsSync(path.join(cart, "NOTICE.md")) ? "" : "# Notice\n\nWhere this cart's pictures came from.\n\n"}- assets/${base}.png (from ${path.basename(file)}): ${source}\n`);
  const name = constName(o.name ?? path.basename(file));
  const used = new Set(rows.join("").replace(/\./g, ""));
  const code = `// ${base}: ${rows[0].length}×${rows.length}, from assets/${base}.png (import_asset). Make it once, in init.\nconst ${name}_ROWS = [\n${rows.map((r) => `  ${JSON.stringify(r)},`).join("\n")}\n];\n// in init(g): s.${name.toLowerCase()} = g.sprite(${name}_ROWS);`;
  return { name, width: rows[0].length, height: rows.length, colors: [...used].map((c) => CHARS.indexOf(c)).sort((a, b) => a - b), files: [`assets/${base}.png`, `assets/${base}.sprite.json`, "NOTICE.md"], code };
}
