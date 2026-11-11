// @ts-check
// The arcade's boards (D201, docs/design/arcade-ux-handoff.md): the shelf's family
// rows, the coin pot, the coin check, the one-screen plan, the four-step progress,
// the post-game screens, the pot's limits and the errors. Pure like screens.js: a
// view goes in, pixels and a record of every text box come out. Most boards are one
// generic `board` (blocks above, tiles at the bottom); the rest have their own layout.
// The view builders at the end turn service state into views, so tests can draw
// every board from real-looking data with no browser.
import { COLORS as C } from "../../../runtime/src/palette.js";
import { ADVANCE, GLYPH_H, LINE_H, W, clean, colsFor, heightOf, wrap } from "./text.js";
import { BODY_Y, HINT_Y, INNER, M, SCREENS, TILE_GAP, TILE_PAD, arrow, flow, planLines } from "./screens.js";
import { checksFor, iconOf } from "./shelf.js";

/** @typedef {import("./screens.js").Painter} Painter */

const TILE_H = heightOf(1) + TILE_PAD * 2;
const COIN_W = 9;
/** The hint line's words when the board lists what the stick and buttons do. */
export const SHELF_HINT = "Stick: choose  Button: play  COIN: coins";
export const COIN_HINT = "1 coin = 10 cents.";

// ---------- pieces ----------

/** A coin: a gold disc with an orange rim. @param {Painter} p @param {number} x @param {number} y top-left @param {number} [r] */
export function coin(p, x, y, r = 3) {
  p.fb.circfill(x + r, y + r, r, C.yellow);
  p.fb.circ(x + r, y + r, r, C.orange);
}

/** "62" or "-8": whole coins as text. @param {number} n */
export const num = (n) => String(Math.round(n));
/** "$6.20". @param {number} cents */
export const dollars = (cents) => `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;
/** "68c". @param {number} c */
export const cents = (c) => `${Math.round(c)}c`;
/** "Dec 1" from "2026-12-01". @param {string} day */
export function dayName(day) {
  const [, m, d] = String(day).split("-").map(Number);
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][(m || 1) - 1]} ${d || 1}`;
}
/** "November" from "2026-11". @param {string} month */
export const monthName = (month) => ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][Number(String(month).split("-")[1] || 1) - 1];
/** "1 coin" / "6 coins". @param {number} n */
export const coinsWord = (n) => `${num(n)} coin${Math.abs(Math.round(n)) === 1 ? "" : "s"}`;

/**
 * A header with an optional coin before its right-hand words ("Pot (coin) 62").
 * @param {Painter} p @param {string} title @param {string} [right] @param {boolean} [withCoin]
 */
export function header(p, title, right = "", withCoin = false) {
  p.header(title, right);
  if (withCoin && right) {
    const rightW = Math.min(14, clean(right).length) * ADVANCE;
    coin(p, W - M - rightW - COIN_W + 1, 3);
  }
}

/**
 * A full-width row: words on the left, a note on the right (with a coin before it, if asked).
 * @param {Painter} p
 * @param {{ id: string, text: unknown, note?: string, noteCoin?: boolean, y: number, x?: number, w?: number, lit: boolean, hue?: number, dim?: boolean, center?: boolean, big?: boolean, onCut?: "ok" | "never" | "reader", noteColor?: number }} o
 * @returns {number} the next free y
 */
export function row(p, o) {
  const x = o.x ?? M;
  const w = o.w ?? INNER;
  const h = o.big ? heightOf(1) * 2 + TILE_PAD * 2 : TILE_H;
  const hue = o.hue ?? C.blue;
  p.fb.rectfill(x, o.y, w, h, o.lit ? hue : o.dim ? C.night : C.slate);
  if (o.lit) p.fb.rect(x, o.y, w, h, C.white);
  else if (o.dim) p.fb.rect(x, o.y, w, h, C.slate);
  const note = o.note ? clean(o.note) : "";
  // A note takes at most half the row; a long name in it is cut, not spilled.
  const noteCols = Math.min(note.length, Math.floor((w / 2 - (o.noteCoin ? COIN_W : 0)) / ADVANCE));
  const noteW = note ? noteCols * ADVANCE - 1 + (o.noteCoin ? COIN_W : 0) : 0;
  const scale = o.big ? 2 : 1;
  const textW = w - TILE_PAD * 2 - 4 - (noteW ? noteW + 6 : 0);
  const fg = o.dim ? C.gray : o.lit ? (hue === C.yellow ? C.night : C.white) : C.ice;
  p.box({ id: o.id, text: o.text, x: x + TILE_PAD + 2, y: o.y + TILE_PAD, w: textW, h: heightOf(1) * scale, scale, color: fg, align: o.center ? "center" : "left", onCut: o.onCut ?? "ok" });
  if (note) {
    const nx = x + w - TILE_PAD - 2 - noteW;
    if (o.noteCoin) coin(p, nx, o.y + TILE_PAD + (o.big ? 4 : 1));
    p.box({ id: `${o.id}-note`, text: note, x: nx + (o.noteCoin ? COIN_W : 0), y: o.y + TILE_PAD + (o.big ? 4 : 0), w: noteW - (o.noteCoin ? COIN_W : 0) + 1, h: GLYPH_H, color: o.noteColor ?? (o.dim ? C.gray : o.lit ? fg : C.silver), align: "right", onCut: "ok" });
  }
  return o.y + h + TILE_GAP;
}

/** Tiles from the bottom up, ending just above the hint. @param {Painter} p @param {any[]} tiles @param {number} sel @param {string} id */
function tilesAtBottom(p, tiles, sel, id) {
  const hs = tiles.map((t) => (t.big ? heightOf(1) * 2 + TILE_PAD * 2 : TILE_H) + TILE_GAP);
  let y = HINT_Y - 2 - hs.reduce((a, b) => a + b, 0);
  const top = y;
  tiles.forEach((t, i) => {
    y = row(p, { id: `${id}-tile-${i}`, ...t, y, lit: sel === i && !t.dim });
  });
  return top;
}

/**
 * The blocks of a board, top down. Kinds: text (scale 1 or 2), pair (left and right
 * words on one line), bar (a filled bar), bars (a name, a bar, a number each),
 * coins (a row of coin icons), strike (struck-through words), gap.
 * @param {Painter} p @param {any[]} blocks @param {number} y @param {number} bottom @param {string} id
 */
