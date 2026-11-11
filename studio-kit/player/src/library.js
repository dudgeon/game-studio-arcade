// Reads the dev cart library (D14) for the player: one folder per cart, with
// game.js, cart.json and spec.md. Read fresh on every request (D70), so a cart
// the CLI just committed shows up without a restart.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseSpec } from "@game-studio-arcade/spec";

/** Same data folder as the CLI (D14): `GSA_DATA_DIR` or ~/game-studio-data. */
export function dataDir(env = process.env) {
  return env.GSA_DATA_DIR || path.join(os.homedir(), "game-studio-data");
}

/**
 * @typedef {{ id: string, text: string }} YouCheckRule
 * @typedef {{
 *   id: string,
 *   dir: string,
 *   source: "library" | "example",
 *   title: string,
 *   version: number,
 *   maker: string | null,
 *   with: string | null,
 *   players: number | null,
 *   parent: string | null,
 *   family: string | null,
 *   branch: string | null,
 *   pitch: string | null,
 *   controls: string[],
 *   session_id: string | null,
 *   created: string | null,
 *   commit: string | null,
 *   youCheck: YouCheckRule[],
 *   autoRules: number,
 * }} CartInfo
 */

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** @param {string} file */
function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** The library commit that last touched a cart folder, or null outside git. */
function commitOf(root, id) {
  if (!fs.existsSync(path.join(root, ".git"))) return null;
  try {
    return execFileSync("git", ["log", "-1", "--format=%H", "--", id], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * One cart folder, or null if it isn't a cart (no game.js).
 * @param {string} root
 * @param {string} id
 * @param {"library" | "example"} source
 * @returns {CartInfo | null}
 */
export function readCart(root, id, source = "library") {
  if (!ID.test(id)) return null;
  const dir = path.join(root, id);
  if (!fs.existsSync(path.join(dir, "game.js"))) return null;
  /** @type {any} */
  let meta = {};
  try {
    meta = JSON.parse(readText(path.join(dir, "cart.json")) ?? "{}") ?? {};
  } catch {}
  const spec = readText(path.join(dir, "spec.md"));
  const parsed = spec ? parseSpec(spec) : null;
  const rules = parsed ? parsed.rules.map(({ id, kind, text }) => ({ id, kind, text })) : [];
  /** @param {string} h */
  const body = (h) => parsed?.sections.find((s) => s.heading === h)?.body ?? null;
  const titleLine = spec?.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const v = Number(meta.version);
  return {
    id,
    dir,
    source,
    title: String(meta.title || titleLine || id),
    version: Number.isInteger(v) && v > 0 ? v : 1,
    maker: meta.maker ?? null,
    with: meta.with ?? null,
    players: Number.isInteger(meta.players) ? meta.players : null,
    parent: meta.parent ?? null,
    // A change's game and line (D206). The cabinet works these out from parent when they're missing.
    family: typeof meta.family === "string" ? meta.family : null,
    branch: typeof meta.branch === "string" ? meta.branch : null,
    pitch: body("Pitch")?.replace(/\s+/g, " ").trim() || null,
    // The Controls section's lines, for "how to play" before every game (G0).
    controls: (body("Controls") ?? "")
      .split("\n")
      .map((l) => l.replace(/^\s*[-*]\s*/, "").trim())
      .filter((l) => l && !/★|cabinet's button/i.test(l)),
    session_id: meta.session_id ?? null,
    created: meta.created ?? null,
    commit: source === "library" ? commitOf(root, id) : null,
    youCheck: rules.filter((r) => r.kind === "you-check").map((r) => ({ id: r.id, text: r.text })),
    autoRules: rules.filter((r) => r.kind === "auto").length,
  };
}

/**
 * Every cart in the given folders. An id found in an earlier folder wins.
 * @param {{ root: string, source: "library" | "example" }[]} roots
 * @returns {CartInfo[]}
 */
export function listCarts(roots) {
  /** @type {Map<string, CartInfo>} */
  const out = new Map();
  for (const { root, source } of roots) {
    if (!fs.existsSync(root)) continue;
    for (const d of fs.readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory() || out.has(d.name)) continue;
      const c = readCart(root, d.name, source);
      if (c) out.set(c.id, c);
    }
  }
  return [...out.values()].sort((a, b) => (b.created ?? "").localeCompare(a.created ?? "") || a.title.localeCompare(b.title));
}
