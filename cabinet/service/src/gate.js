// The publish gate (D310): the cabinet re-tests a game itself, in its own Chromium,
// before the game reaches the shelf (D8). It runs one test at a time, at low priority
// (`nice`), and never while a game is being played: it waits for the play to end,
// and a test already running when a play starts is stopped and run again afterwards.
//
// A made game: its spec's auto rules and the generic checks (studio-kit/playtest), with
// the frame-time budget scaled on the virtual cabinet (D128). A downloaded game (guests/):
// a smoke check only. Each run is logged to logs/publish_gate.jsonl for the Manager.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendLog } from "@game-studio-arcade/studio-cli/src/log.js";
import { writeJsonDurable } from "@game-studio-arcade/studio-cli/src/durable.js";

const RUN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../bin/gate-run.js");

/** The browser driver's frame budget on the Pi (D64): a whole 60 Hz frame. */
export const PI_BUDGET_MS = 16.7;
/**
 * The virtual cabinet's CPU against the Pi 5's (D128): a stated guess until the Picade
 * runs the same carts. M6 cores are several times a Cortex-A76's; 3 is on the low side,
 * so the virtual budget isn't stricter than the Pi's will be.
 */
export const VIRTUAL_CPU_FACTOR = 3;

/**
 * The gate's settings for this cabinet: its profile (/etc/arcade/cabinet.conf) and the
 * service config's `gate` (cpu_factor, chromium, nice, timeout_s, watch_s).
 * @param {{ profile?: string | null, gate?: any }} o
 */
export function gateSettings({ profile, gate = {} }) {
  const host = profile === "virtual" ? "virtual" : profile === "picade" ? "picade" : "dev";
  const cpuFactor = Number(gate.cpu_factor ?? (host === "virtual" ? VIRTUAL_CPU_FACTOR : 1));
  return {
    host,
    cpuFactor,
    budgetMs: Math.round((PI_BUDGET_MS / cpuFactor) * 100) / 100,
    // Until a cabinet is calibrated (the Picade against the virtual one, D128), its frame
    // budget is a guess, and a guess never keeps a game off the shelf: frame time is
    // measured, judged and logged, but only blocks once `gate.calibrated` is true (D311).
    frameTimeBlocks: gate.calibrated === true,
    chromium: typeof gate.chromium === "string" ? gate.chromium : null,
    nice: Number(gate.nice ?? 19),
    timeoutMs: Number(gate.timeout_s ?? 600) * 1000,
    watchMs: Number(gate.watch_s ?? 5) * 1000,
  };
}

