// Guests played by a player (D380-D386): the pinned players, the shortlisted candidates as
// built, and the build tool. Nothing here downloads: a rebuild runs only when the mini's
// player cache already holds the pinned files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { LOCK, KEYS, build, notice } from "../build.mjs";
import { listGuests } from "../../../cabinet/service/src/guests.js";
import { BUNDLE_PATHS } from "../../virtual-cabinet/lib.mjs";

const HERE = import.meta.dirname;
const REPO = resolve(HERE, "../../..");
const SHORTLIST = join(REPO, "guest-shortlist");
const CACHE = process.env.GSA_GUEST_PLAYERS || join(homedir(), "game-studio-data/guest-players");
const sha256 = (/** @type {string} */ f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const files = (/** @type {string} */ d) => readdirSync(d).sort();

test("the players are pinned: a version, a download and its sha256 each; every core says what it plays and its licence", () => {
  for (const name of ["tic80", "retroarch"]) {
    const l = LOCK[name];
    assert.match(l.version, /^\d+\.\d+\.\d+$/);
    assert.match(l.url, /^https:\/\//);
    assert.ok(l.url.includes(l.version) || l.url.includes(`v${l.version}`), `${name}'s url names its version`);
    assert.match(l.sha256, /^[0-9a-f]{64}$/);
    assert.ok(l.licence && l.source);
  }
  for (const [core, c] of Object.entries(LOCK.retroarch.cores)) {
    assert.ok(c.plays.length && c.licence && c.source, core);
    assert.match(c.js, /^[0-9a-f]{64}$/);
    assert.match(c.wasm, /^[0-9a-f]{64}$/);
    for (const system of c.plays) assert.ok(KEYS[system], `${system} has a key map`);
  }
});

test("the key maps use only the cabinet's keys (D82), and A and B are always Z and X", () => {
  const cabinet = new Set(["z", "x", "c", "v", "enter"]);
  for (const [system, keys] of Object.entries(KEYS)) {
    for (const [button, key] of Object.entries(keys)) assert.ok(cabinet.has(key), `${system} ${button}=${key}`);
    assert.equal(keys.a, "z");
    assert.equal(keys.b, "x");
    assert.equal(keys.start, "enter");
    assert.equal(new Set(Object.values(keys)).size, Object.values(keys).length, `${system}: one button per key`);
  }
});

test("the shortlist stays off the shelf and out of the bundle until Geoff picks (D385)", () => {
  assert.ok(!BUNDLE_PATHS.some((p) => p.startsWith("guest-shortlist")), "not in a cabinet's bundle");
  const shelf = new Set(listGuests(join(REPO, "guests")).map((g) => g.id));
  // A pick is a move: a folder is in guests/ or in the shortlist, never both.
  for (const g of listGuests(SHORTLIST)) assert.ok(!shelf.has(g.id), `${g.id} is in one place`);
});

for (const g of listGuests(SHORTLIST)) {
  test(`${g.id}: a complete guest, licence stated with its source, files as pinned`, () => {
    const m = g.meta;
    const play = join(g.dir, "play");
    assert.equal(m.kind, "web");
    assert.equal(m.entry, "index.html");
    assert.ok(m.by && m.version && m.players === 1);
    assert.ok(m.howToPlay.goal.length <= 90, "a goal that fits the how-to-play screen");
    assert.ok(m.howToPlay.controls.length >= 2 && m.howToPlay.controls.length <= 4);
    for (const line of m.howToPlay.controls) assert.doesNotMatch(line, /\b(key|keyboard|press [zxcv]\b)/i, "controls in the cabinet's words");
    // The licence: named, with where the author states it, and a link to the source.
    assert.ok(m.upstream.licence && m.upstream.licence_source && m.upstream.source);
    assert.doesNotMatch(m.upstream.licence, /NC|NonCommercial|proprietary|freeware/i, "freely redistributable");
    const noticeText = readFileSync(join(g.dir, "NOTICE.md"), "utf8");
    assert.equal(noticeText, notice(m, files(play)), "NOTICE.md is what the tool writes");
    assert.ok(noticeText.includes(m.upstream.file.sha256));
    // The game's file is the pinned one, unchanged.
    const game = m.player.name === "tic80" ? "cart.tic" : "rom.bin";
    assert.equal(sha256(join(play, game)), m.upstream.file.sha256);
    // The page that starts it is this repo's, as scripts/guests has it.
    const shim = join(HERE, "..", m.player.name);
    for (const f of files(shim).filter((f) => f !== "index.html")) assert.equal(sha256(join(play, f)), sha256(join(shim, f)), f);
    assert.ok(readFileSync(join(play, "index.html"), "utf8").includes(`<title>${m.title}</title>`));
    if (m.player.name === "retroarch") {
      const core = LOCK.retroarch.cores[m.player.core];
      assert.equal(sha256(join(play, `${m.player.core}_libretro.js`)), core.js);
      assert.equal(sha256(join(play, `${m.player.core}_libretro.wasm`)), core.wasm);
      const game = JSON.parse(readFileSync(join(play, "game.json"), "utf8"));
      assert.equal(game.id, g.id);
      assert.equal(game.core, m.player.core);
      assert.ok(core.plays.includes(game.rom_name.split(".").pop()));
      assert.equal(game.keys.a, "z");
    } else {
      assert.ok(existsSync(join(play, "tic80.js")));
      assert.ok(existsSync(join(play, `tic80${m.player.script}.wasm`)), "the player for the cart's language");
    }
    // Nothing reaches out: the pages name no other host.
    for (const f of ["index.html", ...files(shim).filter((f) => f.endsWith(".js"))]) assert.doesNotMatch(readFileSync(join(play, f), "utf8"), /https?:\/\//, f);
  });
}

test("the shortlist covers both players and all three cores", () => {
  const all = listGuests(SHORTLIST).map((g) => g.meta.player);
  assert.ok(all.filter((p) => p.name === "tic80").length >= 3);
  assert.deepEqual([...new Set(all.filter((p) => p.name === "retroarch").map((p) => p.core))].sort(), ["gambatte", "mgba", "nestopia"]);
});

const cached = existsSync(join(CACHE, `retroarch-${LOCK.retroarch.version}`, "gambatte_libretro.wasm")) && existsSync(join(CACHE, `tic80-${LOCK.tic80.version}`, "lua", "tic80.js"));
test("a rebuild from guest.json gives the same play/ folder, byte for byte", { skip: !cached && "the mini's player cache doesn't hold the pinned players" }, () => {
  for (const id of ["libbet", "grow-quickly"]) {
    const dir = join(mkdtempSync(join(tmpdir(), "gsa-guest-build-")), id);
    mkdirSync(dir, { recursive: true });
    cpSync(join(SHORTLIST, id, "guest.json"), join(dir, "guest.json"));
    const was = join(SHORTLIST, id, "play");
    build(dir, { file: join(was, id === "libbet" ? "rom.bin" : "cart.tic") });
    assert.deepEqual(files(join(dir, "play")), files(was));
    for (const f of files(was)) assert.equal(sha256(join(dir, "play", f)), sha256(join(was, f)), `${id} ${f}`);
    assert.equal(readFileSync(join(dir, "NOTICE.md"), "utf8"), readFileSync(join(SHORTLIST, id, "NOTICE.md"), "utf8"));
  }
});

test("a game file that isn't the pinned one is refused", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "gsa-guest-build-")), "libbet");
  mkdirSync(dir, { recursive: true });
  cpSync(join(SHORTLIST, "libbet", "guest.json"), join(dir, "guest.json"));
  const other = join(dir, "other.gb");
  writeFileSync(other, "not libbet");
  assert.throws(() => build(dir, { file: other }), /not guest\.json's/);
  assert.ok(!existsSync(join(dir, "play")), "nothing was written");
});

