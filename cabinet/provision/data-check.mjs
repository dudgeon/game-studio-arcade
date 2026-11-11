#!/usr/bin/env node
// Proves an update kept the cabinet's data (D5, D196). Run by update-on-cabinet.sh, before and after.
//
//   node data-check.mjs record DATA_DIR MANIFEST    every file's size and hash
//   node data-check.mjs check DATA_DIR MANIFEST     compare now with the manifest; prints JSON, exit 1 if anything is wrong
//
// Under logs/, files only grow: each must still start with exactly what it held, and a new one is fine.
// Everything else must be byte-identical: carts and their git history, sessions/, makers.json, studio-*.json,
// kit-uploads.json, and whatever else is there. A file missing, changed or added outside logs/ fails.
// The Chromium profile is left out: it's a browser cache, rewritten whenever the kiosk runs.
// Prints paths, never contents.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SKIP = new Set(["chromium"]);
const GROWS = (rel) => rel.startsWith("logs/");

/** Every file and symlink under root, as relative paths, in a stable order. */
function walk(root) {
  const out = [];
  const visit = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (dir === root && SKIP.has(name)) continue;
      const st = fs.lstatSync(full);
      if (st.isDirectory()) visit(full);
      else out.push(rel);
    }
  };
  visit(root);
  return out;
}

function hashOf(file, bytes) {
  const h = createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(1 << 16);
    let left = bytes;
    let at = 0;
    while (left > 0) {
      const n = fs.readSync(fd, buf, 0, Math.min(buf.length, left), at);
      if (n === 0) break;
      h.update(buf.subarray(0, n));
      left -= n;
      at += n;
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest("hex");
}

function entry(root, rel) {
  const full = path.join(root, rel);
  const st = fs.lstatSync(full);
  if (st.isSymbolicLink()) return { link: fs.readlinkSync(full) };
  return { size: st.size, hash: hashOf(full, st.size), mode: (st.mode & 0o7777).toString(8) };
}

function record(root, manifest) {
  const files = {};
  for (const rel of walk(root)) files[rel] = entry(root, rel);
  fs.writeFileSync(manifest, JSON.stringify({ root, files }));
  return Object.keys(files).length;
}

function check(root, manifest) {
  const before = JSON.parse(fs.readFileSync(manifest, "utf8")).files;
  const now = new Set(walk(root));
  const report = { ok: true, files: Object.keys(before).length, missing: [], changed: [], shrunk_or_rewritten: [], added: [], grown: [], new_logs: [] };
  for (const [rel, was] of Object.entries(before)) {
    if (!now.has(rel)) {
      report.missing.push(rel);
      continue;
    }
    const full = path.join(root, rel);
    const st = fs.lstatSync(full);
    if (was.link !== undefined) {
      if (!st.isSymbolicLink() || fs.readlinkSync(full) !== was.link) report.changed.push(rel);
      continue;
    }
    if (st.isSymbolicLink()) {
      report.changed.push(rel);
      continue;
    }
    const mode = (st.mode & 0o7777).toString(8);
    if (GROWS(rel)) {
      if (st.size < was.size || hashOf(full, was.size) !== was.hash) report.shrunk_or_rewritten.push(rel);
      else if (st.size > was.size) report.grown.push(rel);
      if (mode !== was.mode) report.changed.push(`${rel} (mode)`);
    } else if (st.size !== was.size || hashOf(full, st.size) !== was.hash || mode !== was.mode) {
      report.changed.push(rel);
    }
  }
  for (const rel of now) {
    if (rel in before) continue;
    if (GROWS(rel)) report.new_logs.push(rel);
    else report.added.push(rel);
  }
  report.ok = !report.missing.length && !report.changed.length && !report.shrunk_or_rewritten.length && !report.added.length;
  return report;
}

const [cmd, root, manifest] = process.argv.slice(2);
if (cmd === "record" && root && manifest) {
  console.log(`recorded ${record(root, manifest)} files`);
} else if (cmd === "check" && root && manifest) {
  const report = check(root, manifest);
  console.log(JSON.stringify(report));
  process.exit(report.ok ? 0 : 1);
} else {
  console.error("usage: data-check.mjs record|check DATA_DIR MANIFEST");
  process.exit(2);
}
