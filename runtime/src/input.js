// Input mapping (D21, D110, D111): keyboard and the Gamepad API to the
// cabinet's buttons. A player's input is a bitmask over BUTTONS; the whole
// input for a frame is one mask per controller, an array of length `players`
// (the console's controller count, 1..MAX_PLAYERS, default 1). ★ (MAKE) is
// reserved for the cabinet: it is reported to the host separately and never
// reaches a cart.

/** @type {readonly Arcade.Button[]} */
export const BUTTONS = Object.freeze(["up", "down", "left", "right", "a", "b", "x", "y", "start"]);

/** @type {Readonly<Record<Arcade.Button, number>>} */
export const BIT = /** @type {any} */ (Object.freeze(Object.fromEntries(BUTTONS.map((b, i) => [b, 1 << i]))));

export const STAR = "star";

/** Most controllers a console can have (D110). `Arcade.Player` is 1..MAX_PLAYERS. */
export const MAX_PLAYERS = 8;

/** Controllers when nothing says otherwise: the cabinet has one player's controls (D80, D110). */
export const DEFAULT_PLAYERS = 1;

/**
 * Check a `players` setting: an integer 1..MAX_PLAYERS, or undefined for the
 * default. Throws a readable error otherwise (D110: no silent fallback).
 * @param {unknown} players
 * @returns {number}
 */
export function checkPlayers(players) {
  if (players === undefined || players === null) return DEFAULT_PLAYERS;
  if (typeof players !== "number" || !Number.isInteger(players) || players < 1 || players > MAX_PLAYERS) {
    throw new Error(`players (the number of controllers) must be a whole number from 1 to ${MAX_PLAYERS}, got ${JSON.stringify(players)}`);
  }
  return players;
}

/**
 * Default dev keyboard map, by KeyboardEvent.code: [player, button | "star"].
 * @type {Readonly<Record<string, readonly [Arcade.Player, Arcade.Button | "star"]>>}
 */
export const DEFAULT_KEYMAP = Object.freeze({
  ArrowUp: [1, "up"],
  ArrowDown: [1, "down"],
  ArrowLeft: [1, "left"],
  ArrowRight: [1, "right"],
  KeyZ: [1, "a"],
  KeyX: [1, "b"],
  KeyC: [1, "x"],
  KeyV: [1, "y"],
  Enter: [1, "start"],
  KeyW: [2, "up"],
  KeyS: [2, "down"],
  KeyA: [2, "left"],
  KeyD: [2, "right"],
  Digit1: [2, "a"],
  Digit2: [2, "b"],
  Digit3: [2, "x"],
  Digit4: [2, "y"],
  Digit5: [2, "start"],
  Escape: [1, "star"],
});

/**
 * Map the set of held key codes to per-player masks, one per controller.
 * Keys for a player beyond `players` are ignored.
 * @param {Iterable<string>} codes held KeyboardEvent.code values
 * @param {number} [players] controllers (default 2, the dev keyboard's two sides)
 * @returns {{ masks: number[], star: boolean }}
 */
export function keyboardToMasks(codes, keymap = DEFAULT_KEYMAP, players = 2) {
  const masks = new Array(players).fill(0);
  let star = false;
  for (const code of codes) {
    const m = keymap[code];
    if (!m) continue;
    const [p, b] = m;
    if (b === STAR) star = true;
    else if (p >= 1 && p <= players) masks[p - 1] |= BIT[b];
  }
  return { masks, star };
}

export const STICK_DEADZONE = 0.5;

/** Standard-mapping gamepad button indices. */
export const PAD = Object.freeze({ a: 0, b: 1, x: 2, y: 3, start: 9, up: 12, down: 13, left: 14, right: 15, guide: 16 });

/**
 * Map one standard-mapping gamepad to a button mask.
 * Accepts anything shaped like a Gamepad: { buttons: [{pressed}], axes: [x, y] }.
 * @param {{ buttons: ArrayLike<{ pressed: boolean } | undefined>, axes: ArrayLike<number> } | null | undefined} pad
 * @returns {{ mask: number, star: boolean }}
 */
