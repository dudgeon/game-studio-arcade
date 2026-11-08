// `studio make` end to end against the frog-hop fixture: session, outputs,
// local checks, cart library commit and log records.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mockApi } from "../test-support/mock-api.js";
import { makeCart } from "../src/make.js";
import { replayAnswerer } from "../src/answers.js";
import { dataPaths } from "../src/config.js";
import { readLog } from "../src/log.js";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/frog-hop");
const script = JSON.parse(fs.readFileSync(path.join(fixtures, "session.json"), "utf8"));
const answers = JSON.parse(fs.readFileSync(path.join(fixtures, "answers.json"), "utf8"));

function cartTgz() {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "frog-tgz-")), "cart.tgz");
  execFileSync("tar", ["-czf", out, "-C", path.join(fixtures, "cart"), "."], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  return fs.readFileSync(out);
}

/** Outputs as the agent leaves them, with DONE.json listing names and sizes (D19). */
/** @param {Record<string, Buffer>} [extra] @param {{omit?: string[]}} [opts] */
function outputs(extra = {}, { omit = [] } = {}) {
  /** @type {Record<string, Buffer>} */
  const files = {
    "spec.md": fs.readFileSync(path.join(fixtures, "cart/spec.md")),
    "report.json": fs.readFileSync(path.join(fixtures, "report.json")),
    "cart.tgz": cartTgz(),
    ...extra,
  };
  for (const n of omit) delete files[n];
  const manifest = { files: Object.entries(files).map(([name, b]) => ({ name, size: b.length })) };
  return { ...files, "DONE.json": Buffer.from(JSON.stringify(manifest)) };
}

const passing = {
  async validate() {
    return { ok: true, problems: [] };
  },
  async playtest() {
    return { ok: true, failing: [], report: { rules: [{ id: "R1", kind: "auto", passed: true }], generic: [] } };
  },
};

function setup(opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gsa-data-"));
  const paths = dataPaths(root);
  const m = mockApi(script, { outputs: opts.outputs ?? outputs(), outputLag: 2, usage: { list_cost: { amount: "143", currency: "USD" }, active_seconds: 312.5, input_tokens: 41000, output_tokens: 9800, cache_read_input_tokens: 120000, cache_creation: { ephemeral_5m_input_tokens: 8000, ephemeral_1h_input_tokens: 0 } }, sessionId: opts.sessionId });
  const info = [];
  let t = Date.parse("2026-11-07T21:00:00Z");
  const make = (extra = {}) =>
    makeCart({
      api: m.api,
      request: answers.request,
      maker: "A",
      model: "claude-opus-5-5",
      budgetCents: 300,
      answerer: replayAnswerer(answers),
      ui: { progress: () => {}, info: (s) => info.push(s) },
      checker: opts.checker ?? passing,
      paths,
      lock: { agentId: "agent_x", agentVersion: 2, environmentId: "env_x" },
      kit: async () => ({ fileId: "file_kit_01", hash: "abc123" }),
      now: () => new Date((t += 1000)),
      outputs: { sleep: async () => {}, tries: 4 },
      ...extra,
    });
  return { root, paths, m, info, make };
}

