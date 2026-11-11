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

test("Geoff's teti: under teti on the shelf, keeps score; G6 shows the score and the best; the original still shows none (D234-D236)", { skip: skip || false, timeout: 240_000 }, async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "gsa-guest-score-"));
  plantSeed(data, { state: "seen" });
  const service = /** @type {any} */ (await startServiceProcess({ replay: FIXTURE, data, pace: 10 }));
  const { browser, page, problems } = await openBrowser(service.url);
  const launcher = (/** @type {string} */ f) => page.evaluate((/** @type {string} */ f) => /** @type {any} */ (window).launcher[f](), f);
  /** The text of the launcher's boxes whose ids match. @param {RegExp} id */
  const boxText = (id) => page.evaluate((/** @type {string} */ src) => /** @type {any} */ (window).launcher.boxes().filter((/** @type {any} */ b) => new RegExp(src).test(b.id)).map((/** @type {any} */ b) => b.lines.map((/** @type {any} */ l) => l.text).join(" ")), id.source);
  const box = (/** @type {string} */ id) => page.evaluate((/** @type {string} */ id) => /** @type {any} */ (window).launcher.boxes().find((/** @type {any} */ b) => b.id === id) ?? null, id);
  /** Move the shelf's highlight to the row whose "by" line matches. @param {RegExp} by */
  const pickRow = async (by) => {
    while ((await launcher("sel")) > 0) await press(page, "ArrowUp"); // from the top
    for (let i = 0; i < 12; i++) {
      const sel = await launcher("sel");
      const line = await box(`shelf-by-${sel}`);
      if (line && by.test(line.lines.map((/** @type {any} */ l) => l.text).join(" "))) return sel;
      await press(page, "ArrowDown");
    }
    throw new Error(`no shelf row ${by}`);
  };
  const frameOf = (/** @type {string} */ id) => page.frames().find((/** @type {any} */ f) => f.url().includes(`/${id}/`));
  /** Into a guest from the shelf (through G0) or straight from G6's Play again, then Marathon to game over. Returns the round's score. @param {string} id */
  const marathonToGameOver = async (id) => {
    await until(page, async () => (await launcher("screen")) === "play", "play");
    await until(page, async () => !!(await frameOf(id)?.evaluate(() => /** @type {any} */ (window).cabinetState?.())), `${id}'s picker`);
    const state = () => frameOf(id)?.evaluate(() => /** @type {any} */ (window).cabinetState());
    await press(page, "z"); // Marathon
    await until(page, async () => (await state()).kind === "playing", "Marathon");
    await page.waitForTimeout(1500); // ready, set, go
    for (let i = 0; i < 80 && (await state()).kind !== "over"; i++) await press(page, "ArrowUp");
    assert.equal((await state()).kind, "over", "topped out");
    return frameOf(id)?.evaluate(() => /** @type {any} */ (window).Game.stats.score);
  };
  try {
    await until(page, async () => (await launcher("screen")) === "shelf", "the shelf");
    await until(page, async () => (await boxText(/^shelf-by-/)).some((t) => /by Geoff/.test(t)), "Geoff's row");

    // The shelf: the original, and Geoff's version indented under it.
    const orig = await pickRow(/by TitanPlayz100/);
    const mine = await pickRow(/by Geoff/);
    assert.equal(mine, orig + 1, "Geoff's version sits right under teti");
    assert.ok((await box(`shelf-title-${mine}`)).x > (await box(`shelf-title-${orig}`)).x, "and is indented");

    // Geoff's version: G0, then Marathon to game over. Escape: G6 with the score.
    await press(page, "z");
    await until(page, async () => (await launcher("board")) === "G0", "G0");
    assert.ok((await boxText(/^howto-goal/)).some((t) => /keep your score/.test(t)));
    await press(page, "z");
    const s1 = await marathonToGameOver("teti-geoff");
    assert.ok(Number.isInteger(s1) && s1 > 0, `a score: ${s1}`);
    await press(page, "Escape");
    await until(page, async () => (await launcher("board")) === "G6", "G6");
    const words = async () => (await page.evaluate(() => /** @type {any} */ (window).launcher.boxes().flatMap((/** @type {any} */ b) => b.lines.map((/** @type {any} */ l) => l.text)))).join(" | ");
    await until(page, async () => /Score:/.test(await words()), "the score line");
    assert.match(await words(), new RegExp(`Score: ${s1}\\. A new best!`));

    // Play again, to game over again: the best is the better of the two.
    await press(page, "ArrowUp"); // "Play again" (G6 lights "Back to the shelf")
    await press(page, "z");
    const s2 = await marathonToGameOver("teti-geoff");
    await press(page, "Escape");
    await until(page, async () => (await launcher("board")) === "G6" && /Score:/.test(await words()), "G6 again");
    assert.match(await words(), s2 > s1 ? new RegExp(`Score: ${s2}\\. A new best!`) : new RegExp(`Score: ${s2}\\. Best: ${s1}\\.`));

    // Both plays logged with their scores; Geoff is a grown-up maker.
    const log = () => fs.readFileSync(path.join(data, "logs", "guest_play.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(log().map((r) => [r.guest_id, r.scores]), [["teti-geoff", [s1]], ["teti-geoff", [s2]]]);
    const geoff = JSON.parse(fs.readFileSync(path.join(data, "makers.json"), "utf8")).find((/** @type {any} */ m) => m.id === "geoff");
    assert.deepEqual([geoff.name, geoff.guest, geoff.grown_up], ["Geoff", false, true]);

    // The original still plays, and shows no score.
    await press(page, "z"); // Back to the shelf
    await until(page, async () => (await launcher("screen")) === "shelf", "the shelf");
    await pickRow(/by TitanPlayz100/);
    await press(page, "z");
    await until(page, async () => (await launcher("board")) === "G0", "G0");
    await press(page, "z");
    await marathonToGameOver("teti");
    await press(page, "Escape");
    await until(page, async () => (await launcher("board")) === "G6", "G6 for the original");
    await page.waitForTimeout(500);
    assert.doesNotMatch(await words(), /Score/);
    const last = log().at(-1);
    assert.deepEqual([last.guest_id, last.scores], ["teti", undefined]);
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
    service.stop();
  }
});