/** The cabinet's profile line, or null. @param {string} [file] */
export function cabinetProfile(file = "/etc/arcade/cabinet.conf") {
  try {
    return fs.readFileSync(file, "utf8").match(/^profile=(\S+)/m)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * @typedef {{ id: string, passed: boolean, reason: string | null }} GateCheck
 * @typedef {{
 *   ok: boolean, kind: "cart" | "guest", what: string, host: string, driver: string, fallback: string | null,
 *   failing: GateCheck[], seconds: number, waited_s: number, restarts: number,
 *   budget_ms?: number, cpu_factor?: number, frame_time?: any, report?: any, error?: string,
 *   advisory?: GateCheck[], frame_time_blocks?: boolean, glide?: any,
 * }} GateResult
 */

/**
 * @param {{
 *   settings: ReturnType<typeof gateSettings>,
 *   playing: () => boolean,
 *   logsDir: string,
 *   log?: (line: string) => void,
 *   pollMs?: number,
 *   run?: (args: string[], o: { nice: number, timeoutMs: number, signal: AbortSignal }) => Promise<any>,
 *   now?: () => number,
 * }} o
 */
export function createGate(o) {
  const s = o.settings;
  const pollMs = o.pollMs ?? 1000;
  const now = o.now ?? Date.now;
  const log = o.log ?? (() => {});
  const run = o.run ?? runChild;
  /** One at a time: the queue is a promise chain. */
  let tail = Promise.resolve();
  let busy = 0;

  const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
  const waitForNoPlay = async () => {
    while (o.playing()) await sleep(pollMs);
  };

  /**
   * Run once, unless a play starts: then stop it, wait, and run again (D310: play is never interrupted).
   * @param {string[]} args @param {string} what
   */
  async function attempt(args, what) {
    const queued = now();
    let restarts = 0;
    let waited = 0;
    for (;;) {
      const w0 = now();
      await waitForNoPlay();
      waited += now() - w0;
      const ac = new AbortController();
      const watch = setInterval(() => {
        if (o.playing()) ac.abort();
      }, Math.min(pollMs, 500));
      const t0 = now();
      try {
        const out = await run(args, { nice: s.nice, timeoutMs: s.timeoutMs, signal: ac.signal });
        return { out, seconds: (now() - t0) / 1000, waited_s: Math.round(waited / 100) / 10, restarts, queued_s: (now() - queued) / 1000 };
      } catch (e) {
        if (!ac.signal.aborted) throw e;
        restarts++;
        log(`publish gate: a game started, so ${what}'s test stopped; it runs again when the game ends`);
      } finally {
        clearInterval(watch);
      }
    }
  }

  /** @template T @param {() => Promise<T>} job @returns {Promise<T>} */
  const enqueue = (job) => {
    busy++;
    const p = tail.then(job).finally(() => busy--);
    tail = p.then(
      () => {},
      () => {},
    );
    return p;
  };

  /** @param {GateResult} r */
  const record = (r) => {
    const { report, ...rest } = r;
    appendLog(o.logsDir, "publish_gate", { ...rest, at: new Date().toISOString() });
    log(`publish gate: ${r.what} ${r.ok ? "passed" : `kept off the shelf (${r.failing.map((f) => f.id).join(", ") || r.error})`} in ${r.seconds} s on ${r.host} (${r.driver})${r.waited_s ? `, after waiting ${r.waited_s} s for a game to end` : ""}`);
    return r;
  };

  return {
    settings: s,
    /** Is a test queued or running? */
    busy: () => busy > 0,
    /**
     * Gate a made game's folder (before it's committed). Never throws: a run that
     * couldn't happen fails the gate with the reason.
     * @param {string} dir @param {{ what?: string, session_id?: string | null }} [about]
     * @returns {Promise<GateResult>}
     */
    cart(dir, about = {}) {
      const what = about.what ?? path.basename(dir);
      return enqueue(async () => {
        const args = ["--cart", dir, "--budget-ms", String(s.budgetMs), ...(s.chromium ? ["--chromium", s.chromium] : [])];
        /** @type {GateResult} */
        const base = { ok: false, kind: "cart", what, host: s.host, driver: "browser", fallback: null, failing: [], seconds: 0, waited_s: 0, restarts: 0, budget_ms: s.budgetMs, cpu_factor: s.cpuFactor, ...(about.session_id ? { session_id: about.session_id } : {}) };
        try {
          const a = await attempt(args, what);
          const { report } = a.out;
          const failing = [
            ...report.rules.filter((/** @type {any} */ r) => r.kind === "auto" && r.status !== "pass" && r.status !== "skipped").map((/** @type {any} */ r) => ({ id: r.id, passed: false, reason: r.reason })),
            ...report.generic.filter((/** @type {any} */ g) => g.status !== "pass").map((/** @type {any} */ g) => ({ id: `generic:${g.id}`, passed: false, reason: g.reason })),
            ...report.coverage.map((/** @type {any} */ c) => ({ id: "coverage", passed: false, reason: `${c.rule ? `${c.rule}: ` : ""}${c.message}` })),
          ];
          const anyAuto = report.rules.some((/** @type {any} */ r) => r.kind === "auto");
          if (!anyAuto) failing.push({ id: "no-auto-rules", passed: false, reason: "the spec has no rule the test can check" });
          // A guessed budget is advice, not a gate (D311).
          const advisory = s.frameTimeBlocks ? [] : failing.filter((f) => f.id === "generic:frame-time");
          const blocking = failing.filter((f) => !advisory.includes(f));
          // Glide (D519): inside the budget, but taking a big share of the frame on this cabinet. A warning, never a block.
          // When glide is what takes it over the budget, the frame-time check's own reason says so.
          const gl = report.glide;
          if (gl?.warning === "heavy") advisory.push({ id: "glide", passed: false, reason: `glide takes about ${gl.costMs} ms of each frame here (${gl.p95Ms} ms at the slowest 5% with it, ${gl.plainP95Ms} ms without; the budget is ${s.budgetMs} ms)` });
          return record({
            ...base,
            ok: blocking.length === 0,
            ...(advisory.length ? { advisory } : {}),
            frame_time_blocks: s.frameTimeBlocks,
            driver: a.out.driver,
            fallback: a.out.fallback,
            failing: blocking,
            seconds: Math.round(a.seconds * 10) / 10,
            waited_s: a.waited_s,
            restarts: a.restarts,
            frame_time: { ...report.frameTime, host: s.host },
            ...(gl ? { glide: gl } : {}),
            report: { ...report, frameTime: { ...report.frameTime, host: s.host } },
          });
        } catch (e) {
          return record({ ...base, error: e instanceof Error ? e.message : String(e), failing: [{ id: "gate", passed: false, reason: `the cabinet couldn't run the test: ${e instanceof Error ? e.message : e}` }] });
        }
      });
    },
    /**
     * Smoke-check a downloaded game at its URL on the guest server.
     * @param {string} id @param {string} url
     * @returns {Promise<GateResult>}
     */
    guest(id, url) {
      return enqueue(async () => {
        const args = ["--guest", url, "--watch-ms", String(s.watchMs), ...(s.chromium ? ["--chromium", s.chromium] : [])];
        /** @type {GateResult} */
        const base = { ok: false, kind: "guest", what: id, host: s.host, driver: "browser", fallback: null, failing: [], seconds: 0, waited_s: 0, restarts: 0 };
        try {
          const a = await attempt(args, id);
          const failing = a.out.checks.filter((/** @type {GateCheck} */ c) => !c.passed);
          return record({ ...base, ok: a.out.ok, failing, seconds: Math.round(a.seconds * 10) / 10, waited_s: a.waited_s, restarts: a.restarts });
        } catch (e) {
          return record({ ...base, error: e instanceof Error ? e.message : String(e), failing: [{ id: "gate", passed: false, reason: `the cabinet couldn't run the check: ${e instanceof Error ? e.message : e}` }] });
        }
      });
    },
  };
}

/** Gate runs in flight, by process group: the service stops them when it stops. @type {Set<number>} */
const LIVE = new Set();

/** How many gate runs are going right now. */
export const liveGateRuns = () => LIVE.size;

/** Stop every gate run now (the service is stopping). */
export function stopGateRuns() {
  for (const pid of LIVE) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {}
  }
  LIVE.clear();
}

/**
 * Run gate-run.js under nice, in its own process group, so stopping it stops its Chromium too.
 * @param {string[]} args @param {{ nice: number, timeoutMs: number, signal: AbortSignal }} o
 */
export function runChild(args, o) {
  return new Promise((resolve, reject) => {
    const child = spawn("nice", ["-n", String(o.nice), process.execPath, RUN, ...args], { stdio: ["ignore", "pipe", "pipe"], detached: true });
    if (child.pid) LIVE.add(child.pid);
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => {
      if (err.length < 4000) err += d;
    });
    const kill = () => {
      try {
        process.kill(-(/** @type {number} */ (child.pid)), "SIGKILL");
      } catch {}
    };
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, o.timeoutMs);
    const onAbort = () => kill();
    o.signal.addEventListener("abort", onAbort, { once: true });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", () => {
      clearTimeout(timer);
      if (child.pid) LIVE.delete(child.pid);
      o.signal.removeEventListener("abort", onAbort);
      if (o.signal.aborted) return reject(new Error("stopped: a game started"));
      if (timedOut) return reject(new Error(`the test didn't finish within ${Math.round(o.timeoutMs / 1000)} s`));
      let doc;
      try {
        doc = JSON.parse(out.trim().split("\n").pop() ?? "");
      } catch {
        return reject(new Error(`the test stopped without a result${err ? `: ${err.trim().split("\n").slice(-1)[0]}` : ""}`));
      }
      if (doc.error) return reject(new Error(doc.error));
      resolve(doc);
    });
  });
}