test("a passing build is committed with complete log records", async () => {
  const s = setup();
  const record = path.join(s.root, "replay.json");
  const { record: rec, committed, sessionDir } = await s.make({ recordFile: record });

  assert.deepEqual(s.m.problems, []);
  assert.equal(s.m.created.model, "claude-opus-5-5");
  assert.equal(s.m.created.kitFileId, "file_kit_01");
  assert.ok(committed);
  assert.equal(committed.id, "frog-hop");

  // Library: committed, cart.json filled in, by the Studio identity.
  const lib = s.paths.carts;
  const cart = JSON.parse(fs.readFileSync(path.join(lib, "frog-hop/cart.json"), "utf8"));
  assert.equal(cart.session_id, "sesn_mock_01");
  assert.equal(cart.maker, "A");
  assert.equal(cart.parent, null);
  assert.equal(cart.version, 1);
  assert.equal(cart.origin, "cabinet");
  assert.ok(fs.existsSync(path.join(lib, "frog-hop/playtest.json")), "the local playtest report is in the cart");
  assert.ok(!fs.existsSync(path.join(lib, "frog-hop/playtest-frames")), "key frames stay out of the library");
  const head = execFileSync("git", ["log", "-1", "--format=%H %an %s"], { cwd: lib, encoding: "utf8" }).trim();
  assert.equal(head, `${committed.commit} Studio make frog-hop v1 (sesn_mock_01)`);
  assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: lib, encoding: "utf8" }), "");

  // Logs (§9.5).
  const [session] = readLog(path.join(s.paths.logs, "studio_session.jsonl"));
  const [version] = readLog(path.join(s.paths.logs, "cart_version.jsonl"));
  assert.deepEqual(version, { type: "cart_version", cart_id: "frog-hop", version: 1, parent: null, session_id: "sesn_mock_01", commit: committed.commit, created: version.created });
  assert.equal(session.type, "studio_session");
  assert.equal(session.id, "sesn_mock_01");
  assert.equal(session.maker, "A");
  assert.equal(session.request, answers.request);
  assert.equal(session.questions, 2);
  assert.equal(session.ended_by, "answers");
  assert.deepEqual(session.list_cost, { amount: "143", currency: "USD" });
  assert.equal(session.list_cost_usd, 1.43);
  assert.ok(session.wall_seconds > 0);
  assert.equal(session.outcome, "committed");
  assert.equal(session.model, "claude-opus-5-5");
  assert.deepEqual(session.agent, { id: "agent_x", version: 2 });
  assert.equal(session.turns.length, 2);
  assert.deepEqual(Object.keys(session.turns[0]), ["question", "option_a", "option_b", "choice", "said"]);
  assert.equal(session.plan_turns.length, 2);
  assert.match(session.spec_diff, /^--- \/dev\/null\n\+\+\+ spec.md\n@@ -0,0 \+1,\d+ @@\n\+# Frog Hop/);
  assert.equal(session.playtest.sandbox.status, "done");
  assert.equal(session.playtest.local.ok, true);
  assert.equal(session.cart_id, "frog-hop");
  assert.deepEqual(session.missing_outputs, []);
  assert.equal(session.outputs_complete, true);
  assert.equal(session.context_pack, "tarball");
  assert.deepEqual(session.edits_after_first_playtest, { game_js: 1, checks_js: 0, spec_md: 0 });
  assert.equal(session.playtest_runs, 1);
  assert.equal(session.checks_changed_after_playtest.changed, false);
  assert.equal(session.checks_changed_after_playtest.baseline, "none", "that fixture has no snapshot");
  assert.equal(session.active_seconds, 312.5);
  assert.deepEqual(session.tokens, { input: 41000, output: 9800, cache_read: 120000, cache_creation: { ephemeral_5m_input_tokens: 8000, ephemeral_1h_input_tokens: 0 } });
  assert.deepEqual({ type: "studio_session", ...rec }, session);

  // Everything kept, and the answers replay.
  assert.ok(!fs.existsSync(path.join(sessionDir, "outputs/studio-kit.tgz")), "the input kit isn't treated as an output");
  const events = fs.readFileSync(path.join(sessionDir, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(events.length, script.steps.filter((s) => s.emit).length, "every streamed event is recorded once");
  for (const f of ["answers.json", "session.json", "events.jsonl", "local-checks.json", "outputs/cart.tgz", "outputs/report.json", "outputs/spec.md", "outputs/DONE.json", "cart/spec.md"]) {
    assert.ok(fs.existsSync(path.join(sessionDir, f)), `kept ${f}`);
  }
  const saved = JSON.parse(fs.readFileSync(record, "utf8"));
  assert.deepEqual(saved, answers, "the recorded answers equal the replayed ones");
  assert.equal(s.m.calls.filter((c) => c === "listOutputs").length, 3, "waited out the output lag");
});

test("a second cart with the same id gets a suffix; the first is untouched", async () => {
  const s = setup();
  await s.make();
  const before = fs.readFileSync(path.join(s.paths.carts, "frog-hop/cart.json"), "utf8");
  const again = mockApi(script, { outputs: outputs(), sessionId: "sesn_mock_02" });
  const { committed } = await s.make({ api: again.api, answerer: replayAnswerer(answers) });
  assert.equal(committed?.id, "frog-hop-2");
  assert.equal(fs.readFileSync(path.join(s.paths.carts, "frog-hop/cart.json"), "utf8"), before);
  assert.equal(readLog(path.join(s.paths.logs, "cart_version.jsonl")).length, 2);
});

test("failing checks: nothing committed, everything kept, outcome logged", async () => {
  const s = setup({
    checker: {
      async validate() {
        return { ok: true };
      },
      async playtest() {
        return { ok: false, failing: ["R3"], report: { rules: [{ id: "R3", kind: "auto", passed: false }] } };
      },
    },
  });
  const { committed, sessionDir, record } = await s.make();
  assert.equal(committed, null);
  assert.equal(record.outcome, "checks_failed");
  assert.deepEqual(record.playtest.local?.failing, ["R3"]);
  assert.ok(!fs.existsSync(path.join(s.paths.carts, "frog-hop")));
  assert.ok(fs.existsSync(path.join(sessionDir, "cart/game.js")));
  assert.equal(readLog(path.join(s.paths.logs, "cart_version.jsonl")).length, 0);
  assert.match(s.info.at(-1), /didn't pass its checks/);
});

test("--commit-anyway commits a failing cart and says so", async () => {
  const s = setup({
    checker: {
      async validate() {
        return { ok: false, unavailable: true };
      },
      async playtest() {
        return { ok: false, unavailable: true };
      },
    },
  });
  const { committed, record } = await s.make({ commitAnyway: true });
  assert.equal(record.outcome, "committed_failing");
  const subject = execFileSync("git", ["log", "-1", "--format=%s"], { cwd: s.paths.carts, encoding: "utf8" }).trim();
  assert.equal(subject, `make ${committed?.id} v1 (sesn_mock_01, checks not passing)`);
});

test("no cart.tgz: the spec is still logged and kept", async () => {
  const s = setup({ outputs: outputs({}, { omit: ["cart.tgz"] }) });
  const { record, sessionDir } = await s.make();
  assert.equal(record.outcome, "no_cart");
  assert.deepEqual(record.missing_outputs, []);
  assert.equal(record.outputs_complete, true, "the manifest didn't promise a cart");
  assert.match(record.spec_diff ?? "", /\+# Frog Hop/);
  assert.ok(fs.existsSync(path.join(sessionDir, "outputs/spec.md")));
});
