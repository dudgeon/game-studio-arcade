#!/usr/bin/env node
// Run a cart headless (no browser) and print what happened, as JSON.
//
//   node runtime/run-cart.js <game.js> [--frames 300] [--seed 1]
//        [--input '[{"frames":30,"p1":"right"}]'] [--checks checks.js]
//
// Prints { ok, frame, hash, probe, sounds, warnings, checks?, error? } and exits 1 if the
// cart threw or any check failed. With --checks, each check runs on a fresh cart.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { headless, loadCart } from "./src/headless.js";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};
const file = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
if (!file) {
  console.error("usage: run-cart.js <game.js> [--frames N] [--seed N] [--input JSON] [--checks checks.js]");
  process.exit(2);
}

const frames = Number(flag("frames", "300"));
const seed = Number(flag("seed", "1"));
const input = JSON.parse(flag("input", "[]"));
const checksFile = flag("checks", undefined);

/** @type {Record<string, any>} */
const out = { ok: true };
try {
  const cart = await loadCart(file);
  const t = await headless(cart, { seed });
  await t.input(input);
  if (frames > 0) await t.step(frames);
  const f = await t.frame();
  Object.assign(out, { frame: f.frame, hash: f.hash, probe: await t.probe(), sounds: (await t.sounds()).length, warnings: await t.warnings() });

  if (checksFile) {
    const mod = await import(pathToFileURL(path.resolve(checksFile)).href);
    /** @type {Arcade.Checks} */
    const checks = mod.default ?? {};
    out.checks = {};
    for (const [id, check] of Object.entries(checks)) {
      const ct = await headless(cart, { seed: 1 });
      try {
        await check(ct);
        out.checks[id] = { pass: true };
      } catch (e) {
        out.ok = false;
        out.checks[id] = { pass: false, reason: /** @type {Error} */ (e).message };
      }
    }
  }
} catch (e) {
  out.ok = false;
  out.error = /** @type {Error} */ (e).message;
}
console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 1);
