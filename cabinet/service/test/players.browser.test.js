// Guests played by a player (D380-D383), end to end in headless Chromium against the real
// service: a TIC-80 cart in TIC-80's web player and a homebrew ROM in RetroArch's web build.
// Each is on the shelf, draws, takes the cabinet's keys (D82), and Escape goes back to the
// shelf with the play logged. Skips if there's no headless Chromium.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBrowser, plantSeed, startServiceProcess } from "../scripts/drive.js";

const FIXTURE = path.resolve(import.meta.dirname, "../../../studio-kit/cli/fixtures/penguin-catch");
const SHORTLIST = path.resolve(import.meta.dirname, "../../../guest-shortlist");
const REPO_GUESTS = path.resolve(import.meta.dirname, "../../../guests");

let skip = "";
try {
  const { chromium } = await import("playwright");
  const b = await chromium.launch({ headless: true }).catch(() => chromium.launch({ headless: true, channel: "chrome" }));
  await b.close();
} catch (e) {
  skip = `no headless Chromium: ${String(/** @type {Error} */ (e).message).split("\n")[0]}`;
}

/** @param {any} page @param {() => Promise<boolean>} ok @param {string} what */
async function until(page, ok, what, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await ok().catch(() => false)) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** @param {any} page @param {string} key */
async function press(page, key, ms = 80) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(150);
}

/** The colours on the screen, sampled 64 by 48, sorted: the page decodes its own screenshot. @param {any} page @returns {Promise<number[]>} */
async function colours(page) {
  const png = (await page.screenshot()).toString("base64");
  return page.evaluate(async (/** @type {string} */ b64) => {
    const i = new Image();
    i.src = `data:image/png;base64,${b64}`;
    await i.decode();
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 48;
    const x = /** @type {CanvasRenderingContext2D} */ (c.getContext("2d"));
    x.imageSmoothingEnabled = false;
    x.drawImage(i, 0, 0, 64, 48);
    const d = x.getImageData(0, 0, 64, 48).data;
    const seen = new Set();
    for (let k = 0; k < d.length; k += 4) seen.add((d[k] << 16) | (d[k + 1] << 8) | d[k + 2]);
    return [...seen].sort((a, b) => a - b);
  }, png);
}

/** A TIC-80 cart of Lua code alone: one chunk, type 5. @param {string} code */
function ticCart(code) {
  const body = Buffer.from(code);
  const head = Buffer.alloc(4);
  head[0] = 5;
  head.writeUInt16LE(body.length, 1);
  return Buffer.concat([head, body]);
}

/** Start the service over a folder of guests and walk the shelf to one of them, into play. */
async function playGuest(/** @type {string} */ guestsDir, /** @type {string} */ title) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "gsa-player-flow-"));
  plantSeed(data, { state: "seen" });
  const service = /** @type {any} */ (await startServiceProcess({ replay: FIXTURE, data, pace: 10, args: ["--guests", guestsDir, "--no-gate"] }));
  const { browser, page, problems } = await openBrowser(service.url);
  const launcher = (/** @type {string} */ f) => page.evaluate((/** @type {string} */ f) => /** @type {any} */ (window).launcher[f](), f);
  await until(page, async () => (await launcher("screen")) === "shelf", "the shelf");
  const lit = async () => {
    const sel = await launcher("sel");
    const box = await page.evaluate((/** @type {number} */ n) => /** @type {any} */ (window).launcher.boxes().find((/** @type {any} */ b) => b.id === `shelf-title-${n}`), sel);
    return box ? box.lines.map((/** @type {any} */ l) => l.text).join(" ") : "";
  };
  for (let i = 0; i < 12 && !(await lit()).includes(title); i++) await press(page, "ArrowDown");
  assert.ok((await lit()).includes(title), `${title} is on the shelf`);
  await press(page, "z");
  await until(page, async () => (await launcher("board")) === "G0", "how to play (G0)");
  await press(page, "z");
  await until(page, async () => (await launcher("screen")) === "play", "play");
  assert.ok(await page.evaluate(() => document.activeElement?.tagName === "IFRAME"), "the game has focus");
  /** Escape, then the guest post-game board, back to the shelf, and the play in the log. */
  const leave = async (/** @type {string} */ id) => {
    await press(page, "Escape");
    await until(page, async () => (await launcher("board")) === "G6", "the guest post-game board");
    assert.equal(page.frames().length, 1, "the game is gone");
    await press(page, "z");
    await until(page, async () => (await launcher("screen")) === "shelf", "back to the shelf");
    const logFile = path.join(data, "logs", "guest_play.jsonl");
    await until(page, async () => fs.existsSync(logFile), "the play log");
    const [play] = fs.readFileSync(logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(play.guest_id, id);
    assert.equal(play.ended, "star");
    assert.ok(play.duration_s > 1);
  };
  return { page, problems, leave, stop: async () => (await browser.close(), service.stop()) };
}

