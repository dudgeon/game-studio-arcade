#!/usr/bin/env node
// Builds the studio kit tarball that every Studio session mounts (D42).
//
//   node studio-kit/managed-agent/scripts/pack-kit.js [--out FILE] [--skill-dir DIR]
//
// The kit holds the runtime, starter library, spec tools, playtest harness,
// context pack and tools: everything a session needs offline. A generated
// KIT.md at the kit root tells the agent what's inside and which commands to
// run; the agent reads it first, so command names live here, not in the prompt.
//
// Uploading (Files API) lives in studio-kit/cli (`studio kit --upload`), which
// owns the API client. This file has no dependencies and makes no network calls.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "../../..");

/** Folders (relative to the repo root) that go into the kit, in KIT.md order. */
export const KIT_PARTS = [
  { dir: "runtime", what: "House runtime and starter library (runtime/lib/). Carts run on this." },
  { dir: "studio-kit/spec", what: "spec.md template, the guide to writing checkable rules, the checks.js format, the spec parser, and validate_cart (the `validate-cart` command)." },
  { dir: "studio-kit/tools", what: "Other cart tools (new_cart, import_asset), once they exist." },
  { dir: "studio-kit/playtest", what: "Playtest harness. Uses the sandbox's preinstalled Playwright and Chromium; never install another." },
  { dir: "studio-kit/context-pack", what: "Library reference, recipes and three tiny example carts. Read it before designing." },
];

const SKIP_NAMES = new Set(["node_modules", ".git", ".DS_Store", "test", "dist", "coverage"]);
const isSkipped = (name) => SKIP_NAMES.has(name) || name.endsWith(".test.js") || name.startsWith("._");

/**
 * List every file of the kit parts that exist, sorted by kit path.
 * @param {{repoRoot?: string, parts?: {dir: string, what: string}[]}} [opts]
 * @returns {{files: {kitPath: string, abs: string}[], present: {dir: string, what: string}[], missing: string[]}}
 */
export function collectKit(opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const parts = opts.parts ?? KIT_PARTS;
  /** @type {{kitPath: string, abs: string}[]} */
  const files = [];
  const present = [];
  const missing = [];
  for (const part of parts) {
    const root = path.join(repoRoot, part.dir);
    if (!fs.existsSync(root)) {
      missing.push(part.dir);
      continue;
    }
    present.push(part);
    walk(root, (abs) => files.push({ kitPath: path.relative(repoRoot, abs).split(path.sep).join("/"), abs }));
  }
  files.sort((a, b) => (a.kitPath < b.kitPath ? -1 : a.kitPath > b.kitPath ? 1 : 0));
  return { files, present, missing };
}

function walk(dir, onFile) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (isSkipped(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, onFile);
    else if (entry.isFile()) onFile(abs);
  }
}

/**
 * Content hash of the kit: paths plus file contents, independent of tar metadata.
 * The same files always give the same hash, so an unchanged kit is uploaded once.
 * @param {{kitPath: string, abs: string}[]} files
 * @param {string} kitMd
 */
