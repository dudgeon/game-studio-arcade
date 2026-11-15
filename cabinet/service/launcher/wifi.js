// @ts-check
// The cabinet's own Wi-Fi screens (D412-D414): the list of networks, the password keyboard, joining, and the
// result. Pure like boards.js: a view goes in, pixels and a record of every text box come out. For grown-ups;
// how they're reached is app.js's (D413).
import { COLORS as C } from "../../../runtime/src/palette.js";
import { ADVANCE, GLYPH_H, LINE_H, W, clean, colsFor, heightOf } from "./text.js";
import { BODY_Y, HINT_Y, INNER, M, SCREENS, TILE_GAP, TILE_PAD, arrow } from "./screens.js";

/** @typedef {import("./screens.js").Painter} Painter */

const ROW_H = heightOf(1) + TILE_PAD * 2;

// ---------- the keyboard's keys ----------

/** Three pages of 40 keys: every printable ASCII character a Wi-Fi password may hold, but the space (its own key). */
export const PAGES = Object.freeze([
  { name: "abc", keys: "1234567890qwertyuiopasdfghjkl-zxcvbnm_.@" },
  { name: "ABC", keys: "1234567890QWERTYUIOPASDFGHJKL-ZXCVBNM_.@" },
  { name: "#+=", keys: "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~        " },
]);
export const KEY_COLS = 10;
export const KEY_ROWS = 4;
/** The bottom row, under the grid: the page switch, space, delete, show or hide, and join. */
export const ACTIONS = Object.freeze(["page", "space", "delete", "show", "join"]);
/** A WPA password is 8 to 63 characters. */
export const PASS_MIN = 8;
export const PASS_MAX = 63;

// ---------- pieces ----------

/** Four signal bars, `level` of them lit (0-4). @param {Painter} p @param {number} x @param {number} y top-left of an 11x8 box @param {number} level @param {number} [on] @param {number} [off] */
export function bars(p, x, y, level, on = C.lime, off = C.gray) {
  for (let i = 0; i < 4; i++) {
    const h = 2 + i * 2;
    p.fb.rectfill(x + i * 3, y + 8 - h, 2, h, i < level ? on : off);
  }
}

/** A padlock, 7x8. @param {Painter} p @param {number} x @param {number} y @param {number} c */
export function lock(p, x, y, c) {
  p.fb.rect(x + 1, y, 5, 5, c);
  p.fb.rectfill(x, y + 3, 7, 5, c);
}

/** 0-4 bars from NetworkManager's 0-100 signal. @param {number} signal */
export const levelOf = (signal) => (signal >= 75 ? 4 : signal >= 55 ? 3 : signal >= 35 ? 2 : signal >= 15 ? 1 : 0);
/** @param {number} signal */
export const signalWord = (signal) => ["Very weak", "Weak", "Fair", "Good", "Strong"][levelOf(signal)];

// ---------- W1: the networks ----------

/**
 * @param {Painter} p
 * @param {{ current?: string | null, scanning?: boolean, networks: { ssid: string, signal: number, secure: boolean, saved?: boolean }[], sel: number }} v
 *   `sel` counts the networks, then "Look again".
 */
