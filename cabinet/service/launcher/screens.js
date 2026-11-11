// @ts-check
// The launcher's screens on the 256x192 console (D180). Pure: a view (plain data)
// goes in, pixels and a record of every text box come out, so tests can feed any
// string to any screen with no browser. All words go through Painter.box (D181).
import { Framebuffer } from "../../../runtime/src/gfx.js";
import { COLORS as C } from "../../../runtime/src/palette.js";
import { ADVANCE, GLYPH_H, H, LINE_H, W, clean, colsFor, fit, heightOf, rowsFor, widthOf, wrap } from "./text.js";

/** @typedef {import("./text.js").BoxRecord} BoxRecord */

export const M = 6; // side margin
const INNER = W - M * 2;
const HEADER_H = 14;
const BODY_Y = HEADER_H + 4;
const HINT_Y = H - GLYPH_H - 2;
const TILE_GAP = 2;
const TILE_PAD = 3;
const BADGE_W = 12;
const BIG_ROWS = 3;

const CHOOSE = "Stick to choose, any button to pick";
const READ_MORE = "Right: read it all. Up/down: choose.";
const ROWS = { question: 6, option: 3, transcript: 11, rule: 9, progress: 5, failure: 10 };

export class Painter {
  constructor() {
    this.fb = new Framebuffer();
    /** @type {BoxRecord[]} */
    this.boxes = [];
    this.warn = false;
  }

  begin(bg = C.night) {
    this.fb.reset();
    this.fb.cls(bg);
    this.boxes = [];
  }

  /**
   * The one way words reach the screen (D181).
   * @param {{ id: string, text: unknown, x: number, y: number, w: number, h: number, color?: number, scale?: number,
   *   align?: "left" | "center" | "right", onCut?: "reader" | "ok" | "never", readable?: boolean, keepLines?: boolean }} o
   */
  box(o) {
    const scale = o.scale ?? 1;
    const text = clean(o.text, { keepLines: o.keepLines });
    const cols = colsFor(Math.floor(o.w / scale));
    const rows = rowsFor(Math.floor(o.h / scale));
    const { lines, cut, total } = fit(text, cols, rows);
    const color = o.color ?? C.white;
    /** @type {BoxRecord["lines"]} */
    const drawn = [];
    lines.forEach((line, i) => {
      const width = widthOf(line) * scale;
      const lx = o.align === "center" ? o.x + Math.floor((o.w - width) / 2) : o.align === "right" ? o.x + o.w - width : o.x;
      const ly = o.y + i * LINE_H * scale;
      this.fb.text(line, lx, ly, color, { scale });
      if (line) drawn.push({ text: line, x: lx, y: ly, scale });
    });
    // o.h is the most it may take. It records what it took, so what follows can
    // flow up under short text; check() still holds it to its limit via fit().
    this.boxes.push({ id: o.id, text, x: o.x, y: o.y, w: o.w, h: heightOf(lines.length) * scale, lines: drawn, cut, onCut: o.onCut ?? "ok", readable: !!o.readable });
    return { rows: lines.length, cut, total };
  }

  /** @param {string} title @param {string} [right] */
  header(title, right) {
    this.fb.rectfill(0, 0, W, HEADER_H, C.navy);
    this.fb.rectfill(0, HEADER_H, W, 1, C.blue);
    const rightW = right ? Math.min(14, clean(right).length) * ADVANCE : 0;
    this.box({ id: "header", text: title, x: M, y: 3, w: INNER - rightW, h: GLYPH_H, color: C.yellow });
    if (right) this.box({ id: "header-right", text: right, x: W - M - rightW + 1, y: 3, w: rightW - 1, h: GLYPH_H, color: C.silver, align: "right" });
  }

  /** @param {string} text */
  hint(text) {
    // Near the walk-away timeout, this says so on any screen that's waiting (D188).
    this.box({ id: "hint", text: this.warn ? "Still there? Move the stick!" : text, x: M, y: HINT_Y, w: INNER, h: GLYPH_H, color: this.warn ? C.yellow : C.silver, onCut: "never" });
  }

