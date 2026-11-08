// D44: spotting check edits after the first playtest.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { analyzeFreeze, bashWrites, isPlaytestRun, parsePlaytestLines, splitChecks } from "../src/freeze.js";

const recorded = fs
  .readFileSync(new URL("../fixtures/penguin-catch/events.jsonl", import.meta.url), "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));

test("bashWrites knows writes from reads, and the file from its snapshot", () => {
  const writes = [
    "cd /workspace/cart && sed -i 's/frames: 300;/frames: 90;/' checks.js",
    "cat > /workspace/cart/checks.js <<'EOF'\nexport default {};\nEOF",
    "python3 - <<'EOF'\ns=open('checks.js').read()\nopen('checks.js','w').write(s)\nEOF",
    "python3 - <<'EOF'\ns=open('/workspace/cart/checks.js').read()\nopen('/workspace/cart/checks.js','w').write(s)\nEOF",
    "python3 - <<'EOF'\np='/workspace/cart/checks.js'\nopen(p,'w').write('x')\nEOF",
    "node -e \"fs.writeFileSync('checks.js', s)\"",
    "cp /tmp/new.js /workspace/cart/checks.js",
    "echo x | tee /workspace/cart/checks.js",
  ];
  for (const c of writes) assert.equal(bashWrites(c, "checks.js"), true, c);
  const reads = [
    "cat /workspace/cart/checks.js",
    "grep -n R4 checks.js",
    "cp /workspace/cart/checks.js /mnt/session/outputs/checks.frozen.js",
    "cat > /tmp/d.mjs <<'EOF'\nimport '/workspace/cart/checks.js';\nEOF",
    "python3 - <<'EOF'\ns=open('checks.js').read()\nopen('game.js','w').write(s)\nEOF",
    "tar -czf /mnt/session/outputs/cart.tgz -C /workspace/cart .",
    "sed -i 's/a/b/' game.js",
    "cp /workspace/cart/checks.js /mnt/session/outputs/checks.js",
  ];
  for (const c of reads) assert.equal(bashWrites(c, "checks.js"), false, c);
});

test("isPlaytestRun matches running it, not reading about it", () => {
  assert.equal(isPlaytestRun('cd kit; NODE_PATH="$(npm root -g)" node studio-kit/playtest/bin/gsa-playtest.js /workspace/cart --driver browser'), true);
  assert.equal(isPlaytestRun("gsa-playtest /workspace/cart"), true);
  assert.equal(isPlaytestRun("cd kit; cat studio-kit/playtest/README.md"), false);
});

test("parsePlaytestLines and splitChecks", () => {
  assert.deepEqual(parsePlaytestLines("  FAIL      R1: nope\n  PASS      R2\n  PASS      loads\n"), { pass: ["R2"], fail: ["R1"] });
  const s = splitChecks('const h = 1;\nexport default {\n  R1: async (t) => { await t.step(1); },\n  "R2": async (t) => {},\n};\n');
  assert.equal(s.header, "const h = 1; export default {");
  assert.deepEqual(Object.keys(s.rules), ["R1", "R2"]);
});

test("the recorded penguin build: 5 first-run failures, 3 check edits, no game edits", () => {
  const a = analyzeFreeze(recorded, { frozenChecks: null, frozenSpec: null, finalChecks: "export default {};", finalSpec: null });
  assert.deepEqual(a.first_playtest?.fail, ["R1", "R4", "R7", "R8", "R9"]);
  assert.deepEqual(a.edits_after_first_playtest, { game_js: 0, checks_js: 3, spec_md: 0 });
  const c = a.checks_changed_after_playtest;
  assert.equal(c.changed, true);
  assert.equal(c.baseline, "none", "that build predates the snapshot");
  assert.equal(c.rules_known, false);
});

const SPEC = (rule, assumptions = "- A1: Fish are worth 10.") => `# Game

maker: A · with: — · parent: — · session: s

## Pitch

A game.

## Rules

- R1 (auto): Up moves up.
- R2 (auto): ${rule}
- R3 (auto): Lives start at 3.

## Controls

Stick.

## Look & sound

Bright.

## Assumptions

${assumptions}

## Changelog

- v1: First.
`;
const CHECKS = (r2, r3 = "t.step(3)") => `export default {\n  R1: async (t) => { await t.step(1); },\n  R2: async (t) => { await ${r2}; },\n  R3: async (t) => { await ${r3}; },\n};\n`;

const use = (id, command) => ({ id, type: "agent.tool_use", name: "bash", input: { command } });
const result = (id, text) => ({ type: "agent.tool_result", tool_use_id: id, content: [{ type: "text", text }] });
const SNAP = "cp /workspace/cart/spec.md /mnt/session/outputs/spec.frozen.md && cp /workspace/cart/checks.js /mnt/session/outputs/checks.frozen.js";
const RUN = "node studio-kit/playtest/bin/gsa-playtest.js /workspace/cart";
const plan = (id, changes) => ({ id, type: "agent.custom_tool_use", name: "show_plan", input: { summary: "s", rules: [], changes } });

test("a clean build: game fixed, checks untouched", () => {
  const events = [use("a", SNAP), use("b", RUN), result("b", "  FAIL      R2: no\n  PASS      R1\n"), use("c", "sed -i 's/a/b/' /workspace/cart/game.js"), use("d", RUN), result("d", "  PASS      R1\n  PASS      R2\n")];
  const a = analyzeFreeze(events, { frozenChecks: CHECKS("t.step(2)"), frozenSpec: SPEC("Hit costs a life."), finalChecks: CHECKS("t.step(2)"), finalSpec: SPEC("Hit costs a life.") });
  assert.deepEqual(a.first_playtest?.fail, ["R2"]);
  assert.equal(a.playtest_runs, 2);
  assert.deepEqual(a.edits_after_first_playtest, { game_js: 1, checks_js: 0, spec_md: 0 });
  assert.equal(a.checks_changed_after_playtest.changed, false);
  assert.equal(a.checks_changed_after_playtest.baseline, "snapshot");
  assert.deepEqual(a.checks_changed_after_playtest.rules, []);
});

test("a check changed with an Assumption naming the rule, shown in the plan: justified", () => {
  const events = [use("a", SNAP), use("b", RUN), plan("p", [{ id: "R2", text: "A hit costs two lives." }]), use("c", "sed -i 's/x/y/' checks.js")];
  const a = analyzeFreeze(events, {
    frozenChecks: CHECKS("t.step(2)"),
    frozenSpec: SPEC("Hit costs a life."),
    finalChecks: CHECKS("t.step(9)"),
    finalSpec: SPEC("Hit costs a life.", "- A1: Fish are worth 10.\n- A2: R2 a hit takes effect after 9 frames."),
  });
  const c = a.checks_changed_after_playtest;
  assert.equal(c.changed, true);
  assert.equal(c.edit_events, 1);
  assert.deepEqual(c.assumptions_added, ["A2"]);
  assert.deepEqual(c.rules, [{ rule: "R2", spec_changed: true, rule_text_changed: false, assumption_names_rule: true, shown_in_plan: true }]);
  assert.deepEqual(c.unjustified, []);
});

test("a rule's own text changing also justifies its check", () => {
  const a = analyzeFreeze([use("a", SNAP), use("b", RUN)], { frozenChecks: CHECKS("t.step(2)"), frozenSpec: SPEC("Hit costs a life."), finalChecks: CHECKS("t.step(9)"), finalSpec: SPEC("Hit costs two lives.") });
  assert.deepEqual(a.checks_changed_after_playtest.rules, [{ rule: "R2", spec_changed: true, rule_text_changed: true, assumption_names_rule: false, shown_in_plan: false }]);
});

test("a check changed with no spec change is unjustified, and only that rule is named", () => {
  const a = analyzeFreeze([use("a", SNAP), use("b", RUN), use("c", "sed -i 's/x/y/' checks.js")], {
    frozenChecks: CHECKS("t.step(2)"),
    frozenSpec: SPEC("Hit costs a life."),
    finalChecks: CHECKS("t.step(2)", "t.step(30)"),
    finalSpec: SPEC("Hit costs a life.", "- A1: Fish are worth 10.\n- A2: R2 is about hits."),
  });
  assert.deepEqual(a.checks_changed_after_playtest.rules.map((r) => r.rule), ["R3"]);
  assert.deepEqual(a.checks_changed_after_playtest.unjustified, ["R3"], "an Assumption about R2 doesn't excuse R3");
});

test("a snapshot taken after the first playtest isn't trusted", () => {
  const a = analyzeFreeze([use("b", RUN), use("c", "sed -i 's/x/y/' checks.js"), use("a", SNAP)], { frozenChecks: CHECKS("t.step(9)"), frozenSpec: SPEC("x"), finalChecks: CHECKS("t.step(9)"), finalSpec: SPEC("x") });
  const c = a.checks_changed_after_playtest;
  assert.equal(c.baseline, "none");
  assert.equal(c.changed, true, "the bash edit is still seen");
});

test("no playtest at all: nothing to report, nothing thrown", () => {
  const a = analyzeFreeze([], { frozenChecks: null, frozenSpec: null, finalChecks: null, finalSpec: null });
  assert.equal(a.first_playtest, null);
  assert.equal(a.checks_changed_after_playtest.changed, false);
});
