import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { formatPlan, formatQuestion, parseChoice, planResult, questionResult } from "../src/tiles.js";
import { liveAnswerer, loadAnswers, overlap, replayAnswerer } from "../src/answers.js";
import { sessionCreateBody } from "../src/api.js";
import { MANAGED_AGENT_DIR, readAgentDef, readLock, readSkillLock, STUDIO_TOOLSET } from "../src/config.js";
import { freeId, slugify, specTitle } from "../src/library.js";
import { LINE_STAGE, progressFor, progressGate, tellStage } from "../src/progress.js";
import { judgeReport } from "../src/checks.js";
import { downloadOutputs, extractCart } from "../src/outputs.js";
import { createClient } from "../src/client.js";
import { ensureKitUploaded } from "../src/kit.js";
import { mockApi } from "../test-support/mock-api.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "gsa-unit-"));

test("tiles: question, plan and results", () => {
  assert.equal(
    formatQuestion({ question: "Two players?", option_a: "Side by side", option_b: "Take turns" }),
    "Claude asks: Two players?\n  A) Side by side\n  B) Take turns\n  C) Something else\n  D) Make it now",
  );
  assert.equal(parseChoice(" c "), "C");
  assert.equal(parseChoice("e"), null);
  assert.equal(questionResult({ choice: "A" }), '{"choice":"A"}');
  assert.equal(questionResult({ choice: "C", said: "lava" }), '{"choice":"C","said":"lava"}');
  assert.equal(questionResult({ choice: "D", said: "ignored" }), '{"choice":"D"}');
  assert.equal(planResult({ choice: "build" }), '{"choice":"build"}');
  assert.equal(planResult({ choice: "change", said: "more lives" }), '{"choice":"change","said":"more lives"}');
  const plan = formatPlan({ summary: "Dodge cars.", rules: [{ id: "R1", kind: "auto", text: "Up moves up." }, { id: "R2", kind: "you-check", text: "Frog smiles." }] });
  assert.match(plan, /R1\. Up moves up\.\n/);
  assert.match(plan, /R2\. Frog smiles\.  \(you check\)/);
  assert.doesNotMatch(plan, /What changed/);
  const replan = formatPlan({ summary: "s", rules: [], changes: [{ id: "R8", text: "Boots start at 15%." }] });
  assert.match(replan, /What changed:\n  R8\. Boots start at 15%\./);
});

test("live answerer: re-asks on bad input, C needs words", async () => {
  const typed = ["x", "c", "", "medium speed", "b", "", "three lives"];
  const printed = [];
  const a = liveAnswerer({ prompt: async () => typed.shift() ?? "", print: (s) => printed.push(s) });
  assert.deepEqual(await a.question({ question: "Speed?", option_a: "Slow", option_b: "Fast" }), { choice: "C", said: "medium speed" });
  assert.deepEqual(await a.plan({ summary: "s", rules: [] }), { choice: "change", said: "three lives" });
  assert.match(printed[0], /Claude asks: Speed\?/);
});

test("loadAnswers rejects bad choices", () => {
  const f = path.join(tmp(), "a.json");
  fs.writeFileSync(f, JSON.stringify({ questions: [{ choice: "E" }] }));
  assert.throws(() => loadAnswers(f), /bad choice/);
});

