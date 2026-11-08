// Browser driver (D60, D63): Playwright against the runtime host page's
// window.arcade.test. The check runs in a worker; its `t` calls come here as
// RPC and are forwarded with page.evaluate.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";

const require = createRequire(import.meta.url);

export class HarnessError extends Error {}

/**
 * Find Playwright without ever installing it (D63): GSA_PLAYWRIGHT, then our
 * own node_modules, then the global npm root.
 * @returns {{ playwright: any, version: string, from: string }}
 */
export function findPlaywright() {
  /** @type {string[]} */
  const tried = [];
  /** @param {string} dir */
  const load = (dir) => {
    const pkg = join(dir, "package.json");
    if (!existsSync(pkg)) return null;
    return { playwright: require(dir), version: JSON.parse(readFileSync(pkg, "utf8")).version, from: dir };
  };
  const env = process.env.GSA_PLAYWRIGHT;
  if (env) {
    tried.push(env);
    const r = load(env);
    if (r) return r;
  }
  for (const name of ["playwright", "@playwright/test"]) {
    try {
      const dir = dirname(require.resolve(`${name}/package.json`));
      tried.push(dir);
      const r = load(dir);
      if (r) return r;
    } catch {
      // not installed locally
    }
  }
  /** @type {string[]} */
  const roots = [];
  try {
    roots.push(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim());
  } catch {
    // no npm on PATH
  }
  // The sandbox's preinstalled copy (platform-notes, D18).
  roots.push("/opt/npm-tools/node_modules");
  for (const root of new Set(roots)) {
    for (const name of ["playwright", "@playwright/test"]) {
      const dir = join(root, name);
      tried.push(dir);
      const r = load(dir);
      if (r) return r;
    }
  }
  throw new HarnessError(`Playwright isn't installed here (looked in ${tried.join(", ") || "nowhere"}). The harness never installs it; set GSA_PLAYWRIGHT or use --driver node.`);
}

/**
 * The default host adapter: the runtime's dev server and play.html
 * (runtime/README.md). Serves the cart folder at /carts/cart/.
 * @param {{ cartDir: string, runtimeDevServer: string }} o
 * @returns {Promise<HostAdapter>}
 */
export async function runtimeHost({ cartDir, runtimeDevServer }) {
  let mod;
  try {
    mod = await import(runtimeDevServer);
  } catch (e) {
    throw new HarnessError(`the runtime's dev server isn't available (${e instanceof Error ? e.message : e}); the browser driver needs runtime/dev-server.js`);
  }
  const name = basename(cartDir).replace(/[^\w.-]/g, "_") || "cart";
  const server = await mod.startServer({ port: 0, carts: { [name]: cartDir } });
  return {
    url: (seed) => `${server.url.replace(/\/$/, "")}/runtime/play.html?cart=/carts/${encodeURIComponent(name)}/game.js&seed=${seed}&test=1`,
    close: () => server.close(),
  };
}

/**
 * @typedef {{ url(seed: number): string, close(): Promise<void> }} HostAdapter
 */

/**
 * Start a browser and return sessions, one page per job.
 * @param {{ host: HostAdapter, headless?: boolean }} o
 */
export async function openBrowser({ host, headless = true }) {
  const pw = findPlaywright();
  let browser;
  try {
    browser = await pw.playwright.chromium.launch({ headless });
  } catch (e) {
    // Headless mode looks for chromium-headless-shell; a machine with only the
    // full Chromium build (perhaps the sandbox's /opt/pw-browsers) can still run it.
    try {
      browser = await pw.playwright.chromium.launch({ headless, channel: "chromium" });
    } catch {
      throw new HarnessError(`Chromium didn't start for Playwright ${pw.version}: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
    }
  }
  const env = { playwright: pw.version, browser: `chromium ${browser.version()}` };
  return {
    env,
    /**
     * @param {number} seed
     * @param {(err: { where: string, message: string, frame: number | null }) => void} onPageError
     */
    async session(seed, onPageError) {
      const context = await browser.newContext();
      const page = await context.newPage();
      page.on("pageerror", (e) => onPageError({ where: "page", message: e.message, frame: null }));
      /** @param {string} method @param {unknown[]} args */
      const call = async (method, args) => {
        if (method === "open") {
          await page.goto(host.url(seed));
          await page.waitForFunction(() => /** @type {any} */ (window).arcade);
          await page.evaluate(() => /** @type {any} */ (window).arcade.ready);
          return null;
        }
        return page.evaluate(
          async ([m, a]) => {
            const t = /** @type {any} */ (window).arcade.test;
            if (m === "timedStep") {
              const t0 = performance.now();
              await t.step(1);
              return performance.now() - t0;
            }
            if (m === "frame") {
              const f = await t.frame();
              return { ...f, pixels: Array.from(f.pixels) };
            }
            return t[m](...a);
          },
          /** @type {[string, unknown[]]} */ ([method, args]),
        );
      };
      return {
        call,
        close: () => context.close(),
      };
    },
    close: () => browser.close(),
  };
}

/** Strip Playwright's wrapping from an error thrown on the page. */
export function pageMessage(/** @type {unknown} */ e) {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/^page\.(evaluate|goto|waitForFunction):\s*/, "").replace(/^Error:\s*/, "").split("\n    at ")[0].split("\nCall log:")[0].trim();
}
