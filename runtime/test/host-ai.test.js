// The host and g.ai (D480, D486): a live host with an `ai` answerer passes each ask
// on and posts the answer back to the frame; a test host, or one with no answerer,
// never asks anyone; `stop` ends asking for the run. Against a stand-in window.
import { test } from "node:test";
import assert from "node:assert/strict";

/** @type {Set<Function>} */
const onMessage = new Set();
/** Key listeners, the live loop's frame callback and a clock the test moves, for the voice tests. @type {Map<string, Set<Function>>} */
const onKeys = new Map([["keydown", new Set()], ["keyup", new Set()]]);
/** @type {((t: number) => void) | null} */
let raf = null;
let clock = 1000;
/** @type {any[]} */
const posted = [];
const frameWindow = { postMessage: (/** @type {any} */ m) => posted.push(m) };
const g = /** @type {any} */ (globalThis);
g.addEventListener = (/** @type {string} */ type, /** @type {Function} */ fn) => (type === "message" ? onMessage.add(fn) : onKeys.get(type)?.add(fn));
g.removeEventListener = (/** @type {string} */ type, /** @type {Function} */ fn) => (type === "message" ? onMessage.delete(fn) : onKeys.get(type)?.delete(fn));
Object.defineProperty(g, "performance", { value: { now: () => clock }, configurable: true });
g.document = { createElement: () => ({ style: {}, setAttribute() {}, addEventListener() {}, contentWindow: frameWindow, remove() {} }) };
g.devicePixelRatio = 1;
g.innerWidth = 1024;
g.innerHeight = 768;
g.location = { href: "http://127.0.0.1:8330/" };
g.requestAnimationFrame = (/** @type {(t: number) => void} */ fn) => ((raf = fn), 0);
g.window = g;

const { createHost } = await import("../src/host.js");
const container = /** @type {any} */ ({ appendChild() {}, getBoundingClientRect: () => ({ width: 1024, height: 768 }) });
const fromFrame = (/** @type {any} */ data) => {
  for (const fn of onMessage) fn({ source: frameWindow, data });
};
const settle = () => new Promise((r) => setTimeout(r, 0));
const ASK = { id: 1, kind: "lines", name: "joke", ask: "A duck joke.", max: 80 };

test("a live host passes each ask to its answerer and posts the answer to the frame", async () => {
  posted.length = 0;
  /** @type {any[]} */
  const asked = [];
  const host = createHost({ container, cartUrl: "/carts/x/game.js", persist: false, ai: async (a) => (asked.push(a), { ok: true, lines: ["Quack!"] }) });
  fromFrame({ type: "out", audio: [], ai: [ASK] });
  await settle();
  assert.deepEqual(asked, [ASK]);
  assert.deepEqual(posted.filter((m) => m.type === "ai"), [{ type: "ai", reply: { id: 1, ok: true, lines: ["Quack!"], pick: undefined } }]);
  host.destroy();
});

test("an answerer that throws is 'no answer', and stop ends asking for the run", async () => {
  posted.length = 0;
  let calls = 0;
  const host = createHost({
    container,
    cartUrl: "/carts/x/game.js",
    persist: false,
    ai: async () => {
      calls++;
      if (calls === 1) throw new Error("network");
      return { ok: false, stop: true };
    },
  });
  fromFrame({ type: "out", ai: [ASK] });
  await settle();
  assert.deepEqual(posted.at(-1), { type: "ai", reply: { id: 1, ok: false } });
  fromFrame({ type: "out", ai: [{ ...ASK, id: 2 }] });
  await settle();
  fromFrame({ type: "out", ai: [{ ...ASK, id: 3 }] });
  await settle();
  assert.equal(calls, 2, "nothing is asked after stop");
  host.destroy();
});

test("a test host never asks anyone, and neither does a host with no answerer (D486)", async () => {
  posted.length = 0;
  let calls = 0;
  const testHost = createHost({ container, cartUrl: "/carts/x/game.js", test: true, ai: async () => (calls++, { ok: true, lines: ["Quack!"] }) });
  fromFrame({ type: "out", ai: [ASK] });
  await settle();
  testHost.destroy();
  const plain = createHost({ container, cartUrl: "/carts/x/game.js", persist: false });
  fromFrame({ type: "out", ai: [ASK] });
  await settle();
  plain.destroy();
  assert.equal(calls, 0);
  assert.deepEqual(posted.filter((m) => m.type === "ai"), []);
});

