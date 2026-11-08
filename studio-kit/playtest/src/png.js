// Indexed-color PNG encoder for captured frames (D62). No dependencies, so it
// runs as-is in the offline sandbox.
import { deflateSync, crc32 } from "node:zlib";

/** @param {string} type @param {Buffer} data */
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * Encode palette-indexed pixels as an 8-bit indexed PNG.
 * Indices outside the palette are written as index 0 (black); the palette
 * check reports them separately.
 * @param {{ width: number, height: number, pixels: ArrayLike<number> }} frame
 * @param {readonly string[]} palette "#rrggbb" per index
 * @returns {Buffer}
 */
export function encodePng(frame, palette) {
  const { width, height, pixels } = frame;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // indexed color
  const plte = Buffer.alloc(palette.length * 3);
  palette.forEach((hex, i) => {
    const v = parseInt(hex.slice(1), 16);
    plte[i * 3] = (v >> 16) & 255;
    plte[i * 3 + 1] = (v >> 8) & 255;
    plte[i * 3 + 2] = v & 255;
  });
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const v = pixels[y * width + x];
      raw[y * (width + 1) + 1 + x] = v >= 0 && v < palette.length ? v : 0;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("PLTE", plte),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
