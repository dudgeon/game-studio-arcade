import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildKit, collectKit, stageContextPackSkill } from "../scripts/pack-kit.js";

function fakeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kit-repo-"));
  const put = (p, s) => {
    fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    fs.writeFileSync(path.join(root, p), s);
  };
  put("runtime/index.js", "export const v = 1;\n");
  put("runtime/lib/grid.js", "export {};\n");
  put("runtime/test/grid.test.js", "skip me\n");
  put("runtime/node_modules/x/index.js", "skip me\n");
  put("runtime/.DS_Store", "skip me\n");
  put("studio-kit/spec/README.md", "# Spec\n");
  put("studio-kit/spec/package.json", JSON.stringify({ name: "@gsa/spec", bin: { "validate-cart": "./bin/validate-cart.js" } }));
  put("studio-kit/spec/bin/validate-cart.js", "// validate\n");
  put("studio-kit/context-pack/reference.md", "# Library reference\n");
  put("studio-kit/context-pack/examples/dodge/spec.md", "# Dodge\n");
  return root;
}

const PARTS = [
  { dir: "runtime", what: "Runtime." },
  { dir: "studio-kit/spec", what: "Spec tools." },
  { dir: "studio-kit/playtest", what: "Playtest." },
  { dir: "studio-kit/context-pack", what: "Context pack." },
];

test("collectKit skips tests, node_modules and macOS litter, and lists missing parts", () => {
  const repo = fakeRepo();
  const { files, missing } = collectKit({ repoRoot: repo, parts: PARTS });
  const paths = files.map((f) => f.kitPath);
  assert.deepEqual(paths, [
    "runtime/index.js",
    "runtime/lib/grid.js",
    "studio-kit/context-pack/examples/dodge/spec.md",
    "studio-kit/context-pack/reference.md",
    "studio-kit/spec/README.md",
    "studio-kit/spec/bin/validate-cart.js",
    "studio-kit/spec/package.json",
  ]);
  assert.deepEqual(missing, ["studio-kit/playtest"]);
});

test("buildKit writes a tarball with KIT.md, a stable hash, and commands from package.json", () => {
  const repo = fakeRepo();
  const out = path.join(repo, "dist/kit.tgz");
  const a = buildKit({ repoRoot: repo, parts: PARTS, out });
  const b = buildKit({ repoRoot: repo, parts: PARTS, out: path.join(repo, "dist/kit2.tgz") });
  assert.equal(a.hash, b.hash, "same files give the same hash");
  assert.equal(a.fileCount, 7);

  const x = fs.mkdtempSync(path.join(os.tmpdir(), "kit-x-"));
  execFileSync("tar", ["-xzf", out, "-C", x]);
  const kitMd = fs.readFileSync(path.join(x, "KIT.md"), "utf8");
  assert.match(kitMd, /`validate-cart`: `node \/workspace\/kit\/studio-kit\/spec\/bin\/validate-cart.js`/);
  assert.match(kitMd, /Read first: `studio-kit\/spec\/README.md`/);
  assert.match(kitMd, /## Not in this kit yet\n\n- studio-kit\/playtest\//);
  assert.ok(fs.existsSync(path.join(x, "runtime/lib/grid.js")));
  assert.ok(!fs.existsSync(path.join(x, "runtime/test")));
  const manifest = JSON.parse(fs.readFileSync(path.join(x, "kit.json"), "utf8"));
  assert.equal(manifest.hash, a.hash);

  fs.writeFileSync(path.join(repo, "runtime/index.js"), "export const v = 2;\n");
  const c = buildKit({ repoRoot: repo, parts: PARTS, out });
  assert.notEqual(c.hash, a.hash, "a content change changes the hash");
});

test("stageContextPackSkill writes a SKILL.md beside the pack", () => {
  const repo = fakeRepo();
  const out = path.join(repo, "skills");
  const r = stageContextPackSkill({ repoRoot: repo, outDir: out });
  const skill = fs.readFileSync(path.join(r.dir, "SKILL.md"), "utf8");
  assert.match(skill, /^---\nname: studio-context-pack\n/);
  assert.match(skill, /- `reference.md`/);
  assert.ok(fs.existsSync(path.join(r.dir, "examples/dodge/spec.md")));
});
