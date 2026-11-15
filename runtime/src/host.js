// The host page side (D21): puts a cart in a sandboxed iframe and owns the
// clock, input, sound and saves. Players (the local player, the launcher,
// the Manager's simulator) and the playtest all use this.
import { H, W } from "./gfx.js";
import { BIT, DEFAULT_KEYMAP, checkPlayers, readInput } from "./input.js";
import { Synth } from "./synth.js";

const STEP_MS = 1000 / 60;
const MAX_TICKS = 4;
const SLACK_MS = 4;
/** A hold shorter than this on a voice ask's button is a tap, not talking (D489). */
export const VOICE_MIN_MS = 300;

/**
 * @typedef {{ message: string, stack: string, where: string, frame: number }} CartErrorInfo
 * @typedef {{
 *   container: HTMLElement,
 *   cartUrl: string,
 *   seed?: number,
 *   save?: unknown,
 *   test?: boolean,
 *   persist?: boolean,
 *   players?: number,
 *   keymap?: typeof DEFAULT_KEYMAP,
 *   glide?: boolean,
 *   gpu?: boolean | "any",
 *   onStar?: () => void,
 *   onError?: (e: CartErrorInfo) => void,
 *   ai?: (ask: import("./ai.js").AiAsk) => Promise<{ ok: boolean, lines?: string[], pick?: string, stop?: boolean }>,
 *   voice?: { start: (v: any) => void, stop: (v: any) => Promise<{ action?: string | null, reply?: string | null, fallback?: boolean }>, cancel: () => void },
 * }} HostOptions
 *   test: paused clock and no live input; frames only advance through `test.step()`.
 *   persist: keep g.save() data in localStorage (default: true unless test).
 *   players: how many controllers this console has, 1..8 (default 1, D110). The
 *     cabinet passes its config's `players`; play.html takes `?players=N`.
 *   ai: answers the cart's g.ai asks (D480). Only the cabinet's launcher has one; without it, and always
 *     on a test host, nobody answers and the cart runs on its fallbacks. `stop: true` ends asking for this run.
 *   voice: the cabinet's microphone, for the cart's voice asks (D489). The host calls `start` when player 1
 *     holds an ask's button, `stop` on release (the action heard, if any, goes to the cart) and `cancel` for a
 *     tap. Without it, and on a test host, a cart never hears anything.
 *   glide: false never shows a cart's glide picture (D476); play.html takes `?glide=0`.
 *   gpu: false shows a glide picture through the 2D canvas, not the GPU (D517); play.html takes `?gpu=0`.
 *     "any" takes the GPU path even on a software GL, for tests (`?gpu=any`).
 */

/** Largest integer scale (in device pixels) that fits the W x H screen in w x h CSS pixels. */
export function integerScale(w, h, dpr = 1) {
  const k = Math.floor(Math.min((w * dpr) / W, (h * dpr) / H));
  return Math.max(1, k);
}

/** The most glide buffer pixels per game pixel each way (D518). */
export const MAX_GLIDE = 2;

/**
 * The glide buffer's size for a screen scale (D476, D518): a whole divisor of the scale, so every buffer
 * pixel is a whole block of display pixels and the picture stays crisp, and at most MAX_GLIDE. On the
 * Picade's 4x that's 2: things move half a game pixel (2 display pixels) at a time. Glide at 4 moved a
 * display pixel at a time, but on the Pi it cost 6.8 ms a frame in the gate, against 3.2 ms at 2 (D518).
 * A scale of 3 keeps 3 (no smaller divisor); a scale with no divisor (5, 7) gets no glide and looks as
 * it always did.
 */
export function fineForScale(scale) {
  const k = Math.floor(scale);
  if (!(k >= 2)) return 1;
  for (let d = Math.min(k, MAX_GLIDE); d >= 2; d--) if (k % d === 0) return d;
  return k <= 3 ? k : 1;
}