/**
 * The Studio's checker with the gate as its playtest (D310): validate as before, then
 * the cabinet's own run in Chromium decides whether the game goes on the shelf.
 * @param {import("@game-studio-arcade/studio-cli/src/checks.js").Checker} base
 * @param {ReturnType<typeof createGate>} gate
 * @returns {import("@game-studio-arcade/studio-cli/src/checks.js").Checker}
 */
export function gatedChecker(base, gate) {
  return {
    validate: (dir) => base.validate(dir),
    async playtest(dir) {
      const r = await gate.cart(dir, { what: readTitle(dir) ?? path.basename(path.dirname(dir)) });
      const { report, ...summary } = r;
      return {
        ok: r.ok,
        ...(r.error ? { unavailable: true } : {}),
        failing: r.failing.map((f) => f.id),
        ...(report ? { report } : {}),
        gate: summary,
      };
    },
  };
}

/** @param {string} dir */
function readTitle(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "cart.json"), "utf8")).title ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether a game is being played (D310): the launcher says so at the start of a play,
 * again every few seconds, and at its end. A launcher that went away without saying
 * stops counting after `staleMs`, so a crash can't hold the gate forever.
 * @param {{ staleMs?: number, now?: () => number }} [o]
 */
export function playTracker(o = {}) {
  const staleMs = o.staleMs ?? 30_000;
  const now = o.now ?? Date.now;
  /** @type {{ at: number, what: string | null } | null} */
  let beat = null;
  return {
    /** @param {boolean} on @param {string | null} [what] */
    set(on, what = null) {
      beat = on ? { at: now(), what } : null;
    },
    playing: () => beat !== null && now() - beat.at < staleMs,
    what: () => (beat && now() - beat.at < staleMs ? beat.what : null),
  };
}

