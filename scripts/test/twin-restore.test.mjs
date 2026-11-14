// The restore rehearsal (D354, D355): the Picade's card dies; a new card is built from the mini's backup alone,
// through the flash's own seed path (D324: seed into an empty folder, pack it as the flash does, unpack it as first
// boot does), and everything that matters comes back. Throwaway folders only, never a live cabinet's data.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

process.env.GSA_TWIN_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "twin-home-"));
const { backup } = await import("../twin-backup/run.mjs");
const { backupDir, folderEnd, seed } = await import("../twin.mjs");
const helper = await import("../../cabinet/twin/helper.mjs");
const { potStore } = await import("../../cabinet/service/src/pot.js");
const { makersStore } = await import("../../cabinet/service/src/makers.js");
const { listCarts } = await import("@game-studio-arcade/player/src/library.js");

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "twin-restore-"));
const put = (/** @type {string} */ root, /** @type {string} */ rel, /** @type {string} */ text) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const git = (/** @type {string} */ dir, /** @type {string[]} */ args) => execFileSync("git", ["-C", dir, "-c", "user.name=cabinet", "-c", "user.email=cabinet@arcade", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** A cart version as the cabinet commits it: a folder, its cart.json with maker and lineage, and a commit. */
function makeCart(/** @type {string} */ data, /** @type {string} */ id, /** @type {any} */ meta) {
  const dir = path.join(data, "carts", id);
  put(dir, "", "");
  fs.rmSync(dir, { recursive: true, force: true });
  put(dir, "cart.json", JSON.stringify({ id, title: meta.title, version: meta.version, maker: meta.maker, parent: meta.parent ?? null, family: meta.family ?? id, branch: meta.branch ?? "main", session_id: meta.session, created: meta.at }, null, 2));
  put(dir, "spec.md", `# ${meta.title}\n\nv${meta.version} by ${meta.maker}\n`);
  put(dir, "game.js", `// ${id} v${meta.version}\n`);
  put(dir, "assets/sprite.bin", Buffer.from([0, 1, 2, 3, meta.version]).toString("latin1"));
  git(path.join(data, "carts"), ["add", "-A"]);
  git(path.join(data, "carts"), ["commit", "-q", "-m", `${id} v${meta.version} by ${meta.maker}`]);
}

/** The Picade, a few weeks in: the twin's seed, the kids' games and changes, the pot, makers, logs, its own files. */
function livedInPicade() {
  const d = tmp();
  fs.mkdirSync(path.join(d, "carts"), { recursive: true });
  git(path.join(d, "carts"), ["init", "-q", "-b", "main"]);
  const at = (/** @type {string} */ iso) => () => new Date(iso);
  const makers = makersStore({ file: path.join(d, "makers.json"), now: at("2026-11-14T16:00:00Z") });
  makers.add("Tester");
  makers.add("Owen");
  makers.add("Alina");
  makers.ensureGrownUp("Geoff");
  put(d, "twin-seed.json", JSON.stringify({ seeded_at: "2026-11-13T12:00:00Z", carts: ["rock-rain"], makers: ["tester"] }));
  makeCart(d, "rock-rain", { title: "Rock Rain", version: 1, maker: "tester", session: "sesn_virtual_1", at: "2026-11-11" });
  makeCart(d, "rock-rain-v2", { title: "Rock Rain", version: 2, maker: "owen", parent: "rock-rain", family: "rock-rain", session: "sesn_picade_1", at: "2026-11-14" });
  makeCart(d, "star-hop", { title: "Star Hop", version: 1, maker: "alina", session: "sesn_picade_2", at: "2026-11-15" });
  makeCart(d, "star-hop-v2", { title: "Star Hop", version: 2, maker: "alina", parent: "star-hop", family: "star-hop", session: "sesn_picade_3", at: "2026-11-16" });
  // The pot, written by the service's own code: October, then November with charges, a top-up and a reset.
  let t = "2026-10-20T15:00:00Z";
  const pot = potStore({ logsDir: path.join(d, "logs"), now: () => new Date(t) });
  pot.charge({ maker: "tester", what: "new", session_id: "sesn_virtual_1", cost_cents: 19, outcome: "on the shelf", cart_id: "rock-rain", cart_version: 1 });
  t = "2026-11-14T16:00:00Z";
  pot.charge({ maker: "owen", what: "change", session_id: "sesn_picade_1", cost_cents: 14, outcome: "on the shelf", cart_id: "rock-rain-v2", cart_version: 2 });
  pot.topUp({ coins: 20, reason: "Owen helped clean the basement", by: "Geoff" });
  t = "2026-11-15T16:00:00Z";
  pot.charge({ maker: "alina", what: "new", session_id: "sesn_picade_2", cost_cents: 31, outcome: "on the shelf", cart_id: "star-hop", cart_version: 1 });
  pot.charge({ maker: "alina", what: "new", session_id: "sesn_picade_x", cost_cents: 8, outcome: "didn't pass its tests" });
  t = "2026-11-16T16:00:00Z";
  pot.charge({ maker: "alina", what: "change", session_id: "sesn_picade_3", cost_cents: 12, outcome: "on the shelf", cart_id: "star-hop-v2", cart_version: 2 });
  for (const s of ["sesn_picade_1", "sesn_picade_2", "sesn_picade_3"]) put(d, `sessions/${s}/events.jsonl`, `{"type":"session.status_idle","id":"${s}"}\n`);
  put(d, "logs/studio_session.jsonl", ['{"id":"sesn_picade_1","maker":"owen"}', '{"id":"sesn_picade_2","maker":"alina"}', '{"id":"sesn_picade_3","maker":"alina"}'].join("\n") + "\n");
  put(d, "logs/play.jsonl", '{"cart":"rock-rain-v2","duration_s":120}\n{"cart":"star-hop","duration_s":300,"scores":[41]}\n');
  put(d, "logs/screening.jsonl", '{"verdict":"ok"}\n');
  put(d, "guests/teti/guest.json", '{"title":"teti"}\n');
  put(d, "guests/teti/play/index.html", "<p>teti</p>\n");
  // Its own, which a new card makes afresh (D292).
  put(d, "kit-uploads.json", '{"file":"file_picade"}\n');
  put(d, "cabinet-state.json", '{"intro_seen_at":"2026-11-13","month_seen":"2026-11"}\n');
  put(d, "studio-left.json", "[]\n");
  return d;
}

/** The flash's path (D324), from a twin source: flash.mjs twinSnapshot, then first boot's step_twin_data. */
function flashFrom(/** @type {string} */ source) {
  const work = tmp();
  const dir = path.join(work, "twin-data");
  fs.mkdirSync(dir, { mode: 0o700 });
  const r = seed(folderEnd(dir), folderEnd(source), new Date("2026-11-17T09:00:00Z"));
  const payload = path.join(work, "payload");
  fs.mkdirSync(payload);
  execFileSync("tar", ["-czf", path.join(payload, "twin-data.tar.gz"), "--no-xattrs", "--no-mac-metadata", "-C", dir, "."], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  const data = path.join(work, "var-lib-arcade");
  const out = execFileSync("/bin/bash", ["-c", `log() { echo "[provision] $*"; }; PAYLOAD=${JSON.stringify(payload)}; DATA=${JSON.stringify(data)}; . ${JSON.stringify(path.join(REPO, "cabinet/provision/twin-data.sh"))}; step_twin_data`], { encoding: "utf8", env: { ...process.env, DATA_OWNER: "true" } });
  return { data, copied: r.copied, out };
}

const lines = (/** @type {string} */ f) => fs.readFileSync(f, "utf8").split("\n").filter(Boolean);

test("a dead card, rebuilt from the mini's backup alone: every version, maker, coin and log line comes back", async () => {
  const picade = livedInPicade();
  const run = (/** @type {string} */ iso) => backup({ picade: () => folderEnd(picade), twin: null, isReachable: async () => true, now: new Date(iso) });
  assert.equal((await run("2026-11-16T17:00:00Z")).last_attempt.result, "ok");
  // An hour of use, a gc on the cabinet, the next backup.
  makeCart(picade, "rock-rain-v3", { title: "Rock Rain", version: 3, maker: "alina", parent: "rock-rain-v2", family: "rock-rain", branch: "alina", session: "sesn_picade_4", at: "2026-11-16" });
  git(path.join(picade, "carts"), ["gc", "-q"]);
  potStore({ logsDir: path.join(picade, "logs"), now: () => new Date("2026-11-16T17:30:00Z") }).charge({ maker: "alina", what: "change", session_id: "sesn_picade_4", cost_cents: 16, outcome: "on the shelf", cart_id: "rock-rain-v3", cart_version: 3 });
  makersStore({ file: path.join(picade, "makers.json"), now: () => new Date("2026-11-16T17:30:00Z") }).touch("alina");
  fs.appendFileSync(path.join(picade, "logs/play.jsonl"), '{"cart":"rock-rain-v3","duration_s":60}\n');
  const last = await run("2026-11-16T18:00:00Z");
  assert.equal(last.last_attempt.result, "ok");
  assert.equal(last.last_ok.games, 5);

  // What the backup holds: the Picade at 18:00, file for file.
  const at1800 = helper.manifest(picade).files;
  // Then one more play after the last backup, and the card dies.
  fs.appendFileSync(path.join(picade, "logs/play.jsonl"), '{"cart":"star-hop-v2","duration_s":30}\n');

  // Rebuilt from the backup alone (the dead card's folder is never read again).
  const { data, out } = flashFrom(backupDir());
  assert.match(out, /the twin's data is here \(D324\): 5 games/);
  const restored = helper.manifest(data).files;

  // Byte for byte: every synced file as the 18:00 backup had it, and nothing else.
  assert.deepEqual(Object.keys(restored).sort(), Object.keys(at1800).sort());
  for (const [rel, f] of Object.entries(at1800)) assert.equal(restored[rel].hash, f.hash, rel);
  for (const own of ["kit-uploads.json", "cabinet-state.json", "studio-left.json"]) assert.ok(!fs.existsSync(path.join(data, own)), `${own} is the new card's own`);

  // Every cart version, through the library's git: whole, clean, every commit.
  const carts = path.join(data, "carts");
  git(carts, ["fsck", "--no-progress"]);
  assert.equal(git(carts, ["status", "--porcelain"]), "");
  assert.deepEqual(git(carts, ["log", "--format=%s"]).trim().split("\n"), ["rock-rain-v3 v3 by alina", "star-hop-v2 v2 by alina", "star-hop v1 by alina", "rock-rain-v2 v2 by owen", "rock-rain v1 by tester"]);

  // Makers and lineage, as the shelf reads them.
  const shelf = (/** @type {string} */ root) => listCarts([{ root: path.join(root, "carts"), source: "library" }]).map((c) => ({ id: c.id, version: c.version, maker: c.maker, parent: c.parent, family: c.family, branch: c.branch, session: c.session_id })).sort((a, b) => a.id.localeCompare(b.id));
  const before = shelf(picade);
  assert.deepEqual(shelf(data), before);
  assert.deepEqual(before.find((c) => c.id === "rock-rain-v3"), { id: "rock-rain-v3", version: 3, maker: "alina", parent: "rock-rain-v2", family: "rock-rain", branch: "alina", session: "sesn_picade_4" });
  assert.deepEqual(makersStore({ file: path.join(data, "makers.json") }).read(), makersStore({ file: path.join(picade, "makers.json") }).read());

  // The coin pot: the same ledger, so the same pot, this month's makers and last month, as the service computes them.
  const potOf = (/** @type {string} */ root) => potStore({ logsDir: path.join(root, "logs"), now: () => new Date("2026-11-17T10:00:00Z") });
  const deadLedger = lines(path.join(picade, "logs/coin_ledger.jsonl"));
  assert.deepEqual(lines(path.join(data, "logs/coin_ledger.jsonl")), deadLedger);
  assert.deepEqual(potOf(data).state(), potOf(picade).state());
  assert.equal(potOf(data).state().coins, potOf(picade).state().coins);

  // What's lost: only what happened after the last backup (here, one play line), as D355 says.
  assert.equal(lines(path.join(data, "logs/play.jsonl")).length, lines(path.join(picade, "logs/play.jsonl")).length - 1);
});

test("restore refuses the virtual cabinet's own test makes: the backup folder is a pure copy of the Picade", async () => {
  // The twin VM also holds test makes of its own until its next sync (D294); the backup folder never does,
  // because nothing but sync writes it. So a restore is from the backup, not the twin (D354).
  const picade = livedInPicade();
  await backup({ picade: () => folderEnd(picade), twin: null, isReachable: async () => true, now: new Date("2026-11-16T17:00:00Z") });
  const notes = helper.info(backupDir());
  assert.equal(notes.makeInFlight, false);
  assert.deepEqual(helper.manifest(backupDir()).notCovered, []);
  assert.deepEqual(Object.keys(helper.manifest(backupDir()).files).sort(), Object.keys(helper.manifest(picade).files).sort());
});