function list(p, v) {
  p.header("Wi-Fi", "Grown-ups");
  const status = v.current ? `On: ${clean(v.current)}` : "Not on Wi-Fi";
  // While the first look is still going it isn't known yet: saying "Not on Wi-Fi" then would be wrong half the time.
  if (v.current || !v.scanning || v.networks.length) p.box({ id: "wifi-status", text: status, x: M, y: BODY_Y, w: INNER, h: GLYPH_H, color: v.current ? C.lime : C.coral, onCut: "ok" });
  const top0 = BODY_Y + LINE_H + 3;
  if (v.scanning && !v.networks.length) {
    p.box({ id: "wifi-scanning", text: "Looking for networks...", x: M, y: top0 + 30, w: INNER, h: GLYPH_H, color: C.silver, align: "center", onCut: "never" });
    p.hint("ESC: back to the shelf");
    return;
  }
  const rows = [...v.networks.map((n) => ({ kind: "net", n })), { kind: "scan", n: null }];
  const perPage = Math.floor((HINT_Y - 2 - top0 + TILE_GAP) / (ROW_H + TILE_GAP));
  const first = Math.max(0, Math.min(v.sel - Math.floor(perPage / 2), rows.length - perPage));
  rows.slice(first, first + perPage).forEach((r, i) => {
    const idx = first + i;
    const y = top0 + i * (ROW_H + TILE_GAP);
    const lit = idx === v.sel;
    const net = r.n;
    if (!net) {
      p.fb.rectfill(M, y, INNER, ROW_H, lit ? C.green : C.forest);
      if (lit) p.fb.rect(M, y, INNER, ROW_H, C.white);
      p.box({ id: "wifi-rescan", text: v.scanning ? "Looking..." : "Look again", x: M, y: y + TILE_PAD, w: INNER, h: GLYPH_H, color: C.white, align: "center", onCut: "never" });
      return;
    }
    p.fb.rectfill(M, y, INNER, ROW_H, lit ? C.blue : C.slate);
    if (lit) p.fb.rect(M, y, INNER, ROW_H, C.white);
    const here = net.ssid === v.current;
    const note = here ? "on now" : net.saved ? "saved" : "";
    const noteW = note ? note.length * ADVANCE + 3 : 0;
    const rightW = 11 + 4 + 7 + 4 + noteW;
    p.box({ id: `wifi-net-${idx}`, text: net.ssid, x: M + TILE_PAD + 2, y: y + TILE_PAD, w: INNER - TILE_PAD * 2 - 2 - rightW, h: GLYPH_H, color: lit ? C.white : C.ice, onCut: "ok" });
    let x = M + INNER - TILE_PAD - 11;
    bars(p, x, y + TILE_PAD, levelOf(net.signal), lit ? C.white : C.lime, lit ? C.navy : C.gray);
    x -= 4 + 7;
    if (net.secure) lock(p, x, y + TILE_PAD, lit ? C.yellow : C.gold);
    if (note) p.box({ id: `wifi-note-${idx}`, text: note, x: x - 4 - noteW, y: y + TILE_PAD, w: noteW, h: GLYPH_H, color: here ? C.lime : C.silver, align: "right", onCut: "never" });
  });
  if (first > 0) arrow(p, W - M - 8, top0 - 4, -1);
  if (first + perPage < rows.length) arrow(p, W - M - 8, HINT_Y - 4, 1);
  p.hint("Stick: choose  Button: pick  ESC: back");
}

// ---------- W2: the password ----------

const KEY_W = 22;
const KEY_H = 15;
const KEY_GAP = 2;
const GRID_X = M + Math.floor((INNER - (KEY_COLS * KEY_W + (KEY_COLS - 1) * KEY_GAP)) / 2);

/**
 * The title, a line saying what it's for, and the field every keyboard screen starts with. The field shows the
 * text's tail, so the last characters typed are always in view. Returns the next free y.
 * @param {Painter} p @param {{ id: string, title: string, right?: string, label: string, text: string, tick?: number }} o
 */
export function fieldTop(p, o) {
  p.header(o.title, o.right);
  p.box({ id: `${o.id}-for`, text: o.label, x: M, y: BODY_Y, w: INNER, h: GLYPH_H, color: C.silver, onCut: "ok" });
  const fy = BODY_Y + LINE_H + 2;
  const fh = GLYPH_H + 8;
  p.fb.rectfill(M, fy, INNER, fh, C.black);
  p.fb.rect(M, fy, INNER, fh, C.sky);
  const cols = colsFor(INNER - 10) - 1;
  const shownText = o.text.length > cols ? o.text.slice(o.text.length - cols) : o.text;
  // Drawn straight from the framebuffer: a password may hold two spaces in a row, which a text box would fold.
  p.fb.text(shownText, M + 5, fy + 4, C.white, {});
  if ((o.tick ?? 0) % 60 < 40) p.fb.rectfill(M + 5 + shownText.length * ADVANCE, fy + 4, ADVANCE - 1, GLYPH_H, C.yellow);
  p.boxes.push({ id: `${o.id}-field`, text: shownText, x: M + 5, y: fy + 4, w: INNER - 10, h: GLYPH_H, lines: [], cut: false, onCut: "ok", readable: false });
  return fy + fh + 4;
}

/**
 * The grid keyboard (D414), for any screen that types with the stick (D431): rows of ten keys, then the action
 * row. `row` past the last row of keys is the action row, and `col` which action. The last action takes the width left.
 * @param {Painter} p
 * @param {{ page: number, row: number, col: number }} v
 * @param {number} y0
 * @param {{ id: string, pages: readonly { name: string, keys: string }[], acts: { id: string, text: string, w?: number, hue: number, dim?: boolean }[], hint: string }} o
 */