  /**
   * A tile: an optional letter badge and words. Height follows its words, up to `rows`.
   * @param {{ id: string, letter?: string, text: unknown, x?: number, y: number, w?: number, rows: number, lit: boolean,
   *   hue?: number, onCut?: "reader" | "ok", readable?: boolean, center?: boolean }} o
   * @returns {{ y: number, cut: boolean }} the next free y
   */
  tile(o) {
    const x = o.x ?? M;
    const w = o.w ?? INNER;
    const textX = o.letter ? x + BADGE_W + 4 : x + TILE_PAD + 2;
    const textW = x + w - TILE_PAD - textX;
    const wanted = Math.min(o.rows, wrap(clean(o.text), colsFor(textW)).length);
    const rows = Math.max(1, wanted);
    const h = heightOf(rows) + TILE_PAD * 2;
    const hue = o.hue ?? C.blue;
    this.fb.rectfill(x, o.y, w, h, o.lit ? hue : C.slate);
    if (o.lit) this.fb.rect(x, o.y, w, h, C.white);
    if (o.letter) {
      this.fb.rectfill(x + 2, o.y + 2, BADGE_W - 1, h - 4, o.lit ? C.white : C.gray);
      this.box({ id: `${o.id}-letter`, text: o.letter, x: x + 2, y: o.y + TILE_PAD, w: BADGE_W - 1, h: GLYPH_H, color: o.lit ? hue : C.night, align: "center" });
    }
    const r = this.box({ id: o.id, text: o.text, x: textX, y: o.y + TILE_PAD, w: textW, h: heightOf(rows), color: o.lit ? C.white : C.ice, onCut: o.onCut, readable: o.readable, align: o.center ? "center" : "left" });
    return { y: o.y + h + TILE_GAP, cut: r.cut };
  }

  /**
   * A scrolled list of lines, each already wrapped by `flow`.
   * @param {{ id: string, x: number, y: number, w: number, h: number, flowed: { text: string, color?: number }[], top: number }} o
   * @returns {{ top: number, max: number }}
   */
  scroll(o) {
    const rows = rowsFor(o.h);
    const max = Math.max(0, o.flowed.length - rows);
    const top = Math.min(Math.max(0, o.top), max);
    const textW = o.w - (max ? 8 : 0);
    /** @type {BoxRecord["lines"]} */
    const drawn = [];
    for (let i = 0; i < rows; i++) {
      const l = o.flowed[top + i];
      if (!l?.text) continue;
      const ly = o.y + i * LINE_H;
      this.fb.text(l.text, o.x, ly, l.color ?? C.white, {});
      drawn.push({ text: l.text, x: o.x, y: ly, scale: 1 });
    }
    this.boxes.push({ id: o.id, text: o.flowed.map((l) => l.text).join(" "), x: o.x, y: o.y, w: textW, h: o.h, lines: drawn, cut: false, onCut: "ok", readable: true });
    if (max) {
      const barX = o.x + o.w - 4;
      this.fb.rectfill(barX, o.y, 3, o.h, C.slate);
      const thumb = Math.max(6, Math.round((o.h * rows) / o.flowed.length));
      this.fb.rectfill(barX, o.y + Math.round(((o.h - thumb) * top) / max), 3, thumb, C.silver);
    }
    return { top, max };
  }
}

/** Columns of a scroll box that may show a scroll bar. */
export const SCROLL_COLS = colsFor(INNER - 8);

/**
 * Flow text into a scroll list.
 * @param {unknown} text @param {number} [color] @param {number} [cols]
 * @returns {{ text: string, color?: number }[]}
 */
export function flow(text, color, cols = SCROLL_COLS) {
  return wrap(clean(text, { keepLines: true }), cols).map((t) => ({ text: t, color }));
}

// ---------- the screens ----------

/** @typedef {{ kind: "make" | "back" | "result" | "busy" | "cart", title: string, by?: string, note?: string, urgent?: boolean }} ShelfItem */

/** @param {Painter} p @param {any} v */
function shelf(p, v) {
  p.header(v.console ?? "Game shelf", v.count != null ? `${v.count} game${v.count === 1 ? "" : "s"}` : "");
  /** @type {ShelfItem[]} */
  const items = v.items;
  const rowH = 2 * LINE_H + TILE_PAD * 2;
  const perPage = Math.floor((HINT_Y - BODY_Y - 2 + TILE_GAP) / (rowH + TILE_GAP));
  const top = Math.max(0, Math.min(v.sel - Math.floor(perPage / 2), items.length - perPage));
  items.slice(top, top + perPage).forEach((it, i) => {
    const y = BODY_Y + i * (rowH + TILE_GAP);
    const n = top + i;
    const lit = n === v.sel;
    const special = it.kind !== "cart";
    const fill = lit ? (special ? C.green : C.blue) : special ? C.forest : C.slate;
    p.fb.rectfill(M, y, INNER, rowH, fill);
    if (lit) p.fb.rect(M, y, INNER, rowH, C.white);
    const inner = INNER - TILE_PAD * 2 - 4;
    p.box({ id: `shelf-title-${n}`, text: it.title, x: M + TILE_PAD + 2, y: y + TILE_PAD, w: inner, h: GLYPH_H, color: lit ? C.white : special ? C.mint : C.ice });
    const by = [it.by && `by ${clean(it.by)}`, it.note].filter(Boolean).join(" - ");
    if (by) p.box({ id: `shelf-by-${n}`, text: by, x: M + TILE_PAD + 2, y: y + TILE_PAD + LINE_H, w: inner, h: GLYPH_H, color: it.urgent ? C.yellow : lit ? C.ice : C.silver });
  });
  if (top > 0) arrow(p, W - M - 8, BODY_Y - 3, -1);
  if (top + perPage < items.length) arrow(p, W - M - 8, HINT_Y - 4, 1);
  p.hint(CHOOSE);
}

