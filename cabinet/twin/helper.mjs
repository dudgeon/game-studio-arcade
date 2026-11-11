// The twin's data helper (D290-D296). Runs on a cabinet, as its `arcade` user, or on a local folder in tests.
// Self-contained (Node built-ins only): the mini sends it over SSH with its input, so the cabinet's
// installed release doesn't matter and nothing is left on the cabinet's disk.
//
//   manifest  every synced file's size, hash and mode, plus what isn't covered
//   info      the release it runs, a make in flight, replay data, the last sync
//   read      the files asked for, whole or from an offset, base64
//   apply     set aside, write, append; each only if the file is still what the plan saw
//
// Prints paths and hashes, never file contents, except to the mini through `read`.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** What a twin mirrors (D291): the cabinet's games and their history, makers, ledger and logs, downloaded games. */
export const SYNCED = ["carts", "sessions", "logs", "guests", "makers.json", "twin-seed.json"];
/** Per-cabinet, never copied either way (D292): its own identity, uploads, first-boot screens, a make in flight, caches. */
export const OWN = ["kit-uploads.json", "kit", "cabinet-state.json", "studio-run.json", "studio-left.json", "studio-results.json", "chromium", "twin-sync"];
/** The twin's own bookkeeping, inside its data folder and outside every manifest. */
export const SYNC_DIR = "twin-sync";
/** Files under logs/ only grow (data-check.mjs, D196). */
export const GROWS = (/** @type {string} */ rel) => rel.startsWith("logs/");

const SAFE = (/** @type {string} */ rel) => rel.length > 0 && !path.isAbsolute(rel) && !rel.split("/").some((p) => p === ".." || p === "" || p === ".");

