// The console core (D10, D21): one cart run with a seeded RNG, a fixed-step
// clock, a framebuffer, input masks, sound events and a save slot. No DOM and
// no timers: hosts (headless Node, the cart frame) drive it a frame at a time.
import * as lib from "../lib/index.js";
import { Framebuffer, H, W, hashPixels, makeSprite } from "./gfx.js";
import { textWidth } from "./font.js";
import { BIT, MAX_PLAYERS, checkPlayers } from "./input.js";
import { COLORS, PALETTE, colorIndex } from "./palette.js";
import { createRng } from "./rng.js";
import { SFX, Voices, toneToSegment } from "./sound.js";

export const SAVE_LIMIT = 4096;

/**
 * @typedef {import("./sound.js").SoundCommand} SoundCommand
 * @typedef {{ type: "play", cmd: SoundCommand } | { type: "stop", voice?: number }} AudioOut
 */

/** Throw a readable error if a module's default export isn't a cart. */
export function checkCart(cart) {
  if (!cart || typeof cart !== "object") throw new Error("game.js must `export default { init, update, draw }`");
  for (const fn of ["init", "update", "draw"]) {
    if (typeof cart[fn] !== "function") throw new Error(`game.js default export has no ${fn}(g, s) function`);
  }
  if (cart.probe !== undefined && typeof cart.probe !== "function") throw new Error("game.js probe must be a function if present");
  if (cart.poke !== undefined && typeof cart.poke !== "function") throw new Error("game.js poke must be a function if present");
  return /** @type {Arcade.Cart} */ (cart);
}

function utf8Length(s) {
  return new TextEncoder().encode(s).length;
}

/**
 * @param {{ cart: Arcade.Cart, seed?: number, save?: string | null, players?: number }} opts
 *   save is the JSON text currently saved for this cart, or null.
 *   players is the number of controllers, 1..MAX_PLAYERS (default 1, D110).
 */
