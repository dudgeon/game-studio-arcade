// The day-one card (D356-D358): Geoff's clean start for the kids' first switch-on, applied by flash.mjs --day-one FILE
// to its copy of the twin's data before it's packed for the card. Nothing on the twin, the backup or the mini changes:
// they keep everything, and `twin.mjs sync` sets the twin's own versions aside, never deleting them (D294).
//
// FILE is JSON:
//   {
//     "pot": "full",                        the pot starts at a full month: the twin's test ledger isn't carried
//     "hide_makers": ["tester", "tester2"], off "Who's making?": a maker mark (D360); makers.json is untouched
//     "shelf": ["teti", "teti-geoff", ...]  the games that show; every other game gets a game mark (carried, not deleted)
//   }
//
// Marks use the Manager's shelf-mark format (D360): logs/shelf_marks.jsonl, append-only, the last line for each
// (kind, target) wins. A day-one mark is a "remove" a grown-up can undo from the Manager with a "restore".
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const LEDGER = "logs/coin_ledger.jsonl";
export const MARKS = "logs/shelf_marks.jsonl";
/** How a day-one mark says where it came from (agreed with the Manager worker, or "manager" if its reader insists). */
export const VIA = "day-one";

/** The spec, checked. @param {string} text */
export function parseDayOne(text) {
  let o;
  try {
    o = JSON.parse(text);
  } catch {
    throw new Error("the day-one file isn't JSON");
  }
  const known = new Set(["pot", "hide_makers", "shelf", "note"]);
  for (const k of Object.keys(o ?? {})) if (!known.has(k)) throw new Error(`the day-one file has "${k}", which isn't one of pot, hide_makers, shelf, note`);
  if (o.pot !== undefined && o.pot !== "full" && o.pot !== "as-is") throw new Error('"pot" is "full" or "as-is"');
  const ids = (/** @type {string} */ k) => {
    const v = o[k] ?? [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(x))) throw new Error(`"${k}" is a list of ids`);
    return [...new Set(v)];
  };
  return { pot: o.pot ?? "as-is", hide_makers: ids("hide_makers"), shelf: o.shelf === undefined ? null : ids("shelf"), note: typeof o.note === "string" ? o.note : "" };
}

/** One mark line, in D360's format. @param {"game" | "maker"} kind @param {string} target @param {Date} at @param {string} reason */
export function mark(kind, target, at, reason) {
  return { type: "shelf_mark", id: `sm_${at.getTime().toString(36)}${randomBytes(3).toString("hex")}`, at: at.toISOString(), kind, target, action: "remove", by: "geoff", via: VIA, reason };
}

/**
 * Apply the spec to a copy of the twin's data, in place. Returns what it did, for the flash to say.
 * @param {string} dir the snapshot folder (never the twin, never the backup)
 * @param {ReturnType<typeof parseDayOne>} spec
 * @param {{ guestIds?: string[], now?: Date }} [o] guestIds: the games that ship with the cabinet (guests/), which the shelf may name
 */
export function applyDayOne(dir, spec, o = {}) {
  const now = o.now ?? new Date();
  const reason = spec.note || "day-one card: Geoff's clean start for the kids' first switch-on";
  const done = { ledgerLeftOff: false, hidden: /** @type {string[]} */ ([]), unknownMakers: /** @type {string[]} */ ([]), shelf: /** @type {string[] | null} */ (null), offShelf: /** @type {string[]} */ ([]), unknownGames: /** @type {string[]} */ ([]) };
  /** @type {any[]} */
  const marks = [];
  if (spec.pot === "full" && fs.existsSync(path.join(dir, LEDGER))) {
    fs.rmSync(path.join(dir, LEDGER)); // the copy only: the twin's own ledger is untouched
    done.ledgerLeftOff = true;
  }
  if (spec.hide_makers.length) {
    const file = path.join(dir, "makers.json");
    const makers = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
    for (const id of spec.hide_makers) {
      if (makers.some((/** @type {any} */ m) => m.id === id)) {
        done.hidden.push(id);
        marks.push(mark("maker", id, now, reason));
      } else done.unknownMakers.push(id);
    }
  }
  if (spec.shelf) {
    // A game mark targets a shelf line: a cart's branch, or its own id if it has none (D360). One mark on
    // candy-cat-drop hides candy-cat-drop-v2 too; a kid's own version is a line of its own. A shelf entry may name
    // a line or any cart in it.
    const cartsDir = path.join(dir, "carts");
    /** @type {Map<string, string>} cart id -> its line */
    const lineOf = new Map();
    for (const id of fs.existsSync(cartsDir) ? fs.readdirSync(cartsDir) : []) {
      const f = path.join(cartsDir, id, "cart.json");
      if (!fs.existsSync(f)) continue;
      let c = {};
      try {
        c = JSON.parse(fs.readFileSync(f, "utf8"));
      } catch {}
      lineOf.set(id, typeof (/** @type {any} */ (c).branch) === "string" && /** @type {any} */ (c).branch ? /** @type {any} */ (c).branch : id);
    }
    for (const g of [...(o.guestIds ?? []), ...(fs.existsSync(path.join(dir, "guests")) ? fs.readdirSync(path.join(dir, "guests")) : [])]) lineOf.set(g, g);
    const lines = new Set(lineOf.values());
    const keep = new Set();
    for (const id of spec.shelf) {
      if (lineOf.has(id)) keep.add(lineOf.get(id));
      else if (lines.has(id)) keep.add(id);
      else done.unknownGames.push(id);
    }
    done.shelf = [...keep].sort();
    done.offShelf = [...lines].filter((l) => !keep.has(l)).sort();
    for (const l of done.offShelf) marks.push(mark("game", l, now, reason));
  }
  if (marks.length) {
    fs.mkdirSync(path.join(dir, "logs"), { recursive: true });
    fs.appendFileSync(path.join(dir, MARKS), marks.map((m) => `${JSON.stringify(m)}\n`).join(""));
  }
  return done;
}