test("session body: pinned agent, model override, kit mount, budget as cents string", () => {
  const base = { agentId: "agent_1", environmentId: "env_1", kitFileId: "file_k", budgetCents: 300 };
  const pinned = sessionCreateBody({ ...base, agentVersion: 4 });
  assert.deepEqual(pinned.agent, { type: "agent", id: "agent_1", version: 4 });
  assert.deepEqual(pinned.resources, [{ type: "file", file_id: "file_k", mount_path: "/mnt/session/uploads/studio-kit.tgz" }]);
  assert.deepEqual(pinned.budget, { type: "limit", max_list_cost: { amount: "300", currency: "USD" } });
  const over = sessionCreateBody({ ...base, agentVersion: 4, model: "claude-opus-5-5" });
  assert.deepEqual(over.agent, { type: "agent_with_overrides", id: "agent_1", model: { id: "claude-opus-5-5" }, version: 4 });
  assert.equal(sessionCreateBody(base).agent, "agent_1");
  const sk = sessionCreateBody({ ...base, model: "claude-sonnet-5-5", skills: [{ type: "custom", skill_id: "skill_1", version: "7" }] });
  assert.deepEqual(sk.agent, { type: "agent_with_overrides", id: "agent_1", model: { id: "claude-sonnet-5-5" }, skills: [{ type: "custom", skill_id: "skill_1", version: "7" }] });
  const brief = sessionCreateBody({ ...base, agentVersion: 1, system: "brief", tools: [{ type: "agent_toolset_20260401" }] });
  assert.deepEqual(brief.agent, { type: "agent_with_overrides", id: "agent_1", version: 1, system: "brief", tools: [{ type: "agent_toolset_20260401" }] });
  const sys = sessionCreateBody({ ...base, system: "harness", extraFiles: [{ fileId: "file_p", mountPath: "/mnt/session/uploads/parity.tgz" }] });
  assert.deepEqual(sys.agent, { type: "agent_with_overrides", id: "agent_1", system: "harness" });
  assert.deepEqual(sys.resources[1], { type: "file", file_id: "file_p", mount_path: "/mnt/session/uploads/parity.tgz" });
  assert.throws(() => sessionCreateBody({ ...base, budgetCents: 2.5 }), /whole number/);
});

test("readLock finds the agent and environment by path", () => {
  const f = path.join(tmp(), "claude-lock.json");
  assert.throws(() => readLock(f), /ant apply/);
  fs.writeFileSync(
    f,
    JSON.stringify({
      version: 1,
      resources: {
        "./agents/studio.md": { kind: "agent", id: "agent_9", version: "3" },
        "./environments/studio.yaml": { kind: "environment", id: "env_9" },
      },
    }),
  );
  assert.deepEqual(readLock(f), { agentId: "agent_9", agentVersion: 3, environmentId: "env_9" });
});

test("readAgentDef gives the repo's brief, and its toolset matches the agent file", () => {
  const def = readAgentDef();
  assert.match(def.system, /^You are the Studio/);
  assert.match(def.system, /The checks are now frozen/);
  assert.doesNotMatch(def.system, /^---/);
  assert.deepEqual(def.tools.map((t) => /** @type {any} */ (t).name ?? /** @type {any} */ (t).type), ["agent_toolset_20260401", "ask_player", "name_version", "show_plan", "tell_player"]);
  const yaml = fs.readFileSync(path.join(MANAGED_AGENT_DIR, "agents/studio.md"), "utf8");
  for (const c of STUDIO_TOOLSET.configs) assert.match(yaml, new RegExp(`- name: ${c.name}\\n\\s+enabled: false`));
  assert.match(yaml, /default_config:\n\s+enabled: true\n\s+permission_policy:\n\s+type: always_allow/);
  assert.match(yaml, /- type: agent_toolset_20260401/);
});

test("readSkillLock finds the skill's id and version", () => {
  const f = path.join(tmp(), "claude-lock.skill.json");
  assert.throws(() => readSkillLock(f), /apply the context-pack skill/);
  fs.writeFileSync(f, JSON.stringify({ resources: { "./skills-staged/studio-context-pack": { kind: "skill", id: "skill_9", version: "123" } } }));
  assert.deepEqual(readSkillLock(f), { type: "custom", skill_id: "skill_9", version: "123" });
});

test("library ids: slug, suffix, title from spec", () => {
  assert.equal(slugify("Candy Pop!"), "candy-pop");
  assert.equal(slugify("Café Crème"), "cafe-creme");
  assert.equal(slugify("!!!"), "cart");
  const root = tmp();
  fs.mkdirSync(path.join(root, "candy-pop"));
  fs.mkdirSync(path.join(root, "candy-pop-2"));
  assert.equal(freeId(root, "Candy Pop"), "candy-pop-3");
  assert.equal(specTitle("# Frog Hop   A · null · sesn_1\n\n## Pitch"), "Frog Hop");
  assert.equal(specTitle("no heading"), null);
});