/** @param {Painter} p @param {number} x @param {number} y @param {1 | -1} dir */
function arrow(p, x, y, dir) {
  for (let i = 0; i < 3; i++) p.fb.rectfill(x + (dir > 0 ? i : 2 - i), y + i, 1 + (dir > 0 ? 4 - i * 2 : i * 2), 1, C.yellow);
}

/** @param {Painter} p @param {any} v */
function who(p, v) {
  p.header("Who's making?");
  const rowH = heightOf(1) + TILE_PAD * 2;
  const perPage = Math.floor((HINT_Y - BODY_Y - 2 + TILE_GAP) / (rowH + TILE_GAP));
  /** @type {string[]} */
  const rows = [...v.makers.map((/** @type {any} */ m) => m.name), "Someone new"];
  const top = Math.max(0, Math.min(v.sel - Math.floor(perPage / 2), rows.length - perPage));
  rows.slice(top, top + perPage).forEach((name, i) => {
    const n = top + i;
    p.tile({ id: `who-${n}`, text: name, y: BODY_Y + i * (rowH + TILE_GAP), rows: 1, lit: n === v.sel, hue: n === rows.length - 1 ? C.green : C.blue });
  });
  p.hint(CHOOSE);
}

const SAY_TITLE = {
  request: "Tell me your game idea",
  answer: "Something else",
  change: "What should change?",
  name: "What's your name?",
  note: "Tell me",
};

/** @param {Painter} p @param {any} v */
function say(p, v) {
  p.header(SAY_TITLE[v.purpose] ?? "Tell me");
  let y = BODY_Y;
  if (v.prompt) {
    const r = p.box({ id: "say-prompt", text: v.prompt, x: M, y, w: INNER, h: heightOf(4), color: C.silver, onCut: "ok" });
    y += heightOf(Math.max(1, r.rows)) + 6;
  }
  if (v.phase === "confirm") {
    p.box({ id: "say-heard-label", text: "I heard:", x: M, y, w: INNER, h: GLYPH_H, color: C.yellow });
    y += LINE_H + 1;
    const tilesY = HINT_Y - 2 * (heightOf(1) + TILE_PAD * 2 + TILE_GAP) - 2;
    const r = p.box({ id: "say-transcript", text: v.transcript, x: M, y, w: INNER, h: Math.min(heightOf(ROWS.transcript), tilesY - y - 2), onCut: "reader", readable: true });
    let ty = tilesY;
    ty = p.tile({ id: "say-yes", text: "Yes, that's it", y: ty, rows: 1, lit: v.sel === 0, hue: C.green }).y;
    p.tile({ id: "say-again", text: "Say it again", y: ty, rows: 1, lit: v.sel === 1 });
    p.hint(r.cut ? READ_MORE : CHOOSE);
    return;
  }
  if (v.phase === "typing") {
    p.box({ id: "say-typing-label", text: "Type it:", x: M, y, w: INNER, h: GLYPH_H, color: C.yellow });
    y += LINE_H + 1;
    const cols = colsFor(INNER);
    const text = clean(v.typed ?? "");
    const lines = wrap(text, cols);
    const rows = Math.max(1, rowsFor(HINT_Y - y - 4));
    // Keep the end in view: that's where the typing is.
    const shown = lines.slice(-rows).join("\n");
    const b = p.box({ id: "say-typed", text: shown, x: M, y, w: INNER, h: heightOf(rows), keepLines: true });
    const lastLine = lines.slice(-1)[0] ?? "";
    if ((v.tick ?? 0) % 40 < 24) p.fb.rectfill(Math.min(M + lastLine.length * ADVANCE, M + INNER - 4), y + (Math.max(b.rows, 1) - 1) * LINE_H, 4, GLYPH_H - 1, C.yellow);
    p.hint("Enter: done. ESC: back.");
    return;
  }
  // idle, listening, hearing, silence
  const cy = Math.max(y + 34, 92);
  const listening = v.phase === "listening";
  const hearing = v.phase === "hearing";
  const pulse = listening ? 3 + Math.floor(((v.tick ?? 0) % 30) / 6) : 0;
  if (listening) p.fb.circ(W / 2, cy, 18 + pulse, C.coral);
  p.fb.circfill(W / 2, cy, 16, listening ? C.red : hearing ? C.gray : C.blue);
  p.fb.rectfill(W / 2 - 3, cy - 10, 7, 13, C.white);
  p.fb.rectfill(W / 2 - 6, cy + 1, 13, 2, C.white);
  p.fb.rectfill(W / 2 - 1, cy + 3, 3, 5, C.white);
  p.fb.rectfill(W / 2 - 5, cy + 8, 11, 2, C.white);
  const msg = listening ? "Listening... let go when you're done" : hearing ? "Writing that down..." : v.phase === "silence" ? "I didn't catch that. Try again!" : "Hold any button and talk";
  p.box({ id: "say-message", text: msg, x: M, y: cy + 25, w: INNER, h: heightOf(2), color: listening ? C.pink : v.phase === "silence" ? C.yellow : C.white, align: "center", onCut: "never" });
  if (!listening && !hearing) p.box({ id: "say-sub", text: "Let go to send it", x: M, y: cy + 25 + 2 * LINE_H, w: INNER, h: GLYPH_H, color: C.silver, align: "center" });
  p.hint(listening || hearing ? "" : "F1: type instead. ESC: back.");
}