export function kitHash(files, kitMd) {
  const h = crypto.createHash("sha256");
  for (const f of files) {
    h.update(f.kitPath).update("\0");
    h.update(crypto.createHash("sha256").update(fs.readFileSync(f.abs)).digest("hex")).update("\n");
  }
  h.update("KIT.md\0").update(kitMd);
  return h.digest("hex");
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Generate KIT.md: what's in the kit, each part's README, and its commands.
 * Commands come from each part's package.json `bin` and `scripts`, so the parts'
 * owners define them and this file never goes stale.
 * @param {{repoRoot?: string, present: {dir: string, what: string}[], missing: string[]}} info
 */
export function renderKitMd(info) {
  const repoRoot = info.repoRoot ?? REPO_ROOT;
  const lines = [
    "# Studio kit",
    "",
    "Extracted at `/workspace/kit/`. Paths below are relative to it. There is no network: use what's here.",
    "",
  ];
  for (const part of info.present) {
    lines.push(`## ${part.dir}/`, "", part.what, "");
    const readme = path.join(repoRoot, part.dir, "README.md");
    if (fs.existsSync(readme)) lines.push(`Read first: \`${part.dir}/README.md\`.`, "");
    const pkg = readJson(path.join(repoRoot, part.dir, "package.json"));
    const bins = pkg && pkg.bin ? (typeof pkg.bin === "string" ? { [pkg.name]: pkg.bin } : pkg.bin) : {};
    const binNames = Object.keys(bins);
    if (binNames.length) {
      lines.push("Commands:", "");
      for (const name of binNames) {
        lines.push(`- \`${name}\`: \`node /workspace/kit/${part.dir}/${String(bins[name]).replace(/^\.\//, "")}\``);
      }
      lines.push("");
    }
  }
  if (info.missing.length) {
    lines.push("## Not in this kit yet", "", ...info.missing.map((d) => `- ${d}/`), "");
  }
  lines.push(
    "## Where things go",
    "",
    "- Build the cart in `/workspace/cart/`.",
    "- Final outputs go flat in `/mnt/session/outputs/`: `cart.tgz`, `report.json`, `spec.md`, then `DONE.json` last.",
    "",
  );
  return lines.join("\n");
}

/**
 * Build the tarball. Files are staged in a temp dir so the archive holds exactly
 * the kit, with no macOS metadata.
 * @param {{out: string, repoRoot?: string, parts?: {dir: string, what: string}[]}} opts
 * @returns {{out: string, hash: string, fileCount: number, missing: string[], bytes: number}}
 */
export function buildKit(opts) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const { files, present, missing } = collectKit({ repoRoot, parts: opts.parts });
  const kitMd = renderKitMd({ repoRoot, present, missing });
  const hash = kitHash(files, kitMd);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "studio-kit-"));
  try {
    for (const f of files) {
      const dest = path.join(stage, f.kitPath);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(f.abs, dest);
    }
    fs.writeFileSync(path.join(stage, "KIT.md"), kitMd);
    fs.writeFileSync(path.join(stage, "kit.json"), JSON.stringify({ hash, files: files.map((f) => f.kitPath) }, null, 2) + "\n");
    fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
    // D19: no macOS extended attributes or AppleDouble files in the kit.
    const macFlags = process.platform === "darwin" ? ["--no-xattrs", "--no-mac-metadata"] : [];
    execFileSync("tar", [...macFlags, "-czf", path.resolve(opts.out), "-C", stage, "."], {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    });
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
  return { out: path.resolve(opts.out), hash, fileCount: files.length, missing, bytes: fs.statSync(opts.out).size };
}

/**
 * Experiment (D40): stage the context pack as a custom skill directory that
 * `ant apply` can upload, so it can be compared against the tarball route.
 * @param {{outDir: string, repoRoot?: string}} opts
 */
export function stageContextPackSkill(opts) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const src = path.join(repoRoot, "studio-kit/context-pack");
  if (!fs.existsSync(src)) throw new Error("studio-kit/context-pack doesn't exist yet");
  const dest = path.resolve(opts.outDir, "studio-context-pack");
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const copied = [];
  walk(src, (abs) => {
    const rel = path.relative(src, abs);
    fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
    fs.copyFileSync(abs, path.join(dest, rel));
    copied.push(rel.split(path.sep).join("/"));
  });
  const index = copied.filter((f) => f.endsWith(".md")).map((f) => `- \`${f}\``);
  fs.writeFileSync(
    path.join(dest, "SKILL.md"),
    [
      "---",
      "name: studio-context-pack",
      "description: House runtime library reference, short recipes and example carts for building small arcade games on the house runtime. Use when designing or coding any cart.",
      "---",
      "",
      "# Studio context pack",
      "",
      "Read the library reference before writing a cart, then the recipe that matches what you're building. The example carts show complete, passing carts.",
      "",
      ...index,
      "",
    ].join("\n"),
  );
  return { dir: dest, files: copied.length + 1 };
}

function main(argv) {
  const flag = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const skillDir = flag("skill-dir");
  if (skillDir) {
    const r = stageContextPackSkill({ outDir: skillDir });
    console.log(`staged skill at ${r.dir} (${r.files} files)`);
    return;
  }
  const out = flag("out") ?? path.join(here, "../dist/studio-kit.tgz");
  const r = buildKit({ out });
  console.log(`kit ${r.hash.slice(0, 12)}: ${r.fileCount} files, ${r.bytes} bytes -> ${r.out}`);
  if (r.missing.length) console.log(`not in the kit yet: ${r.missing.join(", ")}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
