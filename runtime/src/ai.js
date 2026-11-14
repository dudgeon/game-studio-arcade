// g.ai (D480): a cart asks for lines and choices, and always gets an answer in the
// same frame. Fresh answers come from the host, when there is one that can ask
// (the cabinet's launcher, through the cabinet service). With nobody to ask, in a
// headless run, on a test host, offline, the cart's own fallback lines and a seeded
// random are used, so playtests repeat and spend nothing (D486).
//
// No DOM, no network, no timers: asks go into an outbox the host drains, and
// answers come back through deliver().
import { createRng } from "./rng.js";

export const AI_MAX_ASKS = 8;
export const AI_LINE_MAX = 120;
export const AI_ASK_MAX = 300;
export const AI_MIN_FALLBACK = 3;
/** Ask for more lines when this few fresh ones are left. */
const LOW_WATER = 3;
/** After a call that failed, wait this many frames before asking again (10 s). */
const RETRY_FRAMES = 600;
const NAME = /^[a-z][a-z0-9_]{0,23}$/;
const PLAIN = /^[\x20-\x7e]+$/;

/** A line a cart can draw: plain ASCII, not empty, at most `max` characters. @param {unknown} s @param {number} max */
export const plainLine = (s, max = AI_LINE_MAX) => typeof s === "string" && s.trim().length > 0 && s.length <= max && PLAIN.test(s);

/**
 * @typedef {{ id: number, kind: "lines" | "choice", name: string, ask: string, max?: number, options?: string[], facts?: Record<string, number | boolean | string> }} AiAsk
 * @typedef {{ id: number, ok: boolean, lines?: unknown, pick?: unknown }} AiReply
 */

/**
 * @param {{ seed: number, frame: () => number, inInit: () => boolean }} o
 */
