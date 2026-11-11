// Download a session's outputs (D42, D19) before anything else: deleting a
// session deletes them. Outputs keep syncing after the session goes idle, so
// the agent writes DONE.json (a manifest of names and sizes) last, and we poll
// files.list until it's there and every listed file has its final size.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const EXPECTED = ["report.json", "cart.tgz"];
export const MARKER = "DONE.json";
/** Session inputs also show up in files.list({scope_id}) (D19); never treat them as outputs. */
export const INPUT_NAMES = ["studio-kit.tgz", "parent.tgz"]; // parent.tgz: a change's parent game (D209); the API refuses to download it

/**
 * @param {{api: import("./api.js").StudioApi, sessionId: string, dir: string,
 *          inputNames?: string[], tries?: number, waitMs?: number, sleep?: (ms: number) => Promise<void>}} o
 * @returns {Promise<{dir: string, files: string[], missing: string[], complete: boolean, manifest: any, polls: number, listing: any[]}>}
 */
export async function downloadOutputs(o) {
  const tries = o.tries ?? 12;
  const waitMs = o.waitMs ?? 5000;
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const inputs = new Set(o.inputNames ?? INPUT_NAMES);
  fs.mkdirSync(o.dir, { recursive: true });

  /** @type {import("./api.js").OutputFile[]} */
  let outs = [];
  /** @type {{files?: {name: string, size: number}[]}|null} */
  let manifest = null;
  let missing = [MARKER];
  let polls = 0;
  /** @type {any[]} */
  let listing = [];
  for (let i = 0; i < tries; i++) {
    polls++;
    listing = await o.api.listOutputs(o.sessionId);
    outs = listing.filter((f) => !inputs.has(f.filename));
    const marker = latest(outs, MARKER);
    if (marker) {
      try {
        manifest = JSON.parse((await o.api.download(marker.id)).toString("utf8"));
      } catch {
        manifest = null;
      }
      missing = unmatched(outs, manifest);
      if (manifest && !missing.length) break;
    }
    if (i < tries - 1) await sleep(waitMs);
  }

  // Download everything that isn't an input, oldest first, so the newest copy
  // of a repeated filename takes the plain name. Never overwrite a download.
  const files = [];
  const ordered = [...outs].sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
  const newest = new Map(ordered.map((f) => [f.filename, f.id]));
  for (const f of ordered) {
    const name = safeName(f.filename);
    const dest = newest.get(f.filename) === f.id ? path.join(o.dir, name) : path.join(o.dir, `${name}.${f.id}`);
    fs.writeFileSync(dest, await o.api.download(f.id));
    files.push(path.basename(dest));
  }
  if (!manifest) missing = [...new Set([MARKER, ...EXPECTED.filter((n) => !files.includes(n))])];
  return { dir: o.dir, files, missing, complete: Boolean(manifest) && missing.length === 0, manifest, polls, listing };
}

function latest(outs, name) {
  const all = outs.filter((f) => f.filename === name);
  all.sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
  return all.at(-1);
}

/** Manifest entries not yet listed at their final size. A bad manifest counts as the marker missing. */
function unmatched(outs, manifest) {
  if (!manifest || !Array.isArray(manifest.files)) return [MARKER];
  return manifest.files
    .filter((m) => {
      const f = latest(outs, m.name);
      return !f || (typeof m.size === "number" && f.size_bytes !== m.size);
    })
    .map((m) => m.name);
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
