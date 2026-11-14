#!/usr/bin/env node
// The digital twin (D290-D299): the virtual cabinet mirrors the real one, from the Mac mini.
//
//   node scripts/twin.mjs status        what differs: release, shelf, files (reads both, writes nothing)
//   node scripts/twin.mjs sync          pull the Picade's data into the twin, append-only
//   node scripts/twin.mjs seed --yes    once, at bring-up: the Picade starts as a copy of the twin
//     --set-aside-real                  ...after moving aside what bring-up checks left on it (D298)
//
//   The hourly backup (D350-D355) is scripts/twin-backup/: it syncs the Picade into a plain folder on the mini,
//   ~/game-studio-data/twin/backup (the copy a dead card is rebuilt from), then into the twin.
//   A seed, a sync and a backup never run at once: they share one lock in ~/game-studio-data/twin.
//
//   The real cabinet is the Picade: arcade.local, with the key the card script made in
//   the folder scripts/cabinet-card/picade-ssh.sh names (GSA_CABINET_DIR moves it), as connect-picade.sh reaches it.
//   --real HOST                another name for the Picade, if arcade.local doesn't resolve
//   --twin HOST                the twin (default: the virtual cabinet, found as cabinet/vm/drive finds it)
//   --real-dir D --twin-dir D  two data folders on this machine instead (tests, rehearsals)
//   --json                     print the result as JSON
//
// The mini pulls, over each cabinet's SSH (cabinet/vm/drive, ARCADE_HOST). The real cabinet is only ever read,
// except by `seed`, which writes to it once and only while it holds nothing the twin doesn't. Nothing is deleted
// on either side (D5): what the twin made or changed itself is moved to twin-sync/set-aside/<time>/ on the twin.
// Keys, the cabinet's config and its Manager token are never read or copied (D292).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import * as helper from "../cabinet/twin/helper.mjs";
import { PICADE_HOST, PICADE_KEY_NAME, picadeDir } from "./cabinet-card/picade.mjs";
import { applyInput, drift, inSync, shelfDrift } from "../cabinet/twin/plan.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** TWIN_DRIVE: a stand-in for drive, in tests only. */
const DRIVE = process.env.TWIN_DRIVE ?? path.join(REPO, "cabinet/vm/drive");
const HELPER_SRC = fs.readFileSync(path.join(REPO, "cabinet/twin/helper.mjs"), "utf8");
const CABINET_DATA = "/var/lib/arcade";
/** Bytes read from the source per round trip. */
const BATCH = 8 * 1024 * 1024;

/** Runs on the cabinet as `arcade`: the helper and its input arrive on stdin, the answer leaves on stdout's last line. */
const BOOT = `let s="";process.stdin.on("data",d=>s+=d).on("end",async()=>{const q=JSON.parse(s);try{const m=await import("data:text/javascript;base64,"+q.code);process.stdout.write("\\n"+JSON.stringify({ok:m.run(q.cmd,q.root,q.input)}))}catch(e){process.stdout.write("\\n"+JSON.stringify({error:String(e&&e.message)}))}})`;

/**
 * One side of a sync: a cabinet over SSH, or a folder here.
 * @typedef {{ name: string, call: (cmd: string, input?: any) => any }} End
 */

/** @param {string} dir @returns {End} */
export function folderEnd(dir) {
  return { name: dir, call: (cmd, input) => helper.run(cmd, dir, cmd === "info" ? { release: input?.release ?? "(a folder)" } : input) };
}

/**
 * The helper as a cabinet runs it (BOOT, data: import, stdin and stdout), on a folder here. For tests.
 * @param {string} dir @returns {End}
 */
export function bootEnd(dir) {
  const code = Buffer.from(HELPER_SRC).toString("base64");
  return {
    name: `boot:${dir}`,
    call(cmd, input) {
      const r = spawnSync(process.execPath, ["-e", BOOT], { input: JSON.stringify({ code, cmd, root: dir, input: cmd === "info" ? { release: "(a folder)" } : input }), encoding: "utf8", maxBuffer: 2 ** 30 });
      const out = JSON.parse((r.stdout || "").trim().split("\n").at(-1) ?? "{}");
      if (out.error) throw new Error(out.error);
      return out.ok;
    },
  };
}

/** The Picade's SSH, as connect-picade.sh reaches it: the key flash.mjs made when the card was written (D251). */
export const PICADE = {
  host: PICADE_HOST,
  dir: picadeDir(),
  keyName: PICADE_KEY_NAME,
};