test("progress lines are kid language", () => {
  assert.equal(progressFor({ name: "bash", input: { command: "node kit/playtest/bin/playtest.js ." } }), "Playing your game to test it");
  assert.equal(progressFor({ name: "write", input: { file_path: "/workspace/cart/game.js" } }), "Writing the game");
  assert.equal(progressFor({ name: "edit", input: { file_path: "/workspace/cart/game.js" } }), "Fixing the game");
  assert.equal(progressFor({ name: "mystery" }), null);
  // Make 1's lines on the virtual cabinet, in the order they came (live report, 2026-11-10): only forward, never twice (D198).
  const gate = progressGate();
  const came = [
    ["Reading your idea", LINE_STAGE["Reading your idea"]],
    ["Getting the game workshop ready", tellStage("setup")],
    ["Getting my tools out", LINE_STAGE["Getting my tools out"]],
    ["Reading up", LINE_STAGE["Reading up"]],
    ["Writing down the rules for your balloon game", tellStage("spec")],
    ["Writing down the rules", LINE_STAGE["Writing down the rules"]],
    ["Building the balloon and the clouds", tellStage("building")],
    ["Checking your game", LINE_STAGE["Checking your game"]],
    ["Playing your game to test it", LINE_STAGE["Playing your game to test it"]],
    ["Playtesting the game against the rules", tellStage("testing")],
    ["One rule failed the test. Fixing it", tellStage("fixing")],
    ["Fixing the game", LINE_STAGE["Fixing the game"]],
    ["Playing your game to test it", LINE_STAGE["Playing your game to test it"]],
    ["Reading up", LINE_STAGE["Reading up"]],
    ["Packing up your game", LINE_STAGE["Packing up your game"]],
    ["All done! Your balloon game is ready to play", tellStage("done")],
    ["A line with no stage", tellStage("somewhere")],
  ];
  assert.deepEqual(came.map(([t, s]) => gate(/** @type {string} */ (t), /** @type {any} */ (s))).filter(Boolean), [
    "Reading your idea",
    "Getting the game workshop ready",
    "Getting my tools out",
    "Reading up",
    "Writing down the rules for your balloon game",
    "Writing down the rules",
    "Building the balloon and the clouds",
    "Checking your game",
    "Playing your game to test it",
    "Playtesting the game against the rules",
    "One rule failed the test. Fixing it",
    "Packing up your game",
    "A line with no stage",
  ]);
  assert.equal(progressFor({ name: "bash", input: { command: "python3 - <<'EOF'\nprint(1)\nEOF" } }), null, "no meaningless line (D198)");
  assert.equal(progressFor({ name: "bash", input: { command: "cp /workspace/cart/spec.md /mnt/session/outputs/spec.md" } }), null, "copying the spec isn't packing");
  assert.equal(progressFor({ name: "bash", input: { command: "tar -czf /mnt/session/outputs/cart.tgz -C /workspace/cart ." } }), "Packing up your game");
  assert.equal(progressFor({ name: "bash", input: { command: "cd /workspace/kit; cat studio-kit/playtest/README.md" } }), "Reading up");
  assert.equal(progressFor({ name: "bash", input: { command: "node /workspace/kit/studio-kit/spec/bin/validate-cart.js /workspace/cart" } }), "Checking your game");
});

test("judgeReport: every auto rule and generic check must pass", () => {
  assert.deepEqual(judgeReport({ rules: [{ id: "R1", kind: "auto", passed: true }, { id: "R2", kind: "you-check", passed: null }], generic: [{ name: "loads", passed: true }] }), { ok: true, failing: [] });
  assert.deepEqual(judgeReport({ rules: [{ id: "R1", passed: false }], generic: [{ name: "soak", passed: false }] }), { ok: false, failing: ["R1", "generic:soak"] });
  assert.equal(judgeReport({ rules: [] }).ok, false, "no auto rules is not a pass");
});

test("extractCart refuses paths that escape the folder", () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, "src/inner"), { recursive: true });
  fs.writeFileSync(path.join(d, "evil.txt"), "x");
  const bad = path.join(d, "bad.tgz");
  execFileSync("tar", ["-czf", bad, "-C", path.join(d, "src/inner"), "../../evil.txt"]);
  assert.throws(() => extractCart(bad, path.join(d, "out")), /unsafe path/);
});

test("createClient comes from @game-studio-arcade/auth with the profile explicit (D17)", async () => {
  const client = await createClient({ profile: "gsa-test-profile" });
  assert.equal(typeof client.beta.sessions.create, "function");
});

