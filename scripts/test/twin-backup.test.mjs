// The hourly backup of the Picade (D350-D355): the run, its lock, its record, and the Manager's "last backup".
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

process.env.GSA_TWIN_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "twin-home-"));
const { backup, readRecord } = await import("../twin-backup/run.mjs");
const { backupDir, folderEnd, seed, withLock, Busy } = await import("../twin.mjs");
const { backupHealth, WARN_AFTER_MS } = await import("../../manager/backup.mjs");

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "twin-backup-test-"));
const put = (/** @type {string} */ root, /** @type {string} */ rel, /** @type {string} */ text) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const get = (/** @type {string} */ root, /** @type {string} */ rel) => fs.readFileSync(path.join(root, rel), "utf8");
/** A fresh twin home for each test, so records don't mix. */
const fresh = () => {
  process.env.GSA_TWIN_DIR = tmp();
};

function picade() {
  const d = tmp();
  put(d, "carts/rock-rain/cart.json", JSON.stringify({ maker: "owen" }));
  put(d, "logs/coin_ledger.jsonl", '{"kind":"refill"}\n');
  put(d, "makers.json", '[{"id":"owen"}]');
  put(d, "kit-uploads.json", "{}");
  return d;
}

test("a run copies the Picade into the backup folder on the mini and records it", async () => {
  fresh();
  const p = picade();
  const rec = await backup({ picade: () => folderEnd(p), twin: null, isReachable: async () => true, now: new Date("2026-11-14T10:00:00Z") });
  assert.equal(rec.last_attempt.result, "ok");
  assert.equal(rec.last_ok_at, "2026-11-14T10:00:00.000Z");
  assert.equal(rec.last_ok.games, 1);
  assert.equal(get(backupDir(), "carts/rock-rain/cart.json"), get(p, "carts/rock-rain/cart.json"));
  assert.ok(!fs.existsSync(path.join(backupDir(), "kit-uploads.json")), "per-cabinet files never (D292)");
  assert.deepEqual(readRecord(), rec);
  assert.match(fs.readFileSync(path.join(process.env.GSA_TWIN_DIR, "backup.log"), "utf8"), /"result":"ok"/);
});

test("the backup folder keeps every older copy the Picade replaced, not only the twin's own (D351)", async () => {
  fresh();
  const p = picade();
  const at = (/** @type {string} */ t) => ({ picade: () => folderEnd(p), twin: null, isReachable: async () => true, now: new Date(t) });
  await backup(at("2026-11-14T10:00:00Z"));
  put(p, "makers.json", '[{"id":"owen"},{"id":"alina"}]');
  fs.appendFileSync(path.join(p, "logs/coin_ledger.jsonl"), '{"kind":"make"}\n');
  const rec = await backup(at("2026-11-14T11:00:00Z"));
  assert.equal(rec.last_ok.kept_older, 1);
  assert.equal(rec.last_ok.grown, 1);
  assert.equal(get(backupDir(), "makers.json"), '[{"id":"owen"},{"id":"alina"}]');
  const aside = path.join(backupDir(), "twin-sync/set-aside/2026-11-14T11-00-00-000Z");
  assert.equal(get(aside, "makers.json"), '[{"id":"owen"}]');
  assert.match(get(aside, "set-aside.jsonl"), /an older copy/);
});

test("quiet when there's no card or the Picade is off; the last good copy stays", async () => {
  fresh();
  let rec = await backup({ picade: () => { throw new Error("no SSH key for the Picade"); }, twin: null });
  assert.equal(rec.last_attempt.result, "no-card");
  const p = picade();
  await backup({ picade: () => folderEnd(p), twin: null, isReachable: async () => true, now: new Date("2026-11-14T10:00:00Z") });
  rec = await backup({ picade: () => folderEnd(p), twin: null, isReachable: async () => false, now: new Date("2026-11-14T11:00:00Z") });
  assert.equal(rec.last_attempt.result, "unreachable");
  assert.equal(rec.last_ok_at, "2026-11-14T10:00:00.000Z");
  assert.equal(rec.last_reachable_at, "2026-11-14T10:00:00.000Z");
  // The command exits 0 for these.
  const r = spawnSync(process.execPath, [path.join(REPO, "scripts/twin-backup/run.mjs"), "--quiet", "--no-twin"], { encoding: "utf8", env: { ...process.env, GSA_CABINET_DIR: tmp() } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /no-card/);
});

test("never during a seed, and a seed never during a backup (D352)", async () => {
  fresh();
  const p = picade();
  const rec = await withLock("a seed", () => backup({ picade: () => folderEnd(p), twin: null, isReachable: async () => true }));
  // Re-entrant in one process, so test the other way with a lock another process holds.
  assert.equal(rec.last_attempt.result, "ok");
  const lock = path.join(process.env.GSA_TWIN_DIR, "lock");
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ pid: process.ppid, what: "a seed", at: new Date().toISOString() }));
  const busy = await backup({ picade: () => folderEnd(p), twin: null, isReachable: async () => true });
  assert.equal(busy.last_attempt.result, "busy");
  assert.match(busy.last_attempt.message, /a seed is running/);
  assert.throws(() => seed(folderEnd(tmp()), folderEnd(picade())), Busy);
  // A lock whose process is gone is taken over.
  fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ pid: 2 ** 22 + 7, what: "a seed", at: new Date().toISOString() }));
  assert.equal((await backup({ picade: () => folderEnd(p), twin: null, isReachable: async () => true })).last_attempt.result, "ok");
  assert.ok(!fs.existsSync(lock));
});