/** Drive's own settings, so one cabinet's never leak into the other's call. */
const DRIVE_ENV = ["ARCADE_HOST", "ARCADE_SSH_DIR", "ARCADE_SSH_KEY_NAME", "GSA_VM_DIR"];

/**
 * @param {string | undefined} host undefined: the virtual cabinet, found as cabinet/vm/drive finds it
 * @param {Record<string, string>} [env] drive's settings for this cabinet; none means the virtual cabinet's defaults
 * @param {string} [label]
 * @returns {End}
 */
export function cabinetEnd(host, env, label) {
  const code = Buffer.from(HELPER_SRC).toString("base64");
  const name = label ?? host ?? "the virtual cabinet";
  const base = { ...process.env };
  // The twin keeps any GSA_VM_DIR the shell set (that's where the virtual cabinet lives); the Picade sets its own.
  for (const k of DRIVE_ENV) if (env || k !== "GSA_VM_DIR") delete base[k];
  return {
    name,
    call(cmd, input) {
      const r = spawnSync(DRIVE, ["ssh", `sudo -u arcade /usr/local/bin/node -e '${BOOT}'`], {
        input: JSON.stringify({ code, cmd, root: CABINET_DATA, input }),
        encoding: "utf8",
        env: { ...base, ...(env ?? {}), ...(host ? { ARCADE_HOST: host } : {}), ARCADE_SSH_TIMEOUT_S: "300" },
        maxBuffer: 2 ** 30,
      });
      if (r.status === 255) throw new Error(`can't reach ${name} over SSH. Is it up?`);
      const last = (r.stdout || "").trim().split("\n").at(-1) ?? "";
      let out;
      try {
        out = JSON.parse(last);
      } catch {
        throw new Error(`${name}: the helper didn't answer (${(r.stderr || "").trim().split("\n").at(-1) ?? "no output"})`);
      }
      if (out.error) throw new Error(`${name}: ${out.error}`);
      return out.ok;
    },
  };
}

/**
 * The Picade, by its own key. Stops early, the way connect-picade.sh does, if the card hasn't been written yet.
 * @param {string} [host] another name for it, if arcade.local doesn't resolve
 * @returns {End}
 */
export function picadeEnd(host = PICADE.host, dir = PICADE.dir) {
  const ssh = path.join(dir, "ssh");
  if (!fs.existsSync(path.join(ssh, PICADE.keyName))) throw new Error(`no SSH key for the Picade at ${ssh}. It's made when the card is written (scripts/cabinet-card/flash.mjs).`);
  // GSA_VM_DIR as connect-picade.sh sets it, so drive never takes the virtual cabinet's address from its host file.
  return cabinetEnd(host, { ARCADE_SSH_DIR: ssh, ARCADE_SSH_KEY_NAME: PICADE.keyName, GSA_VM_DIR: dir }, `the Picade (${host})`);
}

/** Reads what a drift needs from the source, in batches. A grown log that wasn't grown after all becomes changed. */
function fetchFrom(/** @type {End} */ source, /** @type {import("../cabinet/twin/plan.mjs").Drift} */ d, /** @type {any} */ sm, /** @type {any} */ tm, /** @type {any} */ baseline) {
  /** @type {Record<string, any>} */
  const got = {};
  const readAll = (/** @type {{ rel: string, from?: number }[]} */ want) => {
    let batch = [];
    let bytes = 0;
    const flush = () => {
      if (batch.length) Object.assign(got, source.call("read", { files: batch }));
      batch = [];
      bytes = 0;
    };
    for (const w of want) {
      batch.push(w);
      bytes += sm[w.rel].size - (w.from ?? 0);
      if (bytes >= BATCH) flush();
    }
    flush();
  };
  readAll([...d.missing.map((rel) => ({ rel })), ...d.changed.map((c) => ({ rel: c.rel })), ...d.grown]);
  const rewritten = d.grown.filter((g) => got[g.rel].prefix !== tm[g.rel].hash);
  if (rewritten.length) {
    d.grown = d.grown.filter((g) => !rewritten.includes(g));
    for (const g of rewritten) d.changed.push({ rel: g.rel, untouched: Boolean(baseline && baseline[g.rel] === tm[g.rel].hash) });
    readAll(rewritten.map((g) => ({ rel: g.rel })));
  }
  return got;
}

const stampNow = (/** @type {Date} */ now) => now.toISOString().replace(/[:.]/g, "-");

