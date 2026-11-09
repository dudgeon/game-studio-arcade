#!/usr/bin/env node
// Play a cart briefly with no screen, for a person to judge it (Phase 0 results).
// Presses START, steers toward falling things if probe() lists them (otherwise it
// sweeps left and right), restarts after game over, and writes a contact sheet of
// frames plus a timeline of what probe() reported. It's a simple bot: it shows
// that the game works and how it looks, not how fun it is.
//
//   play-headless.js <cart-dir> <out.png> [--seconds 40] [--seed 1]
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { headless, PALETTE } from "@game-studio-arcade/runtime";
import { encodePng } from "@game-studio-arcade/playtest";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { seconds: { type: "string", default: "40" }, seed: { type: "string", default: "1" } },
});
const [cartDir, out] = positionals;
if (!cartDir || !out) {
  console.error("usage: play-headless.js <cart-dir> <out.png> [--seconds 40] [--seed 1]");
  process.exit(2);
}

const t = await headless(path.resolve(cartDir, "game.js"), { seed: Number(values.seed) });
const shots = [];
const timeline = [];
const shoot = async (label) => shots.push({ label, frame: await t.frame() });
const brief = (p) => {
  const o = {};
  for (const [k, v] of Object.entries(p ?? {})) {
    if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") o[k] = v;
    else if (Array.isArray(v)) o[`${k}#`] = v.length;
  }
  return o;
};
const note = async (at) => timeline.push({ at, ...brief(await t.probe()) });

await t.step(40);
await shoot("title");
await note("title");
await t.input([{ frames: 2, p1: "start" }]);
await t.step(2);
await t.step(30);
await shoot("start");
await note("start");

/** Find the player's x in whatever shape this cart's probe() has. */
function playerX(p) {
  if (typeof p?.x === "number") return p.x;
  for (const [k, v] of Object.entries(p ?? {})) {
    if (/peng|play|hero|cat|char/i.test(k) && v && typeof v === "object" && typeof v.x === "number") return v.x + (v.w ?? 0) / 2;
  }
  for (const [k, v] of Object.entries(p ?? {})) if (/peng|play|hero/i.test(k) && /x$/i.test(k) && typeof v === "number") return v;
  return null;
}

/** The lowest falling thing worth catching, if the probe lists them. */
function target(p) {
  const lists = Object.values(p ?? {}).filter((v) => Array.isArray(v) && typeof v[0]?.x === "number" && typeof v[0]?.y === "number");
  const items = lists.flat().filter((o) => !/boot/i.test(String(o.kind ?? o.type ?? "")));
  if (!items.length) return null;
  const low = items.reduce((a, b) => (b.y > a.y ? b : a));
  return low.x + (low.w ?? 0) / 2;
}

const seconds = Number(values.seconds);
const pattern = ["right", "left", "right", "right", "left", "left", "", "right", "left"];
let frames = 0;
let sounds = 0;
let steered = 0;
let games = 1;
const every = Math.max(1, Math.floor((seconds * 60) / 7));
let nextShot = every;
let lastMode = null;
for (let i = 0; frames < seconds * 60; i++) {
  const p = await t.probe();
  const mode = String(p?.mode ?? p?.state ?? "");
  if (mode !== lastMode && /over/i.test(mode)) {
    await shoot(`game over ${Math.round(frames / 60)}s`);
    await note("over");
  }
  lastMode = mode;
  const px = playerX(p);
  const tx = target(p);
  let script;
  if (/over|title/i.test(mode)) {
    if (/title/i.test(mode)) games++;
    script = [{ frames: 2, p1: "start" }, { frames: 30, p1: "" }];
  } else if (px !== null && tx !== null) {
    steered++;
    const dir = Math.abs(tx - px) < 4 ? "" : tx > px ? "right" : "left";
    script = [{ frames: 3, p1: dir }, { frames: 2, p1: "" }];
  } else {
    const hold = 12 + (i * 7) % 25;
    script = [{ frames: hold, p1: pattern[i % pattern.length] }];
  }
  const span = script.reduce((n, x) => n + x.frames, 0);
  await t.input(script);
  await t.step(span);
  frames += span;
  const s = await t.sounds();
  sounds = Array.isArray(s) ? s.length : sounds; // everything so far, not just the latest
  if (frames >= nextShot) {
    await shoot(`${Math.round(frames / 60)}s`);
    await note(`${Math.round(frames / 60)}s`);
    nextShot += every;
  }
}

// A contact sheet: 3 across, in the house palette, with a gap of index 0 between.
const { width: W, height: H } = shots[0].frame;
const cols = 3;
const rows = Math.ceil(shots.length / cols);
const gap = 4;
const sheetW = cols * W + (cols - 1) * gap;
const sheetH = rows * H + (rows - 1) * gap;
const pixels = new Uint8Array(sheetW * sheetH);
shots.forEach(({ frame }, n) => {
  const ox = (n % cols) * (W + gap);
  const oy = Math.floor(n / cols) * (H + gap);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) pixels[(oy + y) * sheetW + ox + x] = frame.pixels[y * W + x];
});
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, encodePng({ width: sheetW, height: sheetH, pixels }, PALETTE));
console.log(JSON.stringify({ cart: path.basename(path.resolve(cartDir)), frames: 72 + frames, sounds, steered, games, shots: shots.map((s) => s.label), timeline }, null, 1));
