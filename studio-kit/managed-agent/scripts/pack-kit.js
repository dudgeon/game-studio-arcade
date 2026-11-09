#!/usr/bin/env node
// Builds the studio kit tarball that every Studio session mounts (D42).
//
//   node studio-kit/managed-agent/scripts/pack-kit.js [--out FILE] [--skill-dir DIR]
//
// The kit holds the runtime, starter library, spec tools, playtest harness,
// context pack and tools: everything a session needs offline. A generated
// KIT.md at the kit root is the one thing the agent always reads (D160): the
// library's catalog and the commands to run, so command names live here, not
// in the prompt. Everything else it fetches only when a game needs it.
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
  { dir: "studio-kit/context-pack", what: "The library's catalog, guides and templates." },
];

const PACK = "studio-kit/context-pack";

/** The kit with only the blank start, for comparing against templates (D166). */
export const NO_TEMPLATES_KIT = {
  exclude: (/** @type {string} */ kitPath) => kitPath.startsWith(`${PACK}/templates/`) && !kitPath.startsWith(`${PACK}/templates/blank/`),
  templates: false,
};

/** The kit for a session that gets the context pack as a skill instead (D45). */
export const SKILL_KIT = {
  parts: KIT_PARTS.filter((p) => p.dir !== "studio-kit/context-pack"),
  notes: ["The context pack isn't in this kit. It's attached to this session as the skill `studio-context-pack`. Its paths such as `runtime/README.md` and `studio-kit/spec/template.md` are under `/workspace/kit/`."],
};

const SKIP_NAMES = new Set(["node_modules", ".git", ".DS_Store", "test", "dist", "coverage"]);
const isSkipped = (name) => SKIP_NAMES.has(name) || name.endsWith(".test.js") || name.startsWith("._");

/**
 * List every file of the kit parts that exist, sorted by kit path.
 * @param {{repoRoot?: string, parts?: {dir: string, what: string}[], exclude?: (kitPath: string) => boolean}} [opts]
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
    walk(root, (abs) => {
      const kitPath = path.relative(repoRoot, abs).split(path.sep).join("/");
      if (!opts.exclude?.(kitPath)) files.push({ kitPath, abs });
    });
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
 * The catalog with the starting points this kit has: all of them, or only blank.
 * @param {string} text @param {boolean} templates
 */
export function catalogFor(text, templates) {
  const on = text.replace(/<!-- no-templates\n[\s\S]*?no-templates -->\n/, "").replace(/<!-- \/?templates -->\n/g, "");
  if (templates) return on;
  return text.replace(/<!-- templates -->[\s\S]*?<!-- \/templates -->\n/, "").replace(/<!-- no-templates\n|no-templates -->\n/g, "");
}

/**
 * Generate KIT.md: where things go, the library's catalog, and the commands.
 * Commands come from each part's package.json `bin`, so the parts' owners define
 * them and this file never goes stale.
 * @param {{repoRoot?: string, present: {dir: string, what: string}[], missing: string[], notes?: string[], templates?: boolean}} info
 */
export function renderKitMd(info) {
  const repoRoot = info.repoRoot ?? REPO_ROOT;
  const lines = [
    "# Studio kit",
    "",
    "Extracted at `/workspace/kit/`. Paths below are relative to it. There is no network: use what's here.",
    "",
  ];
  for (const note of info.notes ?? []) lines.push(note, "");
  const catalog = path.join(repoRoot, PACK, "CATALOG.md");
  if (info.present.some((p) => p.dir === PACK) && fs.existsSync(catalog)) {
    lines.push(catalogFor(fs.readFileSync(catalog, "utf8"), info.templates ?? true).trimEnd(), "");
  }
  lines.push("## Commands", "");
  for (const part of info.present) {
    const pkg = readJson(path.join(repoRoot, part.dir, "package.json"));
    const bins = pkg && pkg.bin ? (typeof pkg.bin === "string" ? { [pkg.name]: pkg.bin } : pkg.bin) : {};
    for (const name of Object.keys(bins)) {
      lines.push(`- \`${name}\`: \`node /workspace/kit/${part.dir}/${String(bins[name]).replace(/^\.\//, "")}\``);
    }
  }
  lines.push(
    "",
    "Playtest options: `--driver browser` with `NODE_PATH=\"$(npm root -g)\"` set (never install Playwright), `--rules R1,R3`, `--no-frames`. Exit code 0 is all pass, 1 is a failure, and `playtest.json` in the cart folder has the reasons.",
    "",
  );
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
 * @param {{out: string, repoRoot?: string, parts?: {dir: string, what: string}[], notes?: string[], exclude?: (kitPath: string) => boolean, templates?: boolean}} opts
 * @returns {{out: string, hash: string, fileCount: number, missing: string[], bytes: number}}
 */
export function buildKit(opts) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const { files, present, missing } = collectKit({ repoRoot, parts: opts.parts, exclude: opts.exclude });
  const kitMd = renderKitMd({ repoRoot, present, missing, notes: opts.notes, templates: opts.templates });
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
    // The agent needs the reading and the templates, not the pack's own tooling.
    if (!rel.endsWith(".md") && !rel.startsWith("templates" + path.sep) && !rel.startsWith("carts" + path.sep)) return;
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
      "Start with `CATALOG.md` and read only what the game needs. Paths such as `runtime/lib/ref/collide.md` are in the studio kit, under `/workspace/kit/`.",
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
