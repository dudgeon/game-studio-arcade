// play.html's ?players= in a real browser (D110, D111): how many controllers the
// page gives a cart, and the error a bad setting shows. Skipped where Playwright or
// Chromium isn't usable; the harness and these tests never install it (D63).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer } from "../dev-server.js";
import { findPlaywright } from "../../studio-kit/playtest/src/browser.js";

/** Reports the controllers it was given and what each player's A button is doing. */
const CART = `export default {
  init() { return { p1: false, p2: false }; },
  update(g, s) { s.p1 = g.btn("a", 1); s.p2 = g.btn("a", 2); },
  draw(g) { g.cls(0); },
  probe(g, s) { return { players: g.players, p1: s.p1, p2: s.p2 }; },
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gsa-play-page-"));
  fs.writeFileSync(path.join(dir, "game.js"), CART);
  server = await startServer({ port: 0, carts: { c: dir } });
});

after(async () => {
  await browser?.close();
  await server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Open play.html, run `fn` with the page, and close it.
 * @template T
 * @param {string} query @param {(page: any) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function onPage(query, fn) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`${server.url}/runtime/play.html?cart=/carts/c/game.js${query}`);
    return await fn(page);
  } finally {
    await context.close();
  }
}

const ready = (/** @type {any} */ page) => page.evaluate(async () => {
  const a = /** @type {any} */ (window).arcade;
  await a.ready;
  return a.players;
});

/** What the cart sees when a script holds A for both players. Test mode, so no real keys. */
const heldByScript = (/** @type {any} */ page) => page.evaluate(async () => {
  const t = /** @type {any} */ (window).arcade.test;
  await t.input([{ frames: 2, p1: "a", p2: "a" }]);
  await t.step(1);
  return t.probe();
});

/** Hold P1's and P2's A keys together, wait until the cart sees P1's, and report what it sees. */
async function heldByKeys(/** @type {any} */ page) {
  await page.keyboard.down("KeyZ");
  await page.keyboard.down("Digit1");
  await page.waitForFunction(async () => (await /** @type {any} */ (window).arcade.test.probe()).p1);
  // A frame later, in case the two keys landed either side of a tick.
  const start = await page.evaluate(() => /** @type {any} */ (window).arcade.ticks);
  await page.waitForFunction((/** @type {number} */ n) => /** @type {any} */ (window).arcade.ticks > n + 1, start);
  return page.evaluate(() => /** @type {any} */ (window).arcade.test.probe());
}

for (const [query, want] of /** @type {[string, number][]} */ ([["", 1], ["&players=1", 1], ["&players=2", 2]])) {
  const label = query || "no setting";

  test(`play.html, ${label}: ${want} controller${want > 1 ? "s" : ""}, for the host and the cart`, { skip }, async () => {
    await onPage(`${query}&test=1`, async (page) => {
      assert.equal(await ready(page), want, "arcade.players");
      const p = await heldByScript(page);
      assert.equal(p.players, want, "g.players");
      assert.equal(p.p1, true, "player 1 always has a controller");
      assert.equal(p.p2, want >= 2, "player 2 holds nothing without a controller (D112)");
      assert.equal(await page.textContent("#err"), "");
    });
  });

  test(`play.html, ${label}: the P2 keys ${want >= 2 ? "work" : "do nothing"} on the live page`, { skip }, async () => {
    await onPage(query, async (page) => {
      await ready(page);
      const p = await heldByKeys(page);
      assert.equal(p.p1, true);
      assert.equal(p.p2, want >= 2);
    });
  });
}

for (const bad of ["9", "0", "1.5", "two", ""]) {
  test(`play.html, players=${bad || "(empty)"}: a clear error on the page, and no game runs`, { skip }, async () => {
    await onPage(`&players=${bad}`, async (page) => {
      await page.waitForFunction(() => document.getElementById("err")?.textContent);
      assert.match(await page.textContent("#err"), /players \(the number of controllers\) must be a whole number from 1 to 8/);
      assert.equal(await page.evaluate(() => /** @type {any} */ (window).arcade), undefined);
      assert.equal(await page.locator("canvas, iframe").count(), 0, "nothing runs");
    });
  });
}

test("play.html, players=9: the error says what it was given", { skip }, async () => {
  await onPage("&players=9", async (page) => {
    await page.waitForFunction(() => document.getElementById("err")?.textContent);
    assert.match(await page.textContent("#err"), /got 9$/);
  });
});
