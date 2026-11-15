// Version names (D471-D474): the name question on the question board, the name in
// cart.json, the spec and the logs, and what every screen calls a version, named or not.
// Through a real make on the replay of Tester's recorded change, which now asks the name.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dataPaths } from "@game-studio-arcade/studio-cli/src/config.js";
import { readLog } from "@game-studio-arcade/studio-cli/src/log.js";
import { readCart } from "@game-studio-arcade/player/src/library.js";
import { parseSpec } from "@game-studio-arcade/spec";
import { createStudio } from "../src/studio.js";
import { gameLines, shelfMarks } from "../src/shelf-marks.js";
import { replayApi, REPLAY_LOCK } from "../test-support/replay-api.js";
import { makingTitle, readyWords, shelfTag, versionRow, versionWords, YOU_PICK } from "../launcher/version-name.js";
import { gameRows } from "../launcher/shelf.js";
import { cardView } from "../launcher/boards.js";

const FIXTURES = path.resolve(import.meta.dirname, "../../../studio-kit/cli/fixtures");
const MAKE = path.join(FIXTURES, "penguin-catch");
const CHANGE = path.join(FIXTURES, "log-hopper-change");
const passing = {
  async validate() {
    return { ok: true, problems: [] };
  },
  async playtest() {
    return { ok: true, failing: [], report: { rules: [], generic: [] } };
  },
};

/** A Studio on the replay, with one game on the shelf: Ivy's Penguin Catch. @param {{ names?: string[] }} [o] */
function studioWith(o = {}) {
  const paths = dataPaths(fs.mkdtempSync(path.join(os.tmpdir(), "gsa-names-")));
  const parent = { id: "penguin-catch", dir: path.join(MAKE, "cart"), version: 1, maker: "ivy", title: "Penguin Catch", session_id: null, version_name: null, names: o.names ?? [] };
  const studio = createStudio({
    paths,
    api: async (/** @type {any} */ _r, /** @type {any} */ what) => replayApi({ dir: what?.kind === "change" ? CHANGE : MAKE }).api,
    lock: () => REPLAY_LOCK,
    kit: async () => ({ fileId: "file_k", hash: "h" }),
    checker: passing,
    titleOf: () => "Penguin Catch",
    nameOf: (id) => id[0].toUpperCase() + id.slice(1),
    findCart: (id) => (id === parent.id ? parent : null),
  });
  const until = (/** @type {(s: any) => boolean} */ pred) =>
    new Promise((resolve) => {
      if (pred(studio.state())) return resolve(studio.state());
      const alive = setInterval(() => {}, 20);
      const stop = studio.subscribe((s) => {
        if (pred(s)) {
          clearInterval(alive);
          stop();
          resolve(s);
        }
      });
    });
  /** Answer everything A and build; the name question gets `name`. Returns the result and what the name question showed. @param {{ choice: string, said?: string }} name */
  const runThrough = async (name) => {
    /** @type {any} */
    let asked = null;
    for (;;) {
      const s = /** @type {any} */ (await until((x) => x.pending || x.results?.length));
      if (s.results?.length) return { result: s.results[s.results.length - 1], asked };
      if (s.pending.naming) {
        asked = s.pending;
        studio.answer({ id: s.pending.id, ...name });
      } else studio.answer({ id: s.pending.id, choice: s.pending.kind === "plan" ? "build" : "A" });
    }
  };
  const cartOf = (/** @type {string} */ id) => JSON.parse(fs.readFileSync(path.join(paths.carts, id, "cart.json"), "utf8"));
  const specOf = (/** @type {string} */ id) => fs.readFileSync(path.join(paths.carts, id, "spec.md"), "utf8");
  const logged = (/** @type {string} */ type) => readLog(path.join(paths.logs, `${type}.jsonl`));
  return { paths, studio, until, runThrough, cartOf, specOf, logged };
}