test("PICO-8 (D386): without Geoff's PICO-8 on the mini the tool stops and says what it needs; nothing of PICO-8's is in the repo", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "gsa-guest-build-")), "p8");
  mkdirSync(dir, { recursive: true });
  const cart = join(dir, "cart.p8");
  writeFileSync(cart, "pico-8 cartridge // http://www.pico-8.com\nversion 42\n__lua__\n");
  writeFileSync(join(dir, "guest.json"), JSON.stringify({ id: "p8", title: "p8", by: "x", version: "1", kind: "web", entry: "index.html", player: { name: "pico8" }, upstream: { licence: "CC BY-SA 4.0", file: { name: "cart.p8", sha256: sha256(cart) } } }));
  const r = spawnSync(process.execPath, [join(HERE, "../build.mjs"), dir, "--file", cart], { encoding: "utf8", env: { ...process.env, PICO8: "", GSA_PICO8_DIR: join(dir, "none") } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /PICO-8 isn't on this Mac/);
  assert.match(r.stderr, /never goes in git or on a cabinet/);
  assert.ok(!existsSync(join(dir, "play", "game.js")));
  const tracked = spawnSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8" }).stdout.split("\n");
  assert.deepEqual(tracked.filter((f) => /pico8(_dyn|_64)?$|pico8\.dat$|PICO-8\.app|pico-8.*\.zip$/i.test(f)), []);
});
