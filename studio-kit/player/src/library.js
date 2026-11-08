// Reads the dev cart library (D14) for the player: one folder per cart, with
// game.js, cart.json and spec.md. Read fresh on every request (D70), so a cart
// the CLI just committed shows up without a restart.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { rulesOf } from "@game-studio-arcade/spec";

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
  const rules = spec ? rulesOf(spec) : [];
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