function drawBlocks(p, blocks, y, bottom, id) {
  blocks.forEach((b, i) => {
    const bid = `${id}-${b.id ?? i}`;
    if (b.gap) return void (y += b.gap);
    if (b.bar) {
      const h = b.bar.h ?? 6;
      p.fb.rectfill(M, y, INNER, h, C.slate);
      const f = Math.max(0, Math.min(1, b.bar.value / Math.max(1, b.bar.max)));
      if (f > 0) p.fb.rectfill(M, y, Math.max(1, Math.round(INNER * f)), h, b.bar.color ?? C.yellow);
      y += h + 3;
      return;
    }
    if (b.bars) {
      const max = Math.max(1, ...b.bars.map((/** @type {any} */ r) => r.value));
      const nameW = 10 * ADVANCE;
      const numW = 11 * ADVANCE;
      const barW = INNER - nameW - numW - 8;
      b.bars.forEach((/** @type {any} */ r, /** @type {number} */ j) => {
        p.box({ id: `${bid}-name-${j}`, text: r.label, x: M, y, w: nameW - 2, h: GLYPH_H, color: C.white });
        const bw = Math.max(r.value > 0 ? 2 : 0, Math.round((barW * Math.max(0, r.value)) / max));
        if (bw) p.fb.rectfill(M + nameW + 2, y + 1, bw, GLYPH_H - 2, r.color ?? C.aqua);
        p.box({ id: `${bid}-num-${j}`, text: r.note, x: W - M - numW, y, w: numW, h: GLYPH_H, color: C.silver, align: "right" });
        y += LINE_H;
      });
      y += 2;
      return;
    }
    if (b.coins) {
      const n = Math.max(0, Math.min(24, b.coins.of));
      for (let k = 0; k < n; k++) {
        const x = M + k * 10;
        if (k < b.coins.n) coin(p, x, y, 3);
        else p.fb.circ(x + 3, y + 3, 3, C.slate);
      }
      if (b.coins.note) p.box({ id: `${bid}-note`, text: b.coins.note, x: M + n * 10 + 4, y, w: INNER - n * 10 - 4, h: GLYPH_H, color: C.silver, align: "right" });
      y += 10;
      return;
    }
    if (b.pair) {
      const right = clean(b.pair.right);
      const rw = right.length * ADVANCE - 1 + (b.pair.coin ? COIN_W : 0);
      p.box({ id: `${bid}-l`, text: b.pair.left, x: M, y, w: INNER - rw - 6, h: GLYPH_H, color: b.color ?? C.white, onCut: b.onCut ?? "ok" });
      if (b.pair.coin) coin(p, W - M - rw, y + 1);
      p.box({ id: `${bid}-r`, text: right, x: W - M - rw + (b.pair.coin ? COIN_W : 0), y, w: rw - (b.pair.coin ? COIN_W : 0) + 1, h: GLYPH_H, color: b.pair.color ?? b.color ?? C.white, align: "right", onCut: "never" });
      y += LINE_H + (b.after ?? 1);
      return;
    }
    const scale = b.scale ?? 1;
    const rows = b.rows ?? 4;
    const room = Math.max(0, bottom - y);
    const h = Math.min(heightOf(rows) * scale, Math.floor((room + (LINE_H * scale - GLYPH_H * scale)) / (LINE_H * scale)) * LINE_H * scale - (LINE_H - GLYPH_H) * scale);
    const x = M + (b.indent ?? 0);
    // A tag like "you check" sits in its own column at the right, so it never covers words (M9).
    const tagW = b.tag ? clean(b.tag).length * ADVANCE + 1 : 0;
    const textW = INNER - (b.indent ?? 0) - (tagW ? tagW + 4 : 0);
    const r = p.box({ id: bid, text: b.text, x, y, w: textW, h: Math.max(0, h), scale, color: b.color ?? C.white, align: b.align, onCut: b.onCut ?? "ok", readable: !!b.readable, keepLines: b.keepLines });
    if (b.strike) for (let k = 0; k < r.rows; k++) p.fb.rectfill(x, y + k * LINE_H + 4, Math.min(textW, clean(b.text).length * ADVANCE), 1, b.strikeColor ?? C.coral);
    if (b.tag) {
      const tx = W - M - tagW + 1;
      p.fb.rectfill(tx - 1, y - 1, tagW + 1, GLYPH_H + 1, C.aqua);
      p.box({ id: `${bid}-tag`, text: b.tag, x: tx, y, w: tagW - 1, h: GLYPH_H, color: C.night, onCut: "never" });
    }
    y += heightOf(Math.max(1, r.rows)) * scale + (b.after ?? 3);
  });
  return y;
}

// ---------- the generic board ----------

/**
 * @param {Painter} p
 * @param {{ board: string, title: string, right?: string, rightCoin?: boolean, blocks?: any[], tiles?: any[], sel?: number, hint?: string, top?: string }} v
 */
function board(p, v) {
  header(p, v.title, v.right ?? "", !!v.rightCoin);
  const tiles = v.tiles ?? [];
  const tilesTop = tiles.length ? tilesAtBottom(p, tiles, v.sel ?? 0, v.board) : HINT_Y - 2;
  drawBlocks(p, v.blocks ?? [], BODY_Y + 2, tilesTop - 3, v.board);
  p.hint(v.hint ?? "Stick to choose, any button to pick");
}

// ---------- B1: power on ----------

/** @param {Painter} p @param {any} v */
function boot(p, v) {
  const name = v.console ?? "Arcade";
  p.box({ id: "boot-name", text: name, x: M, y: 62, w: INNER, h: heightOf(2) * 2, scale: 2, color: C.yellow, align: "center" });
  const f = ((v.tick ?? 0) % 90) / 90;
  p.fb.rect(48, 110, W - 96, 8, C.silver);
  p.fb.rectfill(50, 112, Math.round((W - 100) * Math.min(1, 0.15 + f)), 4, C.yellow);
  p.box({ id: "boot-msg", text: "Warming up...", x: M, y: 126, w: INNER, h: GLYPH_H, color: C.silver, align: "center", onCut: "never" });
}

// ---------- S1, S2, R9: the shelf ----------

const ICONS = [C.sky, C.coral, C.lime, C.orange, C.lilac, C.aqua, C.pink, C.gold];
const TAG_BG = { new: C.yellow, check: C.aqua, starter: C.gray, version: C.navy };