export function createMachine({ cart, seed = 1, save = null, players }) {
  checkCart(cart);
  const nPlayers = checkPlayers(players);
  const fb = new Framebuffer();
  const rand = createRng(seed);
  const voices = new Voices();
  let frame = 0;
  /** @type {number[]} one mask per controller */
  let cur = new Array(nPlayers).fill(0);
  let prev = cur;
  let saved = save ?? null;
  /** @type {AudioOut[]} */
  let audioOut = [];
  /** @type {SoundCommand[]} */
  const soundLog = [];
  let saveDirty = false;
  /** @type {{ frame: number, message: string }[]} */
  const warnings = [];
  /** @type {{ frame: number, message: string }[]} */
  let warningsOut = [];
  const warned = new Set();

  /** Colors outside 0..31 still wrap (a kid's game shouldn't crash over it), but each kind is reported once. */
  const col = (c, fn) => {
    if (c !== undefined && !(Number.isInteger(c) && c >= 0 && c < 32)) {
      const message = `g.${fn}() got color ${c}; colors are 0..31, so it was drawn as ${colorIndex(c)}`;
      if (!warned.has(message) && warnings.length < 50) {
        warned.add(message);
        const w = { frame, message };
        warnings.push(w);
        warningsOut.push(w);
      }
    }
    return c;
  };

  // Players 1..MAX_PLAYERS are valid; one beyond g.players has no controller,
  // so its mask is 0 and nothing reads as held (D112).
  const playerIndex = (p) => {
    if (p === undefined) return 0;
    if (Number.isInteger(p) && p >= 1 && p <= MAX_PLAYERS) return p - 1;
    throw new Error(`player must be 1 to ${MAX_PLAYERS}, got ${p}`);
  };
  const bit = (b) => {
    const v = BIT[/** @type {Arcade.Button} */ (b)];
    if (!v) throw new Error(`unknown button "${b}" (buttons: up down left right a b x y start)`);
    return v;
  };

  /** @param {"tone" | Arcade.Sfx} kind @param {import("./sound.js").Segment[]} segments @param {number | undefined} voice */
  const play = (kind, segments, voice) => {
    const length = segments.reduce((n, s) => n + s.frames, 0);
    const cmd = { frame, kind, voice: voices.take(frame, length, voice), segments };
    soundLog.push(cmd);
    audioOut.push({ type: "play", cmd });
  };

  /** @type {Arcade.G} */
  const g = {
    W,
    H,
    get frame() {
      return frame;
    },
    colors: COLORS,
    palette: PALETTE,
    lib,

    players: nPlayers,

    btn: (b, p) => ((cur[playerIndex(p)] ?? 0) & bit(b)) !== 0,
    btnp: (b, p) => {
      const i = playerIndex(p);
      const m = bit(b);
      return ((cur[i] ?? 0) & m) !== 0 && ((prev[i] ?? 0) & m) === 0;
    },
    btnr: (b, p) => {
      const i = playerIndex(p);
      const m = bit(b);
      return ((cur[i] ?? 0) & m) === 0 && ((prev[i] ?? 0) & m) !== 0;
    },

    cls: (c) => fb.cls(col(c, "cls")),
    pset: (x, y, c) => fb.pset(x, y, col(c, "pset")),
    pget: (x, y) => fb.pget(x, y),
    line: (x0, y0, x1, y1, c) => fb.line(x0, y0, x1, y1, col(c, "line")),
    rect: (x, y, w, h, c) => fb.rect(x, y, w, h, col(c, "rect")),
    rectfill: (x, y, w, h, c) => fb.rectfill(x, y, w, h, col(c, "rectfill")),
    circ: (x, y, r, c) => fb.circ(x, y, r, col(c, "circ")),
    circfill: (x, y, r, c) => fb.circfill(x, y, r, col(c, "circfill")),
    text: (s, x, y, c, opts) => fb.text(s, x, y, col(c, "text"), opts),
    textWidth: (s, scale) => textWidth(String(s), Math.max(1, Math.floor(scale ?? 1))),
    sprite: (rows) => makeSprite(rows),
    spr: (s, x, y, opts) => {
      if (opts?.color !== undefined) col(opts.color, "spr");
      fb.spr(s, x, y, opts);
    },
    camera: (x, y) => fb.camera(x, y),
    clip: (x, y, w, h) => fb.clip(x, y, w, h),

    rand,
    rnd: (n) => Math.floor(rand() * Math.floor(n)),
    pick: (items) => {
      if (!items || items.length === 0) throw new Error("g.pick() needs a non-empty array");
      return items[Math.floor(rand() * items.length)];
    },

    tone: (t) => play("tone", [toneToSegment(t ?? {})], t?.voice),
    sfx: (name, opts = {}) => {
      const preset = SFX[name];
      if (!preset) throw new Error(`unknown sfx "${name}" (use ${Object.keys(SFX).join(", ")})`);
      play(name, preset.map((t) => toneToSegment(t, opts.pitch ?? 0, opts.vol)), opts.voice);
    },
    stop: (voice) => {
      voices.stop(voice);
      audioOut.push(voice === undefined ? { type: "stop" } : { type: "stop", voice });
    },

    save: (data) => {
      let text;
      try {
        text = JSON.stringify(data);
      } catch (e) {
        throw new Error(`g.save() needs JSON data: ${/** @type {Error} */ (e).message}`);
      }
      if (text === undefined) throw new Error("g.save() needs JSON data (got undefined or a function)");
      const size = utf8Length(text);
      if (size > SAVE_LIMIT) throw new Error(`g.save() data is ${size} bytes; the limit is ${SAVE_LIMIT}`);
      saved = text;
      saveDirty = true;
    },
    load: () => (saved === null ? null : JSON.parse(saved)),
  };
  Object.freeze(g);

  const state = cart.init(g) ?? {};
  fb.reset();
  cart.draw(g, state);

  return {
    g,
    get frame() {
      return frame;
    },
    /** How many controllers this run has (g.players). */
    players: nPlayers,
    /** Run one update with this frame's input: one mask per controller (missing ones are 0, extras ignored). */
    update(/** @type {ArrayLike<number>} */ masks = []) {
      prev = cur;
      cur = new Array(nPlayers);
      for (let i = 0; i < nPlayers; i++) cur[i] = (masks[i] ?? 0) | 0;
      frame++;
      cart.update(g, state);
    },
    draw() {
      fb.reset();
      cart.draw(g, state);
    },
    probe() {
      if (!cart.probe) return null;
      const p = cart.probe(g, state);
      return p === undefined ? null : JSON.parse(JSON.stringify(p));
    },
    /** A check's setup (D163): only t.poke calls this. @param {unknown} o */
    poke(o) {
      if (!cart.poke) throw new Error("this cart has no poke(g, s, o) export, so a check can't set it up");
      cart.poke(g, state, o);
    },
    /** @returns {Arcade.Frame & { pixels: Uint8Array }} */
    capture() {
      return { frame, width: W, height: H, pixels: fb.pixels.slice(), hash: hashPixels(fb.pixels) };
    },
    hash: () => hashPixels(fb.pixels),
    /** The live framebuffer (palette indices); don't keep it across frames. */
    pixels: fb.pixels,
    sounds: () => soundLog.map((c) => ({ frame: c.frame, kind: c.kind, voice: c.voice })),
    /** Dev warnings since start (e.g. out-of-range colors), each kind once. */
    warnings: () => warnings.map((w) => ({ ...w })),
    /** Warnings since the last call, for a host to show. */
    drainWarnings() {
      const out = warningsOut;
      warningsOut = [];
      return out;
    },
    /** Audio commands since the last call, for a host to play. */
    drainAudio() {
      const out = audioOut;
      audioOut = [];
      return out;
    },
    /** The saved JSON text if it changed since the last call, else undefined. */
    drainSave() {
      if (!saveDirty) return undefined;
      saveDirty = false;
      return saved;
    },
    get saved() {
      return saved;
    },
  };
}

/** @typedef {ReturnType<typeof createMachine>} Machine */
