// The playtest harness (D60-D63): run a cart's checks and the generic checks,
// and build playtest.json.
import { Worker } from "node:worker_threads";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { availableParallelism, platform, arch } from "node:os";
// Relative, not by package name: the packed kit has no node_modules (D42).
import { rulesOf, checkCoverage, readCheckIds } from "../../spec/index.js";
import { encodePng } from "./png.js";
import { frameStats } from "./soak.js";
import { HarnessError, openBrowser, runtimeHost, pageMessage } from "./browser.js";

export { HarnessError };

const WORKER = new URL("./worker.js", import.meta.url);
const SOAK_INPUT_SEED = 0x5eed;
export const GENERIC = ["loads", "no-errors", "soak", "palette", "frame-time", "deterministic"];

/**
 * @typedef {import("../index.js").PlaytestOptions} PlaytestOptions
 * @typedef {import("../index.js").Report} Report
 */

/** @param {unknown} e */
const messageOf = (e) => (e instanceof Error ? e.message : String(e));

/**
 * Run a playtest on a cart folder and return the report. Writes
 * playtest.json and key frames unless `out` is null.
 * @param {string} cartDir
 * @param {PlaytestOptions} [opts]
 * @returns {Promise<Report>}
 */
export async function playtest(cartDir, opts = {}) {
  cartDir = resolve(cartDir);
  const driver = opts.driver ?? "node";
  const seed = opts.seed ?? 1;
  const soakFrames = opts.soakFrames ?? 600;
  const budgetMs = opts.budgetMs ?? 4;
  const maxFrames = opts.maxFrames ?? 18000;
  const slow = driver === "browser" ? 3 : 1;
  const checkTimeoutMs = (opts.timeoutMs ?? 10000) * slow;
  const soakTimeoutMs = checkTimeoutMs * 3;
  const out = opts.out === undefined ? cartDir : opts.out === null ? null : resolve(opts.out);
  const keyframes = opts.frames ?? true;
  const runtimeUrl = opts.runtime ?? new URL("../../../runtime/index.js", import.meta.url).href;

  // --- the spec and checks.js
  const specPath = join(cartDir, "spec.md");
  if (!existsSync(specPath)) throw new HarnessError(`no spec.md in ${cartDir}`);
  const rules = rulesOf(await readFile(specPath, "utf8"));
  const gamePath = join(cartDir, "game.js");
  if (!existsSync(gamePath)) throw new HarnessError(`no game.js in ${cartDir}`);
  const checksPath = join(cartDir, "checks.js");
  const hasChecks = existsSync(checksPath);

  /** @type {string[]} */
  let keys = [];
  /** @type {string[]} */
  let nonFunctions = [];
  /** @type {{ line: number | null, rule?: string, message: string }[]} */
  const coverage = [];
  if (hasChecks) {
    const ids = await readCheckIds(checksPath);
    if (ids.error !== undefined) coverage.push({ line: null, message: ids.error });
    else ({ keys, nonFunctions } = ids);
  }
  coverage.push(...checkCoverage(rules, keys).errors);
  for (const id of nonFunctions) coverage.push({ line: null, rule: id, message: `checks.js: ${id} isn't a function` });

  // --- the runtime (palette for PNGs; the node driver's headless())
  let runtime;
  try {
    runtime = await import(runtimeUrl);
  } catch (e) {
    throw new HarnessError(`the house runtime didn't load from ${runtimeUrl}: ${messageOf(e)}`);
  }
  if (driver === "node" && typeof runtime.headless !== "function") throw new HarnessError(`the runtime at ${runtimeUrl} has no headless()`);
  /** @type {readonly string[]} */
  const palette = runtime.PALETTE;

  // --- the browser, if asked for
  /** @type {Awaited<ReturnType<typeof openBrowser>> | null} */
  let browser = null;
  /** @type {import("./browser.js").HostAdapter | null} */
  let host = null;
  if (driver === "browser") {
    host = opts.host ? await opts.host(cartDir) : await runtimeHost({ cartDir, runtimeDevServer: opts.runtimeDevServer ?? new URL("../../../runtime/dev-server.js", import.meta.url).href });
    try {
      browser = await openBrowser({ host });
    } catch (e) {
      await host.close();
      throw e;
    }
  }

  const only = opts.rules ? new Set(opts.rules) : null;
  const framesDir = out && keyframes ? join(out, "playtest-frames") : null;
  if (framesDir) await mkdir(framesDir, { recursive: true });

  /** @type {{ job: number, seq: number, where: string, frame: number | null, message: string }[]} */
  const errors = [];
  /** @type {Report["frames"]} */
  const frames = [];
  let seq = 0;

  /**
   * Run one job in a fresh worker, with a wall-time limit.
   * @param {number} index order in the report, for stable error sorting
   * @param {import("./worker.js").Job} job
   * @param {number} timeoutMs
   * @returns {Promise<any>}
   */
  async function runJob(index, job, timeoutMs) {
    const where = job.kind === "check" ? job.id : job.kind === "soak" ? job.name : "load";
    /** @param {string} w @param {number | null} frame @param {string} message */
    const addError = (w, frame, message) => errors.push({ job: index, seq: seq++, where: w, frame, message });
    const session = browser ? await browser.session(seed, (e) => addError(where, e.frame, `page error: ${e.message}`)) : null;
    const worker = new Worker(WORKER, {
      workerData: {
        job,
        gameUrl: pathToFileURL(gamePath).href,
        checksUrl: hasChecks ? pathToFileURL(checksPath).href : null,
        seed,
        driver,
        runtimeUrl,
        maxFrames,
      },
    });
    /** @type {Promise<void>[]} */
    const writes = [];
    try {
      return await new Promise((resolveJob) => {
        const timer = setTimeout(() => {
          const s = Math.round(timeoutMs / 1000);
          addError(where, null, `stopped after ${s} s of wall time`);
          worker.terminate();
          resolveJob({ status: "fail", reason: `didn't finish within ${s} s; the game or the check may be stuck in a loop`, frames: null, timedOut: true });
        }, timeoutMs);
        worker.on("message", (m) => {
          if (m.type === "crash") addError(m.where, m.frame, m.message);
          else if (m.type === "keyframe") {
            if (framesDir) {
              const file = `${m.name}.png`;
              frames.push({ name: m.name, file: `playtest-frames/${file}`, frame: m.frame.frame, hash: m.frame.hash });
              writes.push(writeFile(join(framesDir, file), encodePng(m.frame, palette)));
            }
          } else if (m.type === "rpc" && session) {
            session.call(m.method, m.args).then(
              (value) => worker.postMessage({ id: m.id, value }),
              (e) => worker.postMessage({ id: m.id, error: pageMessage(e) }),
            );
          } else if (m.type === "done") {
            clearTimeout(timer);
            resolveJob(m.result);
          }
        });
        worker.on("error", (e) => {
          clearTimeout(timer);
          addError(where, null, `uncaught: ${e.message}`);
          resolveJob({ status: "fail", reason: `the run stopped with an uncaught error: ${e.message}`, frames: null });
        });
        worker.on("exit", () => {
          clearTimeout(timer);
          resolveJob({ status: "fail", reason: "the run ended without a result", frames: null });
        });
      });
    } finally {
      await worker.terminate();
      await Promise.all(writes);
      if (session) await session.close().catch(() => {});
    }
  }

  // --- jobs: load, two soaks (for determinism), then one per check
  const autoRules = rules.filter((r) => r.kind === "auto");
  const runnable = autoRules.filter((r) => keys.includes(r.id) && !nonFunctions.includes(r.id) && (!only || only.has(r.id)));
  /** @type {{ name: string, job: import("./worker.js").Job, timeout: number }[]} */
  const jobs = [
    { name: "load", job: { kind: "load" }, timeout: checkTimeoutMs },
    { name: "soak", job: { kind: "soak", name: "soak", frames: soakFrames, inputSeed: SOAK_INPUT_SEED, sampleEvery: 60, keyEvery: 120, keyframes: true }, timeout: soakTimeoutMs },
    { name: "soak-2", job: { kind: "soak", name: "soak-2", frames: soakFrames, inputSeed: SOAK_INPUT_SEED, sampleEvery: 60, keyEvery: 120, keyframes: false }, timeout: soakTimeoutMs },
    // No-input runs: determinism and frame time still get measured when the soak crashes early.
    { name: "idle", job: { kind: "soak", name: "idle", frames: soakFrames, inputSeed: null, sampleEvery: 60, keyEvery: 120, keyframes: false }, timeout: soakTimeoutMs },
    { name: "idle-2", job: { kind: "soak", name: "idle-2", frames: soakFrames, inputSeed: null, sampleEvery: 60, keyEvery: 120, keyframes: false }, timeout: soakTimeoutMs },
    ...runnable.map((r) => ({ name: r.id, job: /** @type {const} */ ({ kind: "check", id: r.id }), timeout: checkTimeoutMs })),
  ];
  const concurrency = Math.max(1, opts.concurrency ?? (driver === "browser" ? 2 : Math.min(4, availableParallelism())));
  /** @type {Map<string, any>} */
  const results = new Map();
  let next = 0;
  try {
    await Promise.all(
      Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
        while (next < jobs.length) {
          const i = next++;
          results.set(jobs[i].name, await runJob(i, jobs[i].job, jobs[i].timeout));
        }
      }),
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (host) await host.close().catch(() => {});
  }

  // --- rules, in spec order
  /** @type {Report["rules"]} */
  const ruleResults = rules.map((r) => withPassed(ruleResult(r)));
  /** @param {{ id: string, kind: "auto" | "you-check", text: string }} r @returns {Omit<Report["rules"][number], "passed">} */
  function ruleResult(r) {
    const base = { id: r.id, kind: r.kind, text: r.text };
    if (r.kind === "you-check") return { ...base, status: "you-check", reason: "the player checks this on first play", frames: null };
    if (only && !only.has(r.id)) return { ...base, status: "skipped", reason: "not in --rules", frames: null };
    if (!keys.includes(r.id)) return { ...base, status: "missing", reason: hasChecks ? `checks.js has no check for ${r.id}` : "there's no checks.js", frames: null };
    if (nonFunctions.includes(r.id)) return { ...base, status: "missing", reason: `checks.js ${r.id} isn't a function`, frames: null };
    const res = results.get(r.id);
    return { ...base, status: res.status, reason: res.reason, frames: res.frames };
  }

  // --- generic checks
  const load = results.get("load");
  const soakA = results.get("soak");
  const soakB = results.get("soak-2");
  const idleA = results.get("idle");
  const idleB = results.get("idle-2");
  errors.sort((a, b) => a.job - b.job || a.seq - b.seq);
  const errorList = errors.map(({ where, frame, message }) => ({ where, frame, message }));

  /** @type {Report["generic"]} */
  const generic = [];
  /** @param {string} id @param {boolean} ok @param {string | null} reason */
  const g = (id, ok, reason) => generic.push({ id, name: id, status: ok ? "pass" : "fail", passed: ok, reason: ok ? null : reason });

  g("loads", load.status === "pass", load.reason);

  const first = errorList[0];
  g("no-errors", errorList.length === 0, first && `${errorList.length} error${errorList.length === 1 ? "" : "s"}; first in ${first.where}${first.frame != null ? ` at frame ${first.frame}` : ""}: ${first.message}`);

  const soakFail = soakA.status !== "pass" ? `${soakFrames} frames of random input: ${soakA.reason}` : idleA.status !== "pass" ? `${soakFrames} frames with no input: ${idleA.reason}` : null;
  g("soak", soakFail === null, soakFail);

  /** @type {{ frame: number, value: number, count: number }[]} */
  const bad = jobs.flatMap((j) => results.get(j.name).paletteBad ?? []);
  const b0 = bad[0];
  g("palette", bad.length === 0, b0 && `frame ${b0.frame} has ${b0.count} pixel${b0.count === 1 ? "" : "s"} of color ${b0.value}, which isn't in the 32-color palette (0-31)${bad.length > 1 ? `; ${bad.length - 1} more like it` : ""}`);

  const times = [soakA, soakB, idleA, idleB].flatMap((r) => r.times ?? []);
  const frameTime = frameStats(times, budgetMs);
  g("frame-time", times.length > 0 && frameTime.p95Ms <= budgetMs, times.length === 0 ? "no soak frames ran, so there's nothing to time" : `95% of frames should take at most ${budgetMs} ms for update+draw; the slowest 5% took ${frameTime.p95Ms} ms or more (max ${frameTime.maxMs} ms)`);

  /** Why two runs with the same seed and input differ, or null. @param {any} x @param {any} y @param {string} what */
  const differ = (x, y, what) => {
    const hx = x.hashes ?? [];
    const hy = y.hashes ?? [];
    for (let i = 0; i < Math.min(hx.length, hy.length); i++) {
      if (hx[i].hash !== hy[i].hash) return `two runs with the same seed and ${what} drew a different screen at frame ${hx[i].frame}; the game may be using Math.random or the clock instead of g.rand`;
    }
    if (x.status !== y.status || x.frames !== y.frames) return `two runs with the same seed and ${what} ended differently (after ${x.frames} vs ${y.frames} frames)`;
    return null;
  };
  let detReason = differ(idleA, idleB, "no input") ?? differ(soakA, soakB, "random input");
  if (!detReason && [idleA, idleB, soakA, soakB].every((r) => !(r.hashes ?? []).length)) detReason = "no run got far enough to compare two runs";
  g("deterministic", detReason === null, detReason);

  frames.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const autoOk = ruleResults.every((r) => r.status === "pass" || r.status === "you-check" || r.status === "skipped");
  /** @type {Report} */
  const report = {
    schema: 1,
    cart: basename(cartDir),
    driver,
    seed,
    ok: autoOk && coverage.length === 0 && generic.every((x) => x.status === "pass"),
    ...(only ? { only: [...only] } : {}),
    rules: ruleResults,
    coverage: coverage.map((c) => ({ rule: c.rule ?? null, message: c.message })),
    generic,
    frameTime,
    errors: errorList,
    frames,
    env: {
      node: process.versions.node,
      platform: `${platform()}-${arch()}`,
      playwright: browser?.env.playwright ?? null,
      browser: browser?.env.browser ?? null,
      at: new Date().toISOString(),
    },
  };
  if (out) {
    await mkdir(out, { recursive: true });
    await writeFile(join(out, "playtest.json"), JSON.stringify(report, null, 2) + "\n");
  }
  return report;
}

/**
 * `passed` (the studio-kit/cli shape): true on pass, false on fail or missing,
 * null when the playtest doesn't decide (you-check, skipped).
 * @template {{ status: string }} T @param {T} r
 */
function withPassed(r) {
  const passed = r.status === "pass" ? true : r.status === "fail" || r.status === "missing" ? false : null;
  return { ...r, passed };
}

/**
 * The part of a report that must be identical on every machine (D62):
 * everything but `env`, the timing numbers and the frame-time verdict.
 * @param {Report} report
 */
export function comparable(report) {
  const { env, frameTime, ...rest } = report;
  return {
    ...rest,
    generic: rest.generic.filter((x) => x.id !== "frame-time"),
    frameTime: { frames: frameTime.frames, budgetMs: frameTime.budgetMs },
  };
}
