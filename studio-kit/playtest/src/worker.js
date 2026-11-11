// One playtest job in its own worker thread (D60): a fresh cart, one check or
// one generic run, then exit. The main thread enforces wall-time limits and
// terminates this worker if the cart or check hangs.
//
// Messages to the main thread:
//   { type: "crash", where, frame, message }      the cart threw
//   { type: "keyframe", name, frame }              a screen worth saving as PNG
//   { type: "rpc", id, method, args }              browser driver only
//   { type: "done", result }                       finished (pass or fail)
import { parentPort, workerData } from "node:worker_threads";
import { soakScript } from "./soak.js";
// A relative path, not the package name: the packed kit has no node_modules (D63).
import { withBot } from "../../../runtime/lib/bot.js";

/**
 * @typedef {{ kind: "load" } | { kind: "check", id: string } | { kind: "soak", name: string, frames: number, inputSeed: number | null, sampleEvery: number, keyEvery: number, keyframes: boolean }} Job
 * @typedef {{ job: Job, gameUrl: string, checksUrl: string | null, seed: number, driver: "node" | "browser", runtimeUrl: string, maxFrames: number }} WorkerData
 */

const data = /** @type {WorkerData} */ (workerData);
const port = /** @type {import("node:worker_threads").MessagePort} */ (parentPort);
const where = data.job.kind === "check" ? data.job.id : data.job.kind === "soak" ? data.job.name : "load";

/** @param {unknown} e */
const messageOf = (e) => (e instanceof Error ? e.message : String(e));

/** @type {unknown} */
let lastCrash;
let crashAt = "";

process.on("unhandledRejection", (e) => {
  port.postMessage({ type: "crash", where, frame: null, message: `unhandled: ${messageOf(e)}` });
});

// --- browser driver: the handle lives on the page; forward calls to the main thread.
let rpcId = 0;
/** @type {Map<number, { resolve: (v: any) => void, reject: (e: Error) => void }>} */
const pending = new Map();
port.on("message", (m) => {
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  if (m.error !== undefined) p.reject(new Error(m.error));
  else p.resolve(m.value);
});
/** @param {string} method @param {unknown[]} args @returns {Promise<any>} */
const rpc = (method, args) =>
  new Promise((resolve, reject) => {
    const id = ++rpcId;
    pending.set(id, { resolve, reject });
    port.postMessage({ type: "rpc", id, method, args });
  });

/** @returns {Promise<{ base: Arcade.TestHandle, timedStep: () => Promise<number> }>} */
async function open() {
  if (data.driver === "browser") {
    /** @type {Arcade.TestHandle} */
    const base = {
      step: (n) => rpc("step", [n]),
      input: (s) => rpc("input", [s]),
      probe: () => rpc("probe", []),
      poke: (o) => rpc("poke", [o]),
      frame: () => rpc("frame", []),
      sounds: () => rpc("sounds", []),
      scores: () => rpc("scores", []),
      warnings: () => rpc("warnings", []),
      reset: (o) => rpc("reset", [o]),
    };
    await rpc("open", []);
    return { base, timedStep: () => rpc("timedStep", []) };
  }
  const rt = await import(data.runtimeUrl);
  /** @type {Arcade.TestHandle} */
  const base = await rt.headless(data.gameUrl, { seed: data.seed });
  return {
    base,
    async timedStep() {
      const t0 = performance.now();
      await base.step(1);
      return performance.now() - t0;
    },
  };
}

class LimitError extends Error {}

/**
 * The `t` a check sees: the driver's handle plus frame counting, the
 * per-check frame limit, and crash recording.
 * @param {Arcade.TestHandle} base
 */
function wrap(base) {
  let gameFrame = 0;
  let total = 0;
  const handle = {
    stepped: () => total,
    gameFrame: () => gameFrame,
    t: withBot(/** @type {Arcade.TestHandle} */ ({
      async step(n = 1) {
        if (!Number.isInteger(n) || n < 1) throw new Error(`t.step(n) needs a whole number of frames >= 1, got ${n}`);
        if (total + n > data.maxFrames) throw new LimitError(`the check stepped more than ${data.maxFrames} frames (${data.maxFrames / 60} s of game time) and was stopped`);
        const from = gameFrame;
        total += n;
        gameFrame += n;
        try {
          await base.step(n);
        } catch (e) {
          lastCrash = e;
          crashAt = n === 1 ? `at frame ${gameFrame}` : `during frames ${from + 1}-${gameFrame}`;
          port.postMessage({ type: "crash", where, frame: n === 1 ? gameFrame : null, message: `${messageOf(e)} (${crashAt})` });
          throw e;
        }
      },
      input: (s) => base.input(s),
      probe: () => base.probe(),
      poke: (o) => base.poke(o),
      frame: () => base.frame(),
      sounds: () => base.sounds(),
      scores: () => base.scores(),
      async reset(o) {
        gameFrame = 0;
        await base.reset(o);
      },
    })),
  };
  return handle;
}

