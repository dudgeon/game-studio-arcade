// The arcade MCP server (D340-D346): its protocol, each tool, and /mcp's pairing, without a browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dataPaths } from "@game-studio-arcade/studio-cli/src/config.js";
import { readLog } from "@game-studio-arcade/studio-cli/src/log.js";
import { commitNewCart } from "@game-studio-arcade/studio-cli/src/library.js";
import { makersStore } from "../src/makers.js";
import { createArcadeMcp, launchRelay, readBundle, folderFiles, bundlePathProblem } from "../src/arcade-mcp.js";
import { mcpServer } from "../src/mcp-rpc.js";
import { startService } from "../src/server.js";
import { stubSpeech } from "../src/speech.js";

const FIXTURE = path.resolve(import.meta.dirname, "../../../studio-kit/cli/fixtures/penguin-catch/cart");
const MODERN = { "io.modelcontextprotocol/protocolVersion": "2026-07-28" };
const TOKEN = "t".repeat(40);

const passing = {
  async validate() {
    return { ok: true, problems: [] };
  },
  async playtest() {
    return { ok: true, failing: [], report: { rules: [{ id: "R1", kind: "auto", status: "pass" }], generic: [] }, gate: { ok: true, failing: [], seconds: 5.1, host: "dev", driver: "browser", waited_s: 0 } };
  },
};
const failing = {
  ...passing,
  async playtest() {
    return { ok: false, failing: ["R2"], report: { rules: [{ id: "R2", kind: "auto", status: "fail" }], generic: [] }, gate: { ok: false, failing: [{ id: "R2", passed: false, reason: "the penguin never moved" }], seconds: 4, host: "dev", driver: "browser" } };
  },
};

/** A cabinet's data folder with makers and one cart in its library. @param {any} [o] */
function cabinet(o = {}) {
  const paths = dataPaths(fs.mkdtempSync(path.join(os.tmpdir(), "gsa-mcp-")));
  const makers = makersStore({ file: path.join(paths.root, "makers.json") });
  makers.add("Ivy");
  makers.add("Milo");
  makers.ensureGrownUp("Geoff");
  const first = commitNewCart({ root: paths.carts, cartDir: FIXTURE, cartJson: { ...JSON.parse(fs.readFileSync(path.join(FIXTURE, "cart.json"), "utf8")), maker: "ivy" }, message: "make {id}" });
  const launches = o.launches ?? launchRelay();
  let playing = false;
  /** @type {any} */
  let studioState = { phase: "idle" };
  const mcp = createArcadeMcp({ paths, makers, checker: o.checker ?? passing, launches, plays: { playing: () => playing }, studio: { state: () => studioState }, online: () => true, status: () => ({ release: "test" }) });
  let n = 0;
  /** @param {string} name @param {any} args */
  const call = async (name, args = {}) => {
    const r = await mcp.handle({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args, _meta: MODERN } });
    assert.equal(r.result.resultType, "complete");
    return r.result;
  };
  return { paths, makers, mcp, call, first, launches, setPlaying: (/** @type {boolean} */ p) => (playing = p), setStudio: (/** @type {any} */ s) => (studioState = s) };
}

/** The fixture cart as a bundle, with an edited spec line. */
const bundle = (/** @type {string} */ extra = "") => ({
  files: folderFiles(FIXTURE).map((f) => (f.path === "spec.md" ? { ...f, text: f.text + extra } : f)),
});