/** @param {Painter} p @param {any} v */
function shelf(p, v) {
  if (v.offline) header(p, v.console ?? "Arcade", "No Wi-Fi");
  else header(p, v.console ?? "Arcade", v.pot != null ? `Pot ${num(v.pot)}` : "", v.pot != null);
  /** @type {any[]} */
  const items = v.items;
  const rowH = 2 * LINE_H + TILE_PAD * 2;
  const perPage = Math.floor((HINT_Y - BODY_Y - 2 + TILE_GAP) / (rowH + TILE_GAP));
  const top = Math.max(0, Math.min(v.sel - Math.floor(perPage / 2), items.length - perPage));
  items.slice(top, top + perPage).forEach((it, i) => {
    const y = BODY_Y + i * (rowH + TILE_GAP);
    const n = top + i;
    const lit = n === v.sel;
    const special = it.kind !== "cart";
    const indent = (it.indent ?? 0) * 10;
    const x = M + indent;
    const w = INNER - indent;
    const dim = it.kind === "waiting";
    const fill = lit ? (special ? C.green : C.blue) : dim ? C.night : special ? C.forest : C.slate;
    p.fb.rectfill(x, y, w, rowH, fill);
    if (lit) p.fb.rect(x, y, w, rowH, C.white);
    else if (dim) p.fb.rect(x, y, w, rowH, C.slate);
    if (indent) p.fb.rectfill(M + 3, y + 4, 3, 1, C.silver), p.fb.rectfill(M + 3, y, 1, 5, C.silver);
    // The icon: a plus for Make, a two-color block for a game.
    const ix = x + TILE_PAD;
    const iy = y + TILE_PAD;
    if (it.kind === "cart") {
      const h = iconOf(it.cart?.id ?? it.title);
      p.fb.rectfill(ix, iy, 16, 16, ICONS[h % ICONS.length]);
      p.fb.rectfill(ix, iy + 10 + (h % 3), 16, 6 - (h % 3), ICONS[(h >> 3) % ICONS.length]);
    } else {
      p.fb.rectfill(ix, iy, 16, 16, dim ? C.slate : C.white);
      p.fb.rectfill(ix + 7, iy + 3, 2, 10, dim ? C.gray : C.green);
      p.fb.rectfill(ix + 3, iy + 7, 10, 2, dim ? C.gray : C.green);
    }
    // Tags and the cost, at the right.
    /** @type {{text: string, kind: string}[]} */
    const tags = [...(it.version ? [{ text: it.version, kind: "version" }] : []), ...(it.tags ?? [])];
    // Game rows keep a column at the right for the ">" that opens the card (S3).
    let right = x + w - TILE_PAD - 1 - (it.hasCard ? 7 : 0);
    if (it.hasCard) {
      const ax = x + w - TILE_PAD - 5;
      const ay = y + Math.floor(rowH / 2) - 3;
      for (let k = 0; k < 4; k++) p.fb.rectfill(ax + k, ay + k, 1, 7 - k * 2, lit ? C.white : C.gray);
    }
    if (it.cost != null) {
      const t = `~${it.cost}`;
      const tw = t.length * ADVANCE - 1;
      p.box({ id: `shelf-cost-${n}`, text: t, x: right - tw, y: y + TILE_PAD, w: tw + 1, h: GLYPH_H, color: dim ? C.gray : C.yellow, align: "right", onCut: "never" });
      coin(p, right - tw - COIN_W, y + TILE_PAD + 1);
      right -= tw + COIN_W + 4;
    }
    tags.forEach((tag, k) => {
      const t = clean(tag.text);
      const tw = t.length * ADVANCE + 1;
      const tx = right - tw;
      const ty = y + TILE_PAD + (k % 2) * LINE_H;
      p.fb.rectfill(tx - 1, ty - 1, tw + 1, GLYPH_H + 1, /** @type {any} */ (TAG_BG)[tag.kind] ?? C.gray);
      p.box({ id: `shelf-tag-${n}-${k}`, text: t, x: tx, y: ty, w: tw, h: GLYPH_H, color: tag.kind === "starter" || tag.kind === "version" ? C.white : C.night, onCut: "never" });
      if (k % 2 === 1 || k === tags.length - 1) right = Math.min(right, tx - 4);
    });
    const textX = ix + 20;
    const inner = right - textX;
    p.box({ id: `shelf-title-${n}`, text: it.title, x: textX, y: y + TILE_PAD, w: inner, h: GLYPH_H, color: dim ? C.gray : lit ? C.white : special ? C.mint : C.ice });
    const by = [it.by, it.note].filter(Boolean).join(" - ");
    if (by) p.box({ id: `shelf-by-${n}`, text: by, x: textX, y: y + TILE_PAD + LINE_H, w: inner, h: GLYPH_H, color: it.urgent ? C.yellow : dim ? C.gray : lit ? C.ice : C.silver });
  });
  if (top > 0) arrow(p, W - M - 8, BODY_Y - 3, -1);
  if (top + perPage < items.length) arrow(p, W - M - 8, HINT_Y - 4, 1);
  p.hint(v.hint ?? SHELF_HINT);
}

// ---------- S3: a game's card ----------

/** @param {Painter} p @param {any} v */
function card(p, v) {
  header(p, v.title, v.by ?? "");
  let y = BODY_Y + 1;
  if (v.pitch) {
    const r = p.box({ id: "card-pitch", text: v.pitch, x: M, y, w: INNER, h: heightOf(2), color: C.silver, onCut: "ok" });
    y += heightOf(Math.max(1, r.rows)) + 4;
  }
  /** @type {any[]} */
  const rows = v.rows;
  const perPage = Math.max(1, Math.floor((HINT_Y - 2 - y + TILE_GAP) / (TILE_H + TILE_GAP)));
  const top = Math.max(0, Math.min(v.sel - Math.floor(perPage / 2), rows.length - perPage));
  rows.slice(top, top + perPage).forEach((r, i) => {
    const n = top + i;
    y = row(p, { id: `card-${n}`, text: r.text, note: r.note, noteCoin: r.noteCoin, x: M + (r.indent ? 10 : 0), w: INNER - (r.indent ? 10 : 0), y, lit: n === v.sel, hue: r.hue ?? C.blue, dim: r.label });
  });
  if (top > 0) arrow(p, W - M - 8, BODY_Y - 3, -1);
  if (top + perPage < rows.length) arrow(p, W - M - 8, HINT_Y - 4, 1);
  p.hint("Button: play that one. ESC: back.");
}

// ---------- A1: the family coin pot ----------

/** @param {Painter} p @param {any} v */
function pot(p, v) {
  const s = v.pot;
  header(p, "Family coin pot", monthName(s.month));
  let y = BODY_Y + 2;
  coin(p, M, y + 2, 6);
  p.box({ id: "pot-coins", text: `${num(s.coins)} left`, x: M + 16, y, w: 124, h: heightOf(1) * 2, scale: 2, color: s.coins > 0 ? C.yellow : C.coral });
  p.box({ id: "pot-of", text: `of ${s.full_coins} (${dollars(s.cents)})`, x: M + 142, y: y + 6, w: INNER - 142, h: GLYPH_H, color: C.silver, align: "right", onCut: "never" });
  y += 22;
  p.fb.rectfill(M, y, INNER, 7, C.slate);
  if (s.coins > 0) p.fb.rectfill(M, y, Math.round((INNER * Math.min(s.coins, s.full_coins)) / s.full_coins), 7, C.yellow);
  y += 10;
  p.box({ id: "pot-refill", text: `Fills back up to ${s.full_coins} on ${dayName(s.refill_on)}.`, x: M, y, w: INNER, h: GLYPH_H, color: C.silver, onCut: "never" });
  y += LINE_H + 4;
  p.box({ id: "pot-used", text: "Used this month", x: M, y, w: INNER, h: GLYPH_H, color: C.yellow, onCut: "never" });
  y += LINE_H + 1;
  const tilesTop = HINT_Y - 2 - (TILE_H + TILE_GAP);
  const room = Math.max(1, Math.floor((tilesTop - y - LINE_H - 6) / LINE_H));
  const makers = s.makers.length ? s.makers : null;
  if (makers) {
    y = drawBlocks(p, [{ bars: makers.slice(0, room).map((/** @type {any} */ m) => ({ label: m.name, value: m.coins, note: `${num(m.coins)} ${dollars(m.cents)}` })) }], y, tilesTop, "pot");
    if (makers.length > room) p.box({ id: "pot-more", text: `+ ${makers.length - room} more in the list`, x: M, y: y - 2, w: INNER, h: GLYPH_H, color: C.silver }), (y += LINE_H);
  } else {
    p.box({ id: "pot-none", text: "Nothing yet. Every coin is still here!", x: M, y, w: INNER, h: GLYPH_H, color: C.silver, onCut: "never" });
    y += LINE_H + 2;
  }
  drawBlocks(p, [{ pair: { left: `New game: about ${s.usual.new}`, right: `Change: about ${s.usual.change}`, color: C.silver }, color: C.silver }], Math.max(y, tilesTop - LINE_H - 3), tilesTop, "pot-usual");
  row(p, { id: "pot-history", text: "See every game it paid for", y: tilesTop, lit: true, hue: C.green, center: true });
  p.hint("ESC: back to the games");
}

