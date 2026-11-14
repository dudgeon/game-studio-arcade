// The context pack's own acceptance (D12, D101, D160-D164): every template is a
// valid, fully covered cart that passes its playtest on the installed runtime and
// at the other screen size, its checks catch a broken game, the catalog matches
// what's there, and each piece stays in its token budget.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
// Relative imports, not package names: the packed kit has no node_modules (D63).
import { formatSpec, parseSpec, validateRuleCoverage, validateCart, formatIssues } from "../../spec/index.js";
import { playtest } from "../../playtest/index.js";
import { KIT_PARTS, collectKit } from "../../managed-agent/scripts/pack-kit.js";
import * as lib from "../../../runtime/lib/index.js";
import { packSize, PACK_DIR, BUDGETS, CALIBRATION, MD_CHARS_PER_TOKEN, CODE_CHARS_PER_TOKEN } from "../bin/pack-size.js";

const RUNTIME = path.resolve(PACK_DIR, "../../runtime");
const TEMPLATES = ["blank", "catch", "dodge", "maze", "maze3d", "paddle", "racer", "scroller"];
/** Templates that fill the screen with a floor or walls each frame (D477). */
const FULL_SCREEN = ["maze3d", "racer"];
const dirOf = (/** @type {string} */ c) => path.join(PACK_DIR, "templates", c);
const read = (/** @type {string} */ f) => fs.readFileSync(f, "utf8");
const CATALOG = read(path.join(PACK_DIR, "CATALOG.md"));

/** @param {any} report */
function failures(report) {
  return [...report.rules, ...report.generic]
    .filter((r) => r.passed === false || r.status === "missing")
    .map((r) => `${r.id}: ${r.reason}`)
    .concat(report.coverage.map((/** @type {any} */ c) => c.message));
}

test("the template list is what's on disk", () => {
  assert.deepEqual(fs.readdirSync(path.join(PACK_DIR, "templates")).sort(), TEMPLATES);
});

for (const c of TEMPLATES) {
  test(`${c}: spec parses cleanly and every auto rule has a check`, async () => {
    const spec = parseSpec(read(path.join(dirOf(c), "spec.md")));
    assert.deepEqual(spec.errors, []);
    assert.deepEqual(spec.warnings, []);
    assert.ok(spec.rules.some((r) => r.kind === "auto") && spec.rules.some((r) => r.kind === "you-check"));
    const cov = await validateRuleCoverage(dirOf(c));
    assert.ok(cov.ok, JSON.stringify(cov.errors));
  });

  test(`${c}: spec.md round-trips byte for byte`, () => {
    const text = read(path.join(dirOf(c), "spec.md"));
    assert.equal(formatSpec(parseSpec(text)), text);
  });

  test(`${c}: cart.json is the agent's part: id, title (as in the spec) and one player`, () => {
    const j = JSON.parse(read(path.join(dirOf(c), "cart.json")));
    assert.deepEqual(Object.keys(j), ["id", "title", "players"]);
    assert.equal(j.title, parseSpec(read(path.join(dirOf(c), "spec.md"))).title);
    assert.equal(j.players, 1);
  });

  test(`${c}: passes the full validator (validate_cart, D31) with no warnings`, async () => {
    const r = await validateCart(dirOf(c));
    assert.deepEqual(formatIssues(r), []);
    assert.equal(r.ok, true);
    assert.equal(r.skipped?.types, undefined, "the type-check pass should run, not be skipped");
  });

  test(`${c}: passes its playtest (node driver)`, async () => {
    const report = await playtest(dirOf(c), { driver: "node", out: null });
    if (!FULL_SCREEN.includes(c)) {
      assert.deepEqual(failures(report), []);
      return assert.equal(report.ok, true);
    }
    // These draw every pixel every frame, so a busy machine can push their slowest frames over the
    // budget. Hold them to the median instead, which a busy machine doesn't move much.
    assert.deepEqual(failures(report).filter((f) => !f.startsWith("frame-time:")), []);
    assert.ok(report.frameTime.p50Ms <= report.frameTime.budgetMs, `median frame ${report.frameTime.p50Ms} ms`);
  });

  test(`${c}: is in the catalog and within its budget`, () => {
    assert.match(CATALOG, new RegExp(`\`${c}/\``));
    const t = packSize().templates.find((x) => x.name === c);
    assert.ok(t && t.tokens <= BUDGETS.template, `${c} is ~${t?.tokens} tokens`);
  });
}