test("the kit uploads once per content hash", async () => {
  const d = tmp();
  const out = path.join(d, "kit.tgz");
  fs.writeFileSync(out, "tgz");
  const m = mockApi({ steps: [] });
  const build = () => ({ out, hash: "h1", fileCount: 3, missing: [], bytes: 3 });
  const cacheFile = path.join(d, "kit-uploads.json");
  const a = await ensureKitUploaded({ api: m.api, cacheFile, out, build });
  const b = await ensureKitUploaded({ api: m.api, cacheFile, out, build });
  assert.deepEqual([a.uploaded, b.uploaded, b.fileId], [true, false, "file_kit_01"]);
  assert.equal(m.calls.filter((c) => c.startsWith("upload:")).length, 1);
});

test("the real spec package validates the fixture cart, and catches a missing check", async () => {
  const { defaultChecker } = await import("../src/checks.js");
  const fixtureCart = new URL("../fixtures/frog-hop/cart/", import.meta.url).pathname;
  const good = await defaultChecker().validate(fixtureCart);
  assert.deepEqual(good.problems, []);
  assert.equal(good.ok, true);

  const d = tmp();
  fs.cpSync(fixtureCart, d, { recursive: true });
  fs.writeFileSync(path.join(d, "checks.js"), "export default { R1: async (t) => {} };\n");
  const bad = await defaultChecker().validate(d);
  assert.equal(bad.ok, false);
  const problems = bad.problems ?? [];
  assert.ok(problems.some((p) => p.includes("R2")), problems.join("; "));
});

test("outputs: waits for DONE.json and final sizes; gives up as incomplete", async () => {
  const body = Buffer.from("cart bytes");
  const done = Buffer.from(JSON.stringify({ files: [{ name: "cart.tgz", size: body.length }] }));
  const m = mockApi({ steps: [] }, { outputs: { "cart.tgz": body, "DONE.json": done }, outputLag: 3 });
  const waits = [];
  const ok = await downloadOutputs({ api: m.api, sessionId: "s", dir: tmp(), sleep: async (ms) => void waits.push(ms), waitMs: 7 });
  assert.equal(ok.complete, true);
  assert.deepEqual(waits, [7, 7, 7], "polled through the lag");
  assert.equal(ok.polls, 4);
  assert.deepEqual(ok.files.sort(), ["DONE.json", "cart.tgz"]);
  assert.equal(fs.readFileSync(path.join(ok.dir, "cart.tgz"), "utf8"), "cart bytes");

  const lying = Buffer.from(JSON.stringify({ files: [{ name: "cart.tgz", size: 999 }, { name: "report.json", size: 5 }] }));
  const m2 = mockApi({ steps: [] }, { outputs: { "cart.tgz": body, "DONE.json": lying } });
  const bad = await downloadOutputs({ api: m2.api, sessionId: "s", dir: tmp(), sleep: async () => {}, tries: 3 });
  assert.equal(bad.complete, false);
  assert.deepEqual(bad.missing, ["cart.tgz", "report.json"]);
  assert.ok(bad.files.includes("cart.tgz"), "what's there is still kept");

  const m3 = mockApi({ steps: [] }, { outputs: { "cart.tgz": body } });
  const none = await downloadOutputs({ api: m3.api, sessionId: "s", dir: tmp(), sleep: async () => {}, tries: 2 });
  assert.deepEqual([none.complete, none.missing], [false, ["DONE.json", "report.json"]]);
});

test("the fixture spec is in canonical form: format(parse(x)) === x", async () => {
  const { parseSpec, formatSpec } = await import("@game-studio-arcade/spec");
  const text = fs.readFileSync(new URL("../fixtures/frog-hop/cart/spec.md", import.meta.url), "utf8");
  const spec = parseSpec(text);
  assert.deepEqual(spec.errors, []);
  assert.equal(formatSpec(spec), text);
});

const PENGUIN = JSON.parse(fs.readFileSync(new URL("../fixtures/penguin-catch/answers.json", import.meta.url), "utf8"));
const q = (question, option_a = "One", option_b = "Two") => ({ question, option_a, option_b });

test("D47: replay finds an answer by its question, in any order and wording", async () => {
  const a = replayAnswerer(PENGUIN);
  assert.deepEqual(await a.question(q("Does the penguin slide or hop?", "Slides", "Hops")), { choice: "C", said: "slides left and right but really slippery like on ice" });
  assert.deepEqual(await a.question(q("How does the game get harder?", "Things fall faster", "Faster and more boots")), { choice: "B" });
  assert.deepEqual(await a.question(q("What if you catch a boot?", "Lose a life", "Lose 5 points")), { choice: "A" });
  assert.deepEqual(a.notes?.(), []);
  assert.equal(a.replayLog?.().length, 3);
});