// ---------- A2: what the pot paid for ----------

/** The ledger as scroll lines, newest first. @param {any[]} history */
export function historyLines(history) {
  /** @type {{ text: string, color?: number }[]} */
  const out = [];
  for (const e of history) {
    const day = dayName(String(e.at).slice(0, 10));
    if (e.kind === "charge") {
      const what = e.what === "change" ? "a change" : "a new game";
      const title = e.title ? `, ${e.title}` : "";
      out.push(...flow(`${day} ${e.name ?? e.who}: ${what}${title}`, C.white));
      out.push(...flow(`  -${coinsWord(e.coins)} (${cents(e.cost_cents ?? 0)}), ${e.outcome ?? ""}${e.cost_known === false ? ", cost not known" : ""}`, e.outcome === "on the shelf" || /on the shelf/.test(e.outcome ?? "") ? C.silver : C.peach));
    } else if (e.kind === "topup") {
      out.push(...flow(`${day} A grown-up added ${coinsWord(e.cents / 10)}`, C.lime));
      out.push(...flow(`  "${e.reason}"`, C.mint));
    } else if (e.kind === "reset") {
      out.push(...flow(`${day} A grown-up set the pot to 100`, C.lime));
      out.push(...flow(`  "${e.reason}"`, C.mint));
    } else if (e.kind === "refill") {
      out.push(...flow(`${day} The pot filled up to ${num(e.pot_after_cents / 10)}`, C.yellow));
    }
    out.push({ text: "" });
  }
  if (!out.length) out.push(...flow("Nothing yet.", C.silver));
  return out;
}

/** @param {Painter} p @param {any} v */
function history(p, v) {
  header(p, "What the pot paid for", v.right ?? "");
  v.top = p.scroll({ id: "history", x: M, y: BODY_Y, w: INNER, h: HINT_Y - BODY_Y - 3, flowed: v.flowed, top: v.top ?? 0 }).top;
  p.hint("Stick: scroll. ESC: back.");
}

// ---------- G0: how to play ----------

/** @param {Painter} p @param {any} v */
function howto(p, v) {
  header(p, "How to play", v.by ?? "");
  let y = BODY_Y + 4;
  const r = p.box({ id: "howto-title", text: v.title, x: M, y, w: INNER, h: heightOf(2) * 2, scale: 2, color: C.yellow, align: "center" });
  y += heightOf(Math.max(1, r.rows)) * 2 + 6;
  if (v.goal) {
    const g = p.box({ id: "howto-goal", text: v.goal, x: M, y, w: INNER, h: heightOf(3), color: C.white, align: "center" });
    y += heightOf(Math.max(1, g.rows)) + 8;
  }
  p.box({ id: "howto-label", text: "The controls", x: M, y, w: INNER, h: GLYPH_H, color: C.yellow, onCut: "never" });
  y += LINE_H + 2;
  for (const [i, c] of (v.controls ?? []).slice(0, 4).entries()) {
    const b = p.box({ id: `howto-control-${i}`, text: c, x: M, y, w: INNER, h: Math.min(heightOf(3), Math.max(0, HINT_Y - 4 - y)), color: C.ice });
    y += heightOf(Math.max(1, b.rows)) + 2;
  }
  p.hint("Any button: start. ESC: back.");
}

// ---------- M9: the plan, one screen ----------

/** The rules the plan screen leads with: the agent's four, or the first four (D201, D210). @param {any} v */
export function topRules(v) {
  const rules = v.rules ?? [];
  const ids = Array.isArray(v.top_rules) && v.top_rules.length ? v.top_rules : null;
  const chosen = ids ? ids.map((/** @type {string} */ id) => rules.find((/** @type {any} */ r) => r.id === id)).filter(Boolean) : [];
  if (chosen.length) return chosen.slice(0, 4);
  const you = rules.filter((/** @type {any} */ r) => r.kind === "you-check");
  return [...rules.filter((/** @type {any} */ r) => r.kind !== "you-check").slice(0, 4 - Math.min(2, you.length)), ...you.slice(0, 2)].slice(0, 4);
}

/** Plain short words for a control line: "Player 1: stick left and right..." -> "Stick left and right...". @param {string} s */
const controlWords = (s) => clean(s).replace(/^Player 1:\s*/i, "").replace(/^./, (c) => c.toUpperCase());

