// The house palette (D3, D21): 32 fixed colors, index 0 is black.
// Our own palette, grouped in ramps: grays, reds, browns/skin, yellows,
// greens, teals, blues, purples, pinks.

/** @type {readonly [string, string][]} name, #rrggbb */
const ENTRIES = Object.freeze([
  ["black", "#000000"],
  ["night", "#161a2e"],
  ["slate", "#3a3f5c"],
  ["gray", "#6e7491"],
  ["silver", "#b4b9cf"],
  ["white", "#ffffff"],
  ["maroon", "#5e1a2b"],
  ["red", "#c42a3a"],
  ["coral", "#f2605a"],
  ["pink", "#ffadb5"],
  ["brown", "#6b3a1f"],
  ["orange", "#e0722a"],
  ["tan", "#c9945e"],
  ["peach", "#ffd0a1"],
  ["gold", "#e8b02a"],
  ["yellow", "#ffeb5c"],
  ["forest", "#17452c"],
  ["green", "#2e8c3e"],
  ["lime", "#8ed645"],
  ["mint", "#c6f5a6"],
  ["teal", "#127a78"],
  ["aqua", "#46d6c4"],
  ["navy", "#142a66"],
  ["blue", "#2f5fd6"],
  ["sky", "#5fb2ff"],
  ["ice", "#c2e8ff"],
  ["indigo", "#3a2378"],
  ["purple", "#7a3fc2"],
  ["lilac", "#bf93f0"],
  ["plum", "#5c1f57"],
  ["magenta", "#d63fb0"],
  ["rose", "#ff8fd1"],
]);

/** @type {readonly string[]} */
export const PALETTE = Object.freeze(ENTRIES.map(([, hex]) => hex));

/** @type {Readonly<Arcade.Colors>} */
export const COLORS = /** @type {any} */ (Object.freeze(Object.fromEntries(ENTRIES.map(([name], i) => [name, i]))));

export const PALETTE_SIZE = 32;

/** [r, g, b] for each index. */
export const RGB = Object.freeze(
  PALETTE.map((hex) => Object.freeze([1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)))),
);

/**
 * Palette as little-endian RGBA Uint32 values, for writing straight into an
 * ImageData buffer viewed as a Uint32Array.
 */
export function rgbaTable() {
  const t = new Uint32Array(PALETTE_SIZE);
  RGB.forEach(([r, g, b], i) => {
    t[i] = (255 << 24) | (b << 16) | (g << 8) | r;
  });
  return t;
}

/** Nearest palette index to an RGB color (squared distance). For tools that quantize images. */
export function nearest(r, g, b) {
  let best = 0;
  let bestD = Infinity;
  RGB.forEach(([pr, pg, pb], i) => {
    const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** Coerce a value to a valid palette index (integers wrap mod 32). */
export function colorIndex(c) {
  const n = Math.floor(Number(c)) | 0;
  return ((n % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE;
}
