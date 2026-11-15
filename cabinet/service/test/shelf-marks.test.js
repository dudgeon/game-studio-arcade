// Off the shelf, kept in the records (D360-D363): the marks file, the service's lists, the Manager's endpoints, the MCP tools.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { dataPaths } from "@game-studio-arcade/studio-cli/src/config.js";
import { commitNewCart } from "@game-studio-arcade/studio-cli/src/library.js";
import { listCarts } from "@game-studio-arcade/player/src/library.js";
import { makersStore } from "../src/makers.js";
import { shelfMarks, gameLines, MARKS_FILE } from "../src/shelf-marks.js";
import { createArcadeMcp } from "../src/arcade-mcp.js";
import { startService } from "../src/server.js";
import { stubSpeech } from "../src/speech.js";

const FIXTURE = path.resolve(import.meta.dirname, "../../../studio-kit/cli/fixtures/penguin-catch/cart");
const BASE = JSON.parse(fs.readFileSync(path.join(FIXTURE, "cart.json"), "utf8"));
const TOKEN = "t".repeat(40);
const MODERN = { "io.modelcontextprotocol/protocolVersion": "2026-07-28" };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "gsa-marks-"));

/** A library: Rock Rain v1 and v2 (one line), Snowball Drop (Milo's version of it, its own line), Frog. */
function library() {
  const paths = dataPaths(tmp());
  const makers = makersStore({ file: path.join(paths.root, "makers.json") });
  makers.add("Ivy");
  makers.add("Milo");
  const cart = (/** @type {any} */ extra) => commitNewCart({ root: paths.carts, cartDir: FIXTURE, cartJson: { ...BASE, ...extra }, message: "make {id}" }).id;
  cart({ id: "rock-rain", title: "Rock Rain", maker: "ivy", version: 1, created: "2026-11-10T10:00:00Z" });
  cart({ id: "rock-rain-v2", title: "Rock Rain", maker: "ivy", version: 2, branch: "rock-rain", family: "rock-rain", parent: "rock-rain@1", created: "2026-11-11T10:00:00Z" });
  cart({ id: "snowball-drop", title: "Snowball Drop", maker: "milo", version: 1, family: "rock-rain", parent: "rock-rain-v2@2", created: "2026-11-12T10:00:00Z" });
  cart({ id: "frog", title: "Frog", maker: "milo", version: 1, created: "2026-11-09T10:00:00Z" });
  fs.mkdirSync(paths.logs, { recursive: true });
  fs.appendFileSync(path.join(paths.logs, "play.jsonl"), JSON.stringify({ type: "play", cart_id: "rock-rain-v2", started_at: "2026-11-12T20:00:00Z", score: 7 }) + "\n");
  const marks = shelfMarks({ logsDir: paths.logs });
  return { paths, makers, marks };
}

