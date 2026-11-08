#!/usr/bin/env node
// Size of the context pack as a Studio session reads it: this folder's docs and
// example carts plus the library reference it points to (runtime/lib/REFERENCE.md).
//
//   node studio-kit/context-pack/bin/pack-size.js [--json]
//
// Tokens are an offline estimate (no API call): characters / 4 for prose and
// / 3.2 for code and JSON, which is on the high side for Claude's tokenizer on
// this kind of text. The target is ~15k tokens (Phase 0 task 6); the test
// fails above LIMIT, which leaves room for the library reference to grow (D102).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const PACK_DIR = path.resolve(here, "..");
export const TARGET = 15000;
export const LIMIT = 16500;

/** Files a session reads, relative to the pack folder: docs, then each cart's files. */
export function packFiles(dir = PACK_DIR) {
  const files = ["README.md", "RECIPES.md", "../../runtime/lib/REFERENCE.md"];
  const carts = path.join(dir, "carts");
  for (const c of fs.readdirSync(carts).sort()) {
    for (const f of ["spec.md", "cart.json", "game.js", "checks.js"]) {
      if (fs.existsSync(path.join(carts, c, f))) files.push(`carts/${c}/${f}`);
    }
  }
  return files;
}

/** @param {string} file @param {string} text */
export const estimateTokens = (file, text) => Math.ceil(text.length / (file.endsWith(".md") ? 4 : 3.2));

export function packSize(dir = PACK_DIR) {
  const rows = packFiles(dir).map((f) => {
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    return { file: f, chars: text.length, tokens: estimateTokens(f, text) };
  });
  return { rows, chars: rows.reduce((a, r) => a + r.chars, 0), tokens: rows.reduce((a, r) => a + r.tokens, 0), target: TARGET, limit: LIMIT };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = packSize();
  if (process.argv.includes("--json")) console.log(JSON.stringify(r, null, 2));
  else {
    for (const row of r.rows) console.log(`${String(row.tokens).padStart(6)}  ${row.file}`);
    console.log(`${String(r.tokens).padStart(6)}  total (~tokens, estimate; ${r.chars} chars; target ${r.target}, limit ${r.limit})`);
  }
}
