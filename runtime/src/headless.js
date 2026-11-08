// Headless runs in Node: load a cart module and return a test handle with no
// browser (D21). Same `t` as in the frame and on the host page.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { checkCart } from "./machine.js";
import { createTestHandle } from "./testhandle.js";

/**
 * Import a cart's game.js and return its default export.
 * @param {string | URL} file
 */
export async function loadCart(file) {
  const url = file instanceof URL ? file : /^file:/.test(file) ? new URL(file) : pathToFileURL(path.resolve(file));
  const mod = await import(url.href);
  return checkCart(mod.default);
}

/**
 * @param {string | URL | Arcade.Cart} cart a game.js path or URL, or a cart object
 * @param {{ seed?: number, save?: unknown, players?: number }} [opts] save: initial g.load() data;
 *   players: controllers, 1..8, default 1 (D110)
 */
export async function headless(cart, opts = {}) {
  const c = typeof cart === "string" || cart instanceof URL ? await loadCart(cart) : checkCart(cart);
  const save = opts.save === undefined || opts.save === null ? null : JSON.stringify(opts.save);
  return createTestHandle(c, { seed: opts.seed, save, players: opts.players });
}
