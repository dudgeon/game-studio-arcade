#!/usr/bin/env node
// The digital twin (D290-D297): the virtual cabinet mirrors the real one, from the Mac mini.
//
//   node scripts/twin.mjs status --real HOST       what differs: release, shelf, files (reads both, writes nothing)
//   node scripts/twin.mjs sync --real HOST         pull the real cabinet's data into the twin, append-only
//   node scripts/twin.mjs seed --real HOST --yes   once, at bring-up: the real cabinet starts as a copy of the twin
//
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
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import * as helper from "../cabinet/twin/helper.mjs";
import { applyInput, drift, inSync, shelfDrift } from "../cabinet/twin/plan.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRIVE = path.join(REPO, "cabinet/vm/drive");
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

/**
 * @param {string | undefined} host undefined: the virtual cabinet, found as cabinet/vm/drive finds it
 * @returns {End}
 */
export function cabinetEnd(host) {
  const code = Buffer.from(HELPER_SRC).toString("base64");
  const name = host ?? "the virtual cabinet";
  return {
    name,
    call(cmd, input) {
      const r = spawnSync(DRIVE, ["ssh", `sudo -u arcade /usr/local/bin/node -e '${BOOT}'`], {
        input: JSON.stringify({ code, cmd, root: CABINET_DATA, input }),
        encoding: "utf8",
        env: { ...process.env, ...(host ? { ARCADE_HOST: host } : {}), ARCADE_SSH_TIMEOUT_S: "300" },
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

/** Real into twin. Append-only: new files copied, logs grown, the twin's own changes set aside first. @param {End} real @param {End} twin */
export function sync(real, twin, now = new Date()) {
  const ti = twin.call("info");
  if (ti.makeInFlight) throw new Error("a make is running on the twin; sync once it's done");
  const ri = real.call("info");
  const [rm, tm] = [real.call("manifest"), twin.call("manifest")];
  const d = drift(rm.files, tm.files, ti.baseline);
  const got = fetchFrom(real, d, rm.files, tm.files, ti.baseline);
  const plan = applyInput(d, rm.files, tm.files, got);
  const result = twin.call("apply", {
    stamp: stampNow(now),
    ...plan,
    baseline: true,
    lastSync: { at: now.toISOString(), from: real.name, real_release: ri.release, copied: d.missing.length, grown: d.grown.length, replaced: d.changed.length, set_aside: plan.setAside.length },
  });
  return { ...result, copied: d.missing.length, grown: d.grown.length, replaced: d.changed.length, realMakeInFlight: ri.makeInFlight };
}

/**
 * Once, at bring-up (D295): the real cabinet becomes a copy of the twin, Tester's games and history included.
 * Refuses if the real cabinet holds anything the twin doesn't, so it can't run over a cabinet the kids have used.
 * @param {End} real @param {End} twin
 */
export function seed(real, twin, now = new Date()) {
  const [ri, ti] = [real.call("info"), twin.call("info")];
  if (ti.replay.length) throw new Error(`the twin has replay data (${ti.replay.join(", ")}); it can't go to a live cabinet (D150, D155)`);
  if (ri.makeInFlight || ti.makeInFlight) throw new Error("a make is running; seed once it's done");
  let tm = twin.call("manifest");
  const rm = real.call("manifest");
  const own = drift(tm.files, rm.files, null);
  const changed = own.changed.map((c) => c.rel).concat(own.grown.map((g) => g.rel));
  if (own.extra.length || changed.length) {
    const list = [...own.extra.map((e) => e.rel), ...changed];
    throw new Error(`the real cabinet already has data of its own (${list.length} files: ${list.slice(0, 5).join(", ")}${list.length > 5 ? ", ..." : ""}). Seeding is only for a new cabinet, and never overwrites one.`);
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
      carts: ids(/^carts\/([^/.][^/]*)\/cart\.json$/),
      sessions: ids(/^sessions\/([^/]+)\//),
      makers,
    };
    twin.call("apply", { stamp: stampNow(now), setAside: [], append: [], write: [{ rel: "twin-seed.json", expect: null, b64: Buffer.from(JSON.stringify(record, null, 2) + "\n").toString("base64"), mode: "644" }] });
    tm = twin.call("manifest");
  }
  const d = drift(tm.files, rm.files, null);
  const got = fetchFrom(twin, d, tm.files, rm.files, null);
  const plan = applyInput(d, tm.files, rm.files, got);
  const result = real.call("apply", { stamp: stampNow(now), ...plan });
  if (result.skipped.length) throw new Error(`${result.skipped.length} files changed on the real cabinet while seeding; run seed again`);
  // The twin's baseline: from here on, a difference on the twin is the twin's own (D294).
  twin.call("apply", { stamp: stampNow(now), setAside: [], write: [], append: [], baseline: true, lastSync: { at: now.toISOString(), from: real.name, seeded: true } });
  return { copied: result.written, appended: result.appended };
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
      json: { type: "boolean", default: false },
    },
  });
  const cmd = positionals[0];
  if (!["status", "sync", "seed"].includes(cmd ?? "")) throw new Error("usage: node scripts/twin.mjs status|sync|seed --real HOST [--twin HOST] [--yes]");
  if (!values.real && !values["real-dir"]) throw new Error("which real cabinet? --real HOST (the Picade, once it's on the network), or --real-dir D");
  const real = values["real-dir"] ? folderEnd(values["real-dir"]) : cabinetEnd(/** @type {string} */ (values.real));
  const twin = values["twin-dir"] ? folderEnd(values["twin-dir"]) : cabinetEnd(values.twin);
  if (real.name === twin.name) throw new Error("the real cabinet and the twin are the same place");
  const print = (/** @type {any} */ x, /** @type {string} */ text) => console.log(values.json ? JSON.stringify(x, null, 2) : text);
  if (cmd === "status") {
    const s = status(real, twin);
    print(s, describe(s));
  } else if (cmd === "sync") {
    const r = sync(real, twin);
    print(r, `Synced ${real.name} → ${twin.name}: ${r.copied} new, ${r.appended} logs grown, ${r.replaced} replaced, ${r.setAside} set aside on the twin${r.skipped.length ? `, ${r.skipped.length} skipped (changed while syncing; the next sync takes them)` : ""}.`);
    const s = status(real, twin);
    if (!values.json) console.log(describe(s));
  } else {
    if (!values.yes) throw new Error(`seed writes the twin's games, makers, ledger and logs onto ${real.name}, once. Add --yes to go ahead.`);
    const r = seed(real, twin);
    print(r, `Seeded ${real.name} from ${twin.name}: ${r.copied} files. From now on: node scripts/twin.mjs sync --real ${real.name}`);
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`twin: ${e.message}`);
    process.exit(1);
  });
}
