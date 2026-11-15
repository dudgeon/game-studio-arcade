// Runs inside the sandboxed cart frame (D13, D21). The host page drives it:
//   host -> frame: { type: "boot", cartUrl, seed, save, players, fine, gpu }
//                  { type: "fine", k }                   the screen's scale changed (D476)
//                  { type: "tick", n, masks }            run n updates, then draw (one mask per controller)
//                  { type: "call", id, method, args }    test handle call
//                  { type: "ai", reply }                 an answer to a g.ai ask (D480)
//                  { type: "heard", name, action }       what the cabinet heard for a voice ask (D489)
//   frame -> host: { type: "ready", voices } | { type: "out", audio, save, scores, ai }
//                  { type: "error", error } | { type: "result", id, value?, error? }
//                  { type: "key", code, down }           keys pressed while the frame has focus
import { createBlit } from "./glblit.js";
import { H, W } from "./gfx.js";
import { checkCart } from "./machine.js";
import { rgbaTable } from "./palette.js";
import { cartError, createTestHandle } from "./testhandle.js";

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("screen"));
const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d", { alpha: false }));
let image = ctx.createImageData(W, H);
let out32 = new Uint32Array(image.data.buffer);
const RGBA = rgbaTable();

/** @type {ReturnType<typeof createTestHandle> | null} */
let t = null;
let failed = false;

const post = (msg) => parent.postMessage(msg, "*");

const errorInfo = (e, where = "frame", frame = t ? t.machine().frame : 0) => {
  const err = /** @type {Error} */ (e);
  return { message: err?.message ?? String(e), stack: err?.stack ?? "", where, frame };
};

// How a gliding cart's picture gets to the screen (D517): "gpu" through glblit.js, "2d" when there's no
// WebGL here, null while nothing glides.
const glideCanvas = /** @type {HTMLCanvasElement} */ (document.getElementById("glide"));
/** @type {ReturnType<typeof createBlit> | undefined} undefined until a cart first glides */
let blit;
/** @type {"gpu" | "2d" | null} */
let glidePath = null;
let showingGlide = false;
/** Which of the two canvases is on screen. */
function surface(glide) {
  if (glide === showingGlide) return;
  showingGlide = glide;
  glideCanvas.style.display = glide ? "block" : "none";
  canvas.style.display = glide ? "none" : "block";
}

// A gliding cart (D476) is shown from its glide buffer: by the GPU when it can be (D517), or else on
// the 2D canvas at that size. Any other cart is shown from the framebuffer, as ever.
function render() {
  if (!t) return;
  const m = t.machine();
  const fine = m.fine;
  if (fine && !noGpu) {
    if (blit === undefined) blit = createBlit(glideCanvas, RGBA);
    if (blit && blit.show(fine.pixels, fine.width, fine.height)) {
      glidePath = "gpu";
      return surface(true);
    }
    blit = null; // no WebGL, or it was lost: the 2D path from here on
  }
  glidePath = fine ? "2d" : null;
  surface(false);
  const w = fine ? fine.width : W;
  const h = fine ? fine.height : H;
  if (image.width !== w || image.height !== h) {
    canvas.width = w;
    canvas.height = h;
    image = ctx.createImageData(w, h);
    out32 = new Uint32Array(image.data.buffer);
  }
  const px = fine ? fine.pixels : m.pixels;
  for (let i = 0; i < px.length; i++) out32[i] = RGBA[px[i]];
  ctx.putImageData(image, 0, 0);
}

/** The host's scale changed: resize the glide buffer and draw the same frame again. */
function setFine(k) {
  if (!t || failed) return;
  const m = t.machine();
  if (m.fineK === (k > 1 ? k : 1)) return;
  m.setFine(k);
  try {
    m.draw();
  } catch (e) {
    failed = true;
    post({ type: "error", error: errorInfo(cartError(e, "draw", m.frame), "draw", m.frame), fatal: true });
    return;
  }
  render();
}

function flush() {
  if (!t) return;
  const m = t.machine();
  const audio = m.drainAudio();
  const save = m.drainSave();
  const warnings = m.drainWarnings();
  const scores = m.drainScores();
  for (const w of warnings) console.warn(`[cart] frame ${w.frame}: ${w.message}`);
  const ai = m.drainAi();
  if (audio.length || save !== undefined || warnings.length || scores.length || ai.length) post({ type: "out", audio, save, warnings, scores, ai });
}

// The host can ask for the 2D path (`gpu: false`), to compare the two and to test the fallback.
let noGpu = false;

async function boot({ cartUrl, seed, save, players, fine, gpu }) {
  noGpu = gpu === false;
  try {
    const url = new URL(cartUrl, location.href);
    const mod = await import(url.href);
    const cart = checkCart(mod.default);
    t = createTestHandle(cart, { seed, save, players, fine });
    render();
    flush();
    post({ type: "ready", voices: t.machine().aiVoices() });
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

const METHODS = new Set(["step", "input", "probe", "poke", "frame", "sounds", "scores", "warnings", "reset"]);

async function call(id, method, args) {
  try {
    if (!t) throw new Error("the cart isn't loaded");
    // Not a test method: what's on the screen, for the host (arcade.screen(), D517).
    if (method === "screen") return post({ type: "result", id, value: { glides: t.machine().glides, fine: t.machine().fineK, path: glidePath } });
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
  else if (msg.type === "ai") t?.machine().aiDeliver(msg.reply);
  else if (msg.type === "heard") t?.machine().aiHear(msg);
  else if (msg.type === "fine") setFine(msg.k | 0);
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
