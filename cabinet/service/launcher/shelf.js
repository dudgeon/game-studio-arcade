// @ts-check
// The shelf's family rows (D206): the newest version of each game, with other
// makers' versions indented under the game they came from. Pure, so tests and the
// page share it. A cart with no family is its own (every cart made before D209).

/**
 * @typedef {{ id: string, title: string, version: number, maker: string | null, parent: string | null,
 *   family?: string | null, branch?: string | null, created?: string | null, plays?: number,
 *   youCheck?: { id: string, text: string }[], answered?: any, pitch?: string | null, controls?: string[] }} Cart
 * @typedef {{ id: string, family: string, maker: string | null, carts: Cart[], newest: Cart }} Line
 * @typedef {{ family: string, main: Line, others: Line[], newest: string }} Family
 */

/** The id a "cart@version" parent names. @param {string | null | undefined} p */
export const parentId = (p) => (p ? String(p).replace(/@\d+$/, "") : null);

/** @param {Cart} c */
const familyOf = (c) => c.family ?? c.id;
/** @param {Cart} c */
const branchOf = (c) => c.branch ?? c.id;

/** @param {Cart[]} carts @returns {Family[]} newest family first */
export function families(carts) {
  /** @type {Map<string, Line>} */
  const lines = new Map();
  for (const c of carts) {
    const id = branchOf(c);
    const l = lines.get(id) ?? { id, family: familyOf(c), maker: c.maker, carts: [], newest: c };
    l.carts.push(c);
    lines.set(id, l);
  }
  for (const l of lines.values()) {
    l.carts.sort((a, b) => b.version - a.version || (b.created ?? "").localeCompare(a.created ?? ""));
    l.newest = l.carts[0];
    l.maker = l.newest.maker;
  }
  /** @type {Map<string, Line[]>} */
  const byFamily = new Map();
  for (const l of lines.values()) byFamily.set(l.family, [...(byFamily.get(l.family) ?? []), l]);
  /** @type {Family[]} */
  const out = [];
  for (const [family, ls] of byFamily) {
    const newestOf = (/** @type {Line} */ l) => l.carts.reduce((m, c) => ((c.created ?? "") > m ? (c.created ?? "") : m), "");
    // The game's own line is the one that started the family; if it's missing, the oldest.
    const main = ls.find((l) => l.id === family) ?? [...ls].sort((a, b) => newestOf(a).localeCompare(newestOf(b)))[0];
    const others = ls.filter((l) => l !== main).sort((a, b) => newestOf(b).localeCompare(newestOf(a)));
    out.push({ family, main, others, newest: ls.map(newestOf).sort().at(-1) ?? "" });
  }
  // Newest activity first; starters (no dates) last, by title.
  return out.sort((a, b) => b.newest.localeCompare(a.newest) || a.main.newest.title.localeCompare(b.main.newest.title));
}

/** You-check rules a kid can judge in one play, at most two (D207): nothing about sound yet. @param {Cart} c */
export function checksFor(c) {
  if (!c.youCheck?.length || c.answered) return [];
  return c.youCheck.filter((r) => !/\b(sound|sounds|hear|heard|noise|music|beep|song|audio|loud)\b/i.test(r.text)).slice(0, 2);
}

/**
 * The tags on a game row (S1): NEW for a made game nobody has played, "n to check", "starter".
 * @param {Cart} c
 */
export function tagsOf(c) {
  /** @type {{ text: string, kind: "new" | "check" | "starter" | "version" }[]} */
  const tags = [];
  if (!c.maker) tags.push({ text: "starter", kind: "starter" });
  else if (!c.plays) tags.push({ text: "NEW", kind: "new" });
  const n = checksFor(c).length;
  if (c.maker && n && c.plays) tags.push({ text: `${n} to check`, kind: "check" });
  return tags;
}

/**
 * The game rows, in shelf order.
 * @param {Cart[]} carts @param {(id: string) => string} nameOf
 * @returns {{ kind: "cart", cart: Cart, line: Line, family: Family, indent: number, title: string, by: string, version: string | null, tags: ReturnType<typeof tagsOf> }[]}
 */
export function gameRows(carts, nameOf) {
  const rows = [];
  for (const f of families(carts)) {
    for (const [i, l] of [f.main, ...f.others].entries()) {
      const c = l.newest;
      rows.push({ kind: /** @type {const} */ ("cart"), cart: c, line: l, family: f, indent: i ? 1 : 0, title: c.title, by: c.maker ? `by ${nameOf(c.maker)}` : "starter game", version: c.version > 1 ? `v${c.version}` : null, tags: tagsOf(c) });
    }
  }
  return rows;
}

/** A cart's family and line, for its card (S3) and the change flow (R1). @param {Cart[]} carts @param {string} id */
export function familyOfCart(carts, id) {
  for (const f of families(carts)) {
    for (const l of [f.main, ...f.others]) if (l.carts.some((c) => c.id === id)) return { family: f, line: l };
  }
  return null;
}

/** A small icon's colors, the same for a game every time. @param {string} id */
export function iconOf(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}