/** @param {Painter} p @param {any} v */
function plan(p, v) {
  const changing = v.mode === "change";
  header(p, changing ? "What changes" : "Here's the plan", v.right ?? v.maker ?? "", v.rightCoin);
  const tilesY = HINT_Y - TILE_H - 3;
  const bottom = tilesY - 3;
  /** @type {any[]} */
  const blocks = [];
  if (changing) {
    const changed = (v.rules ?? []).filter((/** @type {any} */ r) => r.was || r.new);
    const list = changed.length ? changed : (v.changes ?? []).map((/** @type {any} */ c) => ({ id: c.id, text: c.text }));
    for (const r of list.slice(0, 2)) {
      if (r.was) blocks.push({ text: r.was, color: C.gray, strike: true, rows: 2, after: 1 });
      blocks.push({ text: r.text, color: C.lime, rows: 3, tag: r.kind === "you-check" ? "you check" : undefined });
    }
    const same = (v.rules ?? []).filter((/** @type {any} */ r) => !r.was && !r.new);
    if (same.length) {
      const names = same.slice(0, 2).map((/** @type {any} */ r) => shortRule(r.text)).join(", ");
      blocks.push({ text: `Staying the same: ${names}${same.length > 2 ? `, and ${same.length - 2} more` : ""}.`, color: C.silver, rows: 3 });
    }
    blocks.push({ text: `Version ${v.parentVersion ?? 1} stays saved.`, color: C.mint, rows: 1, onCut: "never" });
  } else {
    blocks.push({ text: v.summary, rows: 2, after: 3 });
    const controls = v.controls || (v.cartControls ?? []).map(controlWords).join(" ");
    if (controls) blocks.push({ text: "How to play", color: C.yellow, rows: 1, after: 1 }, { text: controls, color: C.ice, rows: 2 });
    blocks.push({ text: "What happens", color: C.yellow, rows: 1, after: 1 });
    topRules(v).forEach((/** @type {any} */ r, /** @type {number} */ i) => blocks.push({ text: `${i + 1} ${clean(r.text)}`, rows: 2, after: 1, color: i % 2 ? C.white : C.ice, tag: r.kind === "you-check" ? "you check" : undefined }));
    const more = (v.rules ?? []).length - topRules(v).length;
    if (more > 0) blocks.push({ text: `+ ${more} more. Stick right: read them all.`, color: C.silver, rows: 1, onCut: "never" });
  }
  drawBlocks(p, blocks, BODY_Y + 1, bottom, "plan");
  const big = Math.floor((INNER - 4) * 0.6);
  const cost = changing ? v.usual?.change ?? 3 : v.usual?.new ?? 6;
  row(p, { id: "plan-build", text: changing ? "Change it!" : "Build it!", note: `about ${cost}`, noteCoin: true, x: M, y: tilesY, w: big, lit: v.sel === 0, hue: C.green });
  row(p, { id: "plan-change", text: changing ? "Not quite" : "Change it", x: M + big + 4, y: tilesY, w: INNER - big - 4, lit: v.sel === 1, center: true });
  p.hint("Up/down: choose. Right: every rule.");
}

/** A rule's first few words, for "Staying the same". @param {string} t */
function shortRule(t) {
  const words = clean(t).replace(/[.!].*$/, "").split(" ");
  return words.length > 5 ? `${words.slice(0, 5).join(" ")}...` : words.join(" ");
}

// ---------- M10, R7: making it ----------

const STEPS = { new: ["Plan", "Build", "Test", "Done"], change: ["Plan", "Change", "Test", "Done"] };
const STEP_WORDS = {
  new: ["Planning your game", "Building your game", "Testing your game", "All done!"],
  change: ["Planning the change", "Changing your game", "Testing your game", "All done!"],
};

/** @param {Painter} p @param {any} v */
function progress(p, v) {
  const kind = v.kind === "change" ? "change" : "new";
  header(p, kind === "change" ? "Changing your game" : "Making your game", v.maker ?? "");
  const step = Math.max(0, Math.min(3, v.step ?? 0));
  // The track: four dots and a line, forward only (D198, D201).
  const y = BODY_Y + 6;
  const xs = [0, 1, 2, 3].map((i) => M + 24 + Math.round(((INNER - 48) * i) / 3));
  p.fb.rectfill(xs[0], y + 4, xs[3] - xs[0], 2, C.slate);
  if (step > 0) p.fb.rectfill(xs[0], y + 4, xs[step] - xs[0], 2, C.green);
  STEPS[kind].forEach((name, i) => {
    const done = i < step;
    const now = i === step;
    const pulse = now && (v.tick ?? 0) % 40 < 20;
    p.fb.rectfill(xs[i] - 5, y, 11, 11, done ? C.green : now ? (pulse ? C.white : C.yellow) : C.night);
    p.fb.rect(xs[i] - 5, y, 11, 11, done ? C.green : now ? C.white : C.gray);
    p.box({ id: `progress-step-${i}`, text: name, x: xs[i] - 21, y: y + 14, w: 42, h: GLYPH_H, align: "center", color: done ? C.lime : now ? C.yellow : C.gray, onCut: "never" });
  });
  let ly = y + 30;
  const r = p.box({ id: "progress-step", text: STEP_WORDS[kind][step], x: M, y: ly, w: INNER, h: heightOf(1) * 2, scale: 2, align: "center", color: C.yellow, onCut: "ok" });
  ly += heightOf(Math.max(1, r.rows)) * 2 + 5;
  /** @type {string[]} */
  const lines = v.lines ?? [];
  const current = lines[lines.length - 1] ?? "Getting ready";
  const c = p.box({ id: "progress-now", text: current, x: M, y: ly, w: INNER, h: heightOf(3), align: "center", color: C.white });
  ly += heightOf(Math.max(1, c.rows)) + 3;
  const prev = lines.length > 1 ? lines[lines.length - 2] : null;
  if (prev && ly + GLYPH_H < 150) p.box({ id: "progress-before", text: prev, x: M, y: ly, w: INNER, h: GLYPH_H, align: "center", color: C.gray });
  // Coins used so far, against the usual cost, and the time left.
  const usual = v.usual ?? (kind === "change" ? 3 : 6);
  const used = Math.round((v.used_cents ?? 0) / 10);
  const by = 152;
  drawBlocks(p, [{ pair: { left: "Coins used", right: `${used} so far`, color: C.yellow } }], by, HINT_Y, "progress-coins");
  const left = v.minutesLeft;
  const note = `usual: ${usual}. ${left == null ? "" : left <= 0 ? "Almost done" : `About ${left} min left`}`.trim();
  drawBlocks(p, [{ coins: { n: Math.min(used, Math.max(usual, used)), of: Math.min(12, Math.max(usual, used)), note } }], by + LINE_H + 2, HINT_Y, "progress-meter");
  p.hint("ESC: play something else meanwhile");
}

// ---------- the screens, registered with screens.js ----------

/** M6 / E9 / leave and friends are generic boards; these have their own layouts. */
export const BOARDS = { board, boot, shelf, card, pot, history, howto, plan, progress };
Object.assign(SCREENS, BOARDS);

// ---------- view builders: service state in, a view out ----------

/** @typedef {{ coins: number, cents: number, month: string, refill_on: string, full_coins: number, makers: any[], last_month: any, usual: {new: number, change: number}, minutes: {new: number, change: number}, over_usual: number }} Pot */

/** The coin check (M3, R3). Only COIN starts it (D205). @param {{ kind: "new" | "change", pot: Pot, maker: string, parentVersion?: number }} o */
export function coinCheck(o) {
  const change = o.kind === "change";
  const usual = change ? o.pot.usual.change : o.pot.usual.new;
  const min = change ? o.pot.minutes.change : o.pot.minutes.new;
  return {
    screen: "board",
    board: change ? "R3" : "M3",
    coinCheck: true,
    title: change ? "Change a game" : "Make a new game",
    right: o.maker,
    blocks: [
      { text: change ? "Ready to change it?" : "Ready to make?", scale: 2, color: C.yellow, rows: 1, after: 6, onCut: "never" },
      { pair: { left: change ? "A change uses about" : "A new game uses about", right: coinsWord(usual), coin: true }, after: 2 },
      { pair: { left: "Some use more. It takes", right: `about ${min} min`, color: C.silver }, color: C.silver, after: 2 },
      { pair: { left: "The family pot has", right: coinsWord(o.pot.coins), coin: true }, after: 4 },
      { text: change ? `Version ${o.parentVersion ?? 1} stays saved, whatever happens.` : "It always finishes, even if it costs more than usual.", color: C.silver, rows: 2, onCut: "never" },
    ],
    tiles: [
      { text: "Press COIN to start", hue: C.yellow, big: true, center: true },
      { text: "Not now", center: true },
    ],
    sel: 0,
    hint: `${COIN_HINT} About ${usual * 10} cents.`,
  };
}

