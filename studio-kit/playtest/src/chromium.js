// The browser driver without Playwright (D310): a system Chromium, started
// headless with --remote-debugging-pipe and driven over the DevTools protocol.
// The cabinet has Chromium but no Playwright package, so its publish gate uses
// this. It gives the same sessions as browser.js's openBrowser, so the harness
// doesn't care which one it got.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "./browser.js";

/** Where a system Chromium usually is: the cabinet's first, then a Mac's. */
const CANDIDATES = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

/** A system Chromium: GSA_CHROMIUM, then the usual places. @returns {string | null} */
export function findChromium() {
  const env = process.env.GSA_CHROMIUM;
  if (env) return existsSync(env) ? env : null;
  return CANDIDATES.find((p) => existsSync(p)) ?? null;
}

/** Flags Playwright also passes, so timers and frames run at full speed in a page nobody looks at. */
const FLAGS = [
  "--headless=new",
  "--remote-debugging-pipe",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-component-update",
  "--disable-sync",
  "--disable-extensions",
  "--mute-audio",
  "--metrics-recording-only",
  "--password-store=basic",
  "--use-mock-keychain",
];

/**
 * Start Chromium and return a DevTools connection over its pipe.
 * @param {{ executable?: string | null, nice?: number, args?: string[], startMs?: number }} [o]
 */
