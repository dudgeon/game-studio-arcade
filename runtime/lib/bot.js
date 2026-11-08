// @ts-check
// The check bot (D162): what every checks.js used to write for itself and get
// wrong. Checks reach it as `t.bot`; carts never use it, so it isn't in g.lib.
// Time only moves through t.step, so everything here is deterministic.

/** @typedef {{ x: number, y: number, w?: number, h?: number }} Point */
/** @typedef {{ until?: (p: any) => boolean, max?: number, every?: number, anyMode?: boolean }} PlayOptions */
/** @typedef {{ p: any, frames: number, reached: boolean }} PlayResult */

const DEFAULT_MAX = 3000; // steered frames per call: well inside the browser's 30 s
const DEFAULT_EVERY = 3; // frames between looks at the game

const centerOf = (/** @type {Point} */ a, /** @type {"x"|"y"} */ axis) => a[axis] + (axis === "x" ? a.w ?? 0 : a.h ?? 0) / 2;

/**
 * Buttons that move `from` toward `to`, as a held string for t.input: "left", "up right", or "".
 * Sides count from each thing's center when it has w or h. `axis` limits it to "x" or "y"; `dead` is how close is close enough.
 * @param {Point} from @param {Point} to @param {{ axis?: "x"|"y", dead?: number }} [o]
 */
export function toward(from, to, o = {}) {
  const dead = o.dead ?? 2;
  const held = [];
  if (o.axis !== "x") {
    const dy = centerOf(to, "y") - centerOf(from, "y");
    if (Math.abs(dy) > dead) held.push(dy < 0 ? "up" : "down");
  }
  if (o.axis !== "y") {
    const dx = centerOf(to, "x") - centerOf(from, "x");
    if (Math.abs(dx) > dead) held.push(dx < 0 ? "left" : "right");
  }
  return held.join(" ");
}

/**
 * Buttons that move `from` away from `threat`. When level with it, goes right or down.
 * @param {Point} from @param {Point} threat @param {{ axis?: "x"|"y" }} [o]
 */
export function away(from, threat, o = {}) {
  const held = [];
  if (o.axis !== "x") held.push(centerOf(threat, "y") < centerOf(from, "y") || (o.axis === "y" && centerOf(threat, "y") === centerOf(from, "y")) ? "down" : "up");
  if (o.axis !== "y") held.push(centerOf(threat, "x") <= centerOf(from, "x") ? "right" : "left");
  return held.join(" ");
}

/**
 * The thing closest to `from`, or null for an empty list.
 * @template {Point} T
 * @param {Point} from @param {readonly T[]} list
 * @returns {T | null}
 */
export function nearest(from, list) {
  let best = null;
  let bestD = Infinity;
  for (const it of list) {
    const d = Math.hypot(centerOf(it, "x") - centerOf(from, "x"), centerOf(it, "y") - centerOf(from, "y"));
    if (d < bestD) {
      bestD = d;
      best = it;
    }
  }
  return best;
}

/**
 * The button for the first step of the shortest walk from tile `from` to tile `to`, or "" if there's
 * no way through or it's already there. `open(x, y)` says whether a tile can be walked on.
 * @param {(x: number, y: number) => boolean} open @param {{ x: number, y: number }} from @param {{ x: number, y: number } | null} to
 */
export function pathStep(open, from, to) {
  if (!to || (from.x === to.x && from.y === to.y)) return "";
  const dirs = /** @type {const} */ ([["left", -1, 0], ["right", 1, 0], ["up", 0, -1], ["down", 0, 1]]);
  const key = (/** @type {number} */ x, /** @type {number} */ y) => `${x},${y}`;
  const seen = new Set([key(from.x, from.y)]);
  /** @type {{ x: number, y: number, first: string }[]} */
  const queue = [];
  for (const [name, dx, dy] of dirs) {
    if (open(from.x + dx, from.y + dy)) {
      seen.add(key(from.x + dx, from.y + dy));
      queue.push({ x: from.x + dx, y: from.y + dy, first: name });
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i];
    if (at.x === to.x && at.y === to.y) return at.first;
    for (const [, dx, dy] of dirs) {
      const k = key(at.x + dx, at.y + dy);
      if (!seen.has(k) && open(at.x + dx, at.y + dy)) {
        seen.add(k);
        queue.push({ x: at.x + dx, y: at.y + dy, first: at.first });
      }
    }
  }
  return "";
}

/** Fail the check with `why` unless `cond`. @param {unknown} cond @param {string} why */
export function ok(cond, why) {
  if (!cond) throw new Error(why);
}

/** Fail unless `got` equals `want`. `what` names it in the message. @param {unknown} got @param {unknown} want @param {string} what */
export function eq(got, want, what) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) throw new Error(`${what}: expected ${b}, got ${a}`);
}