/** L1, L2: the pot can't cover it. @param {{ kind: "new" | "change", pot: Pot, why: "low" | "empty" }} o */
export function potLimit(o) {
  const p = o.pot;
  const refill = dayName(p.refill_on);
  if (o.why === "empty" || (o.kind === "change" && p.coins < p.usual.change)) {
    return {
      screen: "board",
      board: "L2",
      title: "Family coin pot",
      right: `Pot ${num(p.coins)}`,
      rightCoin: true,
      blocks: [
        { text: o.why === "empty" ? "POT IS EMPTY" : "THE POT IS TOO LOW", scale: 2, color: C.coral, rows: 1, after: 4, onCut: "never" },
        { text: `No making until ${refill}, when it fills up to ${p.full_coins}.`, rows: 2, onCut: "never" },
        ...(p.makers.length ? [{ text: "Used this month", color: C.yellow, rows: 1, after: 1, onCut: "never" }, { bars: p.makers.slice(0, 3).map((m) => ({ label: m.name ?? m.maker, value: m.coins, note: `${num(m.coins)} ${dollars(m.cents)}` })) }] : []),
        { text: "Playing games is always free.", color: C.lime, rows: 1, onCut: "never" },
      ],
      tiles: [{ text: "Play a game", hue: C.green, center: true }],
      sel: 0,
      hint: "A grown-up can add coins",
      limit: "empty",
    };
  }
  return {
    screen: "board",
    board: "L1",
    title: "Make a new game",
    right: `Pot ${num(p.coins)}`,
    rightCoin: true,
    blocks: [
      { text: "The pot is almost empty", scale: 2, color: C.yellow, rows: 2, after: 4, onCut: "ok" },
      { pair: { left: "The family pot has", right: coinsWord(p.coins), coin: true }, after: 1 },
      { pair: { left: "A new game needs about", right: coinsWord(p.usual.new), coin: true }, after: 4 },
      { text: `A small change (about ${p.usual.change}) still fits.`, color: C.lime, rows: 1, onCut: "never" },
      { text: `The pot fills up to ${p.full_coins} on ${refill}.`, color: C.silver, rows: 1, onCut: "never" },
    ],
    tiles: [
      { text: "Change a game instead", note: `about ${p.usual.change}`, noteCoin: true, hue: C.green },
      { text: "Who used the coins?" },
      { text: "Play a game" },
    ],
    sel: 0,
    hint: COIN_HINT,
    limit: "low",
  };
}

/** L5. */
export function resting() {
  return {
    screen: "board",
    board: "L5",
    title: "The Studio is resting",
    blocks: [
      { text: "Claude is resting", scale: 2, color: C.yellow, rows: 1, after: 6, onCut: "never" },
      { text: "The family's real money for Claude ran out this month, so making games stops until the 1st.", rows: 4, onCut: "never" },
      { text: "Playing games works the same as always!", color: C.lime, rows: 2, onCut: "never" },
    ],
    tiles: [{ text: "Play a game", hue: C.green, center: true }],
    sel: 0,
    hint: "A grown-up can see why in the Manager",
  };
}

/** E2: picking Make with no Wi-Fi. */
export function offlineMake() {
  return {
    screen: "board",
    board: "E2",
    title: "No Wi-Fi",
    blocks: [
      { text: "Claude can't be reached", scale: 2, color: C.yellow, rows: 2, after: 6, onCut: "ok" },
      { text: "Making games needs Wi-Fi, and the cabinet can't find it right now.", rows: 3, onCut: "never" },
      { text: "No coins were used.", color: C.lime, rows: 1, onCut: "never" },
      { text: "All the games on the shelf still work.", color: C.lime, rows: 1, onCut: "never" },
    ],
    tiles: [{ text: "Back to the shelf", hue: C.green, center: true }],
    sel: 0,
    hint: "Try again in a little while",
  };
}

/** The result of a make or change: M11, R8, L3, L4, E3, and the plain failures. @param {any} r @param {Pot | null} pot */
export function resultView(r, pot) {
  const by = r.maker_name ?? r.maker;
  const has = r.cost_cents != null;
  const used = has ? `${coinsWord(coinsOfCents(r.cost_cents))} (${cents(r.cost_cents)})` : null;
  const kind = r.kind === "change" ? "change" : "new";
  const usual = pot ? (kind === "change" ? pot.usual.change : pot.usual.new) : kind === "change" ? 3 : 6;
  const after = r.pot_after_cents != null ? Math.round(r.pot_after_cents / 10) : null;
  if (r.resting) return { ...resting(), resultId: r.id };
  if (!r.ok && r.failed && r.request) {
    // E3: Claude's slip, not the kid's. The idea is kept; the try still cost.
    return {
      screen: "board",
      board: "E3",
      resultId: r.id,
      title: "It didn't come out right",
      right: by,
      blocks: [
        { text: "Sorry!", scale: 2, color: C.yellow, rows: 1, after: 4, onCut: "never" },
        { text: "That was Claude's slip, not yours. Your idea and answers are saved.", rows: 3, onCut: "never" },
        ...(used ? [{ text: `The try still used ${used}. Real work costs real money, even when it doesn't work out.`, color: C.silver, rows: 4, onCut: "ok" }] : []),
      ],
      tiles: [
        { text: "Try again, same idea", note: `about ${usual}`, noteCoin: true, hue: C.green },
        { text: "Back to the shelf" },
      ],
      sel: 0,
      retry: { maker: r.maker, request: r.request, kind, parent: r.parent?.id ?? null },
    };
  }
  if (!r.ok) {
    return {
      screen: "board",
      board: "result-failed",
      resultId: r.id,
      title: "A game didn't finish",
      right: by,
      blocks: [{ text: r.message, rows: 8, keepLines: true, onCut: "ok" }, ...(used ? [{ text: `It used ${used}.`, color: C.silver, rows: 1 }] : [])],
      tiles: [{ text: "Back to the shelf", hue: C.green, center: true }],
      sel: 0,
    };
  }
  /** @type {any[]} */
  const blocks = [];
  let title = "Your game is ready!";
  let id = "M11";
  if (kind === "change") {
    id = "R8";
    title = r.version > 1 ? `Version ${r.version} is ready!` : "Your own version is ready!";
    blocks.push({ text: r.title, scale: 2, color: C.yellow, rows: 1, after: 2, align: "center" });
    if (r.changed) blocks.push({ text: r.changed, rows: 2, align: "center" });
    blocks.push({ text: r.version > 1 ? `Version ${r.version - 1} is still saved.` : `${r.parent?.maker_name ?? "The old"} game stays the same.`, color: C.mint, rows: 1, align: "center", onCut: "ok" });
  } else {
    blocks.push({ text: r.title, scale: 2, color: C.yellow, rows: 2, after: 2, align: "center" }, { text: `by ${clean(by)}`, color: C.silver, rows: 1, align: "center", after: 5 });
  }
  if (r.note) blocks.push({ id: "note", text: r.note, rows: 2, align: "center", color: C.silver });
  if (used) {
    if (r.over_pot) {
      id = "L3";
      blocks.push(
        { text: `It used ${used}, and the pot had ${coinsWord(Math.round(r.pot_before_cents / 10))}.`, rows: 2 },
        { text: `So the pot is now ${num(after ?? 0)}. Claude finished your game anyway.`, color: C.peach, rows: 2 },
        { text: `No more making this month. On ${dayName(pot?.refill_on ?? "")} the pot starts fresh at ${pot?.full_coins ?? 100}.`, color: C.silver, rows: 3 },
      );
    } else {
      blocks.push({ text: `This ${kind === "change" ? "change" : "game"} used ${used}.`, rows: 1, onCut: "ok" });
      if (r.over_usual) {
        id = id === "M11" ? "L4" : id;
        blocks.push({ text: `That's more than usual (about ${usual}).`, color: C.peach, rows: 1, onCut: "never" }, { text: r.why_more ?? "", color: C.silver, rows: 2 });
      } else blocks.push({ text: "That's about usual.", color: C.lime, rows: 1, onCut: "never" });
      if (after != null) blocks.push({ pair: { left: "Family pot now", right: coinsWord(after), coin: true } });
    }
  }
  return {
    screen: "board",
    board: id,
    resultId: r.id,
    title,
    right: kind === "change" ? by : "",
    blocks,
    tiles: [{ text: "Play it now", hue: C.green, center: true }, { text: "Back to the shelf", center: true }],
    sel: 0,
    cartId: r.cart_id,
  };
}

