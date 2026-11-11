#!/usr/bin/env node
// Makes every asset the cabinet's teti uses: sound effects, one music loop,
// the block skin, the particle and the menu icons. All of it is generated
// here, so it is this repo's own work and needs no outside licence.
// Upstream teti's sounds (TETR.IO's), music (commercial) and art aren't used.
//
//   node guests/teti/tools/make-assets.mjs        writes into guests/teti/play/assets
//
// Deterministic: the same script makes the same bytes.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..", "play", "assets");
const RATE = 22050;

// ---------- sound ----------

let seed = 1;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;

/** A tone: wave, start and end frequency, length (s), volume, attack and release (s). */
function tone({ wave = "square", f0, f1 = f0, len, vol = 0.5, a = 0.004, r = 0.04, duty = 0.5 }) {
  const n = Math.round(len * RATE);
  const buf = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const f = f0 * Math.pow(f1 / f0, i / n);
    ph = (ph + f / RATE) % 1;
    let s;
    if (wave === "square") s = ph < duty ? 1 : -1;
    else if (wave === "triangle") s = 4 * Math.abs(ph - 0.5) - 1;
    else if (wave === "sine") s = Math.sin(2 * Math.PI * ph);
    else s = rand();
    const env = Math.min(1, t / a) * Math.min(1, (len - t) / r);
    buf[i] = s * vol * Math.max(0, env);
  }
  return buf;
}

/** Plays parts one after another (gap in s between). */
function seq(parts, gap = 0) {
  const g = Math.round(gap * RATE);
  const n = parts.reduce((s, p) => s + p.length + g, 0);
  const buf = new Float32Array(n);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length + g; }
  return buf;
}

/** Mixes parts that start together. */
function mix(...parts) {
  const buf = new Float32Array(Math.max(...parts.map((p) => p.length)));
  for (const p of parts) for (let i = 0; i < p.length; i++) buf[i] += p[i];
  return buf;
}

const note = (m) => 440 * Math.pow(2, (m - 69) / 12); // MIDI note to Hz

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32000), i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const arp = (notes, len = 0.06, wave = "square", vol = 0.35) => seq(notes.map((m) => tone({ wave, f0: note(m), len, vol, r: 0.02 })));
const thud = (vol = 0.6) => mix(tone({ wave: "sine", f0: 180, f1: 50, len: 0.12, vol }), tone({ wave: "noise", f0: 1, len: 0.05, vol: vol * 0.35, r: 0.04 }));
const fanfare = (root) => seq([arp([root, root + 4, root + 7], 0.07), tone({ wave: "square", f0: note(root + 12), len: 0.3, vol: 0.35, r: 0.2, duty: 0.25 })]);

const SFX = {
  move: tone({ wave: "square", f0: 900, len: 0.018, vol: 0.18, r: 0.01, duty: 0.25 }),
  rotate: tone({ wave: "triangle", f0: 620, f1: 980, len: 0.05, vol: 0.4 }),
  spin: arp([76, 83], 0.05, "triangle", 0.45),
  harddrop: thud(),
  hold: seq([tone({ wave: "triangle", f0: 520, len: 0.04, vol: 0.4 }), tone({ wave: "triangle", f0: 780, len: 0.05, vol: 0.4 })]),
  clearline: arp([72, 76, 79], 0.05),
  clearspin: arp([74, 79, 83, 86], 0.05, "triangle", 0.5),
  clearbtb: arp([76, 80, 83, 88], 0.05),
  btb_1: arp([79, 83], 0.05),
  clearquad: seq([arp([72, 76, 79, 84], 0.055), tone({ wave: "square", f0: note(88), len: 0.25, vol: 0.3, r: 0.2, duty: 0.25 })]),
  allclear: seq([fanfare(72), fanfare(77)]),
  levelup: arp([67, 71, 74, 79, 83], 0.06, "square", 0.3),
  zenith_levelup: arp([67, 71, 74, 79, 83], 0.06, "square", 0.3),
  finish: fanfare(72),
  personalbest: seq([fanfare(72), fanfare(79)]),
  pbstart: arp([79, 84], 0.08, "triangle", 0.4),
  pbend: arp([84, 79], 0.08, "triangle", 0.4),
  topout: arp([67, 63, 60, 55], 0.12, "triangle", 0.5),
  failure: tone({ wave: "square", f0: 300, f1: 90, len: 0.6, vol: 0.3, r: 0.3, duty: 0.25 }),
  retry: arp([60, 67], 0.05, "triangle", 0.4),
  menutap: tone({ wave: "square", f0: 1200, len: 0.015, vol: 0.12, r: 0.01, duty: 0.25 }),
  menuclick: tone({ wave: "triangle", f0: 700, f1: 1000, len: 0.04, vol: 0.4 }),
  undo: arp([72, 67], 0.04, "triangle", 0.3),
  redo: arp([67, 72], 0.04, "triangle", 0.3),
  garbage_in_small: thud(0.35),
  garbage_in_large: thud(0.6),
  garbagerise: tone({ wave: "noise", f0: 1, len: 0.15, vol: 0.25, r: 0.1 }),
  garbagesmash: thud(0.7),
  damage_alert: arp([81, 81], 0.06, "square", 0.25),
  hyperalert: arp([84, 81, 84, 81], 0.05, "square", 0.25),
  thunder: tone({ wave: "noise", f0: 1, len: 0.6, vol: 0.4, a: 0.01, r: 0.5 }),
  speed_up: tone({ wave: "triangle", f0: 300, f1: 900, len: 0.2, vol: 0.4 }),
  speed_down: tone({ wave: "triangle", f0: 900, f1: 300, len: 0.2, vol: 0.4 }),
  zenith_speedrun_start: arp([72, 79, 84], 0.07),
  zenith_speedrun_end: arp([84, 79, 72], 0.07),
  offset: tone({ wave: "triangle", f0: 400, len: 0.06, vol: 0.35 }),
  countdown5: tone({ wave: "square", f0: note(69), len: 0.12, vol: 0.3, duty: 0.25 }),
  countdown4: tone({ wave: "square", f0: note(69), len: 0.12, vol: 0.3, duty: 0.25 }),
  go: tone({ wave: "square", f0: note(81), len: 0.3, vol: 0.3, r: 0.2, duty: 0.25 }),
};
// One spawn sound per piece (off unless "piece SFX" is turned on).
["z", "s", "l", "j", "t", "o", "i"].forEach((p, k) => (SFX[p] = tone({ wave: "triangle", f0: note(60 + k * 2), len: 0.05, vol: 0.25 })));
// Combos climb a scale.
const scale = [0, 2, 4, 5, 7, 9, 11];
for (let c = 1; c <= 16; c++) SFX[`combo_${c}`] = tone({ wave: "square", f0: note(64 + scale[(c - 1) % 7] + 12 * Math.floor((c - 1) / 7)), len: 0.08, vol: 0.3, duty: 0.25 });