// The motion showcase (runtime/examples/motion, D475-D479) isn't a template, but it's the one cart that uses
// every motion and depth module, so it's held to the same standard here. Its frame time is left out: it
// draws a lot on purpose, and a busy machine shouldn't fail the suite.
test("the motion showcase is a valid cart and passes its playtest", async () => {
  const dir = path.join(RUNTIME, "examples/motion");
  const v = await validateCart(dir);
  assert.deepEqual(formatIssues(v), []);
  const report = await playtest(dir, { driver: "node", out: null });
  assert.deepEqual(failures(report).filter((f) => !f.startsWith("frame-time:")), []);
  assert.equal(report.rules.filter((/** @type {any} */ r) => r.kind === "auto" && r.passed).length, 8);
  assert.match(read(path.join(dir, "game.js")), /g\.glide\(\)/);
});

test("the three moving templates glide, and each uses its depth module", () => {
  for (const c of ["scroller", "racer", "maze3d"]) {
    const code = read(path.join(dirOf(c), "game.js"));
    assert.match(code, /g\.glide\(\)/, c);
    assert.match(code, /motion\.approach\(|motion\.drive\(/, c);
    assert.doesNotMatch(code, /\.x [+-]= \d/, `${c}: nothing moves a fixed number of pixels on a button`);
  }
  assert.match(read(path.join(dirOf("racer"), "game.js")), /floor\.draw\(/);
  assert.match(read(path.join(dirOf("maze3d"), "game.js")), /raycast\.draw\(/);
});

test("the scroller template moves the way the movement guide says", () => {
  const src = read(path.join(dirOf("scroller"), "game.js"));
  for (const used of [/g\.glide\(\)/, /motion\.drive\(/, /motion\.move\(/, /camera\.follow\(/, /camera\.use\(/, /camera\.shake\(/, /parallax\.layer\(/, /particles\.burst\(/, /motion\.spring\(/]) assert.match(src, used);
  assert.doesNotMatch(src, /\.x [+-]= \d/, "nothing moves a fixed number of pixels on a button");
  assert.doesNotMatch(CATALOG, /nothing here does 3D or scrolling/);
  assert.doesNotMatch(read(path.join(PACK_DIR, "modules/cart-api.md")), /s\.x \+= 2/);
});

// A check that a broken game still passes proves nothing. poke (D163) and the bot
// must not have made these checks weak, so break each number and see the right rule fail.
const BROKEN = [
  { rule: "R1", was: "speed: 3,", now: "speed: 2," },
  { rule: "R2", was: "spawnEvery: 50,", now: "spawnEvery: 60," },
  { rule: "R3", was: "points: 10,", now: "points: 5," },
  { rule: "R8", was: "fallStep: 0.25,", now: "fallStep: 0.5," },
  { rule: "R8", was: "fallMax: 2.5,", now: "fallMax: 2," },
  { rule: "R9", was: "badEvery: 5,", now: "badEvery: 6," },
  { rule: "R7", was: "lives: 3,", now: "lives: 4," },
  { rule: "R4", was: "        hurt(g, s);\n      }\n    }\n    s.things =", now: "      }\n    }\n    s.things =" },
  { rule: "R5", was: "c.red);\n        hurt(g, s);", now: "c.red);" },
  { rule: "R6", was: "if (t.kind === GOOD) {\n        g.sfx(\"pop\");", now: "{\n        g.sfx(\"pop\");" },
  { rule: "R10", was: "g.lib.score.commit(g, s.sc);", now: "" },
];

for (const b of BROKEN) {
  test(`catch's checks catch a broken game: ${b.rule} on "${b.was.split("\n")[0]}"`, async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gsa-broken-"));
    try {
      fs.cpSync(dirOf("catch"), tmp, { recursive: true });
      const src = read(path.join(tmp, "game.js"));
      assert.ok(src.includes(b.was), "the template still has this text");
      fs.writeFileSync(path.join(tmp, "game.js"), src.replace(b.was, b.now));
      const report = await playtest(tmp, { driver: "node", out: null });
      const failed = report.rules.filter((/** @type {any} */ r) => r.passed === false).map((/** @type {any} */ r) => r.id);
      assert.ok(failed.includes(b.rule), `${b.rule} should fail; failed: ${failed.join(",")}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
}

// The screen size is a runtime constant that has changed before (D81). Run every template
// on a copy of the runtime patched to another size, so they're proven size-independent.
test("every template passes at another screen size too", async (t) => {
  const gfx = read(path.join(RUNTIME, "src/gfx.js"));
  const m = gfx.match(/export const W = (\d+);\s*\nexport const H = (\d+);/);
  if (!m) return t.skip("runtime/src/gfx.js no longer declares W and H as plain constants");
  const [w, h] = m[1] === "320" ? [256, 192] : [320, 256];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gsa-pack-rt-"));
  try {
    const rt = path.join(tmp, "runtime");
    fs.cpSync(RUNTIME, rt, { recursive: true, filter: (src) => !/node_modules|[\\/]test$/.test(src) });
    fs.writeFileSync(path.join(rt, "src/gfx.js"), gfx.replace(m[0], `export const W = ${w};\nexport const H = ${h};`));
    for (const c of TEMPLATES) {
      const report = await playtest(dirOf(c), { driver: "node", out: null, runtime: pathToFileURL(path.join(rt, "index.js")).href });
      assert.deepEqual(failures(report).filter((f) => !(FULL_SCREEN.includes(c) && f.startsWith("frame-time:"))), [], `${c} at ${w}x${h}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("no screen-size literals in the templates", () => {
  for (const c of TEMPLATES) for (const f of ["game.js", "checks.js"]) assert.doesNotMatch(read(path.join(dirOf(c), f)), /\b(320|256|240|192)\b/, `${c}/${f}`);
});

test("every lives game shows hearts, not the word, and every template uses the shared title (D170)", () => {
  for (const c of ["catch", "dodge", "paddle"]) {
    const src = read(path.join(dirOf(c), "game.js"));
    assert.match(src, /fx\.lives\(/, c);
    assert.doesNotMatch(src, /LIVES/, c);
    assert.match(src, /fx\.pop\(/, c);
  }
  assert.match(read(path.join(dirOf("maze"), "game.js")), /fx\.pop\(/);
  for (const c of TEMPLATES) {
    const src = read(path.join(dirOf(c), "game.js"));
    assert.match(src, /const art = fx\.title\(/, c);
    assert.match(src, /fx\.banner\(/, c);
  }
});

test("no template is a falling-blocks game (D12)", () => {
  for (const c of TEMPLATES) {
    const src = read(path.join(dirOf(c), "game.js"));
    assert.doesNotMatch(src, /tryRotate|clearRows|fullRows|grid\.place|dropDistance/, c);
  }
  assert.doesNotMatch(CATALOG, /tetris|falling.?blocks/i);
});

test("the catalog names every library module and guide, and each has its file", () => {
  for (const ns of Object.keys(lib)) {
    assert.match(CATALOG, new RegExp(`^- \`${ns}\`:`, "m"), `${ns} has a catalog line`);
    assert.ok(fs.existsSync(path.join(RUNTIME, "lib/ref", `${ns}.md`)), `${ns} has a ref file`);
  }
  const lines = [...CATALOG.matchAll(/^- `([a-z-]+)`:/gm)].map((x) => x[1]);
  const guides = fs.readdirSync(path.join(PACK_DIR, "modules")).map((f) => f.replace(/\.md$/, ""));
  for (const g of guides) assert.ok(lines.includes(g), `guide ${g} has a catalog line`);
  for (const line of lines) assert.ok(line in lib || guides.includes(line), `catalog line ${line} points to a file`);
  for (const f of fs.readdirSync(path.join(RUNTIME, "lib/ref"))) assert.ok(f.replace(/\.md$/, "") in lib, `ref/${f} is for a real module`);
});

test("each piece stays in its token budget (D164)", () => {
  const r = packSize();
  assert.ok(r.catalog <= BUDGETS.catalog, `the catalog is ~${r.catalog} tokens`);
  for (const m of r.modules) assert.ok(m.tokens <= BUDGETS.module, `${m.name} is ~${m.tokens} tokens`);
});

test("the size ratios match the session they were measured from", () => {
  for (const c of CALIBRATION) {
    const ratio = c.chars / c.tokens;
    const used = c.kind === "md" ? MD_CHARS_PER_TOKEN : CODE_CHARS_PER_TOKEN;
    assert.ok(Math.abs(ratio - used) / used < 0.15, `${c.what}: measured ${ratio.toFixed(2)}, using ${used}`);
  }
  const fixture = path.resolve(PACK_DIR, "../cli/fixtures/penguin-catch/events.jsonl");
  assert.ok(fs.existsSync(fixture), "the session these came from stays in the repo");
});

test("the kit packer ships the catalog, guides and templates", () => {
  assert.ok(KIT_PARTS.some((p) => p.dir === "studio-kit/context-pack"));
  const { files } = collectKit();
  const has = (/** @type {string} */ f) => files.some((x) => x.kitPath === f);
  for (const c of TEMPLATES) assert.ok(has(`studio-kit/context-pack/templates/${c}/checks.js`), c);
  assert.ok(has("studio-kit/context-pack/CATALOG.md"));
  assert.ok(has("studio-kit/context-pack/modules/checks.md"));
  assert.ok(has("runtime/lib/ref/collide.md"));
  assert.ok(has("runtime/lib/bot.js"));
});
