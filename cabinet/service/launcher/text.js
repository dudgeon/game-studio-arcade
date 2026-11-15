// @ts-check
// Every word on the launcher goes through here (D181). Pure: runs in the page
// and in Node. A fixed font on a fixed grid makes fitting pure arithmetic.
//
// The relative imports work both ways: on disk they reach the repo's runtime,
// and in the browser "../../../runtime" from /launcher/ resolves to /runtime/.
import { ADVANCE, GLYPH_H, LINE_H } from "../../../runtime/src/font.js";
import { W, H } from "../../../runtime/src/gfx.js";

export { ADVANCE, GLYPH_H, LINE_H, W, H };

const PLAIN = new Map(
  Object.entries({
    "‘": "'", "’": "'", "‚": "'", "‛": "'", "′": "'",
    "“": '"', "”": '"', "„": '"', "″": '"',
    "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "―": "-", "−": "-",
    "…": "...", "×": "x", "•": "-", "·": "-", "→": "->", "←": "<-",
    "ß": "ss", "æ": "ae", "Æ": "AE", "œ": "oe", "Œ": "OE", "ø": "o", "Ø": "O", "ł": "l", "Ł": "L",
  }),
);

/**
 * What the font can draw: printable ASCII. Typographic marks and accents become
 * their plain forms; emoji and control characters go (the font would draw "?").
 * Whitespace, line breaks included, collapses to one space unless `keepLines`.
 * @param {unknown} text
 * @param {{ keepLines?: boolean }} [opts]
 */
export function clean(text, opts = {}) {
  let out = "";
  for (const ch of String(text ?? "").normalize("NFKD")) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 && code <= 0x7e) out += ch;
    else if (ch === "\n" && opts.keepLines) out += "\n";
    else if (ch === "\n" || ch === "\t" || ch === "\r" || ch === " " || (code >= 0x2000 && code <= 0x200a) || ch === "　") out += " ";
    else if (PLAIN.has(ch)) out += PLAIN.get(ch);
    // Anything else: combining marks left by NFKD, emoji, joiners, control codes.
  }
  const lines = out.split("\n").map((l) => l.replace(/ +/g, " ").trim());
  return opts.keepLines ? lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() : lines.join(" ").trim();
}

/** Columns that fit a width in pixels: the last glyph has no gap after it. */
export const colsFor = (w) => Math.floor((w + 1) / ADVANCE);
/** Rows that fit a height in pixels: the last row has no gap after it. */
export const rowsFor = (h) => (h < GLYPH_H ? 0 : 1 + Math.floor((h - GLYPH_H) / LINE_H));
/** Pixel width of a line. */
export const widthOf = (line) => (line.length ? line.length * ADVANCE - 1 : 0);
/** Pixel height of a number of rows. */
export const heightOf = (rows) => (rows > 0 ? (rows - 1) * LINE_H + GLYPH_H : 0);

/**
 * Wrap cleaned text to lines of at most `cols`, breaking a word only if it can't
 * fit a line of its own.
 * @param {string} text cleaned text
 * @param {number} cols
 * @returns {string[]}
 */
export function wrap(text, cols) {
  if (cols < 1) return text ? [""] : [];
  const lines = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (let word of para.split(" ")) {
      if (!word) continue;
      if (line && line.length + 1 + word.length <= cols) {
        line += ` ${word}`;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      while (word.length > cols) {
        lines.push(word.slice(0, cols));
        word = word.slice(cols);
      }
      line = word;
    }
    lines.push(line);
  }
  return lines;
}

const MORE = "...";

/**
 * Fit text to a box of columns and rows; too much ends in "..." on its last row.
 * @param {string} text cleaned text
 * @param {number} cols
 * @param {number} rows
 * @returns {{ lines: string[], cut: boolean, total: number }}
 */
export function fit(text, cols, rows) {
  const all = wrap(text, cols);
  if (all.length <= rows) return { lines: all, cut: false, total: all.length };
  if (rows < 1) return { lines: [], cut: all.length > 0, total: all.length };
  const lines = all.slice(0, rows);
  const room = Math.max(0, cols - MORE.length);
  // Cut back to a word if that doesn't waste most of the line.
  let last = lines[rows - 1];
  if (last.length > room) {
    const space = last.lastIndexOf(" ", room);
    last = space > room / 2 ? last.slice(0, space) : last.slice(0, room);
  }
  lines[rows - 1] = last.replace(/[ .,;:]+$/, "") + MORE;
  return { lines, cut: true, total: all.length };
}

/**
 * Text in pages of `rows - 1` lines, the last row kept for the page count (D453).
 * @param {string} text cleaned text
 * @param {number} cols
 * @param {number} rows
 * @param {number} page wanted; clamped
 * @returns {{ lines: string[], pages: number, page: number, label: string }}
 */
export function paginate(text, cols, rows, page) {
  const all = wrap(text, cols);
  const per = Math.max(1, rows - 1);
  const pages = Math.max(1, Math.ceil(all.length / per));
  const p = Math.max(0, Math.min(pages - 1, page));
  const label = `${p > 0 ? "< " : ""}${p + 1} of ${pages}${p < pages - 1 ? " >" : ""}`;
  return { lines: all.slice(p * per, p * per + per), pages, page: p, label };
}

/**
 * @typedef {{
 *   id: string, text: string,
 *   x: number, y: number, w: number, h: number,
 *   lines: { text: string, x: number, y: number, scale: number }[],
 *   cut: boolean,
 *   onCut: "reader" | "ok" | "never",
 *   readable: boolean,
 *   pages?: number, page?: number,
 * }} BoxRecord
 *   onCut: what a cut means (D181): "reader", the kid must be able to read the
 *     rest; "ok", a label or passing line; "never", our own fixed words. readable: the reader holds these words.
 *   pages, page: a box read in pages (D453) has nothing cut; it shows page `page` (from 0) of `pages`.
 */

/**
 * Faults in a frame's boxes (D181).
 * @param {BoxRecord[]} boxes
 * @returns {string[]}
 */
export function check(boxes) {
  const faults = [];
  for (const b of boxes) {
    if (b.x < 0 || b.y < 0 || b.x + b.w > W || b.y + b.h > H) faults.push(`${b.id}: box off screen (${b.x},${b.y} ${b.w}x${b.h})`);
    for (const l of b.lines) {
      const lw = widthOf(l.text) * l.scale;
      if (l.x < b.x || l.x + lw > b.x + b.w) faults.push(`${b.id}: line wider than its box: "${l.text}"`);
      if (l.y < b.y || l.y + GLYPH_H * l.scale > b.y + b.h) faults.push(`${b.id}: line below its box: "${l.text}"`);
      if (/[^\x20-\x7e]/.test(l.text)) faults.push(`${b.id}: a character the font can't draw: "${l.text}"`);
    }
    if (b.cut && b.onCut === "reader" && !b.readable) faults.push(`${b.id}: cut with no way to read the rest`);
    if (b.cut && b.onCut === "never") faults.push(`${b.id}: our own words don't fit: "${b.text}"`);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const c = boxes[j];
      if (!a.lines.length || !c.lines.length) continue;
      if (a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h) faults.push(`${a.id} overlaps ${c.id}`);
    }
  }
  return faults;
}
