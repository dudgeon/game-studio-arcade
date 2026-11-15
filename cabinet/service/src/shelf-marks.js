// "Off the shelf" (D360-D363): a grown-up takes a game, or a maker's name, off the cabinet for the kids, and can
// put it back. Nothing is erased (D5): the mark is a line appended to logs/shelf_marks.jsonl, beside the other
// logs, so the twin and the backup carry it (D291, D351) and the data check holds it to only growing (D196).
// A cart's files and its library history are never touched.
//
//   {"type":"shelf_mark","id":"sm_…","at":ISO,"kind":"game"|"maker","target":ID,"action":"remove"|"restore",
//    "by":WHO,"via":"manager"|"mcp","reason":TEXT}
//
// A game's target is its line: a cart's branch, or the cart itself (the shelf's rule, HANDOFF §2), so one mark
// covers every version of it. A kid's version of a game is its own line, and stays unless removed itself (D362).
// The last line for a (kind, target) wins. No file means nothing is off.
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const MARKS_FILE = "shelf_marks.jsonl";
const KINDS = new Set(["game", "maker"]);
const ACTIONS = new Set(["remove", "restore"]);
const ID = /^[a-z0-9][a-z0-9_-]{0,99}$/;

/** A cart's line: its branch, or itself. @param {{ id: string, branch?: string | null }} c */
export const lineOf = (c) => c.branch ?? c.id;

/** @param {{ logsDir: string, now?: () => Date }} o */
export function shelfMarks(o) {
  const file = path.join(o.logsDir, MARKS_FILE);
  const now = o.now ?? (() => new Date());
  /** @type {{ size: number, mtimeMs: number, rows: any[] } | null} */
  let cache = null;

  /** Every mark, oldest first. A line that isn't a mark is skipped, never fatal. @returns {any[]} */
  function all() {
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      return [];
    }
    if (cache && cache.size === st.size && cache.mtimeMs === st.mtimeMs) return cache.rows;
    const rows = [];
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (r?.type === "shelf_mark" && KINDS.has(r.kind) && ACTIONS.has(r.action) && typeof r.target === "string") rows.push(r);
      } catch {}
    }
    cache = { size: st.size, mtimeMs: st.mtimeMs, rows };
    return rows;
  }

  /** The mark in force for each target of a kind: only removals are returned. @param {"game" | "maker"} kind @returns {Map<string, any>} */
  function off(kind) {
    /** @type {Map<string, any>} */
    const last = new Map();
    for (const r of all()) if (r.kind === kind) last.set(r.target, r);
    for (const [t, r] of last) if (r.action !== "remove") last.delete(t);
    return last;
  }

  return {
    file,
    all,
    off,
    /** @param {{ id: string, branch?: string | null }} cart */
    cartOff: (cart) => off("game").has(lineOf(cart)),
    /** @param {string} id */
    makerOff: (id) => off("maker").has(id),
    /**
     * Append one mark. Doing what's already so is no change and appends nothing.
     * @param {{ kind: "game" | "maker", target: string, action: "remove" | "restore", by?: string | null, via: "manager" | "mcp", reason?: string | null }} m
     * @returns {{ changed: boolean, mark: any }}
     */
    mark(m) {
      if (!KINDS.has(m.kind)) throw new Error("kind is game or maker");
      if (!ACTIONS.has(m.action)) throw new Error("action is remove or restore");
      if (typeof m.target !== "string" || !ID.test(m.target)) throw new Error("give the game's or maker's id");
      const isOff = off(m.kind).has(m.target);
      if ((m.action === "remove") === isOff) return { changed: false, mark: off(m.kind).get(m.target) ?? null };
      const mark = {
        type: "shelf_mark",
        id: `sm_${Date.now().toString(36)}${randomBytes(3).toString("hex")}`,
        at: now().toISOString(),
        kind: m.kind,
        target: m.target,
        action: m.action,
        by: typeof m.by === "string" && m.by.trim() ? m.by.trim().slice(0, 60) : null,
        via: m.via,
        reason: typeof m.reason === "string" ? m.reason.trim().slice(0, 300) : "",
      };
      fs.mkdirSync(o.logsDir, { recursive: true });
      fs.appendFileSync(file, JSON.stringify(mark) + "\n");
      return { changed: true, mark };
    },
  };
}

/**
 * Every game line in the library, on the shelf or off, for the Manager and the MCP server (D361).
 * @param {any[]} carts listCarts' carts
 * @param {ReturnType<typeof shelfMarks>} marks
 * @param {{ plays?: any[], makerName?: (id: string) => string | null }} [o]
 */
export function gameLines(carts, marks, o = {}) {
  const offGames = marks.off("game");
  /** @type {Map<string, any[]>} */
  const lines = new Map();
  for (const c of carts) lines.set(lineOf(c), [...(lines.get(lineOf(c)) ?? []), c]);
  const lineOfCart = new Map(carts.map((c) => [c.id, lineOf(c)]));
  /** @type {Map<string, { at: string, n: number }>} */
  const played = new Map();
  for (const p of o.plays ?? []) {
    const l = lineOfCart.get(p.cart_id);
    if (!l) continue;
    const was = played.get(l) ?? { at: "", n: 0 };
    played.set(l, { at: String(p.started_at ?? "") > was.at ? String(p.started_at) : was.at, n: was.n + 1 });
  }
  const out = [];
  for (const [id, cs] of lines) {
    cs.sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
    const newest = cs[0];
    const first = cs[cs.length - 1];
    const parentCart = first.parent ? String(first.parent).replace(/@\d+$/, "") : null;
    const from = parentCart ? (lineOfCart.get(parentCart) ?? parentCart) : null;
    const mark = offGames.get(id) ?? null;
    out.push({
      id,
      title: newest.title,
      maker: newest.maker ?? null,
      maker_name: newest.maker ? (o.makerName?.(newest.maker) ?? newest.maker) : null,
      versions: cs.length,
      newest: { id: newest.id, version: newest.version ?? null, version_name: newest.version_name ?? null, created: newest.created ?? null },
      from,
      from_off: from ? offGames.has(from) : false,
      plays: played.get(id)?.n ?? 0,
      last_played: played.get(id)?.at || null,
      on_shelf: !mark,
      off: mark ? { at: mark.at, by: mark.by, via: mark.via, reason: mark.reason } : null,
    });
  }
  out.sort((a, b) => String(b.newest.created ?? "").localeCompare(String(a.newest.created ?? "")) || a.title.localeCompare(b.title));
  return out;
}