async function service(lib) {
  const s = await startService({
    studio: /** @type {any} */ ({ state: () => ({ phase: "idle" }), start() {}, subscribe: () => () => {} }),
    makers: lib.makers,
    marks: lib.marks,
    speech: stubSpeech(),
    libraryDir: lib.paths.carts,
    logsDir: lib.paths.logs,
    managerToken: TOKEN,
    port: 0,
  });
  const get = async (/** @type {string} */ p, auth = false) => (await fetch(`${s.url}${p}`, { headers: auth ? { Authorization: `Bearer ${TOKEN}` } : {} })).json();
  const post = async (/** @type {string} */ p, /** @type {any} */ body, auth = true) => {
    const r = await fetch(`${s.url}${p}`, { method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${TOKEN}` } : {}) }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  return { s, get, post };
}

test("marks: none at first; remove and restore append; the last wins; a repeat changes nothing", () => {
  const dir = tmp();
  let t = Date.parse("2026-11-13T10:00:00Z");
  const m = shelfMarks({ logsDir: dir, now: () => new Date((t += 1000)) });
  assert.equal(m.off("game").size, 0);
  assert.equal(fs.existsSync(path.join(dir, MARKS_FILE)), false);
  assert.equal(m.mark({ kind: "game", target: "rock-rain", action: "remove", by: "geoff", via: "manager", reason: "a test game" }).changed, true);
  assert.equal(m.cartOff({ id: "rock-rain-v2", branch: "rock-rain" }), true);
  assert.equal(m.cartOff({ id: "snowball-drop" }), false);
  assert.equal(m.mark({ kind: "game", target: "rock-rain", action: "remove", via: "manager" }).changed, false);
  assert.equal(m.mark({ kind: "game", target: "rock-rain", action: "restore", by: "geoff", via: "mcp" }).changed, true);
  assert.equal(m.cartOff({ id: "rock-rain" }), false);
  const lines = fs.readFileSync(path.join(dir, MARKS_FILE), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => [l.type, l.kind, l.target, l.action, l.via]), [["shelf_mark", "game", "rock-rain", "remove", "manager"], ["shelf_mark", "game", "rock-rain", "restore", "mcp"]]);
  assert.match(lines[0].id, /^sm_[a-z0-9]+$/);
  assert.equal(lines[0].reason, "a test game");
  assert.throws(() => m.mark({ kind: /** @type {any} */ ("cart"), target: "x", action: "remove", via: "manager" }));
  assert.throws(() => m.mark({ kind: "game", target: "../etc", action: "remove", via: "manager" }));
});

test("marks: the day-one card's lines (any via) are read, and a bad line is skipped (D360)", () => {
  const dir = tmp();
  fs.writeFileSync(
    path.join(dir, MARKS_FILE),
    [
      { type: "shelf_mark", id: "sm_a", at: "2026-11-13T00:00:00Z", kind: "game", target: "rock-rain", action: "remove", by: "geoff", via: "day-one", reason: "day-one card" },
      "not json",
      { type: "shelf_mark", id: "sm_b", at: "2026-11-13T00:00:00Z", kind: "maker", target: "tester", action: "remove", by: "geoff", via: "day-one", reason: "" },
    ].map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n") + "\n",
  );
  const m = shelfMarks({ logsDir: dir });
  assert.equal(m.off("game").get("rock-rain").via, "day-one");
  assert.equal(m.makerOff("tester"), true);
});

test("game lines: versions, lineage, last played, on or off (D361, D362)", () => {
  const lib = library();
  lib.marks.mark({ kind: "game", target: "rock-rain", action: "remove", by: "geoff", via: "manager", reason: "test" });
  const g = gameLines(listCarts([{ root: lib.paths.carts, source: "library" }]), lib.marks, { plays: [{ cart_id: "rock-rain-v2", started_at: "2026-11-12T20:00:00Z" }, { cart_id: "frog", started_at: "2026-11-10T08:00:00Z" }], makerName: (id) => lib.makers.get(id)?.name ?? null });
  assert.deepEqual(
    g.map((x) => [x.id, x.title, x.maker_name, x.versions, x.newest.id, x.from, x.from_off, x.plays, x.on_shelf]),
    [
      ["snowball-drop", "Snowball Drop", "Milo", 1, "snowball-drop", "rock-rain", true, 0, true],
      ["rock-rain", "Rock Rain", "Ivy", 2, "rock-rain-v2", null, false, 1, false],
      ["frog", "Frog", "Milo", 1, "frog", null, false, 1, true],
    ],
  );
  assert.deepEqual({ ...g[1].off, at: null }, { at: null, by: "geoff", via: "manager", reason: "test" });
});

test("the service: a removed game leaves the shelf with all its versions; a kid's version stays; Put back restores it (D361, D362)", async () => {
  const lib = library();
  const { s, get, post } = await service(lib);
  try {
    const before = (await get("/api/carts")).carts.map((/** @type {any} */ c) => c.id).sort();
    assert.deepEqual(before, ["frog", "rock-rain", "rock-rain-v2", "snowball-drop"]);

    // Grown-ups only: without the Manager's token, nothing.
    assert.equal((await post("/api/manager/games/remove", { id: "rock-rain" }, false)).status, 401);
    assert.equal((await post("/api/manager/games/remove", { id: "nope" })).status, 404);

    const r = await post("/api/manager/games/remove", { id: "rock-rain", reason: "a test game", by: "geoff" });
    assert.equal(r.status, 200);
    assert.equal(r.body.changed, true);
    assert.equal(r.body.game.on_shelf, false);
    assert.deepEqual((await get("/api/carts")).carts.map((/** @type {any} */ c) => c.id).sort(), ["frog", "snowball-drop"]);

    // Nothing erased: the files and the library's history are as they were.
    assert.ok(fs.existsSync(path.join(lib.paths.carts, "rock-rain", "game.js")));
    assert.ok(fs.existsSync(path.join(lib.paths.carts, "rock-rain-v2", "game.js")));
    assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: lib.paths.carts, encoding: "utf8" }), "");

    // A change of a game that's off is refused.
    const change = await post("/api/studio/start", { maker: "milo", request: "make it faster", parent: "rock-rain-v2@2" }, false);
    assert.equal(change.status, 409);

    // The Manager's list has every game, on and off, with lineage.
    const games = (await get("/api/manager/games", true)).games;
    const byId = Object.fromEntries(games.map((/** @type {any} */ x) => [x.id, x]));
    assert.deepEqual(Object.keys(byId).sort(), ["frog", "rock-rain", "snowball-drop"]);
    assert.deepEqual([byId["rock-rain"].versions, byId["rock-rain"].on_shelf, byId["rock-rain"].off.reason, byId["rock-rain"].off.by], [2, false, "a test game", "geoff"]);
    assert.deepEqual([byId["rock-rain"].plays, byId["rock-rain"].last_played, byId["rock-rain"].maker_name], [1, "2026-11-12T20:00:00Z", "Ivy"]);
    assert.deepEqual([byId["snowball-drop"].from, byId["snowball-drop"].from_off, byId["snowball-drop"].on_shelf], ["rock-rain", true, true]);

    const back = await post("/api/manager/games/restore", { id: "rock-rain", by: "geoff" });
    assert.equal(back.body.game.on_shelf, true);
    assert.deepEqual((await get("/api/carts")).carts.map((/** @type {any} */ c) => c.id).sort(), before);
    const history = (await get("/api/manager/games", true)).history;
    assert.deepEqual(history.map((/** @type {any} */ h) => h.action), ["restore", "remove"]);
  } finally {
    await s.close();
  }
});

test("the service: a hidden maker leaves 'Who's making?' and comes back (D363)", async () => {
  const lib = library();
  const { s, get, post } = await service(lib);
  try {
    assert.deepEqual((await get("/api/makers")).makers.map((/** @type {any} */ m) => m.id).sort(), ["ivy", "milo"]);
    assert.equal((await post("/api/manager/makers/hide", { id: "milo", reason: "test name" })).status, 200);
    const after = await get("/api/makers");
    assert.deepEqual(after.makers.map((/** @type {any} */ m) => m.id), ["ivy"]);
    // The shelf still says "by Milo" on their games.
    assert.equal(after.names.milo, "Milo");
    const all = (await get("/api/manager/makers", true)).makers;
    assert.deepEqual(all.find((/** @type {any} */ m) => m.id === "milo").on_list, false);
    assert.equal(all.find((/** @type {any} */ m) => m.id === "milo").off.reason, "test name");
    // Their games stay on the shelf.
    assert.ok((await get("/api/carts")).carts.some((/** @type {any} */ c) => c.maker === "milo"));
    assert.equal((await post("/api/manager/makers/hide", { id: "nobody" })).status, 404);
    await post("/api/manager/makers/show", { id: "milo" });
    assert.deepEqual((await get("/api/makers")).makers.map((/** @type {any} */ m) => m.id).sort(), ["ivy", "milo"]);
  } finally {
    await s.close();
  }
});

test("MCP: remove_from_shelf and restore_to_shelf take the whole line; list_carts says what's off (D360, D362)", async () => {
  const lib = library();
  const mcp = createArcadeMcp({ paths: lib.paths, makers: lib.makers, marks: lib.marks, checker: /** @type {any} */ ({}), online: () => true, status: () => ({}) });
  let n = 0;
  const call = async (/** @type {string} */ name, /** @type {any} */ args) => {
    const r = await mcp.handle({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args, _meta: MODERN } });
    return r.result;
  };
  const r = await call("remove_from_shelf", { id: "rock-rain-v2", reason: "test game", by: "geoff" });
  const out = r.structuredContent ?? JSON.parse(r.content[0].text);
  assert.deepEqual([out.game, out.on_shelf, out.changed, out.versions.sort(), out.other_versions_stay], ["rock-rain", false, true, ["rock-rain", "rock-rain-v2"], ["snowball-drop"]]);
  assert.equal(lib.marks.off("game").get("rock-rain").via, "mcp");
  const list = await call("list_carts", {});
  const carts = (list.structuredContent ?? JSON.parse(list.content[0].text)).carts;
  const v2 = carts.find((/** @type {any} */ c) => c.id === "rock-rain-v2");
  assert.deepEqual([v2.on_shelf, v2.off_shelf.reason, v2.line], [false, "test game", "rock-rain"]);
  assert.equal(carts.find((/** @type {any} */ c) => c.id === "snowball-drop").on_shelf, true);
  const again = await call("restore_to_shelf", { id: "rock-rain" });
  assert.equal((again.structuredContent ?? JSON.parse(again.content[0].text)).on_shelf, true);
  assert.equal(lib.marks.cartOff({ id: "rock-rain" }), false);
  const bad = await call("remove_from_shelf", { id: "nope" });
  assert.equal(bad.isError, true);
});