/** @param {HostOptions} opts */
export function createHost(opts) {
  const test = !!opts.test;
  const persist = opts.persist ?? !test;
  const saveKey = `gsa.save.${opts.cartUrl}`;
  const keymap = opts.keymap ?? DEFAULT_KEYMAP;
  const players = checkPlayers(opts.players);

  let initialSave = null;
  if (opts.save !== undefined) initialSave = JSON.stringify(opts.save);
  else if (persist) {
    try {
      initialSave = localStorage.getItem(saveKey);
    } catch {}
  }

  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.setAttribute("title", "cart");
  iframe.setAttribute("allow", "");
  iframe.style.cssText = "border:0;display:block;background:#000;image-rendering:pixelated";
  iframe.src = new URL("../frame.html", import.meta.url).href;
  opts.container.appendChild(iframe);

  const fit = () => {
    const dpr = window.devicePixelRatio || 1;
    const r = opts.container.getBoundingClientRect();
    const k = integerScale(r.width || window.innerWidth, r.height || window.innerHeight, dpr);
    iframe.style.width = `${(W * k) / dpr}px`;
    iframe.style.height = `${(H * k) / dpr}px`;
    arcade.scale = k;
    const fine = opts.glide === false ? 1 : fineForScale(k);
    if (fine !== arcade.fine) {
      arcade.fine = fine;
      if (arcade.state === "ready") send({ type: "fine", k: fine });
    }
  };

  /** @type {Set<string>} */
  const keys = new Set();
  // Keys pressed since the last tick: a tap shorter than a frame (keydown and
  // keyup between two ticks) still counts as held for one frame.
  /** @type {Set<string>} */
  const tapped = new Set();
  let star = false;
  /** @type {Synth | null} */
  let synth = null;
  const audio = () => {
    if (!synth) {
      try {
        synth = new Synth();
      } catch {
        return null;
      }
    }
    synth.resume();
    return synth;
  };

  let aiStopped = false;
  let stopped = false;
  // Voice asks (D489): which one is being held to talk, and since when. One at a time: there's one microphone.
  /** @type {any[]} */
  let voices = [];
  /** @type {{ v: any, at: number } | null} */
  let talking = null;
  /** Player 1's buttons this tick: the mic is on only while a voice ask's button is held. @param {number} mask */
  const voiceTick = (mask) => {
    if (!voices.length || !opts.voice) return;
    if (talking && !(mask & BIT[/** @type {Arcade.Button} */ (talking.v.hold)])) {
      const { v, at } = talking;
      talking = null;
      // A tap isn't talking: it's thrown away, and nothing is asked.
      if (performance.now() - at < VOICE_MIN_MS) return void opts.voice.cancel();
      Promise.resolve()
        .then(() => opts.voice?.stop(v))
        .then(
          (r) => !stopped && (r?.action || r?.reply || r?.fallback) && send({ type: "heard", name: v.name, action: r.action ?? undefined, reply: r.reply ?? undefined, fallback: r.fallback === true }),
          () => {},
        );
    } else if (!talking) {
      const v = voices.find((x) => mask & BIT[/** @type {Arcade.Button} */ (x.hold)]);
      if (v) {
        talking = { v, at: performance.now() };
        opts.voice.start(v);
      }
    }
  };
  let bootFine = 1;
  let nextId = 1;
  /** @type {Map<number, { resolve: (v: any) => void, reject: (e: Error) => void }>} */
  const pending = new Map();
  const send = (msg) => iframe.contentWindow?.postMessage(msg, "*");

  /** @type {(v?: any) => void} */
  let markReady = () => {};
  /** @type {(e: Error) => void} */
  let markFailed = () => {};
  const ready = new Promise((res, rej) => {
    markReady = res;
    markFailed = rej;
  });
  ready.catch(() => {});

  const call = (method, args) =>
    ready.then(
      () =>
        new Promise((resolve, reject) => {
          const id = nextId++;
          pending.set(id, { resolve, reject });
          send({ type: "call", id, method, args });
        }),
    );

  /** @type {Arcade.TestHandle} */
  const testHandle = {
    step: (n) => call("step", [n]),
    input: (script) => call("input", [script]),
    probe: () => call("probe", []),
    poke: (o) => call("poke", [o]),
    frame: () => call("frame", []),
    sounds: () => call("sounds", []),
    scores: () => call("scores", []),
    warnings: () => call("warnings", []),
    reset: (o) => call("reset", [o]),
  };

  const arcade = {
    /** "loading" | "ready" | "error" */
    state: "loading",
    ready,
    /** @type {CartErrorInfo[]} */
    errors: [],
    /** Dev warnings from live play (e.g. out-of-range colors), each kind once. */
    /** @type {{ frame: number, message: string }[]} */
    warnings: [],
    test: testHandle,
    /**
     * What the cart's screen is doing (D517): `glides` (the cart called g.glide()), `fine` (display pixels per
     * game pixel it's drawn at, 1 for no glide) and `path`: "gpu", "2d" or null while nothing glides.
     * @returns {Promise<{ glides: boolean, fine: number, path: "gpu" | "2d" | null }>}
     */
    screen: () => call("screen", []),
    iframe,
    /** Controllers this console has (g.players in the cart). */
    players,
    scale: 1,
    /** Display pixels per game pixel a gliding cart is drawn at (D476); 1 is no glide. */
    fine: 1,
    /** Frames the cart drew in the last second (live mode). */
    fps: 0,
    /** requestAnimationFrame callbacks in the last second (the display's refresh rate). */
    displayHz: 0,
    /** Live ticks run so far. */
    ticks: 0,
    /** Round scores the cart reported with g.score(), in order (D215). @type {number[]} */
    scores: [],
    paused: test,
    pause() {
      arcade.paused = true;
    },
    resume() {
      if (test) return;
      arcade.paused = false;
      last = performance.now();
      acc = 0;
    },
    destroy() {
      stopped = true;
      if (talking) opts.voice?.cancel(); // the game ended mid-hold: the mic goes off
      talking = null;
      removeEventListener("keydown", onKey);
      removeEventListener("keyup", onKey);
      removeEventListener("message", onMessage);
      removeEventListener("resize", fit);
      removeEventListener("blur", onBlur);
      removeEventListener("pointerdown", onPointer, { capture: true });
      synth?.stop(undefined);
      iframe.remove();
    },
  };

  /** @param {MessageEvent} e */
  const onMessage = (e) => {
    if (e.source !== iframe.contentWindow) return;
    const msg = e.data;
    if (!msg || typeof msg !== "object") return;
    switch (msg.type) {
      case "ready":
        // D489: the cart's voice asks. Only a live host with a microphone behind it listens.
        voices = !test && opts.voice && Array.isArray(msg.voices) ? msg.voices.filter((/** @type {any} */ v) => typeof v?.name === "string" && ["a", "b", "x", "y"].includes(v.hold)).slice(0, 4) : [];
        arcade.state = "ready";
        if (arcade.fine !== bootFine) send({ type: "fine", k: arcade.fine }); // the scale changed while it loaded
        markReady();
        break;
      case "out":
        if (!test) {
          for (const a of msg.audio ?? []) {
            const s = audio();
            if (!s) break;
            if (a.type === "play") s.play(a.cmd);
            else s.stop(a.voice);
          }
        }
        for (const w of msg.warnings ?? []) arcade.warnings.push(w);
        // D215: round scores, for the player's post-game screen. Only whole numbers in range get this far.
        for (const n of msg.scores ?? []) if (Number.isInteger(n) && n >= 0) arcade.scores.push(n);
        // D480: g.ai asks go to whoever can answer; a test host never asks anyone (D486).
        if (!test && opts.ai && !aiStopped) {
          for (const ask of Array.isArray(msg.ai) ? msg.ai.slice(0, 8) : []) {
            const id = ask?.id;
            Promise.resolve()
              .then(() => opts.ai?.(ask))
              .then(
                (r) => {
                  if (r?.stop) aiStopped = true;
                  if (!stopped) send({ type: "ai", reply: { id, ok: !!r?.ok, lines: r?.lines, pick: r?.pick } });
                },
                () => !stopped && send({ type: "ai", reply: { id, ok: false } }),
              );
          }
        }
        if (msg.save !== undefined && persist) {
          try {
            localStorage.setItem(saveKey, msg.save);
          } catch {}
        }
        break;
      case "error":
        arcade.errors.push(msg.error);
        opts.onError?.(msg.error);
        if (msg.fatal && arcade.state === "loading") {
          arcade.state = "error";
          markFailed(Object.assign(new Error(msg.error.message), { stack: msg.error.stack }));
        }
        break;
      case "result": {
        const p = pending.get(msg.id);
        if (!p) break;
        pending.delete(msg.id);
        if (msg.error) p.reject(Object.assign(new Error(msg.error.message), { stack: msg.error.stack }));
        else p.resolve(msg.value);
        break;
      }
      case "key":
        if (test) break;
        if (msg.code === "*") keys.clear();
        else if (msg.down) {
          keys.add(msg.code);
          tapped.add(msg.code);
        } else keys.delete(msg.code);
        audio();
        break;
    }
  };
  addEventListener("message", onMessage);

  /** @param {KeyboardEvent} e */
  const onKey = (e) => {
    if (test) return;
    if (e.code in keymap || e.code === "F1" || e.code === "F13") e.preventDefault(); // F1 is Chromium's Help (D433)
    if (e.type === "keydown") {
      if (e.repeat) return;
      keys.add(e.code);
      tapped.add(e.code);
    } else keys.delete(e.code);
    audio();
  };
  addEventListener("keydown", onKey);
  addEventListener("keyup", onKey);
  const onBlur = () => keys.clear();
  const onPointer = () => {
    if (!test) audio();
  };
  addEventListener("blur", onBlur);
  addEventListener("pointerdown", onPointer, { capture: true });
  addEventListener("resize", fit);

  iframe.addEventListener("load", () => {
    bootFine = arcade.fine;
    send({ type: "boot", cartUrl: new URL(opts.cartUrl, location.href).href, seed: opts.seed ?? 1, save: initialSave, players, fine: arcade.fine, gpu: opts.gpu === "any" ? "any" : opts.gpu !== false });
  });

  // Live loop: fixed 60 Hz ticks from requestAnimationFrame (D10).
  stopped = false;
  let last = performance.now();
  let acc = 0;
  let drawn = 0;
  let rafs = 0;
  let fpsAt = last;
  const loop = (now) => {
    if (stopped) return;
    requestAnimationFrame(loop);
    const dt = Math.min(250, now - last);
    last = now;
    if (arcade.paused || arcade.state !== "ready") return;
    acc += dt;
    // rAF intervals jitter around 16.7 ms on a 60 Hz display. Without slack,
    // a 16.5 ms frame gets no tick and the next gets two (a visible stutter),
    // so round up within SLACK_MS; acc may go slightly negative and catches up.
    let n = Math.floor((acc + SLACK_MS) / STEP_MS);
    if (n > 0) {
      acc -= n * STEP_MS;
      if (n > MAX_TICKS) {
        n = MAX_TICKS;
        acc = 0;
      }
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const input = readInput(tapped.size ? new Set([...keys, ...tapped]) : keys, pads, keymap, players);
      tapped.clear();
      if (input.star && !star) opts.onStar?.();
      star = input.star;
      voiceTick(input.masks[0] ?? 0);
      send({ type: "tick", n, masks: input.masks });
      arcade.ticks += n;
      drawn++;
    }
    rafs++;
    if (now - fpsAt >= 1000) {
      arcade.fps = Math.round((drawn * 1000) / (now - fpsAt));
      arcade.displayHz = Math.round((rafs * 1000) / (now - fpsAt));
      drawn = 0;
      rafs = 0;
      fpsAt = now;
    }
  };
  if (!test) requestAnimationFrame(loop);

  fit();
  return arcade;
}