test("the name question comes on the question board after Build it!, and a tile's name is the version's (D471, D472)", async () => {
  const { studio, runThrough, cartOf, specOf, logged, paths } = studioWith();
  studio.start({ maker: "ivy", request: "make the logs float a bit faster", parent: "penguin-catch" });
  const { result, asked } = await runThrough({ choice: "A" });
  // The board the kids know: Claude's two names as A and B; the launcher draws C and D.
  assert.equal(asked.kind, "question");
  assert.equal(asked.naming, true);
  assert.equal(asked.question, "What should this version be called?");
  assert.deepEqual([asked.option_a, asked.option_b], ["Faster logs", "Turbo river"]);
  // R8 and the shelf get the name; the number is still the order.
  assert.equal(result.ok, true);
  assert.equal(result.version, 2);
  assert.equal(result.version_name, "Faster logs");
  assert.equal(result.cart_id, "penguin-catch-v2");
  // cart.json and the spec's Changelog carry it (D472), and the cart still validates as a spec.
  assert.equal(cartOf("penguin-catch-v2").version_name, "Faster logs");
  const spec = parseSpec(specOf("penguin-catch-v2"));
  assert.deepEqual(spec.errors, []);
  assert.equal(/** @type {any} */ (spec.changelog.find((c) => c.id === "v2")).name, "Faster logs");
  assert.equal(readCart(paths.carts, "penguin-catch-v2")?.version_name, "Faster logs");
  // The log says what it's called, who named it and how.
  const v = logged("cart_version").at(-1);
  assert.deepEqual([v.cart_id, v.version, v.version_name, v.named_by, v.name_picked], ["penguin-catch-v2", 2, "Faster logs", "ivy", "tile"]);
  const session = logged("studio_session").at(-1);
  assert.equal(session.version_name, "Faster logs");
  assert.deepEqual(session.name_turn, { option_a: "Faster logs", option_b: "Turbo river", pick: "A", choice: "A", said: null, name: "Faster logs", picked: "tile" });
  // The name question isn't one of the game's questions.
  assert.ok(!session.turns.some((/** @type {any} */ t) => /called/.test(t.question)));
});

test("R7 says what's being made once the name is picked", async () => {
  const { studio, until } = studioWith();
  studio.start({ maker: "ivy", request: "faster logs", parent: "penguin-catch" });
  for (;;) {
    const s = /** @type {any} */ (await until((x) => x.pending));
    assert.equal(s.version_name, undefined, "no name before it's picked");
    studio.answer({ id: s.pending.id, choice: s.pending.naming ? "B" : s.pending.kind === "plan" ? "build" : "A" });
    if (s.pending.naming) break;
  }
  const named = /** @type {any} */ (await until((x) => x.version_name || x.phase === "idle"));
  assert.equal(named.version_name, "Turbo river");
  assert.equal(makingTitle(named.version_name), "Making Turbo river");
  await until((x) => x.results?.length);
});

test("Something else: the maker's own name, tidied; You pick: Claude's choice (D471)", async () => {
  const said = studioWith();
  said.studio.start({ maker: "ivy", request: "faster logs", parent: "penguin-catch" });
  const a = await said.runThrough({ choice: "C", said: "  turbo frog. " });
  assert.equal(a.result.version_name, "Turbo frog");
  assert.equal(said.logged("cart_version").at(-1).name_picked, "said");
  assert.equal(said.logged("studio_session").at(-1).name_turn.said, "turbo frog.");

  const pick = studioWith();
  pick.studio.start({ maker: "ivy", request: "faster logs", parent: "penguin-catch" });
  const b = await pick.runThrough({ choice: "D" });
  assert.equal(b.result.version_name, "Faster logs", "the recording's pick is A");
  assert.equal(pick.logged("cart_version").at(-1).name_picked, "claude");
});

test("a name is the version's own: one the game has used, or its title, isn't taken again (D473)", async () => {
  // A used name on a tile: the cabinet gives none, and the version shows by its number, as before names.
  const used = studioWith({ names: ["faster LOGS"] });
  used.studio.start({ maker: "ivy", request: "faster logs", parent: "penguin-catch" });
  const a = await used.runThrough({ choice: "A" });
  assert.equal(a.result.ok, true, "a name never stops a game");
  assert.equal(a.result.version_name, undefined);
  assert.equal(used.cartOf("penguin-catch-v2").version_name, undefined);
  assert.equal(used.logged("cart_version").at(-1).version_name, undefined);
  // You pick skips a used name for Claude's other one.
  const other = studioWith({ names: ["Faster logs"] });
  other.studio.start({ maker: "ivy", request: "faster logs", parent: "penguin-catch" });
  assert.equal((await other.runThrough({ choice: "D" })).result.version_name, "Turbo river");
  // The game's title isn't a version's name, and neither is something too long to show.
  for (const words of ["Penguin Catch", "the one where every log goes much faster"]) {
    const s = studioWith();
    s.studio.start({ maker: "ivy", request: "faster logs", parent: "penguin-catch" });
    assert.equal((await s.runThrough({ choice: "C", said: words })).result.version_name, undefined, words);
  }
});

