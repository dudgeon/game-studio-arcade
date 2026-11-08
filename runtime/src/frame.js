// Runs inside the sandboxed cart frame (D13, D21). The host page drives it:
//   host -> frame: { type: "boot", cartUrl, seed, save, players }
//                  { type: "tick", n, masks }            run n updates, then draw (one mask per controller)
//                  { type: "call", id, method, args }    test handle call
//   frame -> host: { type: "ready" } | { type: "out", audio, save }
//                  { type: "error", error } | { type: "result", id, value?, error? }
//                  { type: "key", code, down }           keys pressed while the frame has focus
import { H, W } from "./gfx.js";
import { checkCart } from "./machine.js";
import { rgbaTable } from "./palette.js";
import { cartError, createTestHandle } from "./testhandle.js";

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("screen"));
const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d", { alpha: false }));
const image = ctx.createImageData(W, H);
const out32 = new Uint32Array(image.data.buffer);
const RGBA = rgbaTable();

/** @type {ReturnType<typeof createTestHandle> | null} */
let t = null;
let failed = false;

const post = (msg) => parent.postMessage(msg, "*");

const errorInfo = (e, where = "frame", frame = t ? t.machine().frame : 0) => {
  const err = /** @type {Error} */ (e);
  return { message: err?.message ?? String(e), stack: err?.stack ?? "", where, frame };
};

function render() {
  if (!t) return;
  const px = t.machine().pixels;
  for (let i = 0; i < px.length; i++) out32[i] = RGBA[px[i]];
  ctx.putImageData(image, 0, 0);
}

function flush() {
  if (!t) return;
  const m = t.machine();
  const audio = m.drainAudio();
  const save = m.drainSave();
  const warnings = m.drainWarnings();
  for (const w of warnings) console.warn(`[cart] frame ${w.frame}: ${w.message}`);
  if (audio.length || save !== undefined || warnings.length) post({ type: "out", audio, save, warnings });
}

async function boot({ cartUrl, seed, save, players }) {
  try {
    const url = new URL(cartUrl, location.href);
    const mod = await import(url.href);
    const cart = checkCart(mod.default);
    t = createTestHandle(cart, { seed, save, players });
    render();
    flush();
    post({ type: "ready" });
  } catch (e) {
    failed = true;
    post({ type: "error", error: errorInfo(e, "load", 0), fatal: true });
  }
}

function tick(n, masks) {
  if (!t || failed) return;
  const m = t.machine();
  for (let i = 0; i < n; i++) {
    try {
      m.update(masks);
    } catch (e) {
      failed = true;
      post({ type: "error", error: errorInfo(cartError(e, "update", m.frame), "update", m.frame), fatal: true });
      return;
    }
  }
  try {
    m.draw();
  } catch (e) {
    failed = true;
    post({ type: "error", error: errorInfo(cartError(e, "draw", m.frame), "draw", m.frame), fatal: true });
    return;
  }
  render();
  flush();
}

const METHODS = new Set(["step", "input", "probe", "poke", "frame", "sounds", "warnings", "reset"]);

async function call(id, method, args) {
  try {
    if (!t) throw new Error("the cart isn't loaded");
    if (!METHODS.has(method)) throw new Error(`unknown test method ${method}`);
    let value = await /** @type {any} */ (t)[method](...(args ?? []));
    if (method === "frame") value = { ...value, pixels: Array.from(value.pixels) };
    if (method === "step" || method === "reset") {
      failed = false;
      render();
      t.machine().drainAudio(); // tests don't make noise
      t.machine().drainSave();
    }
    post({ type: "result", id, value: value === undefined ? null : value });
  } catch (e) {
    post({ type: "result", id, error: errorInfo(e, method) });
  }
}

addEventListener("message", (e) => {
  if (e.source !== parent) return;
  const msg = e.data;
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "boot") boot(msg);
  else if (msg.type === "tick") tick(Math.max(1, Math.min(8, msg.n | 0)), Array.isArray(msg.masks) ? msg.masks : []);
  else if (msg.type === "call") call(msg.id, msg.method, msg.args);
});

// Keys pressed while the frame has focus go to the host, which owns input.
for (const type of /** @type {const} */ (["keydown", "keyup"])) {
  addEventListener(type, (e) => {
    if (!e.repeat) post({ type: "key", code: e.code, down: type === "keydown" });
    e.preventDefault();
  });
}
addEventListener("blur", () => post({ type: "key", code: "*", down: false }));

addEventListener("error", (e) => post({ type: "error", error: errorInfo(e.error ?? e.message) }));
addEventListener("unhandledrejection", (e) => post({ type: "error", error: errorInfo(e.reason) }));
