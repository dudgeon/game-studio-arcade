// The cabinet's makers (D87): makers.json next to the cart library, never in this
// repo. An open list of first names; never deleted (D5), hidden from the Manager.
import fs from "node:fs";
import path from "node:path";

/** Longest first name kept. A long one is cut here and fitted again on screen. */
export const NAME_MAX = 16;

/**
 * @typedef {{ id: string, name: string, added: string, guest: boolean, grown_up?: boolean, hidden?: boolean, last_made?: string }} Maker
 */

const slug = (name) =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** First names only (D87): the first word, tidied. Null if nothing's left. */
export function firstName(raw) {
  const word = String(raw ?? "").trim().split(/\s+/)[0] ?? "";
  const name = word.replace(/[^\p{L}\p{N}'-]/gu, "").slice(0, NAME_MAX);
  if (!name || !slug(name)) return null;
  return name[0].toUpperCase() + name.slice(1);
}

/** @param {{ file: string, now?: () => Date }} o */
export function makersStore({ file, now = () => new Date() }) {
  /** @returns {Maker[]} */
  const read = () => {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      return Array.isArray(data) ? data : [];
    } catch (/** @type {any} */ e) {
      if (e.code === "ENOENT") return [];
      throw new Error(`makers.json can't be read: ${e.message}`);
    }
  };
  /** @param {Maker[]} list */
  const write = (list) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2) + "\n");
    fs.renameSync(tmp, file);
  };
  return {
    read,
    /** The list the "who's making" screen shows: most recent first (D87). */
    list() {
      return read()
        .filter((m) => !m.hidden)
        .sort((a, b) => (b.last_made ?? b.added).localeCompare(a.last_made ?? a.added));
    },
    /** A name from the new-name slot. The same name again is the same maker. */
    add(raw) {
      const name = firstName(raw);
      if (!name) return null;
      const list = read();
      const id = slug(name);
      const known = list.find((m) => m.id === id);
      if (known) return known;
      /** @type {Maker} */
      const maker = { id, name, added: now().toISOString(), guest: true };
      list.push(maker);
      write(list);
      return maker;
    },
    /**
     * A grown-up maker (D236), such as the author of a guest version: `guest: false` (not added
     * through the new-name slot) and `grown_up: true`. Someone already there is left exactly as is.
     * @param {string} id @param {string} rawName
     */
    ensureGrownUp(id, rawName) {
      const name = firstName(rawName);
      if (!name || slug(name) !== id) return null;
      const list = read();
      const known = list.find((m) => m.id === id);
      if (known) return known;
      /** @type {Maker} */
      const maker = { id, name, added: now().toISOString(), guest: false, grown_up: true };
      list.push(maker);
      write(list);
      return maker;
    },
    /** @param {string} id */
    get(id) {
      return read().find((m) => m.id === id) ?? null;
    },
    /** @param {string} id */
    touch(id) {
      const list = read();
      const m = list.find((x) => x.id === id);
      if (!m) return;
      m.last_made = now().toISOString();
      write(list);
    },
  };
}
