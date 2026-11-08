// The context pack's own acceptance (Phase 0 task 6, D12, D100-D103):
// every example cart is a valid, fully covered cart that passes its playtest
// on the installed runtime and at the other screen size, the pack stays under
// its token budget, and nothing hardcodes the screen size.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// Relative imports, not package names: the packed kit has no node_modules (D63).
import { parseSpec, validateRuleCoverage, validateCart, formatIssues } from "../../spec/index.js";
import { playtest } from "../../playtest/index.js";
import { KIT_PARTS, collectKit } from "../../managed-agent/scripts/pack-kit.js";
import { packSize, PACK_DIR, LIMIT } from "../bin/pack-size.js";

const RUNTIME = path.resolve(PACK_DIR, "../../runtime");
const CARTS = ["dodge", "paddle", "collect"];
const cartDir = (/** @type {string} */ c) => path.join(PACK_DIR, "carts", c);
const read = (/** @type {string} */ f) => fs.readFileSync(f, "utf8");

/** @param {any} report */
function failures(report) {
  return [...report.rules, ...report.generic]
    .filter((r) => r.passed === false || r.status === "missing")
    .map((r) => `${r.id}: ${r.reason}`)
    .concat(report.coverage.map((/** @type {any} */ c) => c.message));
}

for (const c of CARTS) {
  test(`${c}: spec parses cleanly and every auto rule has a check`, async () => {
    const spec = parseSpec(read(path.join(cartDir(c), "spec.md")));
    assert.deepEqual(spec.errors, []);
    assert.deepEqual(spec.warnings, []);
    assert.ok(spec.rules.some((r) => r.kind === "auto") && spec.rules.some((r) => r.kind === "you-check"));
    const cov = await validateRuleCoverage(cartDir(c));
    assert.ok(cov.ok, JSON.stringify(cov.errors));
  });

  // cart.json is what the agent writes (D31): id, title, players. The CLI adds provenance.
  test(`${c}: cart.json is the agent's part: id, title (as in the spec) and one player`, () => {
    const j = JSON.parse(read(path.join(cartDir(c), "cart.json")));
    assert.deepEqual(Object.keys(j), ["id", "title", "players"]);
    assert.equal(j.title, parseSpec(read(path.join(cartDir(c), "spec.md"))).title);
    assert.equal(j.players, 1);
  });

  test(`${c}: passes the full validator (validate_cart, D31) with no warnings`, async () => {
    const r = await validateCart(cartDir(c));
    assert.deepEqual(formatIssues(r), []);
    assert.equal(r.ok, true);
    assert.equal(r.skipped?.types, undefined, "the type-check pass should run, not be skipped");
  });

  test(`${c}: passes its playtest (node driver)`, async () => {
    const report = await playtest(cartDir(c), { driver: "node", out: null });
    assert.deepEqual(failures(report), []);
    assert.equal(report.ok, true);
  });
}

// The screen size is a runtime constant that is changing (D81: 320x256 -> 256x192).
// Run every cart on a copy of the runtime patched to the other size, so the
// examples are proven size-independent before and after the switch.
test("every cart passes at the other screen size too", async (t) => {
  const gfx = read(path.join(RUNTIME, "src/gfx.js"));
  const m = gfx.match(/export const W = (\d+);\s*\nexport const H = (\d+);/);
  if (!m) return t.skip("runtime/src/gfx.js no longer declares W and H as plain constants");
  const [w, h] = m[1] === "320" ? [256, 192] : [320, 256];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gsa-pack-rt-"));
  try {
    const rt = path.join(tmp, "runtime");
    fs.cpSync(RUNTIME, rt, { recursive: true, filter: (src) => !/node_modules|[\\/]test$/.test(src) });
    fs.writeFileSync(path.join(rt, "src/gfx.js"), gfx.replace(m[0], `export const W = ${w};\nexport const H = ${h};`));
    for (const c of CARTS) {
      const report = await playtest(cartDir(c), { driver: "node", out: null, runtime: pathToFileURL(path.join(rt, "index.js")).href });
      assert.deepEqual(failures(report), [], `${c} at ${w}x${h}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("no screen-size literals in the carts or the recipes' code", () => {
  const sources = CARTS.flatMap((c) => ["game.js", "checks.js"].map((f) => path.join("carts", c, f)));
  for (const f of sources) assert.doesNotMatch(read(path.join(PACK_DIR, f)), /\b(320|256|240|192)\b/, f);
  const code = [...read(path.join(PACK_DIR, "RECIPES.md")).matchAll(/```js\n([\s\S]*?)```/g)].map((x) => x[1]).join("\n");
  assert.doesNotMatch(code, /\b(320|256|240|192)\b/);
});

test("no example is a falling-blocks game (D12)", () => {
  for (const c of CARTS) {
    const src = read(path.join(cartDir(c), "game.js"));
    assert.doesNotMatch(src, /tryRotate|clearRows|fullRows|grid\.place|dropDistance/, c);
  }
});

test(`the pack stays under the ${LIMIT}-token ceiling`, () => {
  const r = packSize();
  assert.ok(r.tokens <= LIMIT, `pack is ~${r.tokens} tokens`);
});

test("the kit packer ships the context pack", () => {
  assert.ok(KIT_PARTS.some((p) => p.dir === "studio-kit/context-pack"));
  const { files } = collectKit();
  for (const c of CARTS) assert.ok(files.some((f) => f.kitPath === `studio-kit/context-pack/carts/${c}/checks.js`), c);
  assert.ok(files.some((f) => f.kitPath === "studio-kit/context-pack/RECIPES.md"));
});
