// The dev server, the host's integer scaling and g.lib wiring.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FRAME_CSP, cartsIn, startServer } from "../dev-server.js";
import { integerScale } from "../src/host.js";
import { headless } from "../src/headless.js";

const RUNTIME = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("dev server: runtime and carts, CORS for the opaque-origin frame, CSP on frame.html", async () => {
  const s = await startServer({ port: 0, carts: { hello: path.join(RUNTIME, "examples/hello") } });
  try {
    const frame = await fetch(`${s.url}/runtime/frame.html`);
    assert.equal(frame.status, 200);
    assert.equal(frame.headers.get("content-security-policy"), FRAME_CSP);
    assert.equal(frame.headers.get("access-control-allow-origin"), "*");

    const game = await fetch(`${s.url}/carts/hello/game.js`);
    assert.equal(game.status, 200);
    assert.match(game.headers.get("content-type") ?? "", /^text\/javascript/);
    assert.equal(game.headers.get("access-control-allow-origin"), "*");

    const js = await fetch(`${s.url}/runtime/src/machine.js`);
    assert.equal(js.status, 200);

    assert.deepEqual(await (await fetch(`${s.url}/carts/`)).json(), ["hello"]);
    assert.equal((await fetch(`${s.url}/carts/nope/game.js`)).status, 404);
    assert.equal((await fetch(`${s.url}/carts/hello/..%2f..%2f..%2fCLAUDE.md`)).status, 404, "no escaping a cart folder");
    assert.equal((await fetch(`${s.url}/runtime/..%2f..%2fCLAUDE.md`)).status, 404, "no escaping the runtime folder");
    assert.equal((await fetch(`${s.url}/runtime/frame.html`, { method: "POST" })).status, 405);
    const root = await fetch(`${s.url}/`, { redirect: "manual" });
    assert.equal(root.status, 302);
  } finally {
    await s.close();
  }
});

test("cartsIn finds cart folders by game.js", () => {
  assert.deepEqual(Object.keys(cartsIn(path.join(RUNTIME, "examples"))).sort(), ["hello", "motion"]);
  assert.deepEqual(cartsIn(path.join(RUNTIME, "no-such-dir")), {});
});

test("integer scale in device pixels: 4x on the Picade 10-inch's 1024x768 (D81)", () => {
  assert.equal(integerScale(1024, 768, 1), 4);
  assert.equal(integerScale(1023, 768, 1), 3);
  assert.equal(integerScale(1024, 767, 1), 3);
  assert.equal(integerScale(1024, 768, 2), 8, "Retina: 8 device px = 4 CSS px");
  assert.equal(integerScale(1920, 1080, 1), 5, "1080p: 5x (1280x960)");
  assert.equal(integerScale(100, 100, 1), 1, "never below 1");
});

test("carts reach the starter library as g.lib (D50)", async () => {
  /** @type {any} */
  let seen;
  await headless({
    init: (g) => {
      seen = { frozen: Object.isFrozen(g), lib: Object.keys(g.lib).sort(), grid: g.lib.grid.make(3, 2).cells.length };
      return {};
    },
    update() {},
    draw() {},
  });
  assert.deepEqual(seen.lib, ["anim", "camera", "collide", "floor", "flow", "fx", "grid", "motion", "parallax", "particles", "raycast", "score", "stack", "timers", "turns"]);
  assert.equal(seen.grid, 6);
});