test("the twin follows too, and its trouble doesn't fail the backup", async () => {
  fresh();
  const p = picade();
  const twin = tmp();
  let rec = await backup({ picade: () => folderEnd(p), twin: () => folderEnd(twin), isReachable: async () => true });
  assert.equal(rec.twin.result, "ok");
  assert.equal(get(twin, "makers.json"), get(p, "makers.json"));
  put(twin, "studio-run.json", "{}");
  rec = await backup({ picade: () => folderEnd(p), twin: () => folderEnd(twin), isReachable: async () => true });
  assert.equal(rec.last_attempt.result, "ok");
  assert.equal(rec.twin.result, "skipped");
  assert.match(rec.twin.message, /make is running on the twin/);
});

test("the Manager's last backup: a clear warning only when the newest copy is over a day old and the cabinet is on (D353)", () => {
  const now = Date.parse("2026-11-15T12:00:00Z");
  const H = 3600_000;
  const rec = (/** @type {number} */ okAgo, /** @type {number} */ triedAgo, /** @type {string} */ result, /** @type {boolean | null} */ up) => ({
    last_ok_at: new Date(now - okAgo).toISOString(),
    last_ok: { games: 9, files: 300 },
    last_attempt: { at: new Date(now - triedAgo).toISOString(), result, message: "…", reachable: up },
    last_reachable_at: new Date(now - (up ? triedAgo : okAgo)).toISOString(),
  });
  assert.equal(backupHealth(rec(H / 2, H / 2, "ok", true), { now }).state, "ok");
  assert.match(backupHealth(rec(H / 2, H / 2, "ok", true), { now }).text, /Last backup 30 minutes ago \(9 games, 300 files\)/);
  // Off for two days: old, but nothing new to copy.
  assert.equal(backupHealth(rec(48 * H, H / 2, "unreachable", false), { now }).state, "off");
  // On, and the copy is over a day old: the backup is failing.
  const w = backupHealth(rec(WARN_AFTER_MS + H, H / 2, "error", true), { now });
  assert.equal(w.state, "warn");
  assert.match(w.text, /aren't backed up/);
  // On (the Manager sees it), but the hourly job hasn't run for a day: not installed, or the mini slept.
  const stopped = backupHealth(rec(30 * H, 30 * H, "ok", true), { now, live: true });
  assert.equal(stopped.state, "warn");
  assert.match(stopped.text, /hasn't run for 30 hours/);
  assert.equal(backupHealth(null, { now, live: true }).state, "warn");
  assert.equal(backupHealth(null, { now }).state, "none");
});

test("the Manager shows it for the Picade, not the virtual cabinet", async () => {
  const { createManager } = await import("../../manager/server.mjs");
  const dir = tmp();
  const file = path.join(dir, "backup.json");
  fs.writeFileSync(file, JSON.stringify({ last_ok_at: new Date().toISOString(), last_ok: { games: 3, files: 40 }, last_attempt: { at: new Date().toISOString(), result: "ok", message: "", reachable: true } }));
  const stand = (/** @type {string} */ label) => ({ config: { label, host: "h" }, problem: "", frame: null, canDrive: true, close() {} });
  const server = createManager({ key: "sesame", cabinets: new Map([["real", stand("Picade")], ["virtual", stand("Virtual")]]), backupRecord: file });
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(null)));
  try {
    const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;
    const cookie = (await fetch(`${base}/?key=sesame`, { redirect: "manual" })).headers.get("set-cookie")?.split(";")[0] ?? "";
    const j = await (await fetch(`${base}/api/cabinets`, { headers: { Cookie: cookie } })).json();
    const by = Object.fromEntries(j.cabinets.map((/** @type {any} */ c) => [c.name, c]));
    assert.equal(by.real.backup.state, "ok");
    assert.match(by.real.backup.text, /3 games/);
    assert.equal(by.virtual.backup, null);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(() => r(null)));
  }
  const html = fs.readFileSync(path.join(REPO, "manager/page/index.html"), "utf8");
  assert.match(html, /id="backup"/);
});

test("install.sh's agent: background, hourly, Node 22, this checkout's run.mjs; install refuses a worktree", () => {
  const r = spawnSync("/bin/bash", [path.join(REPO, "scripts/twin-backup/install.sh"), "--print"], { encoding: "utf8", env: { ...process.env, TWIN_BACKUP_NODE: process.execPath } });
  assert.equal(r.status, 0, r.stderr);
  const plist = r.stdout;
  for (const want of ["com.game-studio-arcade.twin-backup", "<integer>3600</integer>", "<string>Background</string>", "<key>LowPriorityIO</key><true/>", `${REPO}/scripts/twin-backup/run.mjs`, "--quiet"]) assert.ok(plist.includes(want), want);
  assert.ok(!/ANTHROPIC|api_key|<key>KeepAlive/.test(plist));
  const lint = spawnSync("plutil", ["-lint", "-"], { input: plist, encoding: "utf8" });
  assert.equal(lint.status, 0, lint.stdout);
  if (REPO.includes("/.claude/worktrees/")) {
    const real = spawnSync("/bin/bash", [path.join(REPO, "scripts/twin-backup/install.sh")], { encoding: "utf8", env: { ...process.env, TWIN_BACKUP_NODE: process.execPath, LAUNCH_AGENTS_DIR: tmp() } });
    assert.equal(real.status, 1);
    assert.match(real.stderr, /worktree/);
  }
});