export function createAi(o) {
  // Its own stream, so using g.ai never changes what g.rand gives the game.
  const rand = createRng((Math.floor(Number(o.seed)) || 0) ^ 0x5a17);
  /** @type {Map<string, any>} */
  const asks = new Map();
  /** @type {AiAsk[]} */
  let outbox = [];
  let nextId = 1;

  const declare = (/** @type {string} */ fn, /** @type {unknown} */ name) => {
    if (!o.inInit()) throw new Error(`g.ai.${fn}() belongs in init: declare each ask once, there`);
    if (typeof name !== "string" || !NAME.test(name)) throw new Error(`g.ai.${fn}() needs a short name like "joke" (small letters, digits, _), got ${JSON.stringify(name)}`);
    if (asks.has(name)) throw new Error(`g.ai.${fn}("${name}") is declared twice`);
    if (asks.size >= AI_MAX_ASKS) throw new Error(`a game can declare at most ${AI_MAX_ASKS} g.ai asks`);
  };
  const askText = (/** @type {string} */ fn, /** @type {string} */ name, /** @type {unknown} */ ask) => {
    if (typeof ask !== "string" || !ask.trim() || ask.length > AI_ASK_MAX || !PLAIN.test(ask)) throw new Error(`g.ai.${fn}("${name}") needs ask: a plain sentence of at most ${AI_ASK_MAX} characters`);
    return ask.trim();
  };
  const get = (/** @type {string} */ fn, /** @type {unknown} */ name, /** @type {string} */ kind) => {
    const a = asks.get(/** @type {string} */ (name));
    if (!a || a.kind !== kind) throw new Error(`g.ai.${fn}("${String(name)}") isn't declared: call g.ai.${kind === "lines" ? "lines" : "choice"}("${String(name)}", ...) in init first`);
    return a;
  };
  /** One call in the air per ask, and a pause after one that failed. @param {any} a @param {Partial<AiAsk>} [extra] */
  const send = (a, extra = {}) => {
    if (a.waiting || o.frame() < a.retryAt) return;
    a.waiting = nextId++;
    outbox.push({ id: a.waiting, kind: a.kind, name: a.name, ask: a.ask, ...(a.kind === "lines" ? { max: a.max } : { options: [...a.options] }), ...extra });
  };

  /** @type {Arcade.Ai} */
  const api = {
    lines(name, opts) {
      declare("lines", name);
      const ask = askText("lines", name, opts?.ask);
      const max = opts?.max ?? 80;
      if (!Number.isInteger(max) || max < 20 || max > AI_LINE_MAX) throw new Error(`g.ai.lines("${name}") max is the longest line the game can show: 20 to ${AI_LINE_MAX}`);
      const fallback = opts?.fallback;
      if (!Array.isArray(fallback) || fallback.length < AI_MIN_FALLBACK) throw new Error(`g.ai.lines("${name}") needs fallback: at least ${AI_MIN_FALLBACK} lines of its own, for when there's no answer`);
      for (const f of fallback) if (!plainLine(f, max)) throw new Error(`g.ai.lines("${name}") fallback lines are plain text of at most ${max} characters: ${JSON.stringify(f)}`);
      const a = { kind: "lines", name, ask, max, fallback: [...fallback], bag: /** @type {string[]} */ ([]), last: "", fresh: /** @type {string[]} */ ([]), waiting: 0, retryAt: 0 };
      asks.set(name, a);
      send(a);
    },
    next(name) {
      const a = get("next", name, "lines");
      if (a.fresh.length <= LOW_WATER) send(a);
      if (a.fresh.length) return (a.last = /** @type {string} */ (a.fresh.shift()));
      // Fallbacks go round in a shuffled bag: every one is used before any repeats.
      if (!a.bag.length) {
        a.bag = [...a.fallback];
        for (let i = a.bag.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          [a.bag[i], a.bag[j]] = [a.bag[j], a.bag[i]];
        }
        if (a.bag.length > 1 && a.bag[a.bag.length - 1] === a.last) a.bag.unshift(/** @type {string} */ (a.bag.pop()));
      }
      return (a.last = /** @type {string} */ (a.bag.pop()));
    },
    choice(name, opts) {
      declare("choice", name);
      const ask = askText("choice", name, opts?.ask);
      const options = opts?.options;
      if (!Array.isArray(options) || options.length < 2 || options.length > 8 || new Set(options).size !== options.length) throw new Error(`g.ai.choice("${name}") needs options: 2 to 8 different words`);
      for (const w of options) if (!plainLine(w, 24)) throw new Error(`g.ai.choice("${name}") options are plain words of at most 24 characters: ${JSON.stringify(w)}`);
      const a = { kind: "choice", name, ask, options: [...options], answer: /** @type {string | null} */ (null), waiting: 0, retryAt: 0 };
      asks.set(name, a);
      send(a);
    },
    pick(name, facts) {
      const a = get("pick", name, "choice");
      /** @type {Record<string, number | boolean | string>} */
      const clean = {};
      if (facts !== undefined) {
        if (!facts || typeof facts !== "object" || Array.isArray(facts)) throw new Error(`g.ai.pick("${name}") facts are an object of numbers, like { round: 3, score: 120 }`);
        const keys = Object.keys(facts);
        if (keys.length > 8) throw new Error(`g.ai.pick("${name}") takes at most 8 facts`);
        for (const k of keys) {
          const v = /** @type {any} */ (facts)[k];
          const fine = (typeof v === "number" && Number.isFinite(v)) || typeof v === "boolean" || (typeof v === "string" && a.options.includes(v));
          if (!NAME.test(k) || !fine) throw new Error(`g.ai.pick("${name}") fact ${JSON.stringify(k)} must be a number, true/false or one of this choice's options`);
          clean[k] = v;
        }
      }
      const out = a.answer ?? a.options[Math.floor(rand() * a.options.length)];
      a.answer = null;
      send(a, { facts: clean });
      return out;
    },
  };
  Object.freeze(api);

  return {
    api,
    /** Asks since the last call, for a host that can answer them. */
    drain() {
      const out = outbox;
      outbox = [];
      return out;
    },
    /** A host's answer. Anything that isn't what was asked for is dropped. @param {AiReply} r */
    deliver(r) {
      if (!r || typeof r !== "object") return;
      const a = [...asks.values()].find((x) => x.waiting && x.waiting === r.id);
      if (!a) return;
      a.waiting = 0;
      if (a.kind === "lines") {
        const lines = r.ok && Array.isArray(r.lines) ? r.lines.filter((l) => plainLine(l, a.max)).slice(0, 50) : [];
        if (lines.length) a.fresh.push(...lines);
        else a.retryAt = o.frame() + RETRY_FRAMES;
      } else if (r.ok && typeof r.pick === "string" && a.options.includes(r.pick)) a.answer = r.pick;
      else a.retryAt = o.frame() + RETRY_FRAMES;
    },
  };
}