export async function launchChromium(o = {}) {
  const exe = o.executable ?? findChromium();
  if (!exe || !existsSync(exe)) throw new HarnessError(`there's no Chromium here (looked for ${o.executable ?? (process.env.GSA_CHROMIUM || CANDIDATES.join(", "))})`);
  const profile = mkdtempSync(join(tmpdir(), "gsa-chromium-"));
  const args = [...FLAGS, `--user-data-dir=${profile}`, ...(o.args ?? []), "about:blank"];
  // Low priority (D8, D310): nice applies to Chromium and everything it starts.
  const [cmd, argv] = o.nice ? ["nice", ["-n", String(o.nice), exe, ...args]] : [exe, args];
  const child = spawn(cmd, argv, { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  // Never left behind: if this process exits without close(), Chromium goes too.
  const reap = () => child.kill("SIGKILL");
  process.once("exit", reap);
  const toBrowser = /** @type {import("node:stream").Writable} */ (child.stdio[3]);
  const fromBrowser = /** @type {import("node:stream").Readable} */ (child.stdio[4]);
  let stderr = "";
  child.stderr?.on("data", (d) => {
    if (stderr.length < 4000) stderr += d;
  });

  let nextId = 1;
  /** @type {Map<number, { resolve: (v: any) => void, reject: (e: Error) => void, method: string }>} */
  const waiting = new Map();
  /** @type {Set<(m: any) => void>} */
  const listeners = new Set();
  let closed = false;
  /** @type {Error | null} */
  let gone = null;
  const fail = (/** @type {Error} */ e) => {
    gone = gone ?? e;
    for (const w of waiting.values()) w.reject(gone);
    waiting.clear();
  };
  child.on("exit", (code, signal) => {
    if (!closed) fail(new HarnessError(`Chromium stopped (${signal ?? `exit ${code}`})${stderr ? `: ${stderr.trim().split("\n").slice(-1)[0]}` : ""}`));
  });
  child.on("error", (e) => fail(new HarnessError(`Chromium didn't start: ${e.message}`)));
  toBrowser.on("error", () => {});

  let buf = Buffer.alloc(0);
  fromBrowser.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    let at;
    while ((at = buf.indexOf(0)) >= 0) {
      const text = buf.subarray(0, at).toString("utf8");
      buf = buf.subarray(at + 1);
      let m;
      try {
        m = JSON.parse(text);
      } catch {
        continue;
      }
      if (m.id !== undefined) {
        const w = waiting.get(m.id);
        if (!w) continue;
        waiting.delete(m.id);
        if (m.error) w.reject(new Error(`${w.method}: ${m.error.message}`));
        else w.resolve(m.result);
      } else for (const l of listeners) l(m);
    }
  });

  /**
   * One DevTools command; on a page's session when sessionId is given.
   * @param {string} method @param {Record<string, unknown>} [params] @param {string} [sessionId]
   * @returns {Promise<any>}
   */
  const send = (method, params = {}, sessionId) => {
    if (gone) return Promise.reject(gone);
    const id = nextId++;
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject, method });
      toBrowser.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
    });
  };
  /** @param {(m: any) => void} fn */
  const on = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  const startMs = o.startMs ?? 20000;
  let version;
  try {
    version = await Promise.race([
      send("Browser.getVersion"),
      new Promise((_, reject) => setTimeout(() => reject(new HarnessError(`Chromium didn't answer within ${startMs / 1000} s`)), startMs).unref()),
    ]);
  } catch (e) {
    closed = true;
    child.kill("SIGKILL");
    rmSync(profile, { recursive: true, force: true });
    throw e instanceof HarnessError ? e : new HarnessError(`Chromium didn't start: ${e instanceof Error ? e.message : e}`);
  }

  return {
    product: String(version.product ?? "Chromium"),
    executable: exe,
    send,
    on,
    async close() {
      if (closed) return;
      closed = true;
      process.removeListener("exit", reap);
      const exited = new Promise((r) => child.once("exit", r));
      send("Browser.close").catch(() => {});
      const t = setTimeout(() => child.kill("SIGKILL"), 3000);
      await exited;
      clearTimeout(t);
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

/** @typedef {Awaited<ReturnType<typeof launchChromium>>} Chromium */

/**
 * A page of its own (a fresh browser context, like a Playwright context).
 * @param {Chromium} chrome
 * @param {{ onException?: (message: string) => void, onRequest?: (url: string) => void }} [o]
 */
export async function openPage(chrome, o = {}) {
  const { browserContextId } = await chrome.send("Target.createBrowserContext", { disposeOnDetach: true });
  const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
  /** @type {Set<() => void>} */
  const loads = new Set();
  const off = chrome.on((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === "Runtime.exceptionThrown") o.onException?.(exceptionMessage(m.params.exceptionDetails));
    else if (m.method === "Network.requestWillBeSent") o.onRequest?.(m.params.request.url);
    else if (m.method === "Page.loadEventFired") for (const l of loads) l();
  });
  await chrome.send("Page.enable", {}, sessionId);
  await chrome.send("Runtime.enable", {}, sessionId);
  if (o.onRequest) await chrome.send("Network.enable", {}, sessionId);
  await chrome.send("Emulation.setDeviceMetricsOverride", { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false }, sessionId);

  /**
   * Evaluate an expression in the page, awaiting a promise, and return its value.
   * @param {string} expression
   */
  const evaluate = async (expression) => {
    const r = await chrome.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(exceptionMessage(r.exceptionDetails, true));
    return r.result?.value;
  };

  return {
    evaluate,
    /** Go to a URL and wait for its load event. @param {string} url @param {number} [timeoutMs] */
    async goto(url, timeoutMs = 30000) {
      /** @type {() => void} */
      let done = () => {};
      const loaded = new Promise((/** @type {(v?: unknown) => void} */ r) => {
        done = r;
        loads.add(done);
      });
      try {
        const nav = await chrome.send("Page.navigate", { url }, sessionId);
        if (nav.errorText) throw new HarnessError(`couldn't open ${url}: ${nav.errorText}`);
        await Promise.race([loaded, new Promise((_, reject) => setTimeout(() => reject(new HarnessError(`${url} didn't load within ${timeoutMs / 1000} s`)), timeoutMs).unref())]);
      } finally {
        loads.delete(done);
      }
    },
    /** Wait until an expression is truthy. @param {string} expression @param {number} [timeoutMs] */
    async waitFor(expression, timeoutMs = 30000) {
      const end = Date.now() + timeoutMs;
      while (!(await evaluate(`Boolean(${expression})`))) {
        if (Date.now() > end) throw new HarnessError(`waited ${timeoutMs / 1000} s for ${expression}`);
        await new Promise((r) => setTimeout(r, 50));
      }
    },
    async close() {
      off();
      await chrome.send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
    },
  };
}

/**
 * A page's exception as one line, the way Playwright words it: a page error is its
 * message alone; a failed evaluate keeps the error's name unless it's plain Error.
 * @param {any} d @param {boolean} [named]
 */
export function exceptionMessage(d, named = false) {
  const desc = d?.exception?.description ?? d?.exception?.value ?? d?.text ?? "an error";
  const line = String(desc).split("\n    at ")[0].replace(/^Uncaught\s+/, "");
  return (named ? line.replace(/^Error: /, "") : line.replace(/^\w*Error: /, "")).trim();
}

/**
 * The harness's browser, on a system Chromium: the same shape as browser.js's
 * openBrowser, so the harness takes either.
 * @param {{ host: import("./browser.js").HostAdapter, executable?: string | null, nice?: number }} o
 */
export async function openChromiumBrowser({ host, executable, nice }) {
  const chrome = await launchChromium({ executable, nice });
  return {
    env: { playwright: null, browser: chrome.product.replace(/^HeadlessChrome\//, "chromium ").replace(/^Chrome\//, "chromium ") },
    /**
     * @param {number} seed
     * @param {(err: { where: string, message: string, frame: number | null }) => void} onPageError
     */
    async session(seed, onPageError, query = "") {
      const page = await openPage(chrome, { onException: (message) => onPageError({ where: "page", message, frame: null }) });
      /** @param {string} method @param {unknown[]} args */
      const call = async (method, args) => {
        if (method === "open") {
          await page.goto(host.url(seed) + query);
          await page.waitFor("window.arcade");
          await page.evaluate("Promise.resolve(window.arcade.ready).then(() => null)");
          return null;
        }
        // undefined stays undefined, as Playwright passes it (JSON would make t.reset() a reset(null)).
        const list = args.map((x) => (x === undefined ? "undefined" : JSON.stringify(x))).join(", ");
        return page.evaluate(`(${PAGE_CALL})([${JSON.stringify(method)}, [${list}]])`);
      };
      return { call, close: () => page.close() };
    },
    close: () => chrome.close(),
  };
}

// The same page-side call as browser.js's, as source text for Runtime.evaluate.
const PAGE_CALL = `async ([m, a]) => {
  const t = window.arcade.test;
  if (m === "timedStep") {
    const t0 = performance.now();
    await t.step(1);
    return performance.now() - t0;
  }
  if (m === "frame") {
    const f = await t.frame();
    return { ...f, pixels: Array.from(f.pixels) };
  }
  if (m === "screen") return window.arcade.screen ? window.arcade.screen() : null;
  return t[m](...a);
}`;
