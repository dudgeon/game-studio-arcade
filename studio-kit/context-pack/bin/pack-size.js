#!/usr/bin/env node
// What the context pack costs a Studio session, file by file (D164).
//
//   node studio-kit/context-pack/bin/pack-size.js [--json]
//
// Tokens are offline estimates from a measured ratio: the Penguin Catch session's
// real reads (docs/cost-penguin-catch.md) came to about 2.58 characters per token
// for Markdown and 2.35 for code. Nothing is read in full any more, so there are
// budgets per piece and a figure for what a typical build reads.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const PACK_DIR = path.resolve(here, "..");
const LIB_REF = path.resolve(PACK_DIR, "../../runtime/lib/ref");

export const MD_CHARS_PER_TOKEN = 2.58;
export const CODE_CHARS_PER_TOKEN = 2.35;

/** Evidence for the ratios: file sizes and measured tokens from that session's reads. */
export const CALIBRATION = [
  { what: "runtime/lib/REFERENCE.md", kind: "md", chars: 22044, tokens: 8540 },
  { what: "runtime/README.md", kind: "md", chars: 8846, tokens: 3834 },
  { what: "the dodge cart", kind: "code", chars: 9111, tokens: 3896 },
  { what: "cart.d.ts + palette.js", kind: "code", chars: 11476, tokens: 4810 },
];

// template: 5,000 since D478: a scrolling game carries a map and a camera, and wouldn't fit 4,500.
export const BUDGETS = { catalog: 2000, module: 1500, template: 5000 };

/** @param {string} file @param {string} text */
export const estimateTokens = (file, text) => Math.ceil(text.length / (file.endsWith(".md") ? MD_CHARS_PER_TOKEN : CODE_CHARS_PER_TOKEN));

const size = (/** @type {string} */ abs) => estimateTokens(abs, fs.readFileSync(abs, "utf8"));
const mdIn = (/** @type {string} */ dir) => fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();

export function templateNames(dir = PACK_DIR) {
  return fs.readdirSync(path.join(dir, "templates")).sort();
}

export const TEMPLATE_FILES = ["spec.md", "cart.json", "game.js", "checks.js"];

/** Tokens in the catalog, each module and each template. */
export function packSize(dir = PACK_DIR) {
  const catalog = size(path.join(dir, "CATALOG.md"));
  const modules = [
    ...mdIn(LIB_REF).map((f) => ({ name: `ref/${f}`, tokens: size(path.join(LIB_REF, f)) })),
    ...mdIn(path.join(dir, "modules")).map((f) => ({ name: `modules/${f}`, tokens: size(path.join(dir, "modules", f)) })),
  ];
  const templates = templateNames(dir).map((name) => ({
    name,
    tokens: TEMPLATE_FILES.reduce((n, f) => n + size(path.join(dir, "templates", name, f)), 0),
  }));
  const of = (/** @type {string} */ n) => modules.find((m) => m.name === n)?.tokens ?? 0;
  const tpl = (/** @type {string} */ n) => templates.find((t) => t.name === n)?.tokens ?? 0;
  // A catch game built from scratch: guides plus the modules it uses, plus the blank start.
  const scratch = catalog + of("modules/cart-api.md") + of("modules/checks.md") + of("modules/spec.md") + of("modules/sprites.md") + of("ref/collide.md") + of("ref/flow.md") + of("ref/score.md") + of("ref/timers.md") + tpl("blank");
  // The same game from its template: only the guides for what it edits.
  const fromTemplate = catalog + of("modules/cart-api.md") + of("modules/checks.md") + of("modules/sprites.md") + tpl("catch");
  return { catalog, modules, templates, typical: { scratch, fromTemplate }, budgets: BUDGETS };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = packSize();
  if (process.argv.includes("--json")) console.log(JSON.stringify(r, null, 2));
  else {
    const row = (/** @type {number} */ n, /** @type {string} */ s) => console.log(`${String(n).padStart(6)}  ${s}`);
    row(r.catalog, `CATALOG.md (always read; budget ${r.budgets.catalog})`);
    console.log(`modules (on demand; budget ${r.budgets.module} each):`);
    for (const m of r.modules) row(m.tokens, m.name);
    console.log(`templates (the one that's used; budget ${r.budgets.template} each):`);
    for (const t of r.templates) row(t.tokens, t.name);
    console.log("a typical catch game reads:");
    row(r.typical.scratch, "from blank");
    row(r.typical.fromTemplate, "from its template");
  }
}
