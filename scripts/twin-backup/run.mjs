#!/usr/bin/env node
// The hourly backup of the Picade (D350-D355). launchd runs it on the mini (install.sh); it can be run by hand too.
//
//   node scripts/twin-backup/run.mjs [--quiet] [--no-twin]
//
// 1. Is there a Picade (its key from the card) and is it on the network (port 22, 5 s)? If not, it records that
//    and stops quietly: a cabinet that's off is normal.
// 2. Under the twin's lock (D352), so never during a seed or a sync, it syncs the Picade into a plain folder on the
//    mini, ~/game-studio-data/twin/backup. Nothing else writes that folder, and every older copy of a file is kept
//    in its twin-sync/set-aside/ (D351). That folder is what a dead card is rebuilt from (D354).
// 3. Then it syncs the twin, the virtual cabinet, if it's up and not making (D293). Its failure doesn't fail the backup.
// 4. It writes ~/game-studio-data/twin/backup.json, which the Cabinet Manager reads (D353), and a line in backup.log.
//
// Exit 0 when the cabinet is off or the run was skipped; 1 when a reachable cabinet couldn't be backed up.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { backupDir, Busy, cabinetEnd, folderEnd, PICADE, picadeEnd, sync, twinHome, withLock } from "../twin.mjs";

export const recordFile = () => path.join(twinHome(), "backup.json");

/** Is anything answering SSH there? @param {string} host @returns {Promise<boolean>} */
export function reachable(host, port = 22, ms = 5000) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, family: 4 });
    const done = (/** @type {boolean} */ ok) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(ms, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}

/** @returns {any} */
export function readRecord(file = recordFile()) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** @param {any} rec */
function writeRecord(rec) {
  const file = recordFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(rec, null, 2) + "\n");
  fs.renameSync(`${file}.tmp`, file);
  fs.appendFileSync(path.join(twinHome(), "backup.log"), JSON.stringify({ at: rec.last_attempt.at, ...rec.last_attempt, twin: rec.twin?.at === rec.last_attempt.at ? rec.twin.result : undefined }) + "\n");
}

/**
 * One backup run.
 * @param {{
 *   now?: Date,
 *   picade?: () => import("../twin.mjs").End,
 *   twin?: (() => import("../twin.mjs").End) | null,
 *   isReachable?: () => Promise<boolean>,
 * }} [o]
 */
export async function backup(o = {}) {
  const now = o.now ?? new Date();
  const at = now.toISOString();
  const rec = readRecord() ?? { what: "The Picade's data, copied to the mini (D350)", folder: backupDir() };
  /** @param {"ok" | "unreachable" | "no-card" | "busy" | "error"} result @param {string} message @param {boolean | null} isUp */
  const finish = (result, message, isUp) => {
    rec.last_attempt = { at, result, message, reachable: isUp };
    if (isUp) rec.last_reachable_at = at;
    writeRecord(rec);
    return rec;
  };
  let real;
  try {
    real = (o.picade ?? (() => picadeEnd()))();
  } catch (/** @type {any} */ e) {
    return finish("no-card", e.message, null);
  }
  const up = await (o.isReachable ?? (() => reachable(PICADE.host)))();
  if (!up) return finish("unreachable", `the Picade (${PICADE.host}) isn't on the network; nothing to do`, false);
  try {
    const r = withLock("the hourly backup", () => {
      fs.mkdirSync(backupDir(), { recursive: true });
      return sync(real, folderEnd(backupDir()), now, { keepOld: true });
    });
    if (r.skipped.length) throw new Error(`${r.skipped.length} files changed in the backup folder while syncing, which nothing should do`);
    rec.last_ok_at = at;
    rec.last_ok = { copied: r.copied, grown: r.grown, replaced: r.replaced, kept_older: r.setAside, files: r.files, games: r.carts, real_make_in_flight: r.realMakeInFlight };
  } catch (/** @type {any} */ e) {
    return finish(e instanceof Busy ? "busy" : "error", e.message, true);
  }
  if (o.twin !== null) {
    try {
      const twin = (o.twin ?? (() => cabinetEnd(undefined)))();
      const r = withLock("the hourly backup", () => sync(real, twin, now));
      rec.twin = { at, result: "ok", message: `${r.copied} new, ${r.appended} logs grown, ${r.replaced} replaced, ${r.setAside} set aside on the twin` };
    } catch (/** @type {any} */ e) {
      rec.twin = { at, result: "skipped", message: e.message };
    }
  }
  return finish("ok", `${rec.last_ok.files} files, ${rec.last_ok.games} games: ${rec.last_ok.copied} new, ${rec.last_ok.grown} logs grown, ${rec.last_ok.replaced} replaced`, true);
}

async function main() {
  const { values } = parseArgs({ options: { quiet: { type: "boolean", default: false }, "no-twin": { type: "boolean", default: false } } });
  const rec = await backup({ twin: values["no-twin"] ? null : undefined });
  const a = rec.last_attempt;
  const line = `${a.at} ${a.result}: ${a.message}${rec.twin?.at === a.at ? ` | twin: ${rec.twin.result}, ${rec.twin.message}` : ""}`;
  if (a.result === "error") {
    console.error(`twin-backup: ${line}`);
    process.exit(1);
  }
  if (!values.quiet || a.result !== "ok") console.log(line);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`twin-backup: ${e.message}`);
    process.exit(1);
  });
}
