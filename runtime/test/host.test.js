// The host page side (src/host.js) against a stand-in window, so it runs in
// Node: every listener createHost adds is removed by destroy() (D114), and the
// players setting reaches the frame (D110). node:test runs each file in its own
// process, so the globals set here don't leak into other tests.
import { test } from "node:test";
import assert from "node:assert/strict";

/** @type {Map<string, Set<Function>>} key: `${type}|${capture}` */
const windowListeners = new Map();
const keyOf = (type, opts) => `${type}|${typeof opts === "boolean" ? opts : !!opts?.capture}`;
/** @type {any[]} messages the host posted to the frame */
const posted = [];

function fakeIframe() {
  /** @type {Record<string, Function[]>} */
  const on = {};
  return {
    style: {},
    attrs: /** @type {Record<string, string>} */ ({}),
    src: "",
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
    addEventListener(type, fn) {
      (on[type] ??= []).push(fn);
    },
    fire(type) {
      for (const fn of on[type] ?? []) fn();
    },
    contentWindow: { postMessage: (msg) => posted.push(msg) },
    removed: false,
    remove() {
      this.removed = true;
    },
  };
}

const g = /** @type {any} */ (globalThis);
g.addEventListener = (type, fn, opts) => {
  const k = keyOf(type, opts);
  if (!windowListeners.has(k)) windowListeners.set(k, new Set());
  windowListeners.get(k)?.add(fn);
};
g.removeEventListener = (type, fn, opts) => windowListeners.get(keyOf(type, opts))?.delete(fn);
g.document = { createElement: () => fakeIframe() };
g.devicePixelRatio = 1;
g.innerWidth = 1024;
g.innerHeight = 768;
g.location = { href: "http://127.0.0.1:8320/runtime/play.html" };
g.requestAnimationFrame = () => 0;
g.window = g;

const { createHost } = await import("../src/host.js");

const count = () => [...windowListeners.values()].reduce((n, s) => n + s.size, 0);
const container = () => {
  /** @type {any} */
  let child = null;
  return {
    appendChild: (c) => (child = c),
    getBoundingClientRect: () => ({ width: 1024, height: 768 }),
    get child() {
      return child;
    },
  };
};

test("destroy() removes every window listener the host added, live or test (D114)", () => {
  assert.equal(count(), 0);
  for (const test of [false, true]) {
    const hosts = [1, 2, 3].map(() => createHost({ container: /** @type {any} */ (container()), cartUrl: "/carts/x/game.js", test, persist: false }));
    assert.ok(count() >= 3 * 6, "keydown, keyup, blur, pointerdown, resize and message per host");
    for (const h of hosts) h.destroy();
    assert.deepEqual(
      [...windowListeners].filter(([, s]) => s.size).map(([k, s]) => `${k} x${s.size}`),
      [],
      "nothing left attached after destroy()",
    );
  }
});

test("players: default 1, passed to the frame at boot, bad values throw (D110)", () => {
  posted.length = 0;
  const c = container();
  const one = createHost({ container: /** @type {any} */ (c), cartUrl: "/carts/x/game.js", test: true, persist: false });
  assert.equal(one.players, 1);
  c.child.fire("load");
  assert.equal(posted.at(-1).type, "boot");
  assert.equal(posted.at(-1).players, 1);
  one.destroy();

  const c2 = container();
  const two = createHost({ container: /** @type {any} */ (c2), cartUrl: "/carts/x/game.js", test: true, persist: false, players: 2 });
  c2.child.fire("load");
  assert.equal(two.players, 2);
  assert.equal(posted.at(-1).players, 2);
  two.destroy();

  assert.throws(() => createHost({ container: /** @type {any} */ (container()), cartUrl: "/x.js", test: true, players: 0 }), /whole number from 1 to 8/);
  assert.equal(count(), 0, "a host that failed to start leaves nothing attached");
});