test("protocol: modern discover and requests, legacy initialize, version and method errors", async () => {
  const s = mcpServer({ name: "x", version: "1", instructions: "hi", tools: [{ name: "echo", description: "echo", inputSchema: { type: "object" }, call: async (a) => a }] });
  const d = await s.handle({ jsonrpc: "2.0", id: 1, method: "server/discover", params: { _meta: MODERN } });
  assert.deepEqual(d.result.supportedVersions, ["2026-07-28"]);
  assert.equal(d.result._meta["io.modelcontextprotocol/serverInfo"].name, "x");
  assert.equal(d.result.resultType, "complete");
  const init = await s.handle({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "c", version: "1" } } });
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.deepEqual(init.result.capabilities, { tools: {} });
  assert.equal(init.result.resultType, undefined, "legacy results carry no resultType");
  assert.equal(await s.handle({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
  const old = await s.handle({ jsonrpc: "2.0", id: 3, method: "initialize", params: { protocolVersion: "2024-01-01" } });
  assert.equal(old.result.protocolVersion, "2025-06-18");
  const bad = await s.handle({ jsonrpc: "2.0", id: 4, method: "tools/list", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "1900-01-01" } } });
  assert.equal(bad.error.code, -32022);
  assert.equal(bad.error.data.requested, "1900-01-01");
  assert.equal((await s.handle({ jsonrpc: "2.0", id: 5, method: "nope", params: {} })).error.code, -32601);
  assert.equal((await s.handle({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "nope" } })).error.code, -32602);
  const echo = await s.handle({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "echo", arguments: { a: 1 } } });
  assert.deepEqual(echo.result.structuredContent, { a: 1 });
  assert.equal(echo.result.content[0].type, "text");
  assert.deepEqual((await s.handle({ jsonrpc: "2.0", id: 8, method: "ping" })).result, {});
});

test("arcade tools: the six from HANDOFF 9.2 and the shelf's two (D360), each with an object schema", async () => {
  const { mcp } = cabinet();
  const r = await mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: MODERN } });
  assert.deepEqual(
    r.result.tools.map((/** @type {any} */ t) => t.name),
    ["list_carts", "get_cart", "publish_cart", "publish_status", "launch_on_cabinet", "get_activity", "remove_from_shelf", "restore_to_shelf", "cabinet_status"],
  );
  for (const t of r.result.tools) {
    assert.equal(t.inputSchema.type, "object");
    assert.ok(t.description.length > 20);
    assert.equal(t.call, undefined);
  }
});

test("list_carts and get_cart: the library, now and at a commit", async () => {
  const { call, first } = cabinet();
  const list = (await call("list_carts")).structuredContent;
  assert.equal(list.carts.length, 1);
  assert.equal(list.carts[0].id, "penguin-catch");
  assert.equal(list.carts[0].on_shelf, true);
  assert.equal(list.carts[0].maker, "ivy");
  assert.ok(list.makers.some((/** @type {any} */ m) => m.id === "geoff" && m.grown_up));
  const got = (await call("get_cart", { id: "penguin-catch" })).structuredContent;
  assert.deepEqual(
    got.files.map((/** @type {any} */ f) => f.path),
    folderFiles(FIXTURE).map((f) => f.path),
  );
  assert.ok(got.files.find((/** @type {any} */ f) => f.path === "spec.md").text.startsWith("# "));
  const at = (await call("get_cart", { id: "penguin-catch", ref: first.commit })).structuredContent;
  assert.equal(at.cart.commit, first.commit);
  assert.equal(at.files.length, got.files.length);
  const missing = await call("get_cart", { id: "nope" });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /no cart "nope"/);
  assert.equal((await call("get_cart", { id: "penguin-catch", ref: "deadbeef" })).isError, true);
  assert.equal((await call("get_cart", { id: "penguin-catch", ref: "--all" })).isError, true);
});

test("bundles: only a cart's own files, safe paths, size limits", () => {
  for (const bad of ["../x", "/etc/passwd", "a/../b", "node_modules/x.js", "game.js/x", ".git/config", "assets/../../x", "x.sh", ""]) assert.ok(bundlePathProblem(bad), bad);
  for (const ok of ["spec.md", "game.js", "assets/sprites/cat.png", "NOTICE.md"]) assert.equal(bundlePathProblem(ok), null, ok);
  assert.throws(() => readBundle({ files: [{ path: "game.js", text: "x" }] }), /no spec\.md/);
  assert.throws(() => readBundle({ files: [{ path: "../evil", text: "x" }] }), /\.\.\/evil/);
  assert.throws(() => readBundle({ files: [{ path: "spec.md", text: "x" }, { path: "cart.json", text: "{}" }, { path: "game.js", base64: Buffer.alloc(5 * 1024 * 1024).toString("base64") }] }), /bytes/);
  const files = readBundle({ files: [{ path: "spec.md", text: "s" }, { path: "cart.json", text: "{}" }, { path: "game.js", text: "g" }, { path: "playtest.json", text: "{}" }, { path: "assets/a.png", base64: "iVBO" }] });
  assert.deepEqual([...files.keys()], ["spec.md", "cart.json", "game.js", "assets/a.png"], "a sent playtest.json is dropped: the cabinet writes its own");
});

