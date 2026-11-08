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
import { buildSummary, makeCart } from "../src/make.js";
import { replayAnswerer } from "../src/answers.js";
import { dataPaths } from "../src/config.js";
import { readLog } from "../src/log.js";
import { reanalyzeSession } from "../src/reanalyze.js";
import { addYouCheckRules, questionsFor } from "../src/untested.js";
import { parseSpec, formatSpec, validateRuleCoverage } from "@game-studio-arcade/spec";
import { readCart } from "../../player/src/library.js";

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
  assert.deepEqual(saved.questions.map((a) => [a.choice, a.said]), answers.questions.map((a) => [a.choice, a.said]), "the recorded answers equal the replayed ones");
  assert.deepEqual(saved.plan, answers.plan);
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

test("the frozen snapshot is fetched when the first playtest starts, so overwriting it later changes nothing", async () => {
  const frozen = Buffer.from("export default {\n  R1: async (t) => { await t.step(1); },\n};\n");
  const base = outputs({ "checks.frozen.js": frozen, "spec.frozen.md": fs.readFileSync(path.join(fixtures, "cart/spec.md")) });
  const s = setup({ outputs: base });
  const { record, sessionDir } = await s.make();
  assert.equal(fs.readFileSync(path.join(sessionDir, "frozen/checks.frozen.js"), "utf8"), frozen.toString());
  const c = record.checks_changed_after_playtest;
  assert.equal(c.baseline, "captured");
  assert.ok(c.rules.some((r) => r.rule === "R1"), "the final checks differ from what was captured");
});

test("a failed capture doesn't stop the build", async () => {
  const s = setup();
  const real = s.m.api.listOutputs;
  let calls = 0;
  s.m.api.listOutputs = async (id) => {
    if (calls++ === 0) throw new Error("network blip");
    return real(id);
  };
  const { record } = await s.make();
  assert.equal(record.outcome, "committed");
});

test("reanalyze appends a correction and leaves the original record", async () => {
  const s = setup();
  const { sessionDir, record } = await s.make();
  const file = path.join(s.paths.logs, "studio_session.jsonl");
  const before = fs.readFileSync(file, "utf8");
  const fixed = reanalyzeSession({ paths: s.paths, session: record.id, why: "detector bug" });
  assert.equal(fs.readFileSync(file, "utf8"), before, "the original log is untouched");
  const [c] = readLog(path.join(s.paths.logs, "studio_session_correction.jsonl"));
  assert.equal(c.corrects, record.id);
  assert.equal(c.why, "detector bug");
  assert.deepEqual(c.edits_after_first_playtest, fixed.edits_after_first_playtest);
  assert.ok(fs.existsSync(sessionDir));
  assert.throws(() => reanalyzeSession({ paths: s.paths, session: "sesn_nope", why: "x" }), /no session folder/);
});