/** @param {Painter} p @param {any} v */
function question(p, v) {
  p.header("Claude asks", v.maker);
  const words = questionWords(v);
  // Double size when it fits: most questions are short, and easier to read big.
  const big = wrap(words.question, colsFor(Math.floor(INNER / 2))).length <= BIG_ROWS;
  const scale = big ? 2 : 1;
  const r = p.box({ id: "q-question", text: words.question, x: M, y: BODY_Y + 1, w: INNER, h: heightOf(big ? BIG_ROWS : ROWS.question) * scale, scale, onCut: "reader", readable: true });
  // Tiles sit at the bottom, by the hint, wherever the question ends.
  const tilesH = tileHeight(words.a, ROWS.option) + tileHeight(words.b, ROWS.option) + 2 * tileHeight("x", 1) + 4 * TILE_GAP;
  const y = Math.max(BODY_Y + 1 + heightOf(Math.max(1, r.rows)) * scale + 4, HINT_Y - 2 - tilesH);
  const a = p.tile({ id: "q-a", letter: "A", text: words.a, y, rows: ROWS.option, lit: v.sel === 0, onCut: "reader", readable: true });
  const b = p.tile({ id: "q-b", letter: "B", text: words.b, y: a.y, rows: ROWS.option, lit: v.sel === 1, onCut: "reader", readable: true });
  const c = p.tile({ id: "q-c", letter: "C", text: "Something else", y: b.y, rows: 1, lit: v.sel === 2, hue: C.purple });
  p.tile({ id: "q-d", letter: "D", text: "Make it now", y: c.y, rows: 1, lit: v.sel === 3, hue: C.green });
  p.hint(r.cut || a.cut || b.cut ? READ_MORE : CHOOSE);
}

/** Height of a lettered, full-width tile. @param {unknown} text @param {number} rows */
function tileHeight(text, rows) {
  const cols = colsFor(M + INNER - TILE_PAD - (M + BADGE_W + 4));
  return heightOf(Math.max(1, Math.min(rows, wrap(clean(text), cols).length))) + TILE_PAD * 2;
}

/**
 * A question's words as they'll show. All emoji or nothing would leave a blank
 * tile, so those get a stand-in that's still a real choice.
 * @param {any} v
 */
function questionWords(v) {
  return { question: clean(v.question) || "Which one?", a: clean(v.option_a) || "The first one", b: clean(v.option_b) || "The second one" };
}

/** The whole question, for the reader. @param {any} v */
export function questionText(v) {
  const w = questionWords(v);
  return [...flow(w.question), { text: "" }, ...flow(`A: ${w.a}`, C.ice), { text: "" }, ...flow(`B: ${w.b}`, C.ice)];
}