/** @param {string} file @param {number} [bytes] */
function hashOf(file, bytes) {
  const size = bytes ?? fs.statSync(file).size;
  const h = createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(1 << 16);
    let at = 0;
    while (at < size) {
      const n = fs.readSync(fd, buf, 0, Math.min(buf.length, size - at), at);
      if (n === 0) break;
      h.update(buf.subarray(0, n));
      at += n;
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest("hex");
}

/** @param {string} root */
function walk(root) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  const visit = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      if (name.endsWith(".tmp") || name.endsWith(".twin-tmp")) continue;
      const full = path.join(dir, name);
      const st = fs.lstatSync(full);
      if (st.isDirectory()) visit(full);
      else if (st.isFile()) out.push(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  for (const top of SYNCED) {
    const full = path.join(root, top);
    if (!fs.existsSync(full)) continue;
    if (fs.lstatSync(full).isDirectory()) visit(full);
    else out.push(top);
  }
  return out;
}

/** @param {string} root */
export function manifest(root) {
  /** @type {Record<string, { size: number, hash: string, mode: string }>} */
  const files = {};
  for (const rel of walk(root)) {
    const full = path.join(root, rel);
    const st = fs.statSync(full);
    files[rel] = { size: st.size, hash: hashOf(full, st.size), mode: (st.mode & 0o777).toString(8) };
  }
  const tops = fs.existsSync(root) ? fs.readdirSync(root).sort() : [];
  const notCovered = tops.filter((t) => !SYNCED.includes(t) && !OWN.includes(t) && !t.endsWith(".tmp"));
  return { files, notCovered };
}

/** Replay data must never reach a live cabinet (D150, D155): the same test as service-config.mjs. @param {string} root */
export function replayData(root) {
  const found = [];
  const carts = path.join(root, "carts");
  for (const id of fs.existsSync(carts) ? fs.readdirSync(carts) : []) {
    const file = path.join(carts, id, "cart.json");
    if (!fs.existsSync(file)) continue;
    try {
      if (String(JSON.parse(fs.readFileSync(file, "utf8")).session_id ?? "").includes("replay")) found.push(`cart ${id}`);
    } catch {
      found.push(`cart ${id} (unreadable cart.json)`);
    }
  }
  const sessions = path.join(root, "logs/studio_session.jsonl");
  if (fs.existsSync(sessions) && fs.readFileSync(sessions, "utf8").includes('"sesn_replay"')) found.push("a replay session in the logs");
  if (fs.existsSync(path.join(root, "sessions/sesn_replay"))) found.push("a replay session folder");
  return found;
}

/** @param {string} file */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** @param {string} root @param {{ release?: string }} [input] */
export function info(root, input = {}) {
  let release = input.release ?? null;
  if (!release) {
    try {
      release = path.basename(fs.realpathSync("/opt/arcade/current"));
    } catch {}
  }
  return {
    release,
    makeInFlight: fs.existsSync(path.join(root, "studio-run.json")),
    replay: replayData(root),
    seed: readJson(path.join(root, "twin-seed.json")),
    lastSync: readJson(path.join(root, SYNC_DIR, "last-sync.json")),
    baseline: readJson(path.join(root, SYNC_DIR, "baseline.json")),
  };
}

/** @param {string} root @param {{ files: { rel: string, from?: number }[] }} input */
export function read(root, input) {
  /** @type {Record<string, { from: number, b64: string, hash: string, prefix: string | null }>} */
  const out = {};
  for (const { rel, from = 0 } of input.files) {
    if (!SAFE(rel)) throw new Error(`refusing path ${rel}`);
    const buf = fs.readFileSync(path.join(root, rel));
    // prefix: the hash of the bytes before `from`, so the mini can tell a grown log from a rewritten one.
    const prefix = from > 0 ? createHash("sha256").update(buf.subarray(0, from)).digest("hex") : null;
    out[rel] = { from, b64: buf.subarray(from).toString("base64"), hash: createHash("sha256").update(buf).digest("hex"), prefix };
  }
  return out;
}

/**
 * @typedef {{ rel: string, expect: string | null }} Guard   expect: the file's hash when the plan was made, null if it was absent
 * @param {string} root
 * @param {{ stamp: string, setAside: (Guard & { reason: string })[], write: (Guard & { b64: string, mode?: string })[], append: (Guard & { b64: string })[], baseline?: boolean, lastSync?: object }} input
 */
export function apply(root, input) {
  const current = (/** @type {string} */ rel) => {
    const full = path.join(root, rel);
    return fs.existsSync(full) ? hashOf(full) : null;
  };
  /** @type {{ rel: string, why: string }[]} */
  const skipped = [];
  const ok = (/** @type {Guard} */ g) => {
    if (!SAFE(g.rel)) throw new Error(`refusing path ${g.rel}`);
    if (current(g.rel) === g.expect) return true;
    skipped.push({ rel: g.rel, why: "changed while syncing; the next sync takes it" });
    return false;
  };
  const asideRoot = path.join(root, SYNC_DIR, "set-aside", input.stamp);
  const setAside = [];
  for (const g of input.setAside) {
    if (!ok(g)) continue;
    const to = path.join(asideRoot, g.rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(path.join(root, g.rel), to); // moved, never deleted (D5)
    setAside.push({ rel: g.rel, reason: g.reason });
    // A folder the move left empty goes too, so a set-aside game leaves no trace on the shelf.
    for (let d = path.dirname(path.join(root, g.rel)); d !== root && d.startsWith(root + path.sep); d = path.dirname(d)) {
      try {
        fs.rmdirSync(d); // fails unless empty
      } catch {
        break;
      }
    }
  }
  if (setAside.length) fs.appendFileSync(path.join(asideRoot, "set-aside.jsonl"), setAside.map((s) => JSON.stringify(s)).join("\n") + "\n");
  let written = 0;
  for (const g of input.write) {
    if (setAside.some((s) => s.rel === g.rel) ? false : !ok(g)) continue;
    const full = path.join(root, g.rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const tmp = `${full}.twin-tmp`;
    fs.writeFileSync(tmp, Buffer.from(g.b64, "base64"), { mode: g.mode ? parseInt(g.mode, 8) : 0o644 });
    if (g.mode) fs.chmodSync(tmp, parseInt(g.mode, 8));
    fs.renameSync(tmp, full);
    written++;
  }
  let appended = 0;
  for (const g of input.append) {
    if (!ok(g)) continue;
    fs.appendFileSync(path.join(root, g.rel), Buffer.from(g.b64, "base64"));
    appended++;
  }
  const dir = path.join(root, SYNC_DIR);
  fs.mkdirSync(dir, { recursive: true });
  // The baseline is what this folder holds now, as the sync left it: a later difference is the twin's own (D294).
  // A file skipped because it moved under us stays out, so a change of the twin's there is set aside, not lost.
  if (input.baseline) {
    /** @type {Record<string, string>} */
    const base = {};
    for (const [rel, f] of Object.entries(manifest(root).files)) if (!skipped.some((s) => s.rel === rel)) base[rel] = f.hash;
    fs.writeFileSync(path.join(dir, "baseline.json"), JSON.stringify(base) + "\n");
  }
  if (input.lastSync) fs.writeFileSync(path.join(dir, "last-sync.json"), JSON.stringify({ ...input.lastSync, skipped: skipped.length }, null, 2) + "\n");
  return { setAside: setAside.length, written, appended, skipped };
}

/** @param {string} cmd @param {string} root @param {any} input */
export function run(cmd, root, input) {
  if (cmd === "manifest") return manifest(root);
  if (cmd === "info") return info(root, input);
  if (cmd === "read") return read(root, input);
  if (cmd === "apply") return apply(root, input);
  throw new Error(`unknown command ${cmd}`);
}