export function keyGrid(p, v, y0, o) {
  const page = o.pages[v.page] ?? o.pages[0];
  const KEY_ROWS = page.keys.length / KEY_COLS;
  for (let r = 0; r < KEY_ROWS; r++) {
    for (let c = 0; c < KEY_COLS; c++) {
      const ch = page.keys[r * KEY_COLS + c];
      if (ch === " ") continue;
      const x = GRID_X + c * (KEY_W + KEY_GAP);
      const y = y0 + r * (KEY_H + KEY_GAP);
      const lit = v.row === r && v.col === c;
      p.fb.rectfill(x, y, KEY_W, KEY_H, lit ? C.blue : C.slate);
      if (lit) p.fb.rect(x, y, KEY_W, KEY_H, C.white);
      // Scale 1, centered; the lit key's letter is yellow so it stands out from across the room.
      p.fb.text(ch, x + Math.floor((KEY_W - 5) / 2), y + Math.floor((KEY_H - GLYPH_H) / 2) + 1, lit ? C.yellow : C.ice, {});
    }
  }
  const ay = y0 + KEY_ROWS * (KEY_H + KEY_GAP) + 2;
  const total = KEY_COLS * KEY_W + (KEY_COLS - 1) * KEY_GAP;
  const fixed = o.acts.slice(0, -1).reduce((s, a) => s + (a.w ?? 0) + KEY_GAP, 0);
  let x = GRID_X;
  o.acts.forEach((a, i) => {
    const w = i === o.acts.length - 1 ? total - fixed : (a.w ?? 0);
    const lit = v.row === KEY_ROWS && v.col === i;
    p.fb.rectfill(x, ay, w, KEY_H, lit ? a.hue : a.dim ? C.night : C.slate);
    p.fb.rect(x, ay, w, KEY_H, lit ? C.white : a.dim ? C.slate : a.hue);
    p.box({ id: `${o.id}-act-${a.id}`, text: a.text, x, y: ay + Math.floor((KEY_H - GLYPH_H) / 2) + 1, w, h: GLYPH_H, color: a.dim ? C.gray : C.white, align: "center", onCut: "never" });
    x += w + KEY_GAP;
  });
  p.hint(o.hint);
}

/**
 * W2. `row` 0-3 and `col` 0-9 are a key; `row` 4 is the action row, `col` 0-4.
 * @param {Painter} p
 * @param {{ ssid: string, text: string, page: number, row: number, col: number, show?: boolean, tick?: number }} v
 */
function keys(p, v) {
  const y0 = fieldTop(p, {
    id: "wifi",
    title: "Wi-Fi password",
    right: v.text.length < PASS_MIN ? `${PASS_MIN - v.text.length} more` : `${v.text.length} letters`,
    label: `For ${clean(v.ssid)}`,
    text: v.show !== false ? v.text : "*".repeat(v.text.length),
    tick: v.tick,
  });
  keyGrid(p, v, y0, {
    id: "wifi",
    pages: PAGES,
    acts: [
      { id: "page", text: PAGES[(v.page + 1) % PAGES.length].name, w: 34, hue: C.purple },
      { id: "space", text: "space", w: 62, hue: C.blue },
      { id: "delete", text: "delete", w: 48, hue: C.red },
      { id: "show", text: v.show === false ? "show" : "hide", w: 38, hue: C.teal },
      { id: "join", text: "JOIN", hue: C.green, dim: v.text.length < PASS_MIN },
    ],
    hint: "A: type  B: delete  X: abc/ABC/#  1UP: join",
  });
}

// ---------- W3, W4: joining, and how it went ----------

/** @param {Painter} p @param {{ ssid: string, tick?: number }} v */
function joining(p, v) {
  p.header("Wi-Fi", "Grown-ups");
  p.box({ id: "wifi-joining", text: "Joining", x: M, y: 52, w: INNER, h: GLYPH_H, color: C.silver, align: "center", onCut: "never" });
  p.box({ id: "wifi-joining-name", text: v.ssid, x: M, y: 66, w: INNER, h: heightOf(2) * 2, scale: 2, color: C.yellow, align: "center", onCut: "ok" });
  const f = ((v.tick ?? 0) % 90) / 90;
  p.fb.rect(48, 112, W - 96, 8, C.silver);
  p.fb.rectfill(50 + Math.round((W - 140) * f), 114, 40, 4, C.yellow);
  p.box({ id: "wifi-joining-note", text: "This can take half a minute.", x: M, y: 128, w: INNER, h: GLYPH_H, color: C.silver, align: "center", onCut: "never" });
  p.hint("Please wait");
}