/** @param {Painter} p @param {any} v */
function reader(p, v) {
  p.header(v.title ?? "Read it all");
  v.top = p.scroll({ id: "reader", x: M, y: BODY_Y, w: INNER, h: HINT_Y - BODY_Y - 3, flowed: v.flowed, top: v.top }).top;
  p.hint("Stick to scroll, any button when done");
}

/** The plan as scroll lines. @param {any} v */
export function planLines(v) {
  /** @type {{ text: string, color?: number }[]} */
  const out = [...flow(v.summary, C.white)];
  if (v.changes?.length) {
    out.push({ text: "" }, { text: "What changed:", color: C.yellow });
    for (const ch of v.changes) out.push(...flow(`${clean(ch.id).replace(/^R(?=\d)/, "")}. ${clean(ch.text)}`, C.peach));
  }
  out.push({ text: "" }, { text: "The rules:", color: C.yellow });
  // Numbers, not spec ids; alternating colors tell one rule from the next.
  (v.rules ?? []).forEach((/** @type {any} */ rule, /** @type {number} */ i) => {
    const you = rule.kind === "you-check";
    out.push(...flow(`${clean(rule.id).replace(/^R(?=\d)/, "")}. ${clean(rule.text)}${you ? " (you check)" : ""}`, you ? C.lilac : i % 2 ? C.white : C.ice));
  });
  return out;
}

/** @param {Painter} p @param {any} v */
function plan(p, v) {
  p.header("Here's the plan", v.maker);
  const tileH = heightOf(1) + TILE_PAD * 2;
  const tilesY = HINT_Y - tileH - 3;
  v.top = p.scroll({ id: "plan-body", x: M, y: BODY_Y, w: INNER, h: tilesY - BODY_Y - 3, flowed: v.flowed ?? planLines(v), top: v.top ?? 0 }).top;
  const half = Math.floor((INNER - 4) / 2);
  p.tile({ id: "plan-build", text: "Build it!", x: M, y: tilesY, w: half, rows: 1, lit: v.sel === 0, hue: C.green, center: true });
  p.tile({ id: "plan-change", text: "Change it", x: M + half + 4, y: tilesY, w: half, rows: 1, lit: v.sel === 1, center: true });
  p.hint("Up/down: read. Left/right: choose.");
}

/** @param {Painter} p @param {any} v */
function progress(p, v) {
  p.header("Making your game", v.maker);
  /** @type {string[]} */
  const lines = v.lines ?? [];
  const current = lines[lines.length - 1] ?? "Getting ready";
  const y = 30;
  // Blocks hopping in turn: something always moves, so it never looks stuck.
  for (let i = 0; i < 7; i++) {
    const hop = ((v.tick ?? 0) + i * 8) % 56 < 14 ? 4 : 0;
    p.fb.rectfill(W / 2 - 42 + i * 12, y - hop, 9, 9, [C.coral, C.orange, C.yellow, C.lime, C.aqua, C.sky, C.lilac][i]);
  }
  const r = p.box({ id: "progress-now", text: current, x: M, y: y + 18, w: INNER, h: heightOf(ROWS.progress), align: "center", color: C.white });
  let ly = y + 18 + heightOf(Math.max(1, r.rows)) + 8;
  const earlier = lines.slice(0, -1).slice(-Math.max(0, rowsFor(HINT_Y - ly - 3)));
  earlier.reverse().forEach((line, i) => {
    p.box({ id: `progress-earlier-${i}`, text: line, x: M, y: ly, w: INNER, h: GLYPH_H, color: C.gray, align: "center" });
    ly += LINE_H;
  });
  p.hint("ESC: play something else meanwhile");
}

