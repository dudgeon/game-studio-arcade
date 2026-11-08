// The test handle `t` (runtime/test-hook.d.ts) over a console machine. Used
// as-is by headless Node runs and inside the cart frame.
import { expandScript } from "./input.js";
import { createMachine } from "./machine.js";

/** Wrap a cart exception with where it happened, keeping the original as cause. */
export function cartError(e, where, frame) {
  const err = /** @type {Error} */ (e);
  const msg = err && err.message ? err.message : String(e);
  const wrapped = new Error(`cart error in ${where} at frame ${frame}: ${msg}`, { cause: e });
  if (err && err.stack) wrapped.stack = `${wrapped.message}\n${err.stack.split("\n").slice(1).join("\n")}`;
  return wrapped;
}

/**
 * @param {Arcade.Cart} cart
 * @param {{ seed?: number, save?: string | null }} [opts]
 */
export function createTestHandle(cart, opts = {}) {
  const start = (seed, save) => {
    try {
      return createMachine({ cart, seed, save });
    } catch (e) {
      throw cartError(e, "init", 0);
    }
  };
  let m = start(opts.seed ?? 1, opts.save ?? null);
  /** @type {[number, number][]} */
  let queue = [];

  /** @type {Arcade.TestHandle & { warnings: () => Promise<Arcade.Warning[]>, machine: () => import("./machine.js").Machine }} */
  const t = {
    async step(n = 1) {
      n = Math.floor(n);
      if (!(n >= 1)) throw new Error(`t.step(n) needs n >= 1, got ${n}`);
      for (let i = 0; i < n; i++) {
        const masks = queue.length ? /** @type {[number, number]} */ (queue.shift()) : [0, 0];
        try {
          m.update(masks);
        } catch (e) {
          throw cartError(e, "update", m.frame);
        }
      }
      try {
        m.draw();
      } catch (e) {
        throw cartError(e, "draw", m.frame);
      }
    },
    async input(script) {
      queue = queue.concat(expandScript(script));
    },
    async probe() {
      try {
        return m.probe();
      } catch (e) {
        throw cartError(e, "probe", m.frame);
      }
    },
    async frame() {
      return m.capture();
    },
    async sounds() {
      return m.sounds();
    },
    async warnings() {
      return m.warnings();
    },
    async reset(r = {}) {
      m = start(r.seed ?? 1, r.keepSave ? m.saved : null);
      queue = [];
    },
    machine: () => m,
  };
  return t;
}