/** @param {number} c */
const coinsOfCents = (c) => Math.sign(c) * Math.round(Math.abs(c) / 10);

/** The post-game screen, after every game (D201): G3, G4, G5. @param {{ cart: any, noRule?: any, versions: number, usual: {change: number} }} o */
export function postGame(o) {
  const c = o.cart;
  const change = o.usual.change;
  if (!c.maker) {
    return {
      screen: "board",
      board: "G5",
      title: "Done playing",
      right: c.title,
      blocks: [{ text: "Make it yours?", scale: 2, color: C.yellow, rows: 1, after: 4, onCut: "never" }, { text: "Change anything you like. This one stays the same for everyone.", rows: 3, onCut: "never" }],
      tiles: [{ text: "Make my own version", note: `about ${change}`, noteCoin: true }, { text: "Play again", note: "free" }, { text: "Back to the shelf", hue: C.green }],
      sel: 2,
      post: ["change", "again", "shelf"],
    };
  }
  if (o.noRule) {
    return {
      screen: "board",
      board: "G3",
      title: "Done playing",
      right: c.title,
      blocks: [
        { text: "Fix it?", scale: 2, color: C.yellow, rows: 1, after: 4, onCut: "never" },
        { text: "You said this wasn't true:", color: C.silver, rows: 1, after: 1, onCut: "never" },
        { text: o.noRule.text, rows: 4, color: C.peach },
      ],
      tiles: [
        { text: "Fix that", note: `about ${change}`, noteCoin: true, hue: C.green },
        { text: "Change something else", note: `about ${change}`, noteCoin: true },
        { text: "Play again", note: "free" },
        { text: "Back to the shelf" },
      ],
      sel: 0,
      post: ["fix", "change", "again", "shelf"],
    };
  }
  return {
    screen: "board",
    board: "G4",
    title: "Done playing",
    right: c.title,
    blocks: [{ text: "Nice game!", scale: 2, color: C.yellow, rows: 1, after: 4, onCut: "never" }, { text: "Want to change anything?", rows: 1, onCut: "never" }],
    tiles: [
      { text: "Play again", note: "free" },
      { text: "Change this game", note: `about ${change}`, noteCoin: true },
      { text: "See other versions", note: String(o.versions) },
      { text: "It's good! Back to the shelf", hue: C.green },
    ],
    sel: 3,
    post: ["again", "change", "versions", "shelf"],
    hint: "A change makes a new version.",
  };
}

/** The first-ever boot (B2, B3) and a new month (B4). @param {"controls" | "pot" | "month"} which @param {Pot | null} pot */
export function bootBoard(which, pot) {
  if (which === "controls") {
    return {
      screen: "board",
      board: "B2",
      title: "Welcome!",
      blocks: [
        { text: "How it works", scale: 2, color: C.yellow, rows: 1, after: 6, onCut: "never" },
        { pair: { left: "Stick", right: "choose" }, after: 3 },
        { pair: { left: "Any button", right: "pick" }, after: 3 },
        { pair: { left: "ESC", right: "go back" }, after: 3 },
        { pair: { left: "COIN", right: "the coin pot" }, after: 6 },
        { text: "You can make your own games here, with Claude.", color: C.silver, rows: 2, onCut: "never" },
      ],
      tiles: [{ text: "Next", hue: C.green, center: true }],
      sel: 0,
    };
  }
  if (which === "pot") {
    return {
      screen: "board",
      board: "B3",
      title: "The coin pot",
      right: pot ? `Pot ${num(pot.coins)}` : "",
      rightCoin: !!pot,
      blocks: [
        { text: "One family pot", scale: 2, color: C.yellow, rows: 1, after: 6, onCut: "never" },
        { text: `The family shares one pot: ${pot?.full_coins ?? 100} coins on the 1st of every month.`, rows: 3, onCut: "never" },
        { text: "Making a game uses coins. Everyone can see who used what.", rows: 3, onCut: "never" },
        { text: "1 coin = 10 cents of real money.", color: C.lime, rows: 1, onCut: "never" },
      ],
      tiles: [{ text: "Let's play!", hue: C.green, center: true }],
      sel: 0,
    };
  }
  const last = pot?.last_month;
  /** @type {any[]} */
  const blocks = [
    { text: "POT IS FULL", scale: 2, color: C.yellow, rows: 1, after: 4, onCut: "never" },
    { coins: { n: 10, of: 10, note: `${pot?.full_coins ?? 100} coins` } },
    { gap: 4 },
  ];
  if (last?.makers?.length) blocks.push({ text: `${monthName(last.month)}'s coins went to`, color: C.yellow, rows: 1, after: 1, onCut: "never" }, { bars: last.makers.slice(0, 4).map((/** @type {any} */ m) => ({ label: m.name ?? m.maker, value: m.coins, note: `${num(m.coins)} ${dollars(m.cents)}` })) });
  if (last && last.ended_cents < 0) blocks.push({ text: `Last month went over by ${num(-last.ended_coins)}. A new month starts fresh.`, color: C.peach, rows: 2 });
  return { screen: "board", board: "B4", title: "A new month", right: pot ? monthName(pot.month) : "", blocks, tiles: [{ text: "Let's play!", hue: C.green, center: true }], sel: 0 };
}