/** @param {ArrayLike<number>} pixels */
function paletteProblems(pixels) {
  /** @type {Map<number, number>} */
  const bad = new Map();
  for (let i = 0; i < pixels.length; i++) {
    const v = pixels[i];
    if (!(Number.isInteger(v) && v >= 0 && v <= 31)) bad.set(v, (bad.get(v) ?? 0) + 1);
  }
  return [...bad].map(([value, count]) => ({ value, count }));
}

/** @param {Arcade.Frame} f */
const sendFrame = (name, f) => port.postMessage({ type: "keyframe", name, frame: f });

/** Frames whose pixels aren't palette indices: [{ frame, value, count }]. */
/** @type {{ frame: number, value: number, count: number }[]} */
const paletteBad = [];
/** @param {Arcade.Frame} f */
function scan(f) {
  for (const p of paletteProblems(f.pixels)) paletteBad.push({ frame: f.frame, ...p });
}

/** @param {unknown} e @param {string} doing */
function crashReason(e, doing) {
  if (e instanceof LimitError) return e.message;
  if (e === lastCrash) return `the game crashed ${crashAt}${doing}: ${messageOf(e)}`;
  return messageOf(e);
}

async function run() {
  const job = data.job;
  /** @type {Awaited<ReturnType<typeof open>>} */
  let opened;
  try {
    opened = await open();
  } catch (e) {
    port.postMessage({ type: "crash", where, frame: 0, message: `loading the game: ${messageOf(e)}` });
    return { status: "fail", reason: `the game didn't load: ${messageOf(e)}`, frames: 0, loadFailed: true };
  }
  handle = opened.base;
  const h = wrap(opened.base);
  const { t } = h;

  if (job.kind === "load") {
    try {
      await t.step(1);
      const f = await t.frame();
      sendFrame("load", f);
      scan(f);
      const p = await t.probe();
      JSON.stringify(p);
      return { status: "pass", reason: null, frames: 1, paletteBad };
    } catch (e) {
      return { status: "fail", reason: crashReason(e, " (the first frame)"), frames: h.stepped(), paletteBad };
    }
  }

  if (job.kind === "soak") {
    /** @type {number[]} */
    const times = [];
    /** @type {{ frame: number, hash: string }[]} */
    const hashes = [];
    try {
      if (job.inputSeed !== null) await t.input(soakScript(job.frames, job.inputSeed));
      for (let i = 1; i <= job.frames; i++) {
        try {
          times.push(await opened.timedStep());
        } catch (e) {
          lastCrash = e;
          crashAt = `at frame ${i}`;
          port.postMessage({ type: "crash", where, frame: i, message: `${messageOf(e)} (at frame ${i})` });
          throw e;
        }
        if (i % job.sampleEvery === 0) {
          const f = await t.frame();
          hashes.push({ frame: i, hash: f.hash });
          scan(f);
          if (job.keyframes && i % job.keyEvery === 0) sendFrame(`soak-${String(i).padStart(4, "0")}`, f);
          try {
            JSON.stringify(await t.probe());
          } catch (e) {
            throw new Error(`probe() failed at frame ${i}: ${messageOf(e)}`);
          }
        }
      }
      return { status: "pass", reason: null, frames: job.frames, times, hashes, paletteBad };
    } catch (e) {
      if (job.keyframes) {
        try {
          sendFrame("soak-crash", await t.frame());
        } catch {
          // nothing to show
        }
      }
      return { status: "fail", reason: crashReason(e, job.inputSeed === null ? " with no input" : " of the random-input soak"), frames: times.length, times, hashes, paletteBad };
    }
  }

  // A check from checks.js.
  /** @type {Arcade.Checks} */
  let checks;
  try {
    checks = (await import(/** @type {string} */ (data.checksUrl))).default;
  } catch (e) {
    return { status: "fail", reason: `checks.js didn't load: ${messageOf(e)}`, frames: 0, paletteBad };
  }
  const fn = checks?.[job.id];
  let result;
  try {
    await fn(t);
    result = { status: "pass", reason: null };
  } catch (e) {
    result = { status: "fail", reason: crashReason(e, "") || `${job.id} failed with an empty message` };
  }
  try {
    const f = await t.frame();
    sendFrame(job.id, f);
    scan(f);
  } catch {
    // the cart is broken; the crash is already recorded
  }
  return { ...result, frames: h.stepped(), paletteBad };
}

/** @type {Arcade.TestHandle | null} */
let handle = null;

/** Dev warnings the runtime collected since the last reset (e.g. colors outside 0..31). */
async function collectWarnings() {
  try {
    return (await handle?.warnings?.()) ?? [];
  } catch {
    return [];
  }
}

run().then(
  async (result) => port.postMessage({ type: "done", result: { ...result, warnings: await collectWarnings() } }),
  (e) => port.postMessage({ type: "done", result: { status: "fail", reason: `harness error: ${messageOf(e)}`, frames: 0 } }),
);
