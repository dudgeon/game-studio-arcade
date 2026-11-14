// @ts-check
// Long words read in pages, in place (D453, Geoff 2026-11-14): a box that holds more than fits shows one page
// and "1 of 3"; the stick left and right turns them. Pure, so the screens and their tests share it.
//
// The page lives in the view as v.pages = { text, page, seen }: which text it belongs to, the page on screen, and
// the furthest page seen. A new text (another hold, the next question) starts on page 1 without anyone resetting it.
import { clean } from "./text.js";

/** @typedef {import("./text.js").BoxRecord} BoxRecord */

/** The page to show of this text. @param {any} v @param {unknown} text */
export function pageOf(v, text) {
  return v?.pages && v.pages.text === clean(text) ? v.pages.page : 0;
}

/** The box on screen that has pages, if any. @param {BoxRecord[]} boxes */
export const pagedBox = (boxes) => boxes.find((b) => (b.pages ?? 1) > 1) ?? null;

/**
 * Stick left or right on a screen with pages: turn one. Returns true if it did something with the stick.
 * @param {any} v @param {"up" | "down" | "left" | "right"} dir @param {BoxRecord[]} boxes
 */
export function turnPage(v, dir, boxes) {
  if (dir !== "left" && dir !== "right") return false;
  const b = pagedBox(boxes);
  if (!b) return false;
  const pages = /** @type {number} */ (b.pages);
  const now = pageOf(v, b.text);
  const page = Math.max(0, Math.min(pages - 1, now + (dir === "right" ? 1 : -1)));
  // Past either end the stick isn't the pages': right on the last page still opens the reader for a cut tile.
  if (page === now) return false;
  const seen = Math.max(page, v.pages?.text === b.text ? v.pages.seen : 0);
  v.pages = { text: b.text, page, seen };
  return true;
}

/** Has every page of this text been on screen? Approving waits for it (D453). @param {any} v @param {BoxRecord[]} boxes */
export function seenAll(v, boxes) {
  const b = pagedBox(boxes);
  if (!b) return true;
  return v.pages?.text === b.text && v.pages.seen >= /** @type {number} */ (b.pages) - 1;
}