test("publish_cart: a new desktop game passes the gate, is committed with origin desktop and logged", async () => {
  const { call, paths } = cabinet();
  const b = bundle();
  const cj = b.files.find((f) => f.path === "cart.json");
  if (cj) cj.text = JSON.stringify({ id: "snow-penguin", title: "Snow Penguin", players: 1, origin: "cabinet", maker: "someone-else" });
  const r = await call("publish_cart", { bundle: b, maker: "milo", with: "geoff", summary: "Milo and Geoff made a snowy penguin game at the desk." });
  assert.equal(r.isError, false, r.content[0].text);
  const out = r.structuredContent;
  assert.equal(out.cart_id, "snow-penguin");
  assert.equal(out.version, 1);
  const meta = JSON.parse(fs.readFileSync(path.join(paths.carts, "snow-penguin", "cart.json"), "utf8"));
  assert.equal(meta.origin, "desktop");
  assert.equal(meta.maker, "milo", "the cabinet writes provenance, whatever the bundle said");
  assert.equal(meta.with, "geoff");
  assert.equal(meta.parent, null);
  assert.equal(meta.session_id, out.session_id);
  assert.ok(fs.existsSync(path.join(paths.carts, "snow-penguin", "playtest.json")), "the cabinet's own report goes in");
  const session = readLog(path.join(paths.logs, "studio_session.jsonl")).at(-1);
  assert.equal(session.origin, "desktop");
  assert.equal(session.outcome, "committed");
  assert.equal(session.summary, "Milo and Geoff made a snowy penguin game at the desk.");
  assert.equal(session.playtest.local.gate.seconds, 5.1);
  const version = readLog(path.join(paths.logs, "cart_version.jsonl")).at(-1);
  assert.equal(version.cart_id, "snow-penguin");
  assert.equal(version.commit, out.commit);
  assert.ok(fs.existsSync(path.join(paths.sessions, out.session_id, "request.json")));
});

test("publish_cart: a change follows the cabinet's lines, and never touches the parent", async () => {
  const { call, paths } = cabinet();
  const before = fs.readFileSync(path.join(paths.carts, "penguin-catch", "spec.md"), "utf8");
  // The parent's maker: the next version of the same line.
  const own = (await call("publish_cart", { bundle: bundle("\n- v2: faster fish\n"), parent: "penguin-catch", maker: "ivy", with: "geoff", summary: "Faster fish." })).structuredContent;
  assert.equal(own.cart_id, "penguin-catch-v2");
  assert.equal(own.version, 2);
  assert.equal(own.parent, "penguin-catch@1");
  const ownMeta = JSON.parse(fs.readFileSync(path.join(paths.carts, "penguin-catch-v2", "cart.json"), "utf8"));
  assert.equal(ownMeta.branch, "penguin-catch");
  assert.equal(ownMeta.family, "penguin-catch");
  // Someone else: their own version, a new line in the same family.
  const theirs = (await call("publish_cart", { bundle: bundle("\n- Milo's way\n"), parent: "penguin-catch", maker: "milo", summary: "Milo's own." })).structuredContent;
  assert.equal(theirs.version, 1);
  assert.notEqual(theirs.cart_id, "penguin-catch");
  const theirMeta = JSON.parse(fs.readFileSync(path.join(paths.carts, theirs.cart_id, "cart.json"), "utf8"));
  assert.equal(theirMeta.family, "penguin-catch");
  assert.equal(theirMeta.branch, undefined);
  assert.equal(fs.readFileSync(path.join(paths.carts, "penguin-catch", "spec.md"), "utf8"), before);
  const session = readLog(path.join(paths.logs, "studio_session.jsonl")).find((s) => s.cart_id === "penguin-catch-v2");
  assert.equal(session.kind, "change");
  assert.match(session.spec_diff, /\+- v2: faster fish/);
  const list = (await call("list_carts")).structuredContent.carts;
  assert.equal(list.find((/** @type {any} */ c) => c.id === "penguin-catch").on_shelf, false, "the shelf shows the line's latest");
  assert.equal(list.find((/** @type {any} */ c) => c.id === "penguin-catch-v2").on_shelf, true);
});