/** The twin's bookkeeping on the mini (D350): the lock, the backup folder and its record. GSA_TWIN_DIR moves it (tests). */
export const twinHome = () => process.env.GSA_TWIN_DIR ?? path.join(os.homedir(), "game-studio-data", "twin");
/** The Picade's copy on the mini that a dead card is rebuilt from (D351). Only sync writes it. */
export const backupDir = () => path.join(twinHome(), "backup");
/** A lock older than this is from a run that died. */
const LOCK_STALE_MS = 6 * 60 * 60 * 1000;

export class Busy extends Error {}

/**
 * One seed, sync or backup at a time (D352). Re-entrant within this process.
 * @template T @param {string} what @param {() => T} fn @returns {T}
 */
export function withLock(what, fn) {
  const home = twinHome();
  fs.mkdirSync(home, { recursive: true });
  const lock = path.join(home, "lock");
  const owner = path.join(lock, "owner.json");
  let mine = false;
  try {
    fs.mkdirSync(lock);
    mine = true;
  } catch (/** @type {any} */ e) {
    if (e.code !== "EEXIST") throw e;
    let o = null;
    try {
      o = JSON.parse(fs.readFileSync(owner, "utf8"));
    } catch {}
    if (o?.pid === process.pid) return fn();
    let alive = false;
    try {
      if (o?.pid) process.kill(o.pid, 0);
      alive = Boolean(o?.pid);
    } catch {}
    if (alive && Date.now() - Date.parse(o.at) < LOCK_STALE_MS) throw new Busy(`${o.what} is running (pid ${o.pid}, since ${o.at}); try again when it's done`);
    // A lock left by a run that died: ours to take. It's bookkeeping, not data.
    fs.rmSync(lock, { recursive: true, force: true });
    fs.mkdirSync(lock);
    mine = true;
  }
  try {
    fs.writeFileSync(owner, JSON.stringify({ pid: process.pid, what, at: new Date().toISOString() }));
    return fn();
  } finally {
    if (mine) fs.rmSync(lock, { recursive: true, force: true });
  }
}

/** What differs, read from both, nothing written. @param {End} real @param {End} twin */
export function status(real, twin) {
  const [ri, ti] = [real.call("info"), twin.call("info")];
  const [rm, tm] = [real.call("manifest"), twin.call("manifest")];
  const d = drift(rm.files, tm.files, ti.baseline);
  return {
    real: real.name,
    twin: twin.name,
    release: { real: ri.release, twin: ti.release, same: ri.release === ti.release },
    shelf: shelfDrift(rm.files, tm.files),
    files: { same: d.same.length, missing: d.missing, grown: d.grown.map((g) => g.rel), changed: d.changed.map((c) => c.rel), extra: d.extra },
    inSync: inSync(d),
    notCovered: { real: rm.notCovered, twin: tm.notCovered },
    seeded: ri.seed?.seeded_at ?? null,
    lastSync: ti.lastSync,
    makeInFlight: { real: ri.makeInFlight, twin: ti.makeInFlight },
  };
}

/**
 * Real into twin. Append-only: new files copied, logs grown, the twin's own changes set aside first.
 * keepOld (the backup folder, D351): every file the real cabinet replaced is kept too, not only the twin's own.
 * @param {End} real @param {End} twin @param {{ keepOld?: boolean }} [o]
 */
export function sync(real, twin, now = new Date(), o = {}) {
  const ti = twin.call("info");
  if (ti.makeInFlight) throw new Error("a make is running on the twin; sync once it's done");
  const ri = real.call("info");
  const [rm, tm] = [real.call("manifest"), twin.call("manifest")];
  const d = drift(rm.files, tm.files, ti.baseline);
  const got = fetchFrom(real, d, rm.files, tm.files, ti.baseline);
  const older = new Set(o.keepOld ? d.changed.filter((c) => c.untouched).map((c) => c.rel) : []);
  if (o.keepOld) for (const c of d.changed) c.untouched = false;
  const plan = applyInput(d, rm.files, tm.files, got);
  for (const a of plan.setAside) if (older.has(a.rel)) a.reason = "an older copy, replaced by the real cabinet's newer one (D351)";
  const result = twin.call("apply", {
    stamp: stampNow(now),
    ...plan,
    dirs: rm.emptyDirs ?? [],
    baseline: true,
    lastSync: { at: now.toISOString(), from: real.name, real_release: ri.release, copied: d.missing.length, grown: d.grown.length, replaced: d.changed.length, set_aside: plan.setAside.length },
  });
  return { ...result, copied: d.missing.length, grown: d.grown.length, replaced: d.changed.length, realMakeInFlight: ri.makeInFlight, files: Object.keys(rm.files).length, carts: shelfDrift(rm.files, {}).onlySource.length };
}