/**
 * Downloaded games' smoke results, by id and version, in the data folder: a guest
 * is on the shelf once its version has passed (D310). An unknown one is checked once.
 * @param {{ file: string, gate: ReturnType<typeof createGate> | null, urlOf: (id: string, meta: any) => string | null }} o
 */
export function guestGate(o) {
  /** @type {Record<string, { ok: boolean, at: string, failing: GateCheck[], seconds: number }>} */
  let known = {};
  try {
    known = JSON.parse(fs.readFileSync(o.file, "utf8"));
  } catch {}
  /** @type {Set<string>} */
  const pending = new Set();
  /** Checks the cabinet couldn't run (no Chromium): the cabinet's fault, so the game stays; tried again next start. */
  /** @type {Set<string>} */
  const unchecked = new Set();
  const keyOf = (/** @type {string} */ id, /** @type {any} */ meta) => `${id}@${meta?.version ?? "unversioned"}`;
  const save = () => {
    writeJsonDurable(o.file, known, 1);
  };
  return {
    /**
     * Is this guest on the shelf? Asks for its check the first time it's seen.
     * @param {string} id @param {any} meta
     */
    admitted(id, meta) {
      if (!o.gate) return true;
      const key = keyOf(id, meta);
      const k = known[key];
      if (k) return k.ok;
      if (unchecked.has(key)) return true;
      const url = o.urlOf(id, meta);
      if (url && !pending.has(key)) {
        pending.add(key);
        o.gate.guest(id, url).then((r) => {
          pending.delete(key);
          if (r.error) return void unchecked.add(key);
          known[key] = { ok: r.ok, at: new Date().toISOString(), failing: r.failing, seconds: r.seconds };
          save();
        });
      }
      return false;
    },
    /** @param {string} id @param {any} meta */
    result: (id, meta) => known[keyOf(id, meta)] ?? null,
    pending: () => pending.size,
  };
}
