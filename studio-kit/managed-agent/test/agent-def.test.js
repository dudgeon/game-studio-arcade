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
    "and nothing else yet",
    "Don't open a template, module or guide until you've finished asking",
    "how the player moves",
    "the player's answers override them",
    "Every answer must show up as a rule or an Assumption",
    "Fetch the rest as you need it",
    "t.bot",
    "started_from",
    "/mnt/session/outputs/",
    "cart.tgz",
    "report.json",
    "gave_up",
    "DONE.json",
    "checks.frozen.js",
    "spec.frozen.md",
    "The checks are now frozen",
    "Never write to them again",
    "A failing check means fix `game.js`",
    "**First** change the spec rule",
    "**Check bug:**",
    "**Rule change:**",
    "Quote the rule",
    "check_changes",
    "only once, as a final check",
    "**Say what's untested (D49):**",
    '"untested": [{"words"',
  ]) {
    assert.ok(body.includes(needle), `prompt mentions ${needle}`);
  }
});

test("the first question checks the idea was heard right, every time, for new games and changes (D308)", () => {
  const { body } = frontmatter(read("agents/studio.md"));
  const at = (s) => body.indexOf(s);
  assert.ok(body.includes("Your first question always checks you heard them right (D308)."));
  assert.ok(body.includes('`option_a` "Yes, that\'s it", `option_b` "Not quite"'), "the two tiles' words");
  assert.ok(!body.includes('`option_b` "Something else"'), "B never repeats C's label (D309)");
  assert.ok(body.includes("Ask it once, every time"));
  assert.ok(at("Ask, before reading anything more") < at("(D308)") && at("(D308)") < at("Pick a starting point"), "it's part of asking");
  assert.ok(body.includes("Your first question restates the change they asked for, the same way (D308)."), "forks and changes too");
});

const toolFiles = fs.readdirSync(path.join(root, "agents/tools")).filter((f) => f.endsWith(".json"));

test("custom tools are valid and allowed names", () => {
  assert.deepEqual(toolFiles.sort(), ["ask_player.json", "name_version.json", "show_plan.json", "tell_player.json"]);
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

test("name_version: two names, Claude's pick, and the name comes back (D471)", () => {
  const t = JSON.parse(read("agents/tools/name_version.json"));
  assert.deepEqual(t.input_schema.required, ["option_a", "option_b", "pick"]);
  assert.deepEqual(t.input_schema.properties.pick.enum, ["A", "B"]);
  for (const needle of ["You pick", "Something else", "at most 16 characters", '{\\"choice\\":\\"A\\",\\"name\\":']) {
    assert.ok(JSON.stringify(t.description).includes(needle), `description documents ${needle}`);
  }
  const { body } = frontmatter(read("agents/studio.md"));
  for (const needle of ["**A version's name (D471).**", "as soon as the player says build on the plan", '`- v3 "Faster logs": The logs move faster.`', '`"version_name": "Faster logs"`', "Never call `name_version` for a new game"]) {
    assert.ok(body.includes(needle), `prompt says: ${needle}`);
  }
});

test("show_plan can carry the changes a frozen check needs (D44)", () => {
  const t = JSON.parse(read("agents/tools/show_plan.json"));
  assert.deepEqual(t.input_schema.required, ["summary", "controls", "rules"], "changes stays optional; how to play is required (D217)");
  assert.deepEqual(t.input_schema.properties.changes.items.required, ["id", "text"]);
});

test("the prompt asks before reading more, and starts from a template before the spec (D161, D165)", () => {
  const { body } = frontmatter(read("agents/studio.md"));
  const at = (s) => body.indexOf(s);
  assert.ok(at("Ask, before reading anything more") < at("Pick a starting point"));
  assert.ok(at("Pick a starting point") < at("Write the checks, from the spec"));
});

test("the prompt puts checks before game code and the snapshot before the build", () => {
  const { body } = frontmatter(read("agents/studio.md"));
  const at = (s) => body.indexOf(s);
  assert.ok(at("Write the checks, from the spec") < at("Build from the spec"));
  assert.ok(at("checks.frozen.js") < at("Build from the spec"));
  assert.ok(at("Build from the spec") < at("Test and fix the game"));
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
