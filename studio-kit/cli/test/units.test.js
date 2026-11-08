import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { formatPlan, formatQuestion, parseChoice, planResult, questionResult } from "../src/tiles.js";
import { liveAnswerer, loadAnswers } from "../src/answers.js";
import { sessionCreateBody } from "../src/api.js";
import { readLock } from "../src/config.js";
import { freeId, slugify, specTitle } from "../src/library.js";
import { progressFor } from "../src/progress.js";
import { judgeReport } from "../src/checks.js";
import { extractCart } from "../src/outputs.js";
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
  assert.deepEqual(pinned.resources, [{ type: "file", file_id: "file_k", mount_path: "/studio-kit.tgz" }]);
  assert.deepEqual(pinned.budget, { type: "limit", max_list_cost: { amount: "300", currency: "USD" } });
  const over = sessionCreateBody({ ...base, agentVersion: 4, model: "claude-opus-5-5" });
  assert.deepEqual(over.agent, { type: "agent_with_overrides", id: "agent_1", model: { id: "claude-opus-5-5" }, version: 4 });
  assert.equal(sessionCreateBody(base).agent, "agent_1");
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

test("createClient refuses an API key in the environment (D16)", async () => {
  await assert.rejects(createClient({ env: { ANTHROPIC_API_KEY: "" } }), /ANTHROPIC_API_KEY is set/);
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
