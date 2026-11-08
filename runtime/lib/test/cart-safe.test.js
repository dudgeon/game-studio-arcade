// The library is cart-side code (D50). These checks keep it that way, so the
// root `npm test` catches a helper that wouldn't run inside a cart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as lib from "../index.js";

const here = dirname(fileURLToPath(import.meta.url));
const libDir = join(here, "..");
const sources = readdirSync(libDir).filter((f) => f.endsWith(".js"));

test("type-checks under the cart rules (ES2023, no DOM, no Node)", () => {
  const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
  try {
    execFileSync(process.execPath, [tsc, "-p", join(libDir, "tsconfig.json")], { encoding: "utf8" });
  } catch (/** @type {any} */ e) {
    assert.fail(`tsc failed:\n${e.stdout}${e.stderr}`);
  }
});

test("imports nothing outside runtime/lib, and uses no non-deterministic or host APIs", () => {
  for (const f of sources) {
    const src = readFileSync(join(libDir, f), "utf8").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
    for (const m of src.matchAll(/(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)/g)) {
      const spec = m[1] ?? m[2];
      assert.match(spec, /^\.\/[\w-]+\.js$/, `${f} imports ${spec}`);
    }
    for (const banned of ["Math.random", "Date", "performance", "setTimeout", "setInterval", "globalThis", "window", "document", "fetch", "localStorage", "process"]) {
      assert.ok(!new RegExp(`\\b${banned.replace(".", "\\.")}\\b`).test(src), `${f} uses ${banned}`);
    }
    assert.ok(!/^(?:let|var)\s/m.test(src), `${f} has module-level mutable state`);
  }
});

test("exports are functions or frozen constants", () => {
  for (const [ns, mod] of Object.entries(lib)) {
    for (const [name, v] of Object.entries(mod)) {
      if (typeof v !== "function") assert.ok(Object.isFrozen(v), `${ns}.${name} is shared but not frozen`);
    }
  }
});

test("every export has a reference entry in its ref/<module>.md", () => {
  const ref = readdirSync(join(libDir, "ref")).map((f) => readFileSync(join(libDir, "ref", f), "utf8")).join("\n");
  const headings = new Set([...ref.matchAll(/^### `([\w.]+)\(?/gm)].map((m) => m[1]));
  const missing = [];
  for (const [ns, mod] of Object.entries(lib)) {
    for (const name of Object.keys(mod)) if (!headings.has(`${ns}.${name}`)) missing.push(`${ns}.${name}`);
  }
  assert.deepEqual(missing, [], "add a ### `ns.name(...)` entry for each");
  const extra = [...headings].filter((h) => {
    const [ns, name] = h.split(".");
    return !(ns in lib) || !(name in lib[ns]);
  });
  assert.deepEqual(extra, [], "reference entries with no matching export");
});
