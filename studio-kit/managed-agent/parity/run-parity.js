#!/usr/bin/env node
// Studio sandbox parity check (task 7 accept; D62 "same cart, same report").
//
//   node studio-kit/managed-agent/parity/run-parity.js --local-only
//   node studio-kit/managed-agent/parity/run-parity.js [--model claude-haiku-5-5] [--budget-cents 50]
//
// Packs the studio kit and a small parity bundle (parity.sh + the playtest's
// dot-catch fixture). It runs parity.sh on the mini, then in one Studio session
// (the applied agent and environment, with a harness system prompt in place of
// the kid brief), and compares comparable() for each driver. It also records
// the output listing, how long DONE.json took, and list cost against a
// recomputation. One session per run; the cap is at most 50 cents.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { buildKit, REPO_ROOT } from "../scripts/pack-kit.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, "../dist");
const FIXTURE = path.join(REPO_ROOT, "studio-kit/playtest/test/fixtures/dot-catch");
const PARITY_MOUNT = "/mnt/session/uploads/parity.tgz";
const MAX_CENTS = 50;

/** List prices per million tokens (pricing page, checked 2026-11-08; Haiku: prompts up to 100k). */
export const PRICES = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cache5m: 0.125, cache1h: 0.2, cacheRead: 0.01 },
  "claude-sonnet-5-5": { input: 2, output: 10, cache5m: 2.5, cache1h: 4, cacheRead: 0.1 },
};
const RUNTIME_PER_HOUR = 0.08;

export const HARNESS = `You are a test harness for a toolchain check, not an assistant and not a game builder.
When asked, run the exact shell command you are given with the bash tool, once, and nothing else.
Do not investigate, fix, retry or explain failures: the script records them itself.
Don't call any other tool. When the command finishes, reply with the single word DONE.`;

const COMMAND = `mkdir -p /workspace/p && tar -xzf ${PARITY_MOUNT} -C /workspace/p && bash /workspace/p/parity.sh`;

/** Recompute list cost in USD from session usage. */
export function computeCost(usage, model) {
  const p = PRICES[model];
  if (!p || !usage) return null;
  const m = (n) => (n ?? 0) / 1e6;
  const cc = usage.cache_creation ?? {};
  const tokens =
    m(usage.input_tokens) * p.input +
    m(usage.output_tokens) * p.output +
    m(usage.cache_read_input_tokens) * p.cacheRead +
    m(cc.ephemeral_5m_input_tokens) * p.cache5m +
    m(cc.ephemeral_1h_input_tokens) * p.cache1h;
  const runtime = ((usage.active_seconds ?? 0) / 3600) * RUNTIME_PER_HOUR;
  return { tokens, runtime, total: tokens + runtime };
}

/** Paths where two JSON values differ (at most `limit`). */
export function diffPaths(a, b, at = "$", out = [], limit = 25) {
  if (out.length >= limit) return out;
  if (a === b) return out;
  const ta = Array.isArray(a) ? "array" : typeof a;
  const tb = Array.isArray(b) ? "array" : typeof b;
  if (ta !== tb || ta !== "object" && ta !== "array" || a === null || b === null) {
    out.push(`${at}: ${JSON.stringify(a)?.slice(0, 120)} != ${JSON.stringify(b)?.slice(0, 120)}`);
    return out;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) diffPaths(a[k], b[k], ta === "array" ? `${at}[${k}]` : `${at}.${k}`, out, limit);
  return out;
}

function tarFlags() {
  return process.platform === "darwin" ? ["--no-xattrs", "--no-mac-metadata"] : [];
}

/** parity.tgz: parity.sh and a copy of the dot-catch fixture. Returns the staged dir too. */
function buildParityBundle() {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "parity-"));
  fs.copyFileSync(path.join(here, "parity.sh"), path.join(stage, "parity.sh"));
  fs.cpSync(FIXTURE, path.join(stage, "dot-catch"), { recursive: true });
  fs.mkdirSync(DIST, { recursive: true });
  const out = path.join(DIST, "parity.tgz");
  execFileSync("tar", [...tarFlags(), "-czf", out, "-C", stage, "."], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  return { out, stage };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function runLocal(kitTgz, stage) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "parity-local-"));
  const out = path.join(work, "outputs");
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, KIT_TGZ: kitTgz, WORK: path.join(work, "w"), OUT: out };
  const pw = path.join(REPO_ROOT, "node_modules/playwright");
  if (!env.GSA_PLAYWRIGHT && fs.existsSync(pw)) env.GSA_PLAYWRIGHT = pw;
  const exits = execFileSync("bash", [path.join(stage, "parity.sh")], { env, encoding: "utf8" }).trim();
  return { out, exits, node: readJson(path.join(out, "playtest-node.json")), browser: readJson(path.join(out, "playtest-browser.json")) };
}