export function gamepadToMask(pad) {
  if (!pad) return { mask: 0, star: false };
  const pressed = (i) => !!pad.buttons[i]?.pressed;
  let mask = 0;
  for (const b of /** @type {const} */ (["a", "b", "x", "y", "start", "up", "down", "left", "right"])) {
    if (pressed(PAD[b])) mask |= BIT[b];
  }
  const ax = pad.axes[0] ?? 0;
  const ay = pad.axes[1] ?? 0;
  if (ax <= -STICK_DEADZONE) mask |= BIT.left;
  if (ax >= STICK_DEADZONE) mask |= BIT.right;
  if (ay <= -STICK_DEADZONE) mask |= BIT.up;
  if (ay >= STICK_DEADZONE) mask |= BIT.down;
  return { mask, star: pressed(PAD.guide) };
}

/**
 * Combine keyboard and gamepads into one mask per controller (D111). Pad k is
 * player k+1 for pads below `players`, OR-ed with that player's keys; pads
 * beyond `players` are ignored except that guide is ★ on any pad.
 * @param {Iterable<string>} codes
 * @param {ArrayLike<any>} pads e.g. navigator.getGamepads()
 * @param {number} [players] controllers, 1..MAX_PLAYERS (default 1)
 * @returns {{ masks: number[], star: boolean }}
 */
export function readInput(codes, pads = [], keymap = DEFAULT_KEYMAP, players = DEFAULT_PLAYERS) {
  const n = checkPlayers(players);
  const k = keyboardToMasks(codes, keymap, n);
  let star = k.star;
  for (let i = 0; i < (pads?.length ?? 0); i++) {
    const pad = gamepadToMask(pads[i]);
    if (pad.star) star = true;
    if (i < n) k.masks[i] |= pad.mask;
  }
  return { masks: k.masks, star };
}

/**
 * Parse a test-script Held value ("right a", ["right", "a"], "" or undefined) to a mask.
 * @param {Arcade.Held | undefined} held
 */
export function heldToMask(held) {
  if (held === undefined || held === null) return 0;
  const names = typeof held === "string" ? held.split(/[\s,+]+/).filter(Boolean) : held;
  let mask = 0;
  for (const name of names) {
    const bit = BIT[/** @type {Arcade.Button} */ (String(name).toLowerCase())];
    if (!bit) throw new Error(`unknown button "${name}" in input script (use ${BUTTONS.join(", ")})`);
    mask |= bit;
  }
  return mask;
}

/**
 * Expand an input script to one mask array (one mask per controller) per
 * frame. Steps hold buttons with p1..p8; a player beyond `players` has no
 * controller, so what it holds is ignored, as in live play (D111). A key past
 * p8 is an error.
 * @param {Arcade.InputScript} script
 * @param {number} [players] controllers, 1..MAX_PLAYERS (default 2, for older callers)
 * @returns {number[][]}
 */
export function expandScript(script, players = 2) {
  const n = checkPlayers(players);
  if (!Array.isArray(script)) throw new Error("t.input() takes an array of { frames, p1, p2 } steps");
  /** @type {number[][]} */
  const out = [];
  script.forEach((step, i) => {
    const frames = Math.floor(step?.frames);
    if (!(frames >= 1)) throw new Error(`input step ${i} needs frames >= 1, got ${step?.frames}`);
    if (frames > 1_000_000) throw new Error(`input step ${i} is too long (${frames} frames)`);
    for (const key of Object.keys(step)) {
      const m = /^p(\d+)$/.exec(key);
      if (m && !(Number(m[1]) >= 1 && Number(m[1]) <= MAX_PLAYERS)) {
        throw new Error(`input step ${i} has ${key}; players are p1 to p${MAX_PLAYERS}`);
      }
    }
    const held = /** @type {Record<string, Arcade.Held | undefined>} */ (/** @type {unknown} */ (step));
    const masks = [];
    for (let p = 1; p <= MAX_PLAYERS; p++) {
      const mask = heldToMask(held[`p${p}`]); // a bad button name is an error even for a missing player
      if (p <= n) masks.push(mask);
    }
    for (let f = 0; f < frames; f++) out.push(masks);
  });
  return out;
}