test("a TIC-80 cart: on the shelf, draws, the cabinet's keys are its buttons, Escape back to the shelf, play logged (D381)", { skip: skip || false, timeout: 120_000 }, async () => {
  // A cart that shows which buttons are down, in TIC-80's own player from a shortlisted guest.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gsa-tic-"));
  const play = path.join(dir, "keys", "play");
  fs.cpSync(path.join(REPO_GUESTS, "grow-quickly", "play"), play, { recursive: true });
  fs.writeFileSync(path.join(play, "cart.tic"), ticCart("-- script: lua\nfunction TIC()\n cls(0)\n rect(0,0,240,8,12)\n for i=0,7 do if btn(i) then rect(i*30,20,30,100,i+1) end end\nend\n"));
  fs.writeFileSync(path.join(dir, "keys", "guest.json"), JSON.stringify({ id: "keys", title: "Key Test", version: "1", kind: "web", entry: "index.html", player: { name: "tic80", script: "lua" } }));
  const g = await playGuest(dir, "Key Test");
  try {
    const idle = await (async () => {
      /** @type {number[]} */
      let c = [];
      // The player's own start-up shows other colours first: wait for the cart's picture, twice the same.
      let before = "";
      await until(
        g.page,
        async () => {
          c = await colours(g.page);
          const same = JSON.stringify(c) === before;
          before = JSON.stringify(c);
          await g.page.waitForTimeout(300);
          return same && c.length === 3; // the border, the cart's background, and its bar
        },
        "TIC-80 to draw the cart (not one flat colour)",
      );
      return c;
    })();
    /** The colours while a key is held. @param {string} key */
    const held = async (key) => {
      await g.page.keyboard.down(key);
      await g.page.waitForTimeout(400);
      const c = await colours(g.page);
      await g.page.keyboard.up(key);
      await g.page.waitForTimeout(200);
      return JSON.stringify(c);
    };
    const none = JSON.stringify(idle);
    // Stick, then A B X Y on Z X C V (D82): each lights its own button. C and V are TIC-80's X and Y.
    const seen = new Set([none]);
    for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "z", "x", "c", "v"]) {
      const c = await held(key);
      assert.ok(!seen.has(c), `${key} is a button of its own: ${c} after ${[...seen].join(" ")}`);
      seen.add(c);
    }
    // Keys the cabinet doesn't have for games never reach TIC-80: its menu and console stay shut.
    for (const key of ["a", "s", "F1", "Enter", "Backquote"]) assert.equal(await held(key), none, `${key} does nothing`);
    await g.leave("keys");
    assert.deepEqual(g.problems, []);
  } finally {
    await g.stop();
  }
});

test("a homebrew ROM in RetroArch: on the shelf, draws, START reaches the game, Escape back to the shelf, play logged (D382)", { skip: skip || false, timeout: 120_000 }, async () => {
  const g = await playGuest(SHORTLIST, "Libbet");
  try {
    /** @type {number[]} */
    let title = [];
    await until(g.page, async () => (title = await colours(g.page)).length > 1, "RetroArch to draw (not one flat colour)");
    // Keys that aren't the cabinet's never reach RetroArch: no menu on F1, no pause on P.
    await press(g.page, "F1");
    await press(g.page, "p");
    // The copyright screen, the instructions, then the puzzle: START moves it on.
    await until(
      g.page,
      async () => {
        await press(g.page, "Enter");
        await g.page.waitForTimeout(600);
        return (await colours(g.page)).length > 4;
      },
      "the puzzle after START",
    );
    await g.leave("libbet");
    assert.deepEqual(g.problems, []);
  } finally {
    await g.stop();
  }
});
