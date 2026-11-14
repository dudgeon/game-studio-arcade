#!/usr/bin/env node
// After a power cut on a rehearsal cabinet (D371): is everything the service said was done still there, whole?
//   node power-check.mjs DATA_DIR SERVICE_URL < acks     (acks: power-workload.mjs's ACK lines, from the mini)
// Prints JSON {ok, problems, counts}. Exit 1 on any problem. Reads only; never prints a file's contents.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [data = "/var/lib/arcade", base = "http://127.0.0.1:8330"] = process.argv.slice(2);
const problems = [];
const counts = {};
const bad = (m) => problems.push(m);
const acks = fs.readFileSync(0, "utf8").split("\n").filter((l) => l.startsWith("ACK ")).map((l) => {
  const [, what, ...rest] = l.split(" ");
  try { return { what, ...JSON.parse(rest.join(" ")) }; } catch { return { what }; }
});
counts.acks = acks.length;
// Starter carts provisioning copied in before the library had a commit: there before any cut, so not the cut's.
const starters = new Set(acks.filter((a) => a.what === "starter").map((a) => a.id));

/** Every line of a .jsonl that parses, and which ones don't (only a torn last line is allowed). */
function jsonl(file) {
  if (!fs.existsSync(file)) return { rows: [], torn: [] };
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split("\n");
  const rows = [];
  const torn = [];
  lines.forEach((l, i) => {
    if (!l) return;
    try { rows.push(JSON.parse(l)); } catch { torn.push(i === lines.length - 1 || (i === lines.length - 2 && lines.at(-1) === "") ? "last" : `line ${i + 1}`); }
  });
  return { rows, torn };
}

// 1. Every JSON file in the data folder parses, and none is empty (a file renamed into place before it reached the disk).
const walk = (d, out = []) => {
  for (const n of fs.readdirSync(d)) {
    if (d === data && (n === "chromium" || n === "carts")) continue;
    const f = path.join(d, n);
    const st = fs.lstatSync(f);
    if (st.isDirectory()) walk(f, out);
    else out.push(f);
  }
  return out;
};
const files = walk(data);
counts.files = files.length;
for (const f of files) {
  const rel = path.relative(data, f);
  if (f.endsWith(".json")) {
    const t = fs.readFileSync(f, "utf8");
    if (!t.length) bad(`${rel}: empty`);
    else try { JSON.parse(t); } catch { bad(`${rel}: doesn't parse`); }
  }
  if (f.endsWith(".jsonl")) {
    const { torn } = jsonl(f);
    for (const t of torn) if (t !== "last") bad(`${rel}: a broken ${t} in the middle (a later line was appended after a torn one)`);
    if (torn.length) counts.torn_last = (counts.torn_last ?? 0) + 1;
  }
}

// 2. The cart library: a sound git repository, a clean tree, every cart whole and committed.
const carts = path.join(data, "carts");
const git = (...a) => execFileSync("git", ["-c", "safe.directory=*", "-C", carts, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const isRepo = fs.existsSync(path.join(carts, ".git"));
if (isRepo) try { git("fsck", "--full", "--no-dangling"); } catch (e) { bad(`carts: git fsck failed: ${String(e.stderr).trim().split("\n").slice(0, 3).join(" | ")}`); }
let status = "";
if (isRepo) try { status = git("status", "--porcelain"); } catch (e) { bad(`carts: git status failed: ${String(e.stderr).trim().split("\n")[0]}`); }
const changes = status.split("\n").filter(Boolean).filter((l) => !starters.has(l.slice(3).replace(/\/$/, "")));
if (changes.length) bad(`carts: uncommitted changes: ${changes.slice(0, 4).join(", ")}`);
let tracked = new Set();
if (isRepo) try { tracked = new Set(git("ls-tree", "--name-only", "HEAD").split("\n").filter(Boolean)); } catch (e) { bad("carts: no HEAD"); }
const cartDirs = fs.readdirSync(carts).filter((n) => !n.startsWith(".") && fs.statSync(path.join(carts, n)).isDirectory());
counts.carts = cartDirs.length;
for (const id of cartDirs) {
  const cj = path.join(carts, id, "cart.json");
  try {
    JSON.parse(fs.readFileSync(cj, "utf8"));
  } catch { bad(`carts/${id}: cart.json missing or broken`); }
  const g = path.join(carts, id, "game.js");
  if (!fs.existsSync(g) || !fs.statSync(g).size) bad(`carts/${id}: game.js missing or empty`);
  if (!tracked.has(id) && !starters.has(id)) bad(`carts/${id}: on disk but not committed`);
}

// 3. What the service acknowledged is there.
const ledger = jsonl(path.join(data, "logs/coin_ledger.jsonl")).rows;
const ledgerIds = new Set(ledger.map((e) => e.id));
const makers = (() => { try { return JSON.parse(fs.readFileSync(path.join(data, "makers.json"), "utf8")); } catch { return []; } })();
const makerIds = new Set(makers.map((m) => m.id));
const plays = new Set(jsonl(path.join(data, "logs/play.jsonl")).rows.map((p) => p.id));
for (const a of acks) {
  if (a.what === "topup" && a.id && !ledgerIds.has(a.id)) bad(`ledger: top-up ${a.id} was acknowledged and is gone`);
  if (a.what === "maker" && a.id && !makerIds.has(a.id)) bad(`makers: ${a.name} was acknowledged and is gone`);
  if (a.what === "play" && a.id && !plays.has(a.id)) bad(`plays: ${a.id} was acknowledged and is gone`);
  if (a.what === "make" && a.ok && a.cart_id) {
    if (!cartDirs.includes(a.cart_id)) bad(`carts: ${a.cart_id} was made and is gone`);
    else {
      let log = "";
      try { log = git("log", "--format=%H", "--", a.cart_id); } catch {}
      if (!log.trim()) bad(`carts: ${a.cart_id} has no commit`);
    }
    if (a.session_id && !ledger.some((e) => e.session_id === a.session_id && e.kind === "charge")) bad(`ledger: the charge for ${a.session_id} is gone`);
  }
}
counts.ledger = ledger.length;
counts.makers = makers.length;

// 4. The service reads it all back: the shelf, the pot, the makers.
for (const p of ["/api/carts", "/api/pot", "/api/makers", "/api/studio"]) {
  try {
    const r = await fetch(base + p);
    if (!r.ok) bad(`${p}: ${r.status}`);
    if (p === "/api/carts") counts.shelf = ((await r.json()).carts ?? []).length;
  } catch (e) { bad(`${p}: ${e.message}`); }
}

process.stdout.write(`${JSON.stringify({ ok: problems.length === 0, problems, counts })}\n`);
process.exit(problems.length ? 1 : 0);