/**
 * Once, at bring-up (D295): the real cabinet becomes a copy of the twin, Tester's games and history included.
 * Refuses if the real cabinet holds anything the twin doesn't, so it can't run over a cabinet the kids have used.
 * With setAsideReal, and only before any seed, the real cabinet's own files (bring-up checks) are moved to
 * twin-sync/set-aside/<time>/ on it first, never deleted (D298).
 * @param {End} real @param {End} twin @param {{ setAsideReal?: boolean }} [o]
 */
export function seed(real, twin, now = new Date(), o = {}) {
  return withLock("a seed", () => seedNow(real, twin, now, o));
}

/** @param {End} real @param {End} twin @param {Date} now @param {{ setAsideReal?: boolean }} o */
function seedNow(real, twin, now, o) {
  const [ri, ti] = [real.call("info"), twin.call("info")];
  if (ti.replay.length) throw new Error(`the twin has replay data (${ti.replay.join(", ")}); it can't go to a live cabinet (D150, D155)`);
  if (ri.makeInFlight || ti.makeInFlight) throw new Error("a make is running; seed once it's done");
  let tm = twin.call("manifest");
  const rm = real.call("manifest");
  const own = drift(tm.files, rm.files, null);
  const changed = own.changed.map((c) => c.rel).concat(own.grown.map((g) => g.rel));
  const list = [...own.extra.map((e) => e.rel), ...changed];
  if (list.length && (!o.setAsideReal || ri.seed)) {
    throw new Error(`the real cabinet already has data of its own (${list.length} files: ${list.slice(0, 5).join(", ")}${list.length > 5 ? ", ..." : ""}). Seeding is only for a new cabinet, and never overwrites one.${ri.seed ? "" : " If these are only from bring-up checks, --set-aside-real moves them aside on it first (kept, not deleted)."}`);
  }
  if (ri.seed && !own.missing.length) throw new Error(`the real cabinet was seeded at ${ri.seed.seeded_at}; seeding happens once. Use sync.`);
  if (!ti.seed) {
    const ids = (/** @type {RegExp} */ re) => [...new Set(Object.keys(tm.files).map((r) => r.match(re)?.[1]).filter(Boolean))].sort();
    let makers = [];
    try {
      makers = JSON.parse(Buffer.from(twin.call("read", { files: [{ rel: "makers.json" }] })["makers.json"].b64, "base64").toString("utf8")).map((/** @type {any} */ m) => m.id);
    } catch {}
    const record = {
      seeded_at: now.toISOString(),
      from: "the virtual cabinet",
      twin_release: ti.release,
      note: "Everything listed here was made before the real cabinet existed: test data (Tester and grown-ups), not the kids' (D295).",
      sessions_note: "These session ids are in the virtual cabinet's workspace (cabinet-virtual). They are records only: nothing on the Picade resumes or fetches them, and a make in flight never seeds (D299).",
      carts: ids(/^carts\/([^/.][^/]*)\/cart\.json$/),
      sessions: ids(/^sessions\/([^/]+)\//),
      makers,
    };
    twin.call("apply", { stamp: stampNow(now), setAside: [], append: [], write: [{ rel: "twin-seed.json", expect: null, b64: Buffer.from(JSON.stringify(record, null, 2) + "\n").toString("base64"), mode: "644" }] });
    tm = twin.call("manifest");
  }
  const d = drift(tm.files, rm.files, null);
  // Only with setAsideReal: a log the real cabinet started on its own is replaced whole, its own copy set aside.
  for (const g of d.grown.splice(0)) d.changed.push({ rel: g.rel, untouched: false });
  const got = fetchFrom(twin, d, tm.files, rm.files, null);
  const plan = applyInput(d, tm.files, rm.files, got);
  for (const a of plan.setAside) a.reason = "on the real cabinet before the seed";
  const result = real.call("apply", { stamp: stampNow(now), ...plan, dirs: tm.emptyDirs ?? [] });
  if (result.skipped.length) throw new Error(`${result.skipped.length} files changed on the real cabinet while seeding; run seed again`);
  // The twin's baseline: from here on, a difference on the twin is the twin's own (D294).
  twin.call("apply", { stamp: stampNow(now), setAside: [], write: [], append: [], baseline: true, lastSync: { at: now.toISOString(), from: real.name, seeded: true } });
  return { copied: result.written, appended: result.appended, setAsideOnReal: result.setAside };
}

function describe(/** @type {ReturnType<typeof status>} */ s) {
  const lines = [`Twin drift: real ${s.real} → twin ${s.twin}`];
  lines.push(s.seeded ? `  seeded from the twin at ${s.seeded}` : "  not seeded yet (node scripts/twin.mjs seed, once, at bring-up)");
  lines.push(`  last sync: ${s.lastSync?.at ?? "never"}`);
  const folder = (/** @type {string | null} */ r) => r === "(a folder)";
  const hint = folder(s.release.twin) || folder(s.release.real) ? "" : ". Bring the twin to it with update-cabinet.mjs, from a checkout at the real cabinet's release (D296)";
  lines.push(`  release: ${s.release.same ? `both ${s.release.real}` : `real ${s.release.real}, twin ${s.release.twin}${hint}`}`);
  const shelf = [];
  if (s.shelf.onlySource.length) shelf.push(`${s.shelf.onlySource.length} only on the real cabinet (${s.shelf.onlySource.join(", ")})`);
  if (s.shelf.onlyTarget.length) shelf.push(`${s.shelf.onlyTarget.length} only on the twin (${s.shelf.onlyTarget.join(", ")})`);
  lines.push(`  games: ${shelf.length ? shelf.join("; ") : "the same"}`);
  const f = s.files;
  lines.push(`  files: ${f.same} the same, ${f.missing.length} new on the real cabinet, ${f.grown.length} logs grown, ${f.changed.length} changed, ${f.extra.length} only on the twin (set aside on sync)`);
  for (const e of f.extra.slice(0, 10)) lines.push(`    twin only: ${e.rel} (${e.reason})`);
  if (s.notCovered.real.length || s.notCovered.twin.length) lines.push(`  not covered by sync: real [${s.notCovered.real.join(", ")}], twin [${s.notCovered.twin.join(", ")}]`);
  if (s.makeInFlight.real || s.makeInFlight.twin) lines.push(`  a make is running on the ${s.makeInFlight.real ? "real cabinet" : "twin"}`);
  lines.push(s.inSync && s.release.same ? "  In sync." : "  Out of sync: node scripts/twin.mjs sync");
  return lines.join("\n");
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      real: { type: "string" },
      twin: { type: "string" },
      "real-dir": { type: "string" },
      "twin-dir": { type: "string" },
      yes: { type: "boolean", default: false },
      "set-aside-real": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
  });
  const cmd = positionals[0];
  if (!["status", "sync", "seed"].includes(cmd ?? "")) throw new Error("usage: node scripts/twin.mjs status|sync|seed [--yes] [--real HOST] [--twin HOST]");
  // The Picade by default, by its own key (D299); --real only renames it.
  const real = values["real-dir"] ? folderEnd(values["real-dir"]) : picadeEnd(values.real);
  const twin = values["twin-dir"] ? folderEnd(values["twin-dir"]) : cabinetEnd(values.twin);
  if (real.name === twin.name) throw new Error("the real cabinet and the twin are the same place");
  const print = (/** @type {any} */ x, /** @type {string} */ text) => console.log(values.json ? JSON.stringify(x, null, 2) : text);
  if (cmd === "status") {
    const s = status(real, twin);
    print(s, describe(s));
  } else if (cmd === "sync") {
    const r = withLock("a sync", () => sync(real, twin));
    print(r, `Synced ${real.name} → ${twin.name}: ${r.copied} new, ${r.appended} logs grown, ${r.replaced} replaced, ${r.setAside} set aside on the twin${r.skipped.length ? `, ${r.skipped.length} skipped (changed while syncing; the next sync takes them)` : ""}.`);
    const s = status(real, twin);
    if (!values.json) console.log(describe(s));
  } else {
    if (!values.yes) throw new Error(`seed writes the twin's games, makers, ledger and logs onto ${real.name}, once. Add --yes to go ahead.`);
    const r = seed(real, twin, new Date(), { setAsideReal: values["set-aside-real"] });
    print(r, `Seeded ${real.name} from ${twin.name}: ${r.copied} files. From now on: node scripts/twin.mjs sync`);
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`twin: ${e.message}`);
    process.exit(1);
  });
}