// ---------- music: one original loop, "Brick Parade" ----------
// I–vi–IV–V in C major, square lead, triangle bass, noise hats. Written for this repo.

function music() {
  const bpm = 132, beat = 60 / bpm, eighth = beat / 2;
  const chords = [[48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50]]; // C Am F G
  // Lead per bar, in eighths; 0 = rest. Two phrases, A then B.
  const A = [[72, 0, 76, 79, 76, 0, 74, 72], [69, 72, 76, 0, 74, 72, 69, 0], [69, 72, 77, 76, 74, 0, 72, 69], [71, 74, 79, 0, 77, 76, 74, 0]];
  const B = [[79, 0, 79, 81, 79, 76, 72, 0], [76, 0, 76, 77, 76, 72, 69, 0], [77, 76, 74, 72, 74, 76, 77, 0], [79, 77, 76, 74, 72, 0, 71, 0]];
  const bars = [...A, ...A, ...B, ...A];
  const parts = [];
  bars.forEach((lead, b) => {
    const ch = chords[b % 4];
    const barStart = b * 8 * eighth;
    lead.forEach((m, k) => m && parts.push([barStart + k * eighth, tone({ wave: "square", f0: note(m), len: eighth * 0.9, vol: 0.16, duty: 0.25, r: 0.03 })]));
    [0, 2, 4, 6].forEach((k, j) => parts.push([barStart + k * eighth, tone({ wave: "triangle", f0: note(ch[j % 2 === 0 ? 0 : 2] - 12), len: eighth * 1.8, vol: 0.3, r: 0.05 })]));
    for (let k = 0; k < 8; k++) parts.push([barStart + k * eighth, tone({ wave: "noise", f0: 1, len: 0.03, vol: k % 2 ? 0.05 : 0.09, r: 0.02 })]);
  });
  const total = Math.round(bars.length * 8 * eighth * RATE);
  const buf = new Float32Array(total);
  for (const [t, p] of parts) {
    const o = Math.round(t * RATE);
    for (let i = 0; i < p.length && o + i < total; i++) buf[o + i] += p[i];
  }
  return buf;
}

// ---------- images ----------

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(w, h, rgba) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));

/** The skin strip teti expects (data/blocksprites.js): 12 frames of 30×30, 1 px apart. */
function skin() {
  const frames = { z: "#ff5a6e", l: "#ff9a3c", o: "#ffd23f", s: "#6ad94a", i: "#3fd8f0", j: "#4a7dff", t: "#b05cff", shadow: null, hold: "#8a8f99", g: "#9aa0a8", darkg: "#4b4f57", topout: "#6b2a33" };
  const W = 372, H = 30, img = Buffer.alloc(W * H * 4);
  Object.entries(frames).forEach(([name, col], k) => {
    const x0 = k * 31;
    for (let y = 0; y < 30; y++) for (let x = 0; x < 30; x++) {
      const o = ((y * W) + x0 + x) * 4;
      if (col === null) { // ghost: a soft outline
        const edge = x < 2 || y < 2 || x > 27 || y > 27;
        img.set(edge ? [255, 255, 255, 200] : [255, 255, 255, 40], o); continue;
      }
      const [r, g, b] = hex(col);
      const round = (x < 2 && y < 2) || (x > 27 && y < 2) || (x < 2 && y > 27) || (x > 27 && y > 27);
      if (round) { img.set([0, 0, 0, 0], o); continue; }
      let k2 = 1;
      if (y < 4 || x < 4) k2 = 1.35; // highlight
      else if (y > 25 || x > 25) k2 = 0.7; // shade
      else if (x > 7 && x < 13 && y > 7 && y < 13) k2 = 1.5; // shine
      img.set([Math.min(255, r * k2), Math.min(255, g * k2), Math.min(255, b * k2), 255].map(Math.round), o);
    }
  });
  return png(W, H, img);
}

