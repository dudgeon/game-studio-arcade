// Static checks on the Studio agent definition, so a bad edit fails here
// instead of at `ant apply` or in a live session.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const BUILT_INS = ["bash", "read", "write", "edit", "glob", "grep", "web_fetch", "web_search"];

function frontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(m, "agent file has YAML frontmatter and a body");
  return { yaml: m[1], body: m[2] };
}

test("agent frontmatter: name, default model, web tools off, custom tools inserted", () => {
  const { yaml, body } = frontmatter(read("agents/studio.md"));
  assert.match(yaml, /^name: Studio$/m);
  assert.match(yaml, /^model: claude-sonnet-5-5$/m);
  assert.match(yaml, /- type: agent_toolset_20260401/);
  for (const t of ["web_fetch", "web_search"]) {
    assert.match(yaml, new RegExp(`- name: ${t}\\n\\s+enabled: false`), `${t} disabled`);
  }
  assert.match(yaml, /- \.\/tools\/\*\.json/);
  assert.match(yaml, /permission_policy:\n\s+type: always_allow/, "unattended runs never wait on a confirmation (D19)");
  assert.doesNotMatch(yaml, /^system:/m, "the system prompt is the body, not a frontmatter field");
  assert.ok(body.trim().length > 500, "body holds the system prompt");
});

test("system prompt covers the kid brief, D-meaning, spec-first and outputs", () => {
  const { body } = frontmatter(read("agents/studio.md"));
  for (const needle of [
    "aged 10 and 13",
    "Claude, an AI",
    "inspired by, never copies",
    "D means stop asking",
    "(auto)",
    "(you check)",
    "show_plan",
    "tell_player",
    "/mnt/session/uploads/studio-kit.tgz",
    "KIT.md",
    "/mnt/session/outputs/",
    "cart.tgz",
    "report.json",
    "gave_up",
    "DONE.json",
  ]) {
    assert.ok(body.includes(needle), `prompt mentions ${needle}`);
  }
});

const toolFiles = fs.readdirSync(path.join(root, "agents/tools")).filter((f) => f.endsWith(".json"));

test("custom tools are valid and allowed names", () => {
  assert.deepEqual(toolFiles.sort(), ["ask_player.json", "show_plan.json", "tell_player.json"]);
  for (const f of toolFiles) {
    const tool = JSON.parse(read(`agents/tools/${f}`));
    assert.equal(tool.type, "custom");
    assert.equal(`${tool.name}.json`, f);
    assert.ok(!/^(mcp__|ant__)/.test(tool.name) && !BUILT_INS.includes(tool.name), `${tool.name} is an allowed name`);
    assert.ok(tool.description.length > 120, `${tool.name} has a detailed description`);
    assert.equal(tool.input_schema.type, "object");
    for (const r of tool.input_schema.required) assert.ok(tool.input_schema.properties[r], `${tool.name}.${r} defined`);
  }
});

test("ask_player matches HANDOFF §9.1", () => {
  const t = JSON.parse(read("agents/tools/ask_player.json"));
  assert.deepEqual(t.input_schema.required, ["question", "option_a", "option_b"]);
  for (const choice of ['{\\"choice\\":\\"A\\"}', '{\\"choice\\":\\"D\\"}', '\\"said\\"']) {
    assert.ok(JSON.stringify(t.description).includes(choice), `description documents ${choice}`);
  }
});

test("environment is limited with no hosts", () => {
  const env = read("environments/studio.yaml");
  assert.match(env, /^\s+type: cloud$/m);
  assert.match(env, /^\s+type: limited$/m);
  assert.match(env, /^\s+allowed_hosts: \[\]$/m);
  assert.match(env, /^\s+allow_package_managers: false$/m);
  assert.match(env, /^\s+allow_mcp_servers: false$/m);
  assert.doesNotMatch(env, /packages:/);
});