test("D47: options that don't say the recorded answer get its words through C", async () => {
  const a = replayAnswerer(PENGUIN);
  assert.deepEqual(await a.question(q("What happens if you catch a boot?", "Counts as a miss", "Lose some points")), { choice: "C", said: "You lose a life" });
});

test("D171: a tile that only partly says the recorded answer doesn't take it", async () => {
  const a = replayAnswerer(PENGUIN);
  assert.deepEqual(await a.question(q("How does it get harder?", "Fish fall faster", "More fish and more boots")), { choice: "C", said: "Faster and more boots" });
  const b = replayAnswerer(PENGUIN);
  assert.deepEqual(await b.question(q("What happens if you catch a boot?", "Lose a life too", "Lose points")), { choice: "C", said: "You lose a life" });
});

test("D171: a tile that says the same in other small words still takes it", async () => {
  const a = replayAnswerer(PENGUIN);
  assert.deepEqual(await a.question(q("What happens if you catch a boot?", "Lose points", "Lose a life")), { choice: "B" });
  const b = replayAnswerer(PENGUIN);
  assert.deepEqual(await b.question(q("How does it get harder?", "Fish fall faster", "More boots and faster!")), { choice: "B" });
});

test("D47: options keep their meaning when they swap places", async () => {
  const a = replayAnswerer(PENGUIN);
  assert.deepEqual(await a.question(q("What happens when you touch a boot?", "Lose 5 points", "You lose a life")), { choice: "B" });
});

test("D47: a question with no recorded answer gets D, and that's logged", async () => {
  const a = replayAnswerer(PENGUIN);
  assert.deepEqual(await a.question(q("What should the game be called?")), { choice: "D" });
  assert.deepEqual(a.notes?.(), ["replay_unmatched"]);
  assert.deepEqual(a.replayLog?.()[0], { asked: "What should the game be called?", option_a: "One", option_b: "Two", matched: null, choice: "D", said: null });
});

test("D47: a boot question about something else doesn't take the catch answer", async () => {
  const a = replayAnswerer(PENGUIN);
  assert.deepEqual(await a.question(q("How often should boots appear?")), { choice: "D" });
});

test("D47: a follow-up on the same topic reuses the answer", async () => {
  const a = replayAnswerer(PENGUIN);
  await a.question(q("What happens if you catch a boot?", "You lose a life", "Lose points"));
  assert.deepEqual(await a.question(q("And if you touch a boot again?", "You lose a life", "Lose points")), { choice: "A" });
});

test("D47: without match, recorded questions compare by word overlap", async () => {
  const a = replayAnswerer({ questions: [{ question: "What color is the frog?", answer: "Bright green" }] });
  assert.ok(overlap("What color is the frog?", "What color should the frog be?") >= 0.5);
  assert.deepEqual(await a.question(q("What color should the frog be?", "Bright green", "Dark blue")), { choice: "A" });
  assert.deepEqual(await a.question(q("How many lives?")), { choice: "D" });
});

test("D168: unmatched: A answers A, keeps asking, and logs the fallback", async () => {
  const a = replayAnswerer(PENGUIN, { unmatched: "A" });
  assert.deepEqual(await a.question({ question: "What should the game be called?", option_a: "One", option_b: "Two" }), { choice: "A" });
  assert.deepEqual(a.notes?.(), ["replay_fallback"]);
  assert.equal(a.replayLog?.()[0].fallback, true);
  assert.equal(a.replayLog?.()[0].matched, null);
  const b = await a.question({ question: "How should the game get harder?", option_a: "Bigger", option_b: "Faster and more boots" });
  assert.notEqual(b.choice, "D", "a recorded answer still applies after a fallback");
  assert.equal(a.replayLog?.()[1].fallback, undefined);
});

test("a file with no questions still replays by position", async () => {
  const a = replayAnswerer({ questions: [{ choice: "B" }] });
  assert.deepEqual(await a.question(q("Anything?")), { choice: "B" });
  assert.deepEqual(await a.question(q("More?")), { choice: "D" });
  assert.deepEqual(a.notes?.(), ["replay_exhausted"]);
});