async function main() {
  const { values } = parseArgs({
    options: {
      "local-only": { type: "boolean", default: false },
      model: { type: "string", default: "claude-haiku-5-5" },
      "budget-cents": { type: "string", default: "50" },
    },
  });
  const budgetCents = Number(values["budget-cents"]);
  if (!Number.isInteger(budgetCents) || budgetCents <= 0 || budgetCents > MAX_CENTS) throw new Error(`--budget-cents must be 1..${MAX_CENTS}`);
  if (!PRICES[values.model]) throw new Error(`model must be one of ${Object.keys(PRICES).join(", ")}`);

  const kit = buildKit({ out: path.join(DIST, "studio-kit.tgz") });
  console.log(`kit ${kit.hash.slice(0, 12)}: ${kit.fileCount} files, ${kit.bytes} bytes; missing: ${kit.missing.join(", ") || "none"}`);
  const bundle = buildParityBundle();
  const { comparable } = await import("@game-studio-arcade/playtest");

  const local = runLocal(kit.out, bundle.stage);
  console.log(`local exits:\n${local.exits}`);
  if (values["local-only"]) {
    for (const d of ["node", "browser"]) console.log(`local ${d}: ok=${local[d]?.ok} rules=${local[d]?.rules?.map((r) => `${r.id}:${r.status}`).join(" ")}`);
    return;
  }

  const { createClient } = await import("../../cli/src/client.js");
  const { sdkApi } = await import("../../cli/src/api.js");
  const { readLock, dataDir, dataPaths } = await import("../../cli/src/config.js");
  const { ensureKitUploaded } = await import("../../cli/src/kit.js");
  const { runSession } = await import("../../cli/src/driver.js");
  const { downloadOutputs } = await import("../../cli/src/outputs.js");

  const paths = dataPaths(dataDir());
  const api = sdkApi(await createClient());
  const lock = readLock();
  const kitUp = await ensureKitUploaded({ api, cacheFile: paths.kitUploads, out: kit.out, build: () => kit, log: console.log });
  const parityFile = await api.uploadFile(bundle.out, "parity.tgz");
  console.log(`parity bundle uploaded as ${parityFile.id}`);

  const result = await runSession({
    api,
    session: {
      agentId: lock.agentId,
      agentVersion: lock.agentVersion,
      environmentId: lock.environmentId,
      model: values.model,
      system: HARNESS,
      kitFileId: kitUp.fileId,
      extraFiles: [{ fileId: parityFile.id, mountPath: PARITY_MOUNT }],
      budgetCents,
      title: "parity: dot-catch, node + browser",
      metadata: { purpose: "playtest-parity", via: "run-parity" },
    },
    request: "",
    maker: "-",
    message: { type: "user.message", content: [{ type: "text", text: `Run this command with bash:\n\n${COMMAND}` }] },
    answerer: { question: async () => ({ choice: "D" }), plan: async () => ({ choice: "build" }) },
    ui: { progress: (s) => console.log(`  … ${s}`), debug: (s) => console.log(`  [debug] ${s}`) },
  });
  console.log(`session ${result.sessionId}: ${result.stopReason}`);

  const sessionDir = path.join(paths.root, "parity", result.sessionId);
  const t0 = Date.now();
  const dl = await downloadOutputs({ api, sessionId: result.sessionId, dir: path.join(sessionDir, "outputs"), inputNames: ["studio-kit.tgz", "parity.tgz"], waitMs: 2000, tries: 30 });
  const outputsMs = Date.now() - t0;

  const compare = {};
  for (const d of ["node", "browser"]) {
    const sandbox = readJson(path.join(dl.dir, `playtest-${d}.json`));
    const diffs = sandbox && local[d] ? diffPaths(comparable(local[d]), comparable(sandbox)) : ["missing report"];
    compare[d] = { identical: diffs.length === 0, diffs, sandboxOk: sandbox?.ok ?? null, localOk: local[d]?.ok ?? null, sandboxEnv: sandbox?.env ?? null, sandboxFrameTime: sandbox?.frameTime ?? null };
  }
  const reported = result.usage?.list_cost ? Number(result.usage.list_cost.amount) / 100 : null;
  const computed = computeCost(result.usage, values.model);
  const summary = {
    session: result.sessionId,
    model: values.model,
    budget_cents: budgetCents,
    stop_reason: result.stopReason,
    wall_seconds: result.wallSeconds,
    errors: result.errors,
    notes: result.notes,
    local_exits: local.exits,
    sandbox_exits: fs.existsSync(path.join(dl.dir, "exits.txt")) ? fs.readFileSync(path.join(dl.dir, "exits.txt"), "utf8").trim() : null,
    outputs: { complete: dl.complete, missing: dl.missing, polls: dl.polls, ms_after_idle: outputsMs, listing: dl.listing.map((f) => ({ filename: f.filename, size_bytes: f.size_bytes, created_at: f.created_at, downloadable: f.downloadable })) },
    compare,
    cost: { usage: result.usage, reported_usd: reported, computed_usd: computed },
    kit: { hash: kit.hash, file_id: kitUp.fileId, uploaded_now: kitUp.uploaded },
  };
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify({ ...summary, outputs: { ...summary.outputs, listing: summary.outputs.listing.length } }, null, 2));
  console.log(`full summary: ${path.join(sessionDir, "summary.json")}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`parity: ${e?.stack ?? e}`);
    process.exit(1);
  });
}
