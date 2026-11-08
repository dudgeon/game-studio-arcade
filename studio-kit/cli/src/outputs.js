// Download a session's outputs (D42) before anything else: deleting a session
// deletes them, and they can lag a few seconds behind the final idle.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const EXPECTED = ["report.json", "cart.tgz"];

/**
 * @param {{api: import("./api.js").StudioApi, sessionId: string, dir: string,
 *          tries?: number, waitMs?: number, sleep?: (ms: number) => Promise<void>}} o
 * @returns {Promise<{dir: string, files: string[], missing: string[]}>}
 */
export async function downloadOutputs(o) {
  const tries = o.tries ?? 6;
  const waitMs = o.waitMs ?? 5000;
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  fs.mkdirSync(o.dir, { recursive: true });
  let list = [];
  for (let i = 0; i < tries; i++) {
    list = await o.api.listOutputs(o.sessionId);
    if (EXPECTED.every((name) => list.some((f) => f.filename === name))) break;
    if (i < tries - 1) await sleep(waitMs);
  }
  const files = [];
  for (const f of list) {
    const name = safeName(f.filename);
    // Never overwrite a download: a repeated filename gets the file id appended.
    const dest = fs.existsSync(path.join(o.dir, name)) ? path.join(o.dir, `${name}.${f.id}`) : path.join(o.dir, name);
    fs.writeFileSync(dest, await o.api.download(f.id));
    files.push(path.basename(dest));
  }
  return { dir: o.dir, files, missing: EXPECTED.filter((n) => !files.includes(n)) };
}

function safeName(name) {
  const base = path.basename(String(name || "unnamed"));
  return base === "." || base === ".." ? "unnamed" : base;
}

/**
 * Extract cart.tgz into a fresh folder, refusing entries that escape it.
 * @param {string} tarball
 * @param {string} dest
 */
export function extractCart(tarball, dest) {
  const entries = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).split("\n").filter(Boolean);
  for (const e of entries) {
    const norm = path.posix.normalize(e);
    if (path.posix.isAbsolute(norm) || norm === ".." || norm.startsWith("../")) throw new Error(`unsafe path in cart.tgz: ${e}`);
  }
  fs.mkdirSync(dest, { recursive: true });
  execFileSync("tar", ["-xzf", tarball, "-C", dest]);
  return dest;
}

/** @param {string} file */
export function readJsonIfExists(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
