// The digital twin (D290-D297) against two data folders on this machine.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { bootEnd, folderEnd, seed, status, sync } from "../twin.mjs";

const TWIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../twin.mjs");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "twin-test-"));
/** @param {string} root @param {string} rel @param {string} text */
const put = (root, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const get = (/** @type {string} */ root, /** @type {string} */ rel) => fs.readFileSync(path.join(root, rel), "utf8");
const has = (/** @type {string} */ root, /** @type {string} */ rel) => fs.existsSync(path.join(root, rel));
/** Every file under a folder, for "nothing was deleted". @param {string} root */
const all = (root) => {
  const out = [];
  const visit = (/** @type {string} */ d) => {
    for (const n of fs.readdirSync(d)) {
      const f = path.join(d, n);
      if (fs.statSync(f).isDirectory()) visit(f);
      else out.push(path.relative(root, f));
    }
  };
  visit(root);
  return out.sort();
};

/** Today's virtual cabinet, in small: Tester's game, a session, the ledger, makers, a downloaded game, its own config bits. */
function virtualCabinet() {
  const d = tmp();
  put(d, "carts/rock-rain/cart.json", JSON.stringify({ title: "Rock Rain", maker: "tester", session_id: "sesn_0165" }));
  put(d, "carts/rock-rain/spec.md", "# Rock Rain\n");
  put(d, "carts/rock-rain/game.js", "// v1\n");
  put(d, "carts/.git/HEAD", "ref: refs/heads/main\n");
  put(d, "carts/.git/refs/heads/main", "aaaa\n");
  put(d, "sessions/sesn_0165/events.jsonl", '{"type":"start"}\n');
  put(d, "logs/coin_ledger.jsonl", '{"kind":"make","maker":"tester","cents":19}\n');
  put(d, "logs/studio_turn.jsonl", '{"turn":1}\n');
  put(d, "makers.json", JSON.stringify([{ id: "tester", name: "Tester" }]));
  put(d, "guests/teti/guest.json", "{}\n");
  put(d, "guests/teti/play/index.html", "<p>teti</p>\n");
  // Its own, never copied (D292).
  put(d, "kit-uploads.json", '{"file":"file_virtual"}\n');
  put(d, "cabinet-state.json", '{"intro_seen_at":"2026-11-08"}\n');
  put(d, "chromium/Default/Cookies", "cache\n");
  return d;
}

test("seed: a new real cabinet starts as a copy of the twin's games, makers, ledger, logs and downloaded games, and nothing of its own", () => {
  const twin = virtualCabinet();
  const real = tmp();
  put(real, "cabinet-state.json", "{}\n"); // a fresh cabinet's own file: not data, doesn't block
  const r = seed(folderEnd(real), folderEnd(twin), new Date("2026-11-12T10:00:00Z"));
  assert.ok(r.copied >= 10);
  for (const rel of ["carts/rock-rain/game.js", "carts/.git/refs/heads/main", "sessions/sesn_0165/events.jsonl", "logs/coin_ledger.jsonl", "makers.json", "guests/teti/play/index.html"]) assert.equal(get(real, rel), get(twin, rel), rel);
  assert.ok(!has(real, "kit-uploads.json") && !has(real, "chromium"), "per-cabinet files stay");
  assert.equal(get(real, "cabinet-state.json"), "{}\n");
  // Tester's data is told apart by twin-seed.json, on both sides.
  const rec = JSON.parse(get(real, "twin-seed.json"));
  assert.equal(rec.seeded_at, "2026-11-12T10:00:00.000Z");
  assert.deepEqual(rec.carts, ["rock-rain"]);
  assert.deepEqual(rec.makers, ["tester"]);
  assert.deepEqual(rec.sessions, ["sesn_0165"]);
  assert.equal(get(twin, "twin-seed.json"), get(real, "twin-seed.json"));
  const s = status(folderEnd(real), folderEnd(twin));
  assert.ok(s.inSync, JSON.stringify(s.files));
  assert.equal(s.seeded, "2026-11-12T10:00:00.000Z");
});

test("seed: once only, and never over a cabinet with data of its own", () => {
  const twin = virtualCabinet();
  const real = tmp();
  seed(folderEnd(real), folderEnd(twin));
  assert.throws(() => seed(folderEnd(real), folderEnd(twin)), /seeding happens once/);
  const used = tmp();
  put(used, "logs/play.jsonl", '{"kid":1}\n');
  assert.throws(() => seed(folderEnd(used), folderEnd(virtualCabinet())), /already has data of its own/);
  assert.equal(get(used, "logs/play.jsonl"), '{"kid":1}\n');
});

test("seed: --set-aside-real moves what bring-up checks left on the real cabinet aside, then copies (D298)", () => {
  const twin = virtualCabinet();
  const real = tmp();
  put(real, "logs/coin_ledger.jsonl", '{"kind":"bring-up"}\n'); // the same file the twin has, different content
  put(real, "logs/guest_play.jsonl", '{"guest":"teti"}\n'); // only on the real cabinet
  assert.throws(() => seed(folderEnd(real), folderEnd(twin)), /--set-aside-real/);
  const r = seed(folderEnd(real), folderEnd(twin), new Date("2026-11-12T10:00:00Z"), { setAsideReal: true });
  assert.equal(r.setAsideOnReal, 2);
  const aside = path.join(real, "twin-sync/set-aside/2026-11-12T10-00-00-000Z");
  assert.equal(get(aside, "logs/coin_ledger.jsonl"), '{"kind":"bring-up"}\n');
  assert.equal(get(aside, "logs/guest_play.jsonl"), '{"guest":"teti"}\n');
  assert.match(get(aside, "set-aside.jsonl"), /before the seed/);
  assert.ok(status(folderEnd(real), folderEnd(twin)).inSync);
  // Never once a seed has happened.
  put(real, "logs/later.jsonl", "{}\n");
  assert.throws(() => seed(folderEnd(real), folderEnd(twin), new Date(), { setAsideReal: true }), /already has data of its own/);
});

test("seed: refuses replay data and a make in flight (D150, D155)", () => {
  const twin = virtualCabinet();
  put(twin, "carts/penguin/cart.json", JSON.stringify({ session_id: "sesn_replay" }));
  assert.throws(() => seed(folderEnd(tmp()), folderEnd(twin)), /replay data/);
  const busy = virtualCabinet();
  put(busy, "studio-run.json", "{}");
  assert.throws(() => seed(folderEnd(tmp()), folderEnd(busy)), /make is running/);
});

test("sync: the real cabinet's new games, versions, sessions and log lines reach the twin, append-only", () => {
  const twin = virtualCabinet();
  const real = tmp();
  seed(folderEnd(real), folderEnd(twin));
  // The kids use the real cabinet.
  put(real, "carts/rock-rain-v2/cart.json", JSON.stringify({ title: "Rock Rain", maker: "owen" }));
  put(real, "carts/rock-rain-v2/game.js", "// v2\n");
  put(real, "carts/.git/refs/heads/main", "bbbb\n");
  put(real, "sessions/sesn_owen/events.jsonl", "{}\n");
  fs.appendFileSync(path.join(real, "logs/coin_ledger.jsonl"), '{"kind":"make","maker":"owen","cents":30}\n');
  put(real, "makers.json", JSON.stringify([{ id: "tester" }, { id: "owen" }]));
  put(real, "logs/guest_play.jsonl", "{}\n");
  put(real, "kit-uploads.json", '{"file":"file_picade"}\n');

  const before = status(folderEnd(real), folderEnd(twin));
  assert.equal(before.inSync, false);
  assert.deepEqual(before.shelf.onlySource, ["rock-rain-v2"]);
  assert.deepEqual(before.files.grown, ["logs/coin_ledger.jsonl"]);

  const r = sync(folderEnd(real), folderEnd(twin));
  assert.equal(r.appended, 1);
  assert.equal(r.setAside, 0, "the twin hadn't changed anything itself");
  assert.equal(get(twin, "logs/coin_ledger.jsonl"), get(real, "logs/coin_ledger.jsonl"));
  assert.equal(get(twin, "carts/rock-rain-v2/game.js"), "// v2\n");
  assert.equal(get(twin, "carts/.git/refs/heads/main"), "bbbb\n");
  assert.equal(get(twin, "makers.json"), get(real, "makers.json"));
  assert.equal(get(twin, "kit-uploads.json"), '{"file":"file_virtual"}\n', "each cabinet keeps its own identity");
  assert.ok(status(folderEnd(real), folderEnd(twin)).inSync);
  // Again: nothing to do.
  const again = sync(folderEnd(real), folderEnd(twin));
  assert.deepEqual([again.copied, again.appended, again.replaced, again.setAside], [0, 0, 0, 0]);
});

test("sync: what the twin made itself is set aside, never deleted, and never reaches the real cabinet", () => {
  const twin = virtualCabinet();
  const real = tmp();
  seed(folderEnd(real), folderEnd(twin));
  const realBefore = all(real).map((f) => [f, get(real, f)]);
  // A test make on the twin after the real cabinet exists.
  put(twin, "carts/test-game/cart.json", JSON.stringify({ maker: "tester" }));
  put(twin, "carts/.git/refs/heads/main", "cccc\n");
  fs.appendFileSync(path.join(twin, "logs/coin_ledger.jsonl"), '{"kind":"make","maker":"tester","cents":20}\n');
  // Meanwhile the real cabinet moves on too.
  fs.appendFileSync(path.join(real, "logs/coin_ledger.jsonl"), '{"kind":"make","maker":"alina","cents":25}\n');
  put(real, "carts/.git/refs/heads/main", "dddd\n");

  const s = status(folderEnd(real), folderEnd(twin));
  assert.deepEqual(s.shelf.onlyTarget, ["test-game"]);
  assert.deepEqual(s.files.extra.map((e) => e.reason), ["made on the twin"]);

  const r = sync(folderEnd(real), folderEnd(twin), new Date("2026-11-13T09:00:00Z"));
  assert.equal(r.setAside, 3, "the cart, the ref and the ledger the twin wrote");
  const aside = path.join(twin, "twin-sync/set-aside/2026-11-13T09-00-00-000Z");
  assert.equal(get(aside, "carts/.git/refs/heads/main"), "cccc\n");
  assert.match(get(aside, "logs/coin_ledger.jsonl"), /tester","cents":20/);
  assert.ok(has(aside, "carts/test-game/cart.json"));
  assert.match(get(aside, "set-aside.jsonl"), /changed on the twin/);
  // The twin now mirrors the real cabinet; the real cabinet was never written.
  assert.equal(get(twin, "logs/coin_ledger.jsonl"), get(real, "logs/coin_ledger.jsonl"));
  assert.equal(get(twin, "carts/.git/refs/heads/main"), "dddd\n");
  assert.ok(!has(twin, "carts/test-game"));
  assert.ok(status(folderEnd(real), folderEnd(twin)).inSync);
  for (const [f, text] of realBefore) if (f !== "logs/coin_ledger.jsonl" && f !== "carts/.git/refs/heads/main") assert.equal(get(real, f), text, f);
  assert.ok(!all(real).some((f) => f.includes("test-game")));
});

test("sync: a file that changes on the twin mid-sync is left for the next one, not overwritten", () => {
  const twin = virtualCabinet();
  const real = tmp();
  seed(folderEnd(real), folderEnd(twin));
  fs.appendFileSync(path.join(real, "logs/studio_turn.jsonl"), '{"turn":2}\n');
  const end = folderEnd(twin);
  const racing = { name: end.name, call: (/** @type {string} */ cmd, /** @type {any} */ input) => {
    if (cmd === "apply" && input.append.length) fs.appendFileSync(path.join(twin, "logs/studio_turn.jsonl"), '{"turn":"twin"}\n');
    return end.call(cmd, input);
  } };
  const r = sync(folderEnd(real), racing);
  assert.equal(r.skipped.length, 1);
  assert.match(get(twin, "logs/studio_turn.jsonl"), /"twin"/, "the twin's line is still there");
  // The next sync sets the twin's version aside and takes the real one.
  const r2 = sync(folderEnd(real), folderEnd(twin));
  assert.equal(r2.setAside, 1);
  assert.equal(get(twin, "logs/studio_turn.jsonl"), get(real, "logs/studio_turn.jsonl"));
});

test("sync: refuses while a make is running on the twin", () => {
  const twin = virtualCabinet();
  const real = tmp();
  seed(folderEnd(real), folderEnd(twin));
  put(twin, "studio-run.json", "{}");
  assert.throws(() => sync(folderEnd(real), folderEnd(twin)), /make is running on the twin/);
});

test("the helper runs as a cabinet runs it: sent on stdin, imported from a data: URL", () => {
  const twin = virtualCabinet();
  const real = tmp();
  seed(bootEnd(real), bootEnd(twin));
  put(real, "carts/new/cart.json", "{}");
  fs.appendFileSync(path.join(real, "logs/coin_ledger.jsonl"), "{}\n");
  sync(bootEnd(real), bootEnd(twin));
  assert.ok(status(bootEnd(real), bootEnd(twin)).inSync);
  assert.equal(get(twin, "carts/new/cart.json"), "{}");
});

test("the command: status, sync and seed on two folders", () => {
  const twin = virtualCabinet();
  const real = tmp();
  const run = (/** @type {string[]} */ args) => spawnSync(process.execPath, [TWIN, ...args], { encoding: "utf8" });
  assert.match(run(["seed", "--real-dir", real, "--twin-dir", twin]).stderr, /Add --yes/);
  assert.equal(run(["seed", "--real-dir", real, "--twin-dir", twin, "--yes"]).status, 0);
  put(real, "carts/x/cart.json", "{}");
  const st = run(["status", "--real-dir", real, "--twin-dir", twin]);
  assert.match(st.stdout, /1 only on the real cabinet \(x\)/);
  assert.match(st.stdout, /Out of sync/);
  const sy = run(["sync", "--real-dir", real, "--twin-dir", twin]);
  assert.match(sy.stdout, /1 new/);
  assert.match(sy.stdout, /In sync\./);
  assert.match(run(["status"]).stderr, /which real cabinet/);
});

test("sync: a real git cart library keeps every version on the twin, through new commits and a gc on the real cabinet", () => {
  const g = (/** @type {string} */ dir, /** @type {string[]} */ args) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const twin = virtualCabinet();
  fs.rmSync(path.join(twin, "carts/.git"), { recursive: true });
  g(path.join(twin, "carts"), ["init", "-q", "-b", "main"]);
  g(path.join(twin, "carts"), ["add", "-A"]);
  g(path.join(twin, "carts"), ["commit", "-q", "-m", "rock-rain v1"]);
  const real = tmp();
  seed(folderEnd(real), folderEnd(twin));
  for (const n of [2, 3]) {
    put(real, `carts/rock-rain-v${n}/game.js`, `// v${n}\n`);
    g(path.join(real, "carts"), ["add", "-A"]);
    g(path.join(real, "carts"), ["commit", "-q", "-m", `rock-rain v${n}`]);
  }
  g(path.join(real, "carts"), ["gc", "-q"]); // loose objects packed and removed on the real cabinet
  const r = sync(folderEnd(real), folderEnd(twin));
  assert.ok(r.setAside > 0, "objects gone from the real cabinet are set aside on the twin, not deleted");
  assert.ok(status(folderEnd(real), folderEnd(twin)).inSync);
  g(path.join(twin, "carts"), ["fsck", "--no-progress"]);
  assert.equal(g(path.join(twin, "carts"), ["log", "--format=%s"]), "rock-rain v3\nrock-rain v2\nrock-rain v1\n");
  assert.equal(g(path.join(twin, "carts"), ["status", "--porcelain"]), "");
});