test("publish_cart: a failing gate keeps it off the shelf, says why, and keeps the attempt", async () => {
  const { call, paths } = cabinet({ checker: failing });
  const r = await call("publish_cart", { bundle: bundle(), maker: "milo", summary: "Try." });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /R2: the penguin never moved/);
  assert.equal(r.structuredContent.outcome, "checks_failed");
  assert.deepEqual(
    fs.readdirSync(paths.carts).filter((d) => !d.startsWith(".") && d !== "README.md"),
    ["penguin-catch"],
  );
  assert.ok(fs.existsSync(path.join(paths.sessions, r.structuredContent.session_id, "cart", "game.js")), "the attempt is kept (D5)");
  assert.equal(readLog(path.join(paths.logs, "studio_session.jsonl")).at(-1).outcome, "checks_failed");
});

test("publish_cart: unknown makers, a missing summary, and an unknown parent are refused before anything is written", async () => {
  const { call, paths } = cabinet();
  assert.match((await call("publish_cart", { bundle: bundle(), maker: "zed", summary: "x" })).content[0].text, /no maker "zed"/);
  assert.match((await call("publish_cart", { bundle: bundle(), maker: "milo", with: "zed", summary: "x" })).content[0].text, /no maker "zed"/);
  assert.match((await call("publish_cart", { bundle: bundle(), maker: "milo", summary: "  " })).content[0].text, /summary/);
  assert.match((await call("publish_cart", { bundle: bundle(), maker: "milo", summary: "x", parent: "nope" })).content[0].text, /no cart "nope"/);
  assert.equal(fs.existsSync(paths.sessions), false);
});