/** Fail unless `got` is within `eps` of `want`. @param {number} got @param {number} want @param {string} what @param {number} [eps] */
export function near(got, want, what, eps = 1e-6) {
  if (!(Math.abs(got - want) <= eps)) throw new Error(`${what}: expected ${want}, got ${got}`);
}

/** A probe, short enough for a failure message. @param {unknown} p */
function brief(p) {
  const s = JSON.stringify(p) ?? "null";
  return s.length > 240 ? `${s.slice(0, 240)}…` : s;
}

/**
 * The bot for one test handle.
 * @param {Pick<Arcade.TestHandle, "step" | "input" | "probe">} t
 */
export function makeBot(t) {
  /** Hold buttons for `frames` frames, then return the probe. @param {Arcade.Held} held @param {number} frames */
  const hold = async (held, frames) => {
    await t.input([{ frames, p1: held }]);
    await t.step(frames);
    return t.probe();
  };

  /** Run `frames` frames with nothing held; returns the probe. @param {number} frames */
  const wait = async (frames) => {
    await t.step(frames);
    return t.probe();
  };

  /**
   * Press a button for one frame, then run `then` more frames (default 1) so the game has seen it. Returns the probe.
   * @param {Arcade.Button} button @param {number} [then]
   */
  const press = async (button, then = 1) => {
    await t.input([{ frames: 1, p1: button }]);
    await t.step(1 + then);
    return t.probe();
  };

  /**
   * From the title into play: waits out the 30 frames flow.startPressed ignores, presses START, and checks `mode`.
   * @param {{ button?: Arcade.Button, mode?: string }} [o]
   */
  const start = async (o = {}) => {
    await t.step(31);
    const p = await press(o.button ?? "start");
    const want = o.mode ?? "play";
    if (p?.mode !== want) throw new Error(`pressing ${o.button ?? "START"} on the title should reach mode "${want}", but mode is ${JSON.stringify(p?.mode)}`);
    return p;
  };

  /**
   * Steer the game: every `every` frames (default 3) look at the probe and hold what `steer(p)` returns.
   * Stops when `until(p)` is true, at `max` frames (default 3000), or when `p.mode` stops being what it was
   * at the start (so a bot doesn't play on through game over); `anyMode: true` turns that last one off.
   * Returns `{ p, frames, reached }`; `reached` says whether `until` came true.
   * @param {(p: any) => Arcade.Held} steer @param {PlayOptions} [o]
   * @returns {Promise<PlayResult>}
   */
  const play = async (steer, o = {}) => {
    const max = o.max ?? DEFAULT_MAX;
    const every = o.every ?? DEFAULT_EVERY;
    let p = await t.probe();
    const mode = p?.mode;
    let frames = 0;
    for (;;) {
      if (o.until?.(p)) return { p, frames, reached: true };
      if (frames >= max || (!o.anyMode && p?.mode !== mode)) return { p, frames, reached: false };
      const n = Math.min(every, max - frames);
      await t.input([{ frames: n, p1: steer(p) }]);
      await t.step(n);
      frames += n;
      p = await t.probe();
    }
  };

  /**
   * `play` until `until(p)`, and fail with a message that says it was the bot, not the game rule,
   * if it never comes true. `what` finishes "the bot couldn't get to …". Returns the probe.
   * @param {(p: any) => Arcade.Held} steer @param {(p: any) => boolean} until @param {string} what
   * @param {Omit<PlayOptions, "until">} [o]
   */
  const reach = async (steer, until, what, o = {}) => {
    const r = await play(steer, { ...o, until });
    if (!r.reached) throw new Error(`the bot couldn't get to ${what} in ${r.frames} frames; the game ended up at ${brief(r.p)}`);
    return r.p;
  };

  /**
   * How much `get(probe)` changes over `frames` frames (default 1), holding `held`.
   * @param {(p: any) => number} get @param {{ frames?: number, held?: Arcade.Held }} [o]
   */
  const delta = async (get, o = {}) => {
    const before = get(await t.probe());
    const frames = o.frames ?? 1;
    await t.input([{ frames, p1: o.held ?? "" }]);
    await t.step(frames);
    return get(await t.probe()) - before;
  };

  return { start, hold, press, wait, play, reach, delta, toward, away, nearest, pathStep, ok, eq, near };
}

/** @typedef {ReturnType<typeof makeBot>} Bot */

/**
 * Add `bot` to a test handle.
 * @template {Pick<Arcade.TestHandle, "step" | "input" | "probe">} T
 * @param {T} t
 * @returns {T & { bot: Bot }}
 */
export function withBot(t) {
  return Object.assign(t, { bot: makeBot(t) });
}
