// @ts-check
// Typing on a talk screen with the stick (D431): the Wi-Fi screens' grid keyboard (D414, wifi.js and
// wifi-flow.js), with letters only for a name and every key for an idea or an answer. For when speech
// mishears or there's no mic; the Picade has no other keyboard.
import { COLORS as C } from "../../../runtime/src/palette.js";
import { SAY_TITLE, SCREENS } from "./screens.js";
import { PAGES, fieldTop, keyGrid } from "./wifi.js";
import { keyboardKey } from "./wifi-flow.js";

/** @typedef {import("./wifi-flow.js").Keys} Keys */

/**
 * A name's keyboard: letters only, one page, and delete and DONE. The first letter is a capital and the rest small.
 * @param {number} max @returns {Keys}
 */
export const nameKeys = (max) => ({
  pages: [{ name: "ABC", keys: "QWERTYUIOPASDFGHJKL ZXCVBNM   " }],
  actions: ["delete", "done"],
  actionUnder: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1],
  colOver: [2, 7],
  max,
  put: (text, ch) => text + (text ? ch.toLowerCase() : ch),
});

/** An idea's or an answer's keyboard: the Wi-Fi one's three pages, with space, delete and DONE. @param {number} max @returns {Keys} */
export const wordKeys = (max) => ({ pages: PAGES, actions: ["page", "space", "delete", "done"], actionUnder: [0, 0, 1, 1, 1, 2, 2, 3, 3, 3], colOver: [0, 3, 5, 8], max });

/** @param {{ purpose: string, max: number }} v */
export const keysFor = (v) => (v.purpose === "name" ? nameKeys(v.max) : wordKeys(v.max));

/** A talk screen's view, turned to the keyboard, with `text` already in the field. @param {any} v @param {string} [text] */
export function openKeys(v, text = "") {
  // "Q" is lit to start with: the name's first row, and the second row of the pages that begin with digits.
  return { ...v, phase: "keys", text, typed: "", page: 0, row: v.purpose === "name" ? 0 : 1, col: 0 };
}

/**
 * A key went down on the keyboard. True when DONE (or 1UP) was pressed with something typed.
 * @param {{ code: string, repeat: boolean }} e @param {any} v
 */
export function sayKey(e, v) {
  return keyboardKey(e, v, keysFor(v)) === "done" && !e.repeat && !!v.text.trim();
}

/** @param {import("./screens.js").Painter} p @param {any} v */
function sayKeys(p, v) {
  const name = v.purpose === "name";
  const L = keysFor(v);
  const left = v.max - v.text.length;
  const y0 = fieldTop(p, {
    id: "keys",
    title: /** @type {Record<string, string>} */ (SAY_TITLE)[v.purpose] ?? "Tell me",
    right: left <= 0 ? "Full" : name || left <= 20 ? `${left} left` : "",
    label: name ? "Your first name" : (v.prompt ?? "Type it with the stick"),
    text: v.text,
    tick: v.tick,
  });
  const empty = !v.text.trim();
  const tail = [
    { id: "delete", text: "delete", w: name ? 90 : 48, hue: C.red },
    { id: "done", text: "DONE", hue: C.green, dim: empty },
  ];
  const acts = name ? tail : [{ id: "page", text: PAGES[(v.page + 1) % PAGES.length].name, w: 34, hue: C.purple }, { id: "space", text: "space", w: 62, hue: C.blue }, ...tail];
  keyGrid(p, v, y0, { id: "keys", pages: L.pages, acts, hint: name ? "A: type  B: delete  1UP: done" : "A: type  B: delete  X: abc/ABC/#  1UP: done" });
}

Object.assign(SCREENS, { "say-keys": sayKeys });