test("launch_on_cabinet: only when the launcher says yes from the shelf", async () => {
  const c = cabinet();
  assert.match((await c.call("launch_on_cabinet", { id: "penguin-catch" })).content[0].text, /isn't listening/);
  const stop = c.launches.subscribe((m) => setImmediate(() => c.launches.answer(m.launch, true)));
  const ok = await c.call("launch_on_cabinet", { id: "penguin-catch" });
  assert.equal(ok.isError, false);
  assert.equal(ok.structuredContent.launched, "penguin-catch");
  c.setPlaying(true);
  assert.match((await c.call("launch_on_cabinet", { id: "penguin-catch" })).content[0].text, /someone is playing/);
  c.setPlaying(false);
  c.setStudio({ phase: "running", maker_name: "Ivy" });
  assert.match((await c.call("launch_on_cabinet", { id: "penguin-catch" })).content[0].text, /Ivy is making a game/);
  c.setStudio({ phase: "idle" });
  stop();
  const stop2 = c.launches.subscribe((m) => c.launches.answer(m.launch, false, "the cabinet is on another screen (M3)"));
  assert.match((await c.call("launch_on_cabinet", { id: "penguin-catch" })).content[0].text, /another screen \(M3\)/);
  stop2();
  const relay = launchRelay();
  relay.subscribe(() => {});
  assert.deepEqual(await relay.ask({ id: "x", title: "X" }, 20), { ok: false, why: "the launcher didn't answer in time" });
});

test("get_activity and cabinet_status", async () => {
  const { call, paths } = cabinet();
  await call("publish_cart", { bundle: bundle(), maker: "milo", summary: "One." });
  fs.appendFileSync(path.join(paths.logs, "play.jsonl"), JSON.stringify({ type: "play", cart_id: "penguin-catch", started_at: "2026-11-13T10:00:00Z", duration_s: 30 }) + "\n");
  const all = (await call("get_activity")).structuredContent;
  assert.ok(all.count >= 3);
  assert.equal(all.records[0].type === "studio_session" || all.records[0].type === "cart_version", true, "newest first");
  const s = all.records.find((/** @type {any} */ r) => r.type === "studio_session");
  assert.equal(s.usage, undefined);
  assert.equal(typeof s.spec_diff_lines, "number");
  const plays = (await call("get_activity", { type: "play", cart_id: "penguin-catch" })).structuredContent;
  assert.equal(plays.count, 1);
  assert.equal((await call("get_activity", { since: "2099-01-01T00:00:00Z" })).structuredContent.count, 0);
  assert.equal((await call("get_activity", { since: "soon" })).isError, true);
  // D348: a kid's words are left out unless asked for; a desktop summary (Geoff's) stays.
  const kid = { type: "studio_session", id: "sesn_k", origin: "cabinet", maker: "ivy", request: "a penguin that eats tacos", turns: [{ question: "Fast or slow?", option_a: "Fast", option_b: "Slow", choice: "C", said: "super duper fast" }], plan_turns: [{ choice: "change", said: "more tacos" }], started_at: "2026-11-13T09:00:00Z", outcome: "committed" };
  fs.appendFileSync(path.join(paths.logs, "studio_session.jsonl"), JSON.stringify(kid) + "\n");
  fs.appendFileSync(path.join(paths.logs, "screening.jsonl"), JSON.stringify({ at: "2026-11-13T09:01:00Z", kind: "new", maker: "milo", said: "rude words", outcome: "redirected", alternative: "funny words", why: "it said rude words" }) + "\n");
  fs.appendFileSync(path.join(paths.logs, "you_check.jsonl"), JSON.stringify({ cart_id: "penguin-catch", answered_at: "2026-11-13T09:02:00Z", answers: [{ rule: "R12", text: "The penguin looks happy", answer: "no", said: "he looks grumpy" }] }) + "\n");
  const plain = (await call("get_activity")).structuredContent;
  assert.equal(plain.words, "left out");
  const text = JSON.stringify(plain.records);
  for (const w of ["tacos", "super duper", "rude words", "funny words", "grumpy"]) assert.ok(!text.includes(w), `"${w}" left out`);
  const kidRow = plain.records.find((/** @type {any} */ r) => r.id === "sesn_k");
  assert.equal(kidRow.turns[0].choice, "C", "what was chosen stays");
  assert.equal(kidRow.request, undefined);
  assert.equal(plain.records.find((/** @type {any} */ r) => r.type === "you_check").answers[0].answer, "no");
  assert.equal(plain.records.find((/** @type {any} */ r) => r.type === "studio_session" && r.origin === "desktop").request, "One.", "Geoff's desktop summary stays");
  const full = (await call("get_activity", { include_words: true })).structuredContent;
  assert.equal(full.words, "included");
  assert.ok(JSON.stringify(full.records).includes("super duper fast"));
  const st = (await call("cabinet_status")).structuredContent;
  assert.equal(st.online, true);
  assert.equal(st.release, "test");
  assert.equal(st.studio.phase, "idle");
  assert.ok(st.carts >= 2);
});

test("/mcp: the Manager's token, no browsers, JSON-RPC over POST; the launch stream and answer", async () => {
  const { paths, makers, mcp, launches } = cabinet();
  const studio = { state: () => ({ phase: "idle" }), subscribe: () => () => {} };
  const s = await startService(/** @type {any} */ ({ studio, makers, speech: stubSpeech(), libraryDir: paths.carts, logsDir: paths.logs, managerToken: TOKEN, mcp, launches, port: 0 }));
  try {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: MODERN } });
    const post = (/** @type {Record<string, string>} */ headers, b = body) => fetch(`${s.url}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: b });
    assert.equal((await post({})).status, 401);
    assert.equal((await post({ Authorization: "Bearer wrong" })).status, 401);
    assert.equal((await post({ Authorization: `Bearer ${TOKEN}`, Origin: "http://evil.example" })).status, 403);
    const ok = await post({ Authorization: `Bearer ${TOKEN}` });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).result.tools.length, 9);
    const note = await post({ Authorization: `Bearer ${TOKEN}` }, JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
    assert.equal(note.status, 202);
    assert.equal((await fetch(`${s.url}/mcp`, { headers: { Authorization: `Bearer ${TOKEN}` } })).status, 405);
    // The launcher's side: a stream to listen on, and an answer.
    const ac = new AbortController();
    const stream = await fetch(`${s.url}/api/arcade/launch`, { signal: ac.signal });
    const reader = /** @type {ReadableStreamDefaultReader<Uint8Array>} */ (stream.body?.getReader());
    await reader.read(); // ": listening"
    const asked = launches.ask({ id: "penguin-catch", title: "Penguin Catch" });
    let text = "";
    while (!text.includes("data:")) text += new TextDecoder().decode((await reader.read()).value);
    const m = JSON.parse(text.slice(text.indexOf("data:") + 5).trim());
    assert.equal(m.cart, "penguin-catch");
    const ans = await fetch(`${s.url}/api/arcade/launch/answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ launch: m.launch, ok: true }) });
    assert.equal(ans.status, 200);
    assert.deepEqual(await asked, { ok: true });
    ac.abort();
  } finally {
    await s.close();
  }
});