/** @param {Painter} p @param {any} v */
function result(p, v) {
  p.header(v.ok ? "Your game is ready!" : "Oh no");
  let y = BODY_Y + 6;
  if (!v.ok && v.by) {
    p.box({ id: "result-by", text: `${clean(v.by)}'s game`, x: M, y, w: INNER, h: GLYPH_H, color: C.silver });
    y += LINE_H + 3;
  }
  if (v.ok) {
    const r = p.box({ id: "result-title", text: v.title, x: M, y, w: INNER, h: heightOf(3) * 2, scale: 2, color: C.yellow, align: "center" });
    y += heightOf(Math.max(1, r.rows)) * 2 + 8;
    if (v.by) {
      p.box({ id: "result-by", text: `by ${clean(v.by)}`, x: M, y, w: INNER, h: GLYPH_H, color: C.silver, align: "center" });
      y += LINE_H + 6;
    }
    if (v.note) p.box({ id: "result-note", text: v.note, x: M, y, w: INNER, h: heightOf(3), align: "center" });
  } else {
    const r = p.box({ id: "result-message", text: v.message, x: M, y, w: INNER, h: heightOf(ROWS.failure), keepLines: true });
    y += heightOf(Math.max(1, r.rows)) + 8;
  }
  const tileH = heightOf(1) + TILE_PAD * 2;
  const tiles = v.tiles ?? ["Back to the shelf"];
  let ty = HINT_Y - tiles.length * (tileH + TILE_GAP) - 2;
  tiles.forEach((/** @type {string} */ t, /** @type {number} */ i) => {
    ty = p.tile({ id: `result-tile-${i}`, text: t, y: ty, rows: 1, lit: v.sel === i, hue: i === 0 && v.ok ? C.green : C.blue, center: true }).y;
  });
  p.hint(CHOOSE);
}

const CHECK_TILES = ["Yes", "No", "Not sure", "Ask me later"];

/** @param {Painter} p @param {any} v */
function check(p, v) {
  p.header("You check", `${v.i + 1} of ${v.n}`);
  p.box({ id: "check-title", text: v.title, x: M, y: BODY_Y, w: INNER, h: GLYPH_H, color: C.silver });
  p.box({ id: "check-ask", text: "Is this true when you play it?", x: M, y: BODY_Y + LINE_H + 2, w: INNER, h: GLYPH_H, color: C.yellow });
  const y = BODY_Y + 2 * LINE_H + 5;
  const tileH = heightOf(1) + TILE_PAD * 2;
  const tilesY = HINT_Y - CHECK_TILES.length * (tileH + TILE_GAP) - 1;
  const r = p.box({ id: "check-rule", text: v.rule, x: M, y, w: INNER, h: Math.min(heightOf(ROWS.rule), tilesY - y - 3), onCut: "reader", readable: true });
  CHECK_TILES.forEach((t, i) => {
    p.tile({ id: `check-${i}`, text: t, y: tilesY + i * (tileH + TILE_GAP), rows: 1, lit: v.sel === i, hue: i === 0 ? C.green : i === 1 ? C.red : C.blue });
  });
  p.hint(r.cut ? READ_MORE : CHOOSE);
}

/** @param {Painter} p @param {any} v */
function notice(p, v) {
  p.header(v.title ?? "One moment");
  p.box({ id: "notice", text: v.message, x: M, y: BODY_Y + 30, w: INNER, h: heightOf(8), align: "center", keepLines: true });
  if (v.hint) p.hint(v.hint);
}

const LEAVE_TILES = ["Keep going", "Come back later", "Stop making this game"];

/** @param {Painter} p @param {any} v */
function leave(p, v) {
  p.header("Leave this game?");
  p.box({ id: "leave-message", text: "Claude is waiting for your answer.", x: M, y: BODY_Y + 12, w: INNER, h: heightOf(2), align: "center", onCut: "never" });
  const tileH = heightOf(1) + TILE_PAD * 2;
  const ty = HINT_Y - LEAVE_TILES.length * (tileH + TILE_GAP) - 2;
  LEAVE_TILES.forEach((t, i) => {
    p.tile({ id: `leave-${i}`, text: t, y: ty + i * (tileH + TILE_GAP), rows: 1, lit: v.sel === i, hue: i === 0 ? C.green : i === 2 ? C.red : C.blue });
  });
  p.hint(CHOOSE);
}

/** @type {Record<string, (p: Painter, v: any) => void>} */
export const SCREENS = { shelf, who, say, question, reader, plan, progress, result, check, notice, leave };

/** The most each ask_player field can hold on the question screen. The brief states these (D190); a test holds the two together. */
export const ASK_LIMITS = {
  bigQuestion: colsFor(Math.floor(INNER / 2)) * BIG_ROWS,
  question: colsFor(INNER) * ROWS.question,
  option: colsFor(M + INNER - TILE_PAD - (M + BADGE_W + 4)) * ROWS.option,
};

/**
 * Draw one view.
 * @param {Painter} p @param {any} view must have `screen`
 */
export function draw(p, view) {
  const fn = SCREENS[view.screen];
  if (!fn) throw new Error(`no screen ${view.screen}`);
  p.begin();
  p.warn = !!view.warn;
  fn(p, view);
}

export { CHECK_TILES, LEAVE_TILES };
