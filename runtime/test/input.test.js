import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BIT,
  BUTTONS,
  DEFAULT_KEYMAP,
  MAX_PLAYERS,
  checkPlayers,
  expandScript,
  gamepadToMask,
  heldToMask,
  keyboardToMasks,
  readInput,
} from "../src/input.js";

const pad = (pressed = [], axes = [0, 0]) => ({
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })),
  axes,
});

test("buttons are the cabinet's nine, each with its own bit", () => {
  assert.deepEqual(BUTTONS, ["up", "down", "left", "right", "a", "b", "x", "y", "start"]);
  const bits = BUTTONS.map((b) => BIT[b]);
  assert.equal(new Set(bits).size, 9);
  for (const b of bits) assert.equal(b & (b - 1), 0, "single bit");
});

test("keyboard: P1 arrows + Z X C V + Enter", () => {
  const { masks, star } = keyboardToMasks(["ArrowLeft", "KeyZ", "KeyX", "KeyC", "KeyV", "Enter"]);
  assert.equal(masks[0], BIT.left | BIT.a | BIT.b | BIT.x | BIT.y | BIT.start);
  assert.equal(masks[1], 0);
  assert.equal(star, false);
});

test("keyboard: P2 WASD + 1-5, separate from P1", () => {
  const { masks } = keyboardToMasks(["KeyW", "KeyA", "Digit1", "Digit5", "ArrowRight"]);
  assert.equal(masks[1], BIT.up | BIT.left | BIT.a | BIT.start);
  assert.equal(masks[0], BIT.right);
});

test("keyboard: Escape is the reserved star button and never sets a cart bit", () => {
  const { masks, star } = keyboardToMasks(["Escape"]);
  assert.deepEqual(masks, [0, 0]);
  assert.equal(star, true);
});

test("keyboard: unmapped keys are ignored; every mapped key targets a real button", () => {
  assert.deepEqual(keyboardToMasks(["KeyQ", "Space", "F5"]).masks, [0, 0]);
  for (const [code, [p, b]] of Object.entries(DEFAULT_KEYMAP)) {
    assert.ok(p === 1 || p === 2, code);
    assert.ok(b === "star" || BUTTONS.includes(b), code);
  }
  // No code maps to two things, and no button is mapped twice for the same player.
  const seen = new Set(Object.values(DEFAULT_KEYMAP).map(([p, b]) => `${p}:${b}`));
  assert.equal(seen.size, Object.keys(DEFAULT_KEYMAP).length);
});

test("gamepad: standard mapping face buttons, start and d-pad", () => {
  assert.equal(gamepadToMask(pad([0])).mask, BIT.a);
  assert.equal(gamepadToMask(pad([1])).mask, BIT.b);
  assert.equal(gamepadToMask(pad([2])).mask, BIT.x);
  assert.equal(gamepadToMask(pad([3])).mask, BIT.y);
  assert.equal(gamepadToMask(pad([9])).mask, BIT.start);
  assert.equal(gamepadToMask(pad([12, 15])).mask, BIT.up | BIT.right);
  assert.equal(gamepadToMask(pad([13, 14])).mask, BIT.down | BIT.left);
});

test("gamepad: left stick with a 0.5 dead zone", () => {
  assert.equal(gamepadToMask(pad([], [0.49, -0.49])).mask, 0);
  assert.equal(gamepadToMask(pad([], [0.5, 0])).mask, BIT.right);
  assert.equal(gamepadToMask(pad([], [-0.9, 0.8])).mask, BIT.left | BIT.down);
  assert.equal(gamepadToMask(pad([], [0, -1])).mask, BIT.up);
});

test("gamepad: guide is star, not a cart button; missing pads are empty", () => {
  assert.deepEqual(gamepadToMask(pad([16])), { mask: 0, star: true });
  assert.deepEqual(gamepadToMask(null), { mask: 0, star: false });
  assert.deepEqual(gamepadToMask({ buttons: [], axes: [] }), { mask: 0, star: false });
});

test("readInput: pad 0 is P1, pad 1 is P2, OR-ed with the keyboard", () => {
  const r = readInput(["ArrowUp", "KeyD"], [pad([0]), pad([1])], undefined, 2);
  assert.deepEqual(r.masks, [BIT.up | BIT.a, BIT.right | BIT.b]);
  assert.equal(r.star, false);
  assert.equal(readInput([], [null, pad([16])], undefined, 2).star, true);
});

test("readInput: one controller by default (D110); extra keys and pads are ignored, guide still counts", () => {
  const r = readInput(["ArrowUp", "KeyD", "Digit1"], [pad([0]), pad([1])]);
  assert.deepEqual(r.masks, [BIT.up | BIT.a], "player 2's keys and pad 1 have no controller");
  assert.equal(readInput([], [null, pad([16])]).star, true, "guide on any pad is ★");
});

test("readInput: N controllers, pad k is player k+1", () => {
  const pads = [pad([0]), null, pad([2]), pad([3]), pad([9])];
  const r = readInput(["KeyW"], pads, undefined, 4);
  assert.deepEqual(r.masks, [BIT.a, BIT.up, BIT.x, BIT.y], "pad 4 is beyond 4 controllers");
  assert.equal(readInput([], [], undefined, 8).masks.length, 8);
  assert.equal(MAX_PLAYERS, 8);
  for (const bad of [0, 9, 1.5, "2", NaN]) {
    assert.throws(() => readInput([], [], undefined, /** @type {any} */ (bad)), /whole number from 1 to 8/);
  }
});

test("checkPlayers: default 1, 1..8, otherwise a readable error", () => {
  assert.equal(checkPlayers(undefined), 1);
  assert.equal(checkPlayers(null), 1);
  assert.equal(checkPlayers(3), 3);
  assert.throws(() => checkPlayers("two"), /must be a whole number from 1 to 8, got "two"/);
});

test("test scripts: held strings and arrays", () => {
  assert.equal(heldToMask("right a"), BIT.right | BIT.a);
  // @ts-expect-error case-insensitive at runtime
  assert.equal(heldToMask(["Up", "start"]), BIT.up | BIT.start);
  assert.equal(heldToMask(""), 0);
  assert.equal(heldToMask(undefined), 0);
  assert.throws(() => heldToMask("jump"), /unknown button "jump"/);
});

test("test scripts expand to one mask per controller per frame", () => {
  const frames = expandScript([{ frames: 2, p1: "left" }, { frames: 1, p2: "a" }, { frames: 1 }]);
  assert.deepEqual(frames, [[BIT.left, 0], [BIT.left, 0], [0, BIT.a], [0, 0]]);
  assert.deepEqual(expandScript([{ frames: 1, p1: "a", p2: "b" }], 1), [[BIT.a]], "p2 has no controller at players 1");
  assert.deepEqual(expandScript([{ frames: 1, p3: "x", p8: "y" }], 8), [[0, 0, BIT.x, 0, 0, 0, 0, BIT.y]]);
  // @ts-expect-error p9 isn't a player
  assert.throws(() => expandScript([{ frames: 1, p9: "a" }], 2), /p9; players are p1 to p8/);
  assert.throws(() => expandScript([{ frames: 1, p2: "jump" }], 1), /unknown button "jump"/, "bad names fail even for a missing player");
  assert.throws(() => expandScript([{ frames: 0 }]), /frames >= 1/);
  // @ts-expect-error not an array
  assert.throws(() => expandScript({ frames: 1 }), /array/);
});
