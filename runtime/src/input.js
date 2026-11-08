// Input mapping (D21): keyboard and the Gamepad API to the cabinet's buttons.
// A player's input is a bitmask over BUTTONS; the whole input for a frame is
// [p1mask, p2mask]. ★ (MAKE) is reserved for the cabinet: it is reported to
// the host separately and never reaches a cart.

/** @type {readonly Arcade.Button[]} */
export const BUTTONS = Object.freeze(["up", "down", "left", "right", "a", "b", "x", "y", "start"]);

/** @type {Readonly<Record<Arcade.Button, number>>} */
export const BIT = /** @type {any} */ (Object.freeze(Object.fromEntries(BUTTONS.map((b, i) => [b, 1 << i]))));

export const STAR = "star";

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
 * Map the set of held key codes to per-player masks.
 * @param {Iterable<string>} codes held KeyboardEvent.code values
 * @returns {{ masks: [number, number], star: boolean }}
 */
export function keyboardToMasks(codes, keymap = DEFAULT_KEYMAP) {
  /** @type {[number, number]} */
  const masks = [0, 0];
  let star = false;
  for (const code of codes) {
    const m = keymap[code];
    if (!m) continue;
    const [p, b] = m;
    if (b === STAR) star = true;
    else masks[p - 1] |= BIT[b];
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
 * Combine keyboard and gamepads (pad 0 is P1, pad 1 is P2). Inputs are OR-ed.
 * @param {Iterable<string>} codes
 * @param {ArrayLike<any>} pads e.g. navigator.getGamepads()
 * @returns {{ masks: [number, number], star: boolean }}
 */
export function readInput(codes, pads = [], keymap = DEFAULT_KEYMAP) {
  const k = keyboardToMasks(codes, keymap);
  const p1 = gamepadToMask(pads[0]);
  const p2 = gamepadToMask(pads[1]);
  return { masks: [k.masks[0] | p1.mask, k.masks[1] | p2.mask], star: k.star || p1.star || p2.star };
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
 * Expand an input script to one [p1, p2] mask pair per frame.
 * @param {Arcade.InputScript} script
 * @returns {[number, number][]}
 */
export function expandScript(script) {
  if (!Array.isArray(script)) throw new Error("t.input() takes an array of { frames, p1, p2 } steps");
  /** @type {[number, number][]} */
  const out = [];
  script.forEach((step, i) => {
    const frames = Math.floor(step?.frames);
    if (!(frames >= 1)) throw new Error(`input step ${i} needs frames >= 1, got ${step?.frames}`);
    if (frames > 1_000_000) throw new Error(`input step ${i} is too long (${frames} frames)`);
    const pair = /** @type {[number, number]} */ ([heldToMask(step.p1), heldToMask(step.p2)]);
    for (let f = 0; f < frames; f++) out.push(pair);
  });
  return out;
}
