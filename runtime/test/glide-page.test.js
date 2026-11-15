// A gliding cart on a real page (D476, D517): the glide picture is on screen at the display's size, the
// GPU path and the 2D path show exactly the same pixels, and a cart that doesn't glide is shown as ever.
// Skipped where Playwright or Chromium isn't usable; these tests never install it (D63).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer } from "../dev-server.js";
import { findPlaywright } from "../../studio-kit/playtest/src/browser.js";

/** Every color, text, a sprite at a fraction of a pixel and a scrolled world: `glide` is the only difference. */
const cart = (glide) => `export default {
  init(g) { ${glide ? "g.glide();" : ""} return { x: 10.25, ship: g.sprite(["7788", "9ff9", "8877"]) }; },
  update(g, s) { s.x += 0.25; },
  draw(g, s) {
    g.cls(1);
    for (let c = 0; c < 32; c++) g.rectfill(c * 8, 20, 8, 30, c);
    g.camera(s.x / 2, 0.5);
    g.rectfill(0, 100, 400, 6, 17);
    g.spr(s.ship, s.x * 2, 80, { rot: 0.4, zoom: 3 });
    g.circfill(60.5, 140.25, 9, 15);
    g.camera();
    g.text("GLIDE 0123", 2.5, 2.75, 5);
  },
  probe(g, s) { return { x: s.x }; },
};
`;

/** @returns {Promise<any>} */
async function launch() {
  const { playwright } = findPlaywright();
  try {
    return await playwright.chromium.launch({ headless: true });
  } catch {
    return playwright.chromium.launch({ headless: true, channel: "chromium" });
  }
}

/** @type {string | false} */
let skip = false;
/** @type {any} */
let browser;
try {
  browser = await launch();
} catch (e) {
  skip = `Playwright or its Chromium isn't usable here: ${String(/** @type {Error} */ (e).message).split("\n")[0]}`;
}

/** @type {{ url: string, close: () => Promise<void> }} */
let server;
/** @type {string} */
let dir;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gsa-glide-page-"));
  for (const [name, glide] of /** @type {const} */ ([["glides", true], ["plain", false]])) {
    fs.mkdirSync(path.join(dir, name));
    fs.writeFileSync(path.join(dir, name, "game.js"), cart(glide));
  }
  server = await startServer({ port: 0, carts: { glides: path.join(dir, "glides"), plain: path.join(dir, "plain") } });
});

after(async () => {
  await browser?.close();
  await server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Open a cart paused at the cabinet's 1024x768, step it, and return what its screen says and a picture of it.
 * @param {string} name @param {string} [query] @param {{ width: number, height: number }} [viewport]
 */
async function shot(name, query = "", viewport = { width: 1024, height: 768 }) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  try {
    /** @type {string[]} */
    const errors = [];
    page.on("pageerror", (/** @type {Error} */ e) => errors.push(e.message));
    await page.goto(`${server.url.replace(/\/$/, "")}/runtime/play.html?cart=/carts/${name}/game.js&test=1${query}`);
    await page.waitForFunction(() => /** @type {any} */ (window).arcade);
    const screen = await page.evaluate(async () => {
      const a = /** @type {any} */ (window).arcade;
      await a.ready;
      await a.test.step(7);
      return { ...(await a.screen()), scale: a.scale, hash: (await a.test.frame()).hash };
    });
    // Two frames of the compositor, so what was drawn is what's captured.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
    const png = await page.screenshot();
    assert.deepEqual(errors, []);
    return { screen, png };
  } finally {
    await page.close();
  }
}

test("a gliding cart is drawn at the display's size, by the GPU where there is one", { skip }, async () => {
  const { screen } = await shot("glides");
  assert.equal(screen.glides, true);
  assert.deepEqual([screen.scale, screen.fine], [4, 4]);
  assert.ok(screen.path === "gpu" || screen.path === "2d", `path ${screen.path}`);
});

test("the GPU path and the 2D path put exactly the same pixels on the screen", { skip }, async (t) => {
  const gpu = await shot("glides");
  const flat = await shot("glides", "&gpu=0");
  assert.equal(flat.screen.path, "2d");
  assert.equal(gpu.screen.hash, flat.screen.hash);
  if (gpu.screen.path !== "gpu") return t.skip("this Chromium has no WebGL, so there's only the 2D path to see");
  assert.ok(gpu.png.equals(flat.png), "the two screenshots differ");
});

test("glide really moves things by less than a game pixel, and ?glide=0 is the old picture", { skip }, async () => {
  const on = await shot("glides");
  const off = await shot("glides", "&glide=0");
  const plain = await shot("plain");
  assert.deepEqual([off.screen.fine, off.screen.path], [1, null]);
  assert.deepEqual([plain.screen.glides, plain.screen.path], [false, null]);
  assert.ok(off.png.equals(plain.png), "a gliding cart with glide off looks exactly like the same cart that never asked");
  assert.ok(!on.png.equals(off.png), "with glide on, things sit at fractions of a pixel");
  assert.equal(on.screen.hash, plain.screen.hash, "and the framebuffer a check sees is the same either way");
});

test("at a scale with no glide (7) the cart is shown the old way", { skip }, async () => {
  const { screen } = await shot("glides", "", { width: 256 * 7, height: 192 * 7 });
  assert.deepEqual([screen.scale, screen.fine, screen.path], [7, 1, null]);
});