/** M1 and R1: who's making, or who's changing. @param {{ makers: any[], pot: Pot | null, change?: { cart: any } }} o */
export function whoView(o) {
  const used = (/** @type {string} */ id) => o.pot?.makers.find((m) => m.maker === id)?.coins ?? 0;
  const c = o.change?.cart;
  const rows = o.makers.map((m) => ({
    maker: m,
    text: m.name,
    note: c ? (c.maker === m.id ? `makes version ${c.version + 1}` : `makes ${m.name}'s own`) : `used ${used(m.id)} this month`,
  }));
  return {
    screen: "who",
    title: c ? "Who's changing it?" : "Who's making?",
    right: o.pot ? `Pot ${num(o.pot.coins)}` : "",
    rows: [...rows, { text: "Someone new", note: c ? "makes their own" : "", hue: C.green }],
    makers: o.makers,
    change: o.change ?? null,
    sel: 0,
  };
}

/** M1/R1 drawn: names with a note each. @param {Painter} p @param {any} v */
function who(p, v) {
  header(p, v.title ?? "Who's making?", v.right ?? "", !!v.right);
  /** @type {any[]} */
  const rows = v.rows ?? [...v.makers.map((/** @type {any} */ m) => ({ text: m.name })), { text: "Someone new", hue: C.green }];
  const perPage = Math.floor((HINT_Y - BODY_Y - 2 + TILE_GAP) / (TILE_H + TILE_GAP));
  const top = Math.max(0, Math.min(v.sel - Math.floor(perPage / 2), rows.length - perPage));
  rows.slice(top, top + perPage).forEach((r, i) => {
    const n = top + i;
    row(p, { id: `who-${n}`, text: r.text, note: r.note, y: BODY_Y + i * (TILE_H + TILE_GAP), lit: n === v.sel, hue: r.hue ?? C.blue });
  });
  if (top > 0) arrow(p, W - M - 8, BODY_Y - 3, -1);
  if (top + perPage < rows.length) arrow(p, W - M - 8, HINT_Y - 4, 1);
  p.hint("Stick to choose, any button to pick");
}
Object.assign(SCREENS, { who });

/** R2: someone else's game. @param {{ cart: any, makerName: string, ownerName: string }} o */
export function notYours(o) {
  return {
    screen: "board",
    board: "R2",
    title: "Someone else's game",
    right: o.makerName,
    blocks: [
      { text: `This is ${o.ownerName}'s game.`, scale: 2, color: C.yellow, rows: 2, after: 6 },
      { text: "Your changes make a new game, just yours.", rows: 2, onCut: "never" },
      { text: `${o.ownerName}'s stays the same.`, color: C.mint, rows: 1 },
    ],
    tiles: [{ text: "OK, make mine", hue: C.green, center: true }, { text: "Not now", center: true }],
    sel: 0,
  };
}

/** R4: what to change. @param {{ noRule?: any, makerName: string }} o */
export function whatToChange(o) {
  return {
    screen: "board",
    board: "R4",
    title: "What should change?",
    right: o.makerName,
    blocks: [
      { text: "It's Claude again!", scale: 2, color: C.yellow, rows: 1, after: 4, onCut: "never" },
      { text: o.noRule ? "You said one thing wasn't right. Fix it, or tell me something else." : "Tell me what to change, or look at the plan first.", rows: 3, onCut: "never" },
    ],
    tiles: [
      ...(o.noRule ? [{ text: `Fix: ${clean(o.noRule.text)}`, hue: C.green }] : []),
      { text: "Tell Claude something else", hue: o.noRule ? C.blue : C.green },
      { text: "Look at the plan first" },
    ],
    sel: 0,
    actions: [...(o.noRule ? ["fix"] : []), "tell", "plan"],
  };
}

/** E8: ESC during a question (D188). @param {{ usedCents: number }} o */
export function leaveView(o) {
  return {
    screen: "board",
    board: "E8",
    title: "Leave this game?",
    blocks: [
      { text: "Claude is waiting for your answer.", rows: 2, align: "center", after: 4, onCut: "never" },
      ...(coinsOfCents(o.usedCents) >= 1 ? [{ text: `It has used ${coinsWord(coinsOfCents(o.usedCents))} so far.`, color: C.silver, rows: 1, align: "center" }] : []),
    ],
    tiles: [
      { text: "Keep going", hue: C.green },
      { text: "Come back later", note: "waits 10 min" },
      { text: "Stop making this game", hue: C.red },
    ],
    sel: 0,
    hint: "Coins used so far stay used.",
  };
}

/** The game card (S3). @param {{ cart: any, family: any, line: any, nameOf: (id: string) => string, usual: {change: number} }} o */
export function cardView(o) {
  const { line, family } = o;
  /** @type {any[]} */
  const rows = line.carts.map((/** @type {any} */ c, /** @type {number} */ i) => ({ text: `Version ${c.version}${i === 0 ? " (newest)" : ""}`, note: c.created ? dayName(c.created.slice(0, 10)) : "", cart: c }));
  const others = [family.main, ...family.others].filter((l) => l !== line);
  if (others.length) {
    rows.push({ text: line === family.main ? "Made from it by others:" : "Where it came from:", label: true });
    for (const l of others) rows.push({ text: l.newest.title, note: l.newest.maker ? `by ${o.nameOf(l.newest.maker)}` : "starter", cart: l.newest, indent: true });
  }
  rows.push({ text: "Change this game", note: `about ${o.usual.change}`, noteCoin: true, hue: C.green, change: true });
  return { screen: "card", title: line.newest.title, by: line.newest.maker ? `by ${o.nameOf(line.newest.maker)}` : "starter", pitch: line.newest.pitch, rows, sel: 0, cart: line.newest };
}

/** G0. @param {any} c @param {(id: string) => string} nameOf */
export function howtoView(c, nameOf) {
  const goal = c.pitch ? clean(c.pitch).split(/(?<=[.!?])\s/)[0] : null;
  const controls = (c.controls ?? []).map(controlWords);
  return { screen: "howto", cart: c, title: c.title, by: c.maker ? `by ${nameOf(c.maker)}` : "starter", goal, controls: controls.length ? controls : ["Stick and buttons: try them and see!"] };
}

/** The you-check questions to ask after this play: two at most, none about sound (D207). */
export { checksFor };

/** The full rules, for the plan's reader. */
export { planLines };