test("publish_cart: a maker's own next version can have a name; a bad or used one is refused with the reason (D472, D473)", async () => {
  const { call, paths } = cabinet();
  const change = (/** @type {any} */ extra) => call("publish_cart", { bundle: bundle("\n- v2: faster fish\n"), parent: "penguin-catch", maker: "ivy", summary: "Faster fish.", ...extra });
  // Refused before anything is written: too long, the game's title, and a name on someone else's own version.
  assert.match((await change({ version_name: "the one where every fish is faster" })).content[0].text, /at most 16 characters/);
  assert.match((await change({ version_name: "penguin catch" })).content[0].text, /already used by this game/);
  assert.match((await change({ maker: "milo", version_name: "Faster fish" })).content[0].text, /go by their title/);
  assert.match((await call("publish_cart", { bundle: bundle(), maker: "milo", summary: "New.", version_name: "Faster fish" })).content[0].text, /go by their title/);
  assert.ok(!fs.existsSync(path.join(paths.carts, "penguin-catch-v2")));

  const own = (await change({ version_name: " faster fish. " })).structuredContent;
  assert.deepEqual([own.cart_id, own.version, own.version_name], ["penguin-catch-v2", 2, "Faster fish"]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(paths.carts, "penguin-catch-v2", "cart.json"), "utf8")).version_name, "Faster fish");
  assert.match(fs.readFileSync(path.join(paths.carts, "penguin-catch-v2", "spec.md"), "utf8"), /^- v2 "Faster fish": faster fish$/m);
  const v = readLog(path.join(paths.logs, "cart_version.jsonl")).at(-1);
  assert.deepEqual([v.version_name, v.named_by, v.name_picked], ["Faster fish", "ivy", "desktop"]);
  // The list says what each version is called; one with no name says null, and goes by its number.
  const list = (await call("list_carts")).structuredContent.carts;
  assert.equal(list.find((/** @type {any} */ c) => c.id === "penguin-catch-v2").version_name, "Faster fish");
  assert.equal(list.find((/** @type {any} */ c) => c.id === "penguin-catch").version_name, null);
  // The next version can't take the same name, and one with no name is still fine.
  const again = (/** @type {any} */ extra) => call("publish_cart", { bundle: bundle("\n- v2: faster fish\n- v3: more fish\n"), parent: "penguin-catch-v2", maker: "ivy", summary: "More fish.", ...extra });
  assert.match((await again({ version_name: "FASTER FISH" })).content[0].text, /already used by this game/);
  const third = (await again({})).structuredContent;
  assert.deepEqual([third.version, third.version_name], [3, null]);
});