function particle() {
  const img = Buffer.alloc(4 * 4 * 4, 255);
  [0, 3, 12, 15].forEach((p) => (img[p * 4 + 3] = 0)); // round the corners
  return png(4, 4, img);
}

// Simple menu icons (mostly hidden on the cabinet, which has no mouse).
const ICON = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="#fff">${body}</svg>\n`;
const ICONS = {
  play: '<polygon points="30,20 80,50 30,80"/>',
  pause: '<rect x="25" y="20" width="18" height="60"/><rect x="57" y="20" width="18" height="60"/>',
  reset: '<path d="M50 15a35 35 0 1 0 35 35h-12a23 23 0 1 1-23-23v13l22-19-22-19z"/>',
  settings: '<circle cx="50" cy="50" r="22" fill="none" stroke="#fff" stroke-width="12"/><circle cx="50" cy="50" r="40" fill="none" stroke="#fff" stroke-width="6" stroke-dasharray="12 9"/>',
  volume: '<polygon points="15,38 35,38 58,18 58,82 35,62 15,62"/><path d="M68 32q14 18 0 36" fill="none" stroke="#fff" stroke-width="7"/>',
  info: '<circle cx="50" cy="50" r="40" fill="none" stroke="#fff" stroke-width="8"/><rect x="45" y="42" width="10" height="32"/><circle cx="50" cy="30" r="6"/>',
  upload: '<polygon points="50,15 78,45 60,45 60,80 40,80 40,45 22,45"/>',
  download: '<polygon points="50,85 78,55 60,55 60,20 40,20 40,55 22,55"/>',
  edit: '<polygon points="20,80 25,62 65,22 78,35 38,75"/>',
  timer: '<circle cx="50" cy="55" r="32" fill="none" stroke="#fff" stroke-width="8"/><rect x="46" y="32" width="8" height="25"/><rect x="40" y="10" width="20" height="8"/>',
  goal: '<rect x="25" y="15" width="7" height="72"/><polygon points="32,18 80,30 32,44"/>',
  medal: '<circle cx="50" cy="60" r="25"/><polygon points="35,10 50,38 65,10"/>',
  history: '<circle cx="50" cy="50" r="35" fill="none" stroke="#fff" stroke-width="8"/><polyline points="50,30 50,52 66,62" fill="none" stroke="#fff" stroke-width="8"/>',
  joystick: '<rect x="20" y="65" width="60" height="18" rx="6"/><rect x="46" y="30" width="8" height="38"/><circle cx="50" cy="25" r="13"/>',
  handling: '<rect x="15" y="25" width="70" height="8"/><rect x="15" y="47" width="70" height="8"/><rect x="15" y="69" width="70" height="8"/><circle cx="35" cy="29" r="9"/><circle cx="62" cy="51" r="9"/><circle cx="45" cy="73" r="9"/>',
  display: '<rect x="12" y="20" width="76" height="50" rx="5" fill="none" stroke="#fff" stroke-width="8"/><rect x="35" y="76" width="30" height="8"/>',
  next: '<polygon points="20,20 55,50 20,80"/><polygon points="50,20 85,50 50,80"/>',
  puzzle: '<rect x="20" y="20" width="27" height="27"/><rect x="53" y="20" width="27" height="27"/><rect x="20" y="53" width="27" height="27"/>',
  addgarb: '<rect x="15" y="60" width="70" height="22"/><rect x="45" y="10" width="10" height="40"/><rect x="30" y="25" width="40" height="10"/>',
  cleargarb: '<rect x="15" y="60" width="70" height="22"/><rect x="30" y="25" width="40" height="10"/>',
  github: '<circle cx="50" cy="50" r="38"/>',
};

// ---------- write ----------

function write(rel, data) {
  const p = path.join(out, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
}

for (const [name, s] of Object.entries(SFX)) write(`sfx/${name}.wav`, wav(s));
write("music/brick-parade.wav", wav(music()));
write("skins/cabinet.png", skin());
write("particle.png", particle());
for (const [name, body] of Object.entries(ICONS)) write(`icons/${name}.svg`, ICON(body));
console.log(`wrote ${Object.keys(SFX).length} sounds, 1 song, 1 skin, 1 particle, ${Object.keys(ICONS).length} icons to ${path.relative(process.cwd(), out)}`);
