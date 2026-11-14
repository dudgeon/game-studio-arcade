// The host and g.ai (D480, D486): a live host with an `ai` answerer passes each ask
// on and posts the answer back to the frame; a test host, or one with no answerer,
// never asks anyone; `stop` ends asking for the run. Against a stand-in window.
import { test } from "node:test";
import assert from "node:assert/strict";

/** @type {Set<Function>} */
const onMessage = new Set();
/** @type {any[]} */
const posted = [];
const frameWindow = { postMessage: (/** @type {any} */ m) => posted.push(m) };
const g = /** @type {any} */ (globalThis);
g.addEventListener = (/** @type {string} */ type, /** @type {Function} */ fn) => type === "message" && onMessage.add(fn);
g.removeEventListener = (/** @type {string} */ type, /** @type {Function} */ fn) => type === "message" && onMessage.delete(fn);
g.document = { createElement: () => ({ style: {}, setAttribute() {}, addEventListener() {}, contentWindow: frameWindow, remove() {} }) };
g.devicePixelRatio = 1;
g.innerWidth = 1024;
g.innerHeight = 768;
g.location = { href: "http://127.0.0.1:8330/" };
g.requestAnimationFrame = () => 0;
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
