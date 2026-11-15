// Desktop publishes as jobs (D513, D514): no call waits on the gate, and the same cart again publishes once.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dataPaths } from "@game-studio-arcade/studio-cli/src/config.js";
import { readLog } from "@game-studio-arcade/studio-cli/src/log.js";
import { commitNewCart } from "@game-studio-arcade/studio-cli/src/library.js";
import { makersStore } from "../src/makers.js";
import { createArcadeMcp, folderFiles, publishKey, readBundle } from "../src/arcade-mcp.js";

const FIXTURE = path.resolve(import.meta.dirname, "../../../studio-kit/cli/fixtures/penguin-catch/cart");
const MODERN = { "io.modelcontextprotocol/protocolVersion": "2026-07-28" };
const report = { rules: [{ id: "R1", kind: "auto", status: "pass" }], generic: [] };
const passing = {
  async validate() {
    return { ok: true, problems: [] };
  },
  async playtest() {
    return { ok: true, failing: [], report, gate: { ok: true, failing: [], seconds: 5, host: "dev", driver: "browser", waited_s: 0 } };
  },
};
const failing = {
  ...passing,
  async playtest() {
    return { ok: false, failing: ["R2"], report, gate: { ok: false, failing: [{ id: "R2", passed: false, reason: "no" }], seconds: 4, host: "dev", driver: "browser" } };
  },
};

/** A gate held until let go, as when it waits out a game being played. */
function heldGate() {
  /** @type {() => void} */
  let release = () => {};
  let runs = 0;
  const held = new Promise((r) => (release = () => r(undefined)));
  return {
    checker: {
      ...passing,
      async playtest() {
        runs++;
        await held;
        return passing.playtest();
      },
    },
    release: () => release(),
    runs: () => runs,
  };
}

/** @param {any} checker */
function cabinet(checker) {
  const paths = dataPaths(fs.mkdtempSync(path.join(os.tmpdir(), "gsa-pub-")));
  const makers = makersStore({ file: path.join(paths.root, "makers.json") });
  makers.add("Alina");
  makers.add("Owen");
  commitNewCart({ root: paths.carts, cartDir: FIXTURE, cartJson: { ...JSON.parse(fs.readFileSync(path.join(FIXTURE, "cart.json"), "utf8")), maker: "alina" }, message: "make {id}" });
  let playing = false;
  const server = (/** @type {any} */ ch) => createArcadeMcp({ paths, makers, checker: ch, plays: { playing: () => playing } });
  /** @param {ReturnType<typeof server>} s */
  const caller = (s) => async (/** @type {string} */ name, /** @type {any} */ args) => (await s.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args, _meta: MODERN } })).result;
  return { paths, makers, server, caller, call: caller(server(checker)), setPlaying: (/** @type {boolean} */ p) => (playing = p) };
}

const bundle = (/** @type {string} */ extra = "") => ({ files: folderFiles(FIXTURE).map((f) => (f.path === "spec.md" ? { ...f, text: f.text + extra } : f)) });

test("the publish key: same files, parent, maker, with and name are the same publish; the summary isn't part of it", () => {
  const files = readBundle(bundle("\nx\n"));
  const k = publishKey(files, { parent: "p", maker: "alina" });
  assert.equal(k, publishKey(new Map([...files].reverse()), { parent: "p", maker: "alina" }), "file order doesn't matter");
  assert.notEqual(k, publishKey(readBundle(bundle("\ny\n")), { parent: "p", maker: "alina" }));
  assert.notEqual(k, publishKey(files, { parent: "p", maker: "owen" }));
  assert.notEqual(k, publishKey(files, { parent: null, maker: "alina" }));
});

test("pending while the gate waits; a retry joins the same publish; one cart, even after a restart (D513, D514)", async () => {
  const g = heldGate();
  const c = cabinet(g.checker);
  c.setPlaying(true);
  const args = { bundle: bundle("\n- v2: x\n"), parent: "penguin-catch", maker: "alina", summary: "Faster." };
  const first = (await c.call("publish_cart", { ...args, wait_s: 0 })).structuredContent;
  assert.equal(first.status, "pending");
  assert.match(first.publish_id, /^pub_[0-9a-f]{20}$/);
  assert.match(first.waiting_for, /game being played/);
  assert.match(first.note, /Don't publish again/);
  // Gave up and tried again, in other words: it joins, with no second run and no second cart.
  const again = (await c.call("publish_cart", { ...args, summary: "Faster fish, again.", wait_s: 0 })).structuredContent;
  assert.equal(again.publish_id, first.publish_id);
  assert.equal(again.same_as_before, true);
  assert.equal((await c.call("publish_status", { publish_id: first.publish_id, wait_s: 0 })).structuredContent.status, "pending");
  c.setPlaying(false);
  g.release();
  const done = (await c.call("publish_status", { publish_id: first.publish_id, wait_s: 5 })).structuredContent;
  assert.equal(done.outcome, "committed");
  assert.equal(done.cart_id, "penguin-catch-v2");
  assert.equal(g.runs(), 1, "the gate ran once");
  const late = (await c.call("publish_cart", { ...args, wait_s: 0 })).structuredContent;
  assert.equal(late.cart_id, "penguin-catch-v2", "after it's done: the same cart");
  // A new server on the same data (the service restarted): the logs still know it.
  const ask = c.caller(c.server(passing));
  const after = (await ask("publish_cart", { ...args, summary: "After a restart." })).structuredContent;
  assert.equal(after.already_published, true);
  assert.equal(after.cart_id, "penguin-catch-v2");
  assert.equal((await ask("publish_status", { publish_id: first.publish_id })).structuredContent.cart_id, "penguin-catch-v2");
  assert.deepEqual(
    fs
      .readdirSync(c.paths.carts)
      .filter((d) => d.startsWith("penguin-catch"))
      .sort(),
    ["penguin-catch", "penguin-catch-v2"],
    "one new cart, not two",
  );
  assert.equal(readLog(path.join(c.paths.logs, "studio_session.jsonl")).filter((r) => r.origin === "desktop").length, 1);
  // A different cart is a different publish.
  const next = (await c.call("publish_cart", { ...args, bundle: bundle("\n- v3: y\n"), parent: "penguin-catch-v2", wait_s: 5 })).structuredContent;
  assert.notEqual(next.publish_id, first.publish_id);
  assert.equal(next.cart_id, "penguin-catch-v3");
});

test("refusals come back at once; a failed publish runs again when asked; an unknown publish_id says what to do", async () => {
  const c = cabinet(failing);
  const bad = await c.call("publish_cart", { bundle: bundle(), maker: "zed", summary: "x", wait_s: 0 });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /no maker "zed"/);
  const f1 = await c.call("publish_cart", { bundle: bundle(), maker: "owen", summary: "x" });
  assert.equal(f1.isError, true);
  assert.match(f1.structuredContent.publish_id, /^pub_/);
  const f2 = await c.call("publish_cart", { bundle: bundle(), maker: "owen", summary: "x" });
  assert.equal(f2.isError, true);
  assert.equal(readLog(path.join(c.paths.logs, "studio_session.jsonl")).filter((r) => r.outcome === "checks_failed").length, 2, "it ran again");
  const unknown = await c.call("publish_status", { publish_id: "pub_nope" });
  assert.equal(unknown.isError, true);
  assert.match(unknown.content[0].text, /list_carts/);
});