test("the build summary shows check bugs and rule changes (D46)", () => {
  const base = { changed: true, rules_known: true, edit_events: 2, helpers_unjustified: false };
  const lines = buildSummary({
    ...base,
    rules: [
      { rule: "R2", classification: "check_bug", quote: "Hit costs a life.", what: "The check ran too long." },
      { rule: "R3", classification: "rule_change", shown_in_plan: true, what: "Three lives now." },
      { rule: "R4", classification: "rule_change", shown_in_plan: false, what: null },
      { rule: "R5", classification: "unexplained", what: null },
    ],
  });
  assert.deepEqual(lines, [
    'Test fixed, rule unchanged: R2 "Hit costs a life.". The check ran too long.',
    "Rule changed: R3. Three lives now.",
    "Rule changed: R4 (not shown in the plan).",
    "Test changed with no explanation: R5.",
  ]);
  assert.match(buildSummary({ ...base, rules: [], rules_known: false })[0], /can't be said which/);
});

test("a run saves its answers with the question and words, so they replay by question", async () => {
  const s = setup();
  const record = path.join(s.root, "answers.json");
  await s.make({ recordFile: record });
  const saved = JSON.parse(fs.readFileSync(record, "utf8"));
  assert.equal(saved.questions[0].question, "What does the frog dodge?");
  assert.equal(saved.questions[0].answer, "Cars");
  assert.equal(saved.questions[1].answer, "medium and it gets faster");
  const again = replayAnswerer(saved);
  assert.deepEqual(await again.question({ question: "What does the frog dodge?", option_a: "Logs", option_b: "Cars" }), { choice: "B" });
});

const SPEC_TEXT = fs.readFileSync(path.join(fixtures, "cart/spec.md"), "utf8");

test("D49: questionsFor asks each lost part, or the whole rule if it doesn't say", () => {
  const q = questionsFor([
    { rule: "R1", narrowed: false },
    { rule: "R2", narrowed: true, untested: [{ words: "up to 3", question: "Do things  stop\nspeeding up?" }, { words: "every 600", question: "" }] },
    { rule: "R3", narrowed: true, untested: [], rule_text: "Lives start\nat 3." },
  ]);
  assert.deepEqual(q, [
    { from: "R2", words: "up to 3", text: "Do things stop speeding up?" },
    { from: "R2", words: "every 600", text: "Play and check: every 600" },
    { from: "R3", words: null, text: "Play and check: Lives start at 3." },
  ]);
});

test("D49: addYouCheckRules adds valid rules with new ids, a Changelog line, and canonical form", () => {
  const { text, added } = addYouCheckRules(SPEC_TEXT, [{ from: "R4", words: "faster", text: "Do the cars get faster?" }]);
  assert.deepEqual(added, [{ rule: "R6", from: "R4", words: "faster", text: "Do the cars get faster?" }], "R1-R5 are taken");
  const spec = parseSpec(text);
  assert.deepEqual(spec.errors, []);
  assert.equal(spec.rules.at(-1)?.id, "R6");
  assert.equal(spec.rules.at(-1)?.kind, "you-check");
  assert.equal(spec.rules.filter((r) => r.kind === "auto").length, 4, "the auto rules are untouched");
  assert.match(spec.changelog.at(-1)?.text ?? "", /tests for R4 no longer prove all of the rule, so R6 ask/);
  assert.equal(spec.changelog.at(-1)?.id, "v2");
  assert.equal(formatSpec(spec), text, "still canonical");
  assert.deepEqual(addYouCheckRules(SPEC_TEXT, []), { text: SPEC_TEXT, added: [] });
  assert.deepEqual(addYouCheckRules("no spec here", [{ from: "R1", words: null, text: "x" }]).added, [], "nothing to add it to");
});

test("D49 end to end: a check that lost a point reaches the local player as a question", async () => {
  // Frog-hop's final R1 has no list of points; this snapshot's did.
  const frozen = fs.readFileSync(path.join(fixtures, "cart/checks.js"), "utf8").replace("await t.step(1);", "for (const at of [10, 20]) await t.step(at);");
  const report = JSON.parse(fs.readFileSync(path.join(fixtures, "report.json"), "utf8"));
  report.check_changes = [{ rule: "R1", kind: "check_bug", quote: "one lane up", what: "Too slow.", untested: [{ words: "one lane up", question: "Does pressing up move one lane?" }] }];
  const s = setup({ outputs: outputs({ "checks.frozen.js": Buffer.from(frozen), "spec.frozen.md": Buffer.from(SPEC_TEXT), "report.json": Buffer.from(JSON.stringify(report)) }) });
  const { record, committed, sessionDir } = await s.make();

  assert.deepEqual(record.you_check_added, [{ rule: "R6", from: "R1", words: "one lane up", text: "Does pressing up move one lane?" }]);
  const r1 = record.checks_changed_after_playtest.rules.find((r) => r.rule === "R1");
  assert.equal(r1.classification, "check_bug");
  assert.equal(r1.narrowed, true);
  const summary = s.info.join("\n");
  assert.match(summary, /Test proves less: R1 no longer tests "one lane up"\. You check it on first play: R6\./);
  assert.ok(committed);

  // The agent's copy is as sent; the cart has the new rule, the checks still line up.
  assert.doesNotMatch(fs.readFileSync(path.join(sessionDir, "outputs/spec.md"), "utf8"), /Does pressing up/);
  assert.match(record.spec_diff ?? "", /\+- R6 \(you check\): Does pressing up move one lane\?/);
  assert.equal((await validateRuleCoverage(committed.dir)).ok, true);
  const cart = readCart(s.paths.carts, committed.id);
  assert.ok(cart);
  assert.deepEqual(cart.youCheck.map((r) => r.id), ["R5", "R6"]);
  assert.equal(cart.youCheck[1].text, "Does pressing up move one lane?");
});

test("D49 summary: a narrowed rule that won't say what still gets flagged, and still gets asked", async () => {
  const lines = buildSummary(
    { changed: true, rules_known: true, edit_events: 1, helpers_unjustified: false, helpers_narrowed: true, rules: [{ rule: "R7", classification: "unexplained", narrowed: true, untested: [], what: null }] },
    [{ rule: "R20", from: "R7", words: null }],
  );
  assert.deepEqual(lines, ["Test changed with no explanation: R7.", "Test may prove less: R7, and it doesn't say what. You check it on first play: R20.", "Shared test code may prove less. Worth reading."]);
});