test("someone else's change takes the game's title: no name question, no name (D471)", async () => {
  const { studio, runThrough, cartOf, logged } = studioWith();
  studio.start({ maker: "milo", request: "faster logs", parent: "penguin-catch" });
  const { result, asked } = await runThrough({ choice: "A" });
  assert.equal(asked, null, "the question board never asked for a name");
  assert.equal(result.version, 1);
  assert.equal(result.version_name, undefined);
  assert.equal(cartOf(result.cart_id).version_name, undefined);
  assert.ok(logged("studio_session").at(-1).notes.includes("named_a_version_that_takes_its_title"));
});

test("what the screens call a version, named or not (D474)", () => {
  const named = { version: 3, version_name: "Faster logs" };
  const old = { version: 2 };
  const first = { version: 1 };
  // S1: the name is the tag; an unnamed version keeps "v2"; a first version has none.
  assert.deepEqual([shelfTag(named), shelfTag(old), shelfTag(first)], ["Faster logs", "v2", null]);
  assert.deepEqual([versionWords(3, "Faster logs"), versionWords(2, null), versionWords(undefined)], ["Faster logs", "Version 2", "Version 1"]);
  // S3: the number small beside the name; an unnamed row as it was.
  assert.deepEqual(versionRow(named, true, "Nov 14"), { text: "Faster logs (newest)", note: "v3 Nov 14" });
  assert.deepEqual(versionRow(old, false, "Nov 12"), { text: "Version 2", note: "Nov 12" });
  // R7, R8.
  assert.deepEqual([makingTitle("Faster logs"), makingTitle(null)], ["Making Faster logs", "Changing your game"]);
  assert.deepEqual(readyWords({ version: 3, version_name: "Faster logs", parent: { version: 2, version_name: "Bigger frog" } }), { title: "Faster logs is ready!", saved: "Bigger frog is still saved." });
  assert.deepEqual(readyWords({ version: 3, version_name: "Faster logs", parent: { version: 2 } }), { title: "Faster logs is ready!", saved: "Version 2 is still saved." });
  assert.deepEqual(readyWords({ version: 2 }), { title: "Version 2 is ready!", saved: "Version 1 is still saved." });
  assert.deepEqual(readyWords({ version: 1, parent: { maker_name: "Ivy" } }), { title: "Your own version is ready!", saved: "Ivy's game stays the same." });
  assert.equal(YOU_PICK, "You pick");
});

test("the shelf row, the versions list and the Manager's games show the name; old carts show as they did", () => {
  const cart = (/** @type {any} */ o) => ({ title: "Log Hopper", maker: "ivy", parent: null, family: "log-hopper", branch: "log-hopper", created: "2026-11-14T10:00:00Z", plays: 1, ...o });
  const carts = [cart({ id: "log-hopper", version: 1, created: "2026-11-10T10:00:00Z" }), cart({ id: "log-hopper-v2", version: 2, parent: "log-hopper@1", created: "2026-11-12T10:00:00Z" }), cart({ id: "log-hopper-v3", version: 3, version_name: "Faster logs", parent: "log-hopper-v2@2" })];
  const rows = gameRows(carts, () => "Ivy");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].version, "Faster logs");
  assert.equal(gameRows(carts.slice(0, 2), () => "Ivy")[0].version, "v2");
  const card = cardView({ cart: carts[2], family: rows[0].family, line: rows[0].line, nameOf: () => "Ivy", usual: { change: 2 } });
  assert.deepEqual(card.rows.slice(0, 3).map((/** @type {any} */ r) => [r.text, r.note]), [["Faster logs (newest)", "v3 Nov 14"], ["Version 2", "Nov 12"], ["Version 1", "Nov 10"]]);
  const marks = shelfMarks({ logsDir: fs.mkdtempSync(path.join(os.tmpdir(), "gsa-names-marks-")) });
  const [line] = gameLines(carts, marks);
  assert.deepEqual([line.versions, line.newest.version, line.newest.version_name], [3, 3, "Faster logs"]);
  assert.equal(gameLines(carts.slice(0, 2), marks)[0].newest.version_name, null);
});

test("a cart.json name that wouldn't show is tidied or dropped when the cart is read, never refused", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gsa-names-lib-"));
  const put = (/** @type {string} */ id, /** @type {any} */ meta) => {
    fs.cpSync(path.join(MAKE, "cart"), path.join(root, id), { recursive: true });
    fs.writeFileSync(path.join(root, id, "cart.json"), JSON.stringify({ id, title: "Penguin Catch", players: 1, ...meta }));
  };
  put("a", {});
  put("b", { version: 2, version_name: "Faster logs" });
  put("c", { version: 3, version_name: "the one where every log goes much faster" });
  put("d", { version: 4, version_name: 7 });
  assert.deepEqual(["a", "b", "c", "d"].map((id) => readCart(root, id)?.version_name), [null, "Faster logs", "The one where", null]);
});