// ---- voice asks (D489) ----

const SPELL = { name: "spell", ask: "Which spell does the wizard cast?", actions: ["fire", "ice"], hold: "y" };
const key = (/** @type {"keydown" | "keyup"} */ type, /** @type {string} */ code) => {
  for (const fn of onKeys.get(type) ?? []) fn({ type, code, repeat: false, preventDefault() {} });
};
/** Run the live loop for this many milliseconds, a frame at a time. */
const run = (/** @type {number} */ ms) => {
  for (let t = 0; t < ms; t += 17) {
    clock += 17;
    raf?.(clock);
  }
};
const mic = () => {
  /** @type {string[]} */
  const calls = [];
  return { calls, voice: { start: (/** @type {any} */ v) => void calls.push(`start ${v.name}`), stop: async (/** @type {any} */ v) => (calls.push(`stop ${v.name}`), { action: "fire" }), cancel: () => void calls.push("cancel") } };
};

test("the mic is on only while the game's talk button is held, and the action heard goes to the cart", async () => {
  posted.length = 0;
  const m = mic();
  const host = createHost({ container, cartUrl: "/carts/x/game.js", persist: false, voice: m.voice });
  fromFrame({ type: "ready", voices: [SPELL] });
  run(200);
  assert.deepEqual(m.calls, [], "nothing is heard with no button held");
  key("keydown", "KeyZ");
  run(500);
  key("keyup", "KeyZ");
  run(100);
  assert.deepEqual(m.calls, [], "another button isn't the talk button");
  key("keydown", "KeyV");
  run(600);
  assert.deepEqual(m.calls, ["start spell"]);
  key("keyup", "KeyV");
  run(50);
  await settle();
  assert.deepEqual(m.calls, ["start spell", "stop spell"]);
  assert.deepEqual(posted.filter((p) => p.type === "heard"), [{ type: "heard", name: "spell", action: "fire" }]);
  host.destroy();
});

test("a tap on the talk button is thrown away, and a game that ends mid-hold turns the mic off", async () => {
  posted.length = 0;
  const m = mic();
  const host = createHost({ container, cartUrl: "/carts/x/game.js", persist: false, voice: m.voice });
  fromFrame({ type: "ready", voices: [SPELL] });
  key("keydown", "KeyV");
  run(100);
  key("keyup", "KeyV");
  run(50);
  await settle();
  assert.deepEqual(m.calls, ["start spell", "cancel"]);
  key("keydown", "KeyV");
  run(100);
  host.destroy();
  assert.deepEqual(m.calls, ["start spell", "cancel", "start spell", "cancel"]);
  assert.deepEqual(posted.filter((p) => p.type === "heard"), []);
});

test("no microphone behind the host, a test host, or no usable voice ask: nothing ever listens", async () => {
  const m = mic();
  const testHost = createHost({ container, cartUrl: "/carts/x/game.js", test: true, voice: m.voice });
  fromFrame({ type: "ready", voices: [SPELL] });
  key("keydown", "KeyV");
  run(600);
  key("keyup", "KeyV");
  testHost.destroy();
  const noAsk = createHost({ container, cartUrl: "/carts/x/game.js", persist: false, voice: m.voice });
  fromFrame({ type: "ready", voices: [] });
  key("keydown", "KeyV");
  run(600);
  key("keyup", "KeyV");
  run(50);
  noAsk.destroy();
  // The stick and start can't be made a talk button, whatever a frame claims.
  const bad = createHost({ container, cartUrl: "/carts/x/game.js", persist: false, voice: m.voice });
  fromFrame({ type: "ready", voices: [{ ...SPELL, hold: "start" }, { ...SPELL, hold: "up" }, { hold: "y" }] });
  key("keydown", "Enter");
  key("keydown", "ArrowUp");
  key("keydown", "KeyV");
  run(600);
  bad.destroy();
  assert.deepEqual(m.calls, []);
});
