#!/usr/bin/env node
// gsa-playtest <cart-dir> [--driver node|browser] [--rules R1,R3] [--out dir]
//   [--no-frames] [--budget-ms N] [--soak-frames N] [--seed N] [--runtime dir] [--json]
//   [--chromium PATH] [--nice N]: the browser driver on a system Chromium, no Playwright (D310)
// --runtime points at a runtime folder other than the installed one (dev only).
// Exit: 0 ok, 1 a rule or generic check failed, 2 the harness couldn't run (D62).
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { playtest, HarnessError } from "../index.js";

const USAGE = "usage: gsa-playtest <cart-dir> [--driver node|browser] [--rules R1,R3] [--out dir] [--no-frames] [--budget-ms N] [--soak-frames N] [--seed N] [--runtime dir] [--chromium PATH] [--nice N] [--json]";

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      driver: { type: "string", default: "node" },
      rules: { type: "string" },
      out: { type: "string" },
      "no-frames": { type: "boolean", default: false },
      "budget-ms": { type: "string" },
      "soak-frames": { type: "string" },
      seed: { type: "string" },
      runtime: { type: "string" },
      chromium: { type: "string" },
      nice: { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  console.error(USAGE);
  process.exit(2);
}
const { values: v, positionals } = args;
if (v.help || positionals.length !== 1) {
  console.error(USAGE);
  process.exit(v.help ? 0 : 2);
}
if (v.driver !== "node" && v.driver !== "browser") {
  console.error(`--driver must be node or browser, got ${v.driver}`);
  process.exit(2);
}
/** @param {string | undefined} s */
const num = (s) => (s === undefined ? undefined : Number(s));

try {
  const report = await playtest(positionals[0], {
    driver: v.chromium !== undefined ? "browser" : v.driver,
    rules: v.rules ? v.rules.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    out: v.out,
    frames: !v["no-frames"],
    budgetMs: num(v["budget-ms"]),
    soakFrames: num(v["soak-frames"]),
    seed: num(v.seed),
    runtime: v.runtime ? pathToFileURL(resolve(v.runtime, "index.js")).href : undefined,
    chromium: v.chromium === undefined ? undefined : v.chromium || true,
    nice: num(v.nice),
    runtimeDevServer: v.runtime ? pathToFileURL(resolve(v.runtime, "dev-server.js")).href : undefined,
  });
  if (v.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const mark = { pass: "PASS", fail: "FAIL", missing: "MISSING", "you-check": "YOU CHECK", skipped: "SKIP" };
    console.log(`${report.cart}: ${report.ok ? "all good" : "something failed"} (${report.driver} driver)`);
    for (const r of report.rules) console.log(`  ${mark[r.status].padEnd(9)} ${r.id}${r.status === "fail" || r.status === "missing" ? `: ${r.reason}` : ""}`);
    for (const c of report.coverage) console.log(`  DRIFT     ${c.rule ?? ""} ${c.message}`);
    for (const x of report.generic) console.log(`  ${x.status === "pass" ? "PASS" : "FAIL"}      ${x.id}${x.reason ? `: ${x.reason}` : ""}${x.frame !== undefined ? ` (first at frame ${x.frame})` : ""}`);
    const f = report.frameTime;
    console.log(`  frame time: mean ${f.meanMs} ms, p95 ${f.p95Ms} ms, max ${f.maxMs} ms over ${f.frames} frames (budget ${f.budgetMs} ms)`);
    const gl = report.glide;
    if (gl) {
      console.log(`  glide: x${gl.fine} by ${gl.path === "gpu" ? "the GPU" : "the 2D canvas"}; median ${gl.p50Ms} ms and p95 ${gl.p95Ms} ms with it, ${gl.plainP50Ms} and ${gl.plainP95Ms} ms without: about ${gl.costMs} ms a frame`);
      if (gl.warning === "over") console.log("  WARNING   glide takes this game's slowest frames over the budget here");
      if (gl.warning === "heavy") console.log(`  WARNING   glide takes more than a third of the ${f.budgetMs} ms frame budget here`);
    }
  }
  process.exit(report.ok ? 0 : 1);
} catch (e) {
  console.error(`playtest couldn't run: ${e instanceof Error ? e.message : e}`);
  if (!(e instanceof HarnessError) && e instanceof Error) console.error(e.stack);
  process.exit(2);
}
