// A guest game end to end (D230–D232), in headless Chromium against the real
// service process: teti is on the shelf, plays with D82 keys, and Escape goes
// back to the shelf with the play logged. Skips if there's no headless Chromium.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBrowser, plantSeed, startServiceProcess } from "../scripts/drive.js";

const FIXTURE = path.resolve(import.meta.dirname, "../../../studio-kit/cli/fixtures/penguin-catch");

let skip = "";
try {
  const { chromium } = await import("playwright");
  const b = await chromium.launch({ headless: true }).catch(() => chromium.launch({ headless: true, channel: "chrome" }));
  await b.close();
} catch (e) {
  skip = `no headless Chromium: ${String(/** @type {Error} */ (e).message).split("\n")[0]}`;
}

/** @param {any} page @param {() => Promise<boolean>} ok @param {string} what */
async function until(page, ok, what, ms = 20_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await ok().catch(() => false)) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** @param {any} page @param {string} key */
async function press(page, key) {
  await page.keyboard.down(key);
  await page.waitForTimeout(60);
  await page.keyboard.up(key);
  await page.waitForTimeout(120);
}

test("teti: on the shelf, played with the stick and buttons, Escape back to the shelf, play logged", { skip: skip || false, timeout: 120_000 }, async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "gsa-guest-flow-"));
  plantSeed(data, { state: "seen" }); // past the first-ever boot's screens (B2, B3)
  const service = /** @type {any} */ (await startServiceProcess({ replay: FIXTURE, data, pace: 10 }));
  const { browser, page, problems } = await openBrowser(service.url);
  const launcher = (/** @type {string} */ f) => page.evaluate((/** @type {string} */ f) => /** @type {any} */ (window).launcher[f](), f);
  try {
    await until(page, async () => (await launcher("screen")) === "shelf", "the shelf");
    // The shelf: the Make tile, then teti (a fresh cabinet has no carts).
    const titles = () => page.evaluate(() => /** @type {any} */ (window).launcher.boxes().filter((/** @type {any} */ b) => /^shelf-title-/.test(b.id)).map((/** @type {any} */ b) => b.lines.map((/** @type {any} */ l) => l.text).join(" ")));
    await until(page, async () => (await titles()).some((/** @type {string} */ t) => /teti/.test(t)), "teti on the shelf");

    // teti's row: "by TitanPlayz100" and a "free game" tag; the stick moves down to it.
    const boxText = (/** @type {RegExp} */ id) => page.evaluate((/** @type {string} */ src) => /** @type {any} */ (window).launcher.boxes().filter((/** @type {any} */ b) => new RegExp(src).test(b.id)).map((/** @type {any} */ b) => b.lines.map((/** @type {any} */ l) => l.text).join(" ")), id.source);
    assert.ok((await boxText(/^shelf-by-/)).some((/** @type {string} */ t) => /by TitanPlayz100/.test(t)));
    assert.ok((await boxText(/^shelf-tag-/)).some((/** @type {string} */ t) => /free game/.test(t)));
    for (let i = 0; i < 10; i++) {
      const sel = await launcher("sel");
      const lit = await page.evaluate((/** @type {number} */ n) => /** @type {any} */ (window).launcher.boxes().find((/** @type {any} */ b) => b.id === `shelf-title-${n}`), sel);
      if (lit && /teti/.test(lit.lines.map((/** @type {any} */ l) => l.text).join(" "))) break;
      await press(page, "ArrowDown");
    }
    await press(page, "ArrowRight");
    assert.equal(await launcher("screen"), "shelf", "a guest has no card (no versions)");

    // G0 from guest.json, then the game.
    await press(page, "z");
    await until(page, async () => (await launcher("board")) === "G0", "how to play (G0)");
    assert.ok((await boxText(/^howto-goal/)).some((/** @type {string} */ t) => /rows/.test(t)), "the goal from guest.json");
    await press(page, "z");
    await until(page, async () => (await launcher("screen")) === "play", "play");
    const frame = async () => page.frames().find((/** @type {any} */ f) => f.url().includes("/teti/"));
    await until(page, async () => !!(await (await frame())?.evaluate(() => /** @type {any} */ (window).cabinetState?.())), "teti's picker");
    const state = async () => (await frame())?.evaluate(() => /** @type {any} */ (window).cabinetState());
    assert.equal((await state()).kind, "picker");
    assert.ok(await page.evaluate(() => document.activeElement?.tagName === "IFRAME"), "the game has focus");

    // Marathon, then a few moves: keys reach the game.
    await press(page, "z");
    await until(page, async () => (await state()).kind === "playing", "Marathon to start");
    await page.waitForTimeout(1500); // ready, set, go
    await press(page, "ArrowLeft");
    await press(page, "x");
    await press(page, "ArrowUp");
    await until(page, async () => (await state()).score > 0, "a hard drop to score");
    await press(page, "Enter");
    assert.equal((await state()).kind, "pause", "START pauses");

    // Escape: never the game's. The guest post-game: Play again or Back to the shelf, no coins.
    await press(page, "Escape");
    await until(page, async () => (await launcher("board")) === "G6", "the guest post-game board");
    assert.equal(await frame(), undefined, "the game is gone");
    const tiles = (await boxText(/tile/)).join(" | ");
    assert.match(tiles, /Play again/);
    assert.match(tiles, /Back to the shelf/);
    assert.doesNotMatch(tiles, /[Cc]hange|coin/, "nothing to change, nothing to spend");
    await press(page, "z"); // "Back to the shelf" is lit
    await until(page, async () => (await launcher("screen")) === "shelf", "back to the shelf");
    const logFile = path.join(data, "logs", "guest_play.jsonl");
    await until(page, async () => fs.existsSync(logFile), "the play log");
    const [play] = fs.readFileSync(logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(play.guest_id, "teti");
    assert.equal(play.ended, "star");
    assert.ok(play.duration_s > 1);
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
    service.stop();
  }
});
