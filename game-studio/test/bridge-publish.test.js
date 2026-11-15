// The bridge's publish waits and its choice of cabinet (D513, D514, D516), against a real local service over HTTP.
// GSA_LONG_GATE_S=330 holds the gate past Node fetch's old 300 s limit, the way the real failure happened (slow; run by hand).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { dataPaths } from "@game-studio-arcade/studio-cli/src/config.js";
import { commitNewCart } from "@game-studio-arcade/studio-cli/src/library.js";
import { readLog } from "@game-studio-arcade/studio-cli/src/log.js";
import { makersStore } from "../../cabinet/service/src/makers.js";
import { createArcadeMcp, folderFiles } from "../../cabinet/service/src/arcade-mcp.js";
import { mcpServer, serveStdio } from "../../cabinet/service/src/mcp-rpc.js";
import { startService } from "../../cabinet/service/src/server.js";
import { stubSpeech } from "../../cabinet/service/src/speech.js";
import { REPO } from "../src/studio-server.js";
import { createBridge, directLink, chooseCabinet, CABINET_FILE, PULLED } from "../src/arcade-bridge.js";

const FIXTURE = path.join(REPO, "studio-kit/cli/fixtures/penguin-catch/cart");
const MODERN = { "io.modelcontextprotocol/protocolVersion": "2026-07-28" };
const TOKEN = "q".repeat(48);
const LONG_S = Number(process.env.GSA_LONG_GATE_S ?? 0);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "gsa-bp-"));
const passing = {
  async validate() {
    return { ok: true, problems: [] };
  },
  async playtest() {
    return { ok: true, failing: [], report: { rules: [], generic: [] }, gate: { ok: true, failing: [], seconds: 1, host: "dev", driver: "browser", waited_s: 0 } };
  },
};

/** A local service whose gate is held for holdMs, as when it waits out a game. @param {number} holdMs */
async function service(holdMs) {
  const paths = dataPaths(tmp());
  const makers = makersStore({ file: path.join(paths.root, "makers.json") });
  makers.add("Alina");
  commitNewCart({ root: paths.carts, cartDir: FIXTURE, cartJson: { ...JSON.parse(fs.readFileSync(path.join(FIXTURE, "cart.json"), "utf8")), maker: "alina" }, message: "make {id}" });
  let runs = 0;
  const checker = {
    ...passing,
    async playtest() {
      runs++;
      await new Promise((r) => setTimeout(r, holdMs));
      return passing.playtest();
    },
  };
  const mcp = createArcadeMcp({ paths, makers, checker, plays: { playing: () => true } });
  const studio = { state: () => ({ phase: "idle" }), subscribe: () => () => {} };
  const s = await startService(/** @type {any} */ ({ studio, makers, speech: stubSpeech(), libraryDir: paths.carts, logsDir: paths.logs, managerToken: TOKEN, mcp, port: 0 }));
  return { paths, s, runs: () => runs };
}

/** @param {any} b */
const caller = (b) => async (/** @type {string} */ name, /** @type {any} */ args, /** @type {any} */ ctx = {}) => (await b.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args, _meta: { ...MODERN, progressToken: "p1" } } }, ctx)).result;

/** A pulled copy of the fixture, changed. */
function pulledFolder() {
  const dir = path.join(tmp(), "penguin");
  fs.cpSync(FIXTURE, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, PULLED), JSON.stringify({ id: "penguin-catch", version: 1 }));
  fs.appendFileSync(path.join(dir, "spec.md"), "\n- v2: faster\n");
  return dir;
}

