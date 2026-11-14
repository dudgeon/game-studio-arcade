// "Last backup" in the Manager's health (HANDOFF 9.4, D353): read from the hourly backup's record on the mini,
// ~/game-studio-data/twin/backup.json (scripts/twin-backup/run.mjs). Read-only; the Manager never runs a backup.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const BACKUP_RECORD = () => path.join(process.env.GSA_TWIN_DIR ?? path.join(os.homedir(), "game-studio-data", "twin"), "backup.json");
const HOUR = 60 * 60 * 1000;
/** The newest copy may be this old while the cabinet is on, before it's a warning. */
export const WARN_AFTER_MS = 24 * HOUR;
/** The hourly job counts as stopped when it hasn't tried for this long. */
export const STOPPED_AFTER_MS = 3 * HOUR;

/** @param {string} [file] */
export function readBackupRecord(file = BACKUP_RECORD()) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** "3 hours", "2 days". @param {number} ms */
export function ago(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.round(h / 24);
  return `${d} days`;
}

/**
 * The health line, and whether it's a warning.
 * @param {any} rec backup.json, or null
 * @param {{ now?: number, live?: boolean }} o live: the Manager can reach the cabinet right now
 * @returns {{ state: "ok" | "warn" | "off" | "none", text: string, last_ok_at: string | null }}
 */
export function backupHealth(rec, o = {}) {
  const now = o.now ?? Date.now();
  if (!rec || !rec.last_attempt) {
    return { state: o.live ? "warn" : "none", text: `No backup yet. The hourly backup isn't installed or hasn't run: scripts/twin-backup/install.sh on the mini.`, last_ok_at: null };
  }
  const a = rec.last_attempt;
  const okAt = rec.last_ok_at ? Date.parse(rec.last_ok_at) : null;
  const tried = Date.parse(a.at);
  // On now: the Manager sees it, or the backup's own last try found it.
  const on = Boolean(o.live) || (a.reachable === true && now - tried < 2 * HOUR);
  const copy = okAt ? `Last backup ${ago(now - okAt)} ago${rec.last_ok?.games != null ? ` (${rec.last_ok.games} games, ${rec.last_ok.files} files)` : ""}` : "Never backed up";
  const old = okAt == null || now - okAt > WARN_AFTER_MS;
  if (on && old) {
    const why = now - tried > STOPPED_AFTER_MS ? `the hourly backup hasn't run for ${ago(now - tried)}; is it installed, and is the mini awake?` : `its last try said: ${a.result}, ${a.message}`;
    return { state: "warn", text: `${copy}, and the cabinet is on. The kids' newest games aren't backed up: ${why}`, last_ok_at: rec.last_ok_at ?? null };
  }
  if (on && now - tried > STOPPED_AFTER_MS) return { state: "warn", text: `${copy}. The hourly backup hasn't run for ${ago(now - tried)}: is it still installed?`, last_ok_at: rec.last_ok_at ?? null };
  if (!on && rec.last_reachable_at) return { state: "off", text: `${copy}. The cabinet has been off since ${new Date(rec.last_reachable_at).toLocaleString()}, so there's nothing new to copy.`, last_ok_at: rec.last_ok_at ?? null };
  if (!on) return { state: "off", text: `${copy}. ${a.result === "no-card" ? "There's no Picade yet." : "The cabinet isn't on the network."}`, last_ok_at: rec.last_ok_at ?? null };
  return { state: "ok", text: `${copy}.${a.result !== "ok" ? ` The last try: ${a.result}, ${a.message}` : ""}`, last_ok_at: rec.last_ok_at ?? null };
}