/**
 * @param {Painter} p
 * @param {{ ok: boolean, ssid: string, signal?: number, address?: string, name?: string, internet?: boolean, why?: string, back?: string | null, sel: number }} v
 */
function result(p, v) {
  p.header("Wi-Fi", "Grown-ups");
  let y = BODY_Y + 4;
  const line = (/** @type {string} */ id, /** @type {string} */ text, /** @type {number} */ color, rows = 1) => {
    const r = p.box({ id, text, x: M, y, w: INNER, h: heightOf(rows), color, onCut: "ok" });
    y += r.rows * LINE_H + 2;
  };
  if (v.ok) {
    p.box({ id: "wifi-result", text: "On Wi-Fi", x: M, y, w: INNER, h: heightOf(1) * 2, scale: 2, color: C.lime, onCut: "never" });
    y += heightOf(1) * 2 + 6;
    line("wifi-result-name", v.ssid, C.white);
    const level = levelOf(v.signal ?? 0);
    p.box({ id: "wifi-result-signal", text: `Signal: ${signalWord(v.signal ?? 0)}`, x: M, y, w: INNER - 16, h: GLYPH_H, color: level >= 2 ? C.ice : C.orange, onCut: "never" });
    bars(p, M + INNER - 12, y, level);
    y += LINE_H + 2;
    if (v.address) line("wifi-result-address", `Address: ${v.address}`, C.ice);
    if (v.name) line("wifi-result-host", `Name: ${v.name}`, C.ice);
    // Not known for a few seconds after joining: the service looks again, and the line appears.
    if (v.internet != null) line("wifi-result-net", v.internet ? "Claude can be reached." : "Joined, but it can't reach the internet yet.", v.internet ? C.lime : C.orange, 2);
    line("wifi-result-saved", "Saved. The cabinet joins it by itself from now on.", C.silver, 2);
  } else {
    p.box({ id: "wifi-result", text: "That didn't work", x: M, y, w: INNER, h: heightOf(1) * 2, scale: 2, color: C.coral, onCut: "never" });
    y += heightOf(1) * 2 + 6;
    line("wifi-result-name", v.ssid, C.white);
    line("wifi-result-why", v.why ?? "The password may be wrong, or the signal is too weak here.", C.ice, 3);
    line("wifi-result-back", v.back ? `The cabinet is back on ${v.back}.` : "The Wi-Fi it knew before is still saved.", C.lime, 2);
  }
  const tiles = v.ok ? ["Back to the shelf"] : ["Try the password again", "Pick another network", "Back to the shelf"];
  let ty = HINT_Y - 2 - tiles.length * (ROW_H + TILE_GAP) + TILE_GAP;
  tiles.forEach((t, i) => {
    ty = p.tile({ id: `wifi-tile-${i}`, text: t, y: ty, rows: 1, lit: i === v.sel, hue: i === tiles.length - 1 ? C.green : C.blue, center: true }).y;
  });
  p.hint("Stick to choose, any button to pick");
}

/**
 * The hold that opens the Wi-Fi screens, drawn over whatever is showing (D413).
 * @param {Painter} p @param {number} f how far through the hold, 0-1
 */
export function holdOverlay(p, f) {
  const w = 196;
  const h = 46;
  const x = Math.floor((W - w) / 2);
  const y = 70;
  p.fb.rectfill(x, y, w, h, C.navy);
  p.fb.rect(x, y, w, h, C.white);
  // What it covers is no longer on screen, so the fit check doesn't count it.
  p.boxes = p.boxes.filter((b) => b.x + b.w <= x || b.x >= x + w || b.y + b.h <= y || b.y >= y + h);
  p.box({ id: "wifi-hold", text: "Keep holding for Wi-Fi", x, y: y + 8, w, h: GLYPH_H, color: C.yellow, align: "center", onCut: "never" });
  p.box({ id: "wifi-hold-who", text: "(for grown-ups)", x, y: y + 19, w, h: GLYPH_H, color: C.silver, align: "center", onCut: "never" });
  p.fb.rect(x + 20, y + 32, w - 40, 7, C.silver);
  p.fb.rectfill(x + 22, y + 34, Math.round((w - 44) * Math.max(0, Math.min(1, f))), 3, C.yellow);
}

export const WIFI = { "wifi-list": list, "wifi-keys": keys, "wifi-joining": joining, "wifi-result": result };
Object.assign(SCREENS, WIFI);
