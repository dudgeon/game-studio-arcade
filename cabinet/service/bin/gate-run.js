#!/usr/bin/env node
// One publish-gate run (D310), started by src/gate.js under `nice`, so it and its
// Chromium run at low priority. Prints one JSON document on stdout.
//
//   gate-run.js --cart DIR  [--chromium PATH] [--budget-ms N]   a made game: its spec's auto rules
//                                                               and the generic checks, in Chromium
//   gate-run.js --guest URL [--chromium PATH] [--watch-ms N]    a downloaded game: a smoke check only
//
// Exit 0 when it ran (pass or fail is in the JSON), 2 when it couldn't run at all.
import { parseArgs } from "node:util";
import { playtest, HarnessError, launchChromium, openPage } from "@game-studio-arcade/playtest";

const { values: v } = parseArgs({
  options: {
    cart: { type: "string" },
    guest: { type: "string" },
    chromium: { type: "string" },
    "budget-ms": { type: "string" },
    "watch-ms": { type: "string" },
  },
});

/** @param {unknown} doc @param {number} [code] */
const done = (doc, code = 0) => {
  process.stdout.write(`${JSON.stringify(doc)}\n`, () => process.exit(code));
};

// The service went away (killed, not stopped): stop too, with Chromium. This run leads
// its own process group (src/gate.js starts it detached), so that's the whole group.
const parent = process.ppid;
setInterval(() => {
  if (process.ppid === parent) return;
  try {
    process.kill(0, "SIGKILL");
  } catch {
    process.exit(3);
  }
}, 1000).unref();

const t0 = Date.now();
const seconds = () => Math.round((Date.now() - t0) / 100) / 10;

try {
  if (v.cart) {
    const budgetMs = v["budget-ms"] ? Number(v["budget-ms"]) : undefined;
    let report;
    /** @type {string | null} */
    let fallback = null;
    try {
      report = await playtest(v.cart, { driver: "browser", chromium: v.chromium || true, budgetMs, out: null, frames: false });
    } catch (e) {
      // No Chromium, or it wouldn't start: that's the cabinet's fault, not the game's.
      // The same checks on the node driver still decide (D310).
      if (!(e instanceof HarnessError) || !/Chromium/.test(e.message)) throw e;
      fallback = e.message;
      report = await playtest(v.cart, { driver: "node", out: null, frames: false });
    }
    done({ kind: "cart", driver: report.driver, fallback, seconds: seconds(), report });
  } else if (v.guest) {
    done({ kind: "guest", ...(await smoke(v.guest, v.chromium || null, Number(v["watch-ms"] ?? 5000))), seconds: seconds() });
  } else {
    done({ error: "gate-run.js --cart DIR or --guest URL" }, 2);
  }
} catch (e) {
  done({ error: e instanceof Error ? e.message : String(e), seconds: seconds() }, 2);
}

/**
 * A downloaded game's smoke check (D310): it loads, it throws nothing, and it asks
 * for nothing beyond its own origin.
 * @param {string} url @param {string | null} executable @param {number} watchMs
 */
async function smoke(url, executable, watchMs) {
  const origin = new URL(url).origin;
  const chrome = await launchChromium({ executable });
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const outside = [];
  try {
    const page = await openPage(chrome, {
      onException: (m) => errors.push(m),
      onRequest: (u) => {
        if (/^(data|blob|about|chrome-extension):/.test(u)) return;
        try {
          if (new URL(u).origin !== origin) outside.push(u);
        } catch {
          outside.push(u);
        }
      },
    });
    /** @type {string | null} */
    let loadFailed = null;
    try {
      await page.goto(url, 30000);
    } catch (e) {
      loadFailed = e instanceof Error ? e.message : String(e);
    }
    // A game's first seconds: most fail at once, or fetch what they need as they start.
    if (!loadFailed) await new Promise((r) => setTimeout(r, watchMs));
    await page.close();
    /** @type {{ id: string, passed: boolean, reason: string | null }[]} */
    const checks = [
      { id: "loads", passed: !loadFailed, reason: loadFailed },
      { id: "no-errors", passed: errors.length === 0, reason: errors.length ? `${errors.length} error${errors.length === 1 ? "" : "s"}; the first: ${errors[0]}` : null },
      { id: "no-network", passed: outside.length === 0, reason: outside.length ? `it asked for ${outside.length} thing${outside.length === 1 ? "" : "s"} off the cabinet; the first: ${outside[0]}` : null },
    ];
    return { ok: checks.every((c) => c.passed), checks, browser: chrome.product };
  } finally {
    await chrome.close();
  }
}