test(`a publish held by the gate ${LONG_S ? `for ${LONG_S} s` : "for a few seconds"}: one call through the bridge waits it out in short calls, with progress, and makes one cart`, { timeout: (LONG_S + 60) * 1000 }, async () => {
  const hold = LONG_S ? LONG_S * 1000 : 3500;
  const { s, paths, runs } = await service(hold);
  try {
    /** @type {any[]} */
    const notes = [];
    const call = caller(createBridge(directLink(s.url, TOKEN), { pollWaitS: LONG_S ? 25 : 1, retryMs: 50 }));
    const t0 = Date.now();
    let r = await call("publish_cart", { dir: pulledFolder(), maker: "alina", summary: "Faster." }, { notify: (/** @type {any} */ m) => notes.push(m) });
    // Past the bridge's own 4-minute budget it answers pending; publish_status waits on, as a caller is told to.
    for (let i = 0; i < 3 && r.structuredContent?.status === "pending"; i++) {
      assert.match(r.structuredContent.note, /Call publish_status with publish_id pub_.*Don't publish again/);
      r = await call("publish_status", { publish_id: r.structuredContent.publish_id });
    }
    assert.equal(r.isError, false, r.content[0].text);
    assert.equal(r.structuredContent.cart_id, "penguin-catch-v2");
    assert.equal(r.structuredContent.cabinet, s.url, "it says which cabinet answered");
    assert.ok(Date.now() - t0 >= hold - 100);
    assert.ok(notes.length >= 1, "progress went out while it waited");
    assert.equal(notes[0].method, "notifications/progress");
    assert.equal(notes[0].params.progressToken, "p1");
    assert.match(notes[0].params.message, /game being played/);
    assert.equal(runs(), 1);
    assert.equal(readLog(path.join(paths.logs, "studio_session.jsonl")).length, 1);
  } finally {
    await s.close();
  }
});

test("past the bridge's own budget it answers pending with a publish_id; publish_status picks it up; a second publish_cart makes no second cart", async () => {
  const { s, paths, runs } = await service(2500);
  try {
    const call = caller(createBridge(directLink(s.url, TOKEN), { pollWaitS: 0, waitBudgetMs: 300, retryMs: 50 }));
    const dir = pulledFolder();
    const first = (await call("publish_cart", { dir, maker: "alina", summary: "Faster." })).structuredContent;
    assert.equal(first.status, "pending");
    assert.match(first.note, /publish_status with publish_id pub_/);
    const again = (await call("publish_cart", { dir, maker: "alina", summary: "Faster, I said." })).structuredContent;
    assert.equal(again.publish_id, first.publish_id);
    const patient = caller(createBridge(directLink(s.url, TOKEN), { pollWaitS: 1, retryMs: 50 }));
    const done = (await patient("publish_status", { publish_id: first.publish_id })).structuredContent;
    assert.equal(done.cart_id, "penguin-catch-v2");
    assert.equal(runs(), 1);
    assert.deepEqual(fs.readdirSync(paths.carts).filter((d) => d.startsWith("penguin-catch")).sort(), ["penguin-catch", "penguin-catch-v2"]);
  } finally {
    await s.close();
  }
});

test("a dropped connection mid-publish: the bridge asks again and joins the same publish", async () => {
  const { s, runs } = await service(1500);
  try {
    const real = directLink(s.url, TOKEN);
    let drops = 2;
    const flaky = {
      describe: "flaky",
      close() {},
      /** @param {any} m */
      async post(m) {
        const r = await real.post(m); // the cabinet got it…
        if (drops-- > 0) throw new TypeError("fetch failed"); // …but the answer was lost
        return r;
      },
    };
    const r = (await caller(createBridge(flaky, { pollWaitS: 1, retryMs: 20 }))("publish_cart", { dir: pulledFolder(), maker: "alina", summary: "Faster." })).structuredContent;
    assert.equal(r.cart_id, "penguin-catch-v2");
    assert.equal(runs(), 1, "asked three times, published once");
  } finally {
    await s.close();
  }
});

test("which cabinet: ARCADE_CABINET, else .arcade-cabinet in the project or above, else virtual (D516)", () => {
  const root = tmp();
  const deep = path.join(root, "a", "b");
  fs.mkdirSync(deep, { recursive: true });
  assert.deepEqual(chooseCabinet({}, deep), { name: "virtual", from: "the default" });
  fs.writeFileSync(path.join(root, CABINET_FILE), "real\n# the Picade in the kitchen\n");
  assert.deepEqual(chooseCabinet({}, deep), { name: "real", from: path.join(root, CABINET_FILE) });
  assert.equal(chooseCabinet({ ARCADE_CABINET: "virtual" }, deep).name, "virtual", "the environment wins");
});

test("use_cabinet switches the rest of the session, and every result names its cabinet", async () => {
  /** @param {string} name */
  const fake = (name) => ({ describe: `${name}: fake`, close() {}, post: async (/** @type {any} */ m) => ({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "{}" }], structuredContent: { ok: true } } }) });
  /** @type {string[]} */
  const chosen = [];
  const b = createBridge(async () => fake("virtual"), {
    choose: async (name) => {
      if (name === "nope") throw new Error("no cabinet called nope");
      chosen.push(name);
      return fake(name);
    },
  });
  const call = caller(b);
  assert.equal((await call("cabinet_status", {})).structuredContent.cabinet, "virtual: fake");
  const sw = await call("use_cabinet", { cabinet: "real" });
  assert.equal(sw.structuredContent.cabinet, "real: fake");
  assert.equal((await call("cabinet_status", {})).structuredContent.cabinet, "real: fake");
  assert.match((await call("use_cabinet", { cabinet: "nope" })).content[0].text, /no cabinet called nope/);
  assert.equal((await call("cabinet_status", {})).structuredContent.cabinet, "real: fake", "a bad choice changes nothing");
  assert.deepEqual(chosen, ["real"]);
  assert.match((await caller(createBridge(fake("x")))("use_cabinet", { cabinet: "real" })).content[0].text, /fixed to one cabinet/);
});

test("progress goes out over stdio only when asked for", async () => {
  const s = mcpServer({ name: "x", version: "1", tools: [{ name: "slow", description: "slow", inputSchema: { type: "object" }, call: async (_a, ctx) => (ctx.progress(1, "half way"), { ok: true }) }] });
  const input = new PassThrough();
  const output = new PassThrough();
  let out = "";
  output.on("data", (d) => (out += d));
  const done = serveStdio(s, { input, output });
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "slow", arguments: {}, _meta: { ...MODERN, progressToken: 7 } } }) + "\n");
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "slow", arguments: {}, _meta: MODERN } }) + "\n");
  await new Promise((r) => setTimeout(r, 50));
  input.end();
  await done;
  const lines = out.trim().split("\n").map((l) => JSON.parse(l));
  const progress = lines.filter((l) => l.method === "notifications/progress");
  assert.equal(progress.length, 1);
  assert.deepEqual(progress[0].params, { progressToken: 7, progress: 1, message: "half way" });
  assert.equal(lines.filter((l) => l.id).length, 2);
});
