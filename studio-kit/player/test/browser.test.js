// The whole loop in headless Chromium: list → play → ★ → you-check → logs.
// Keyboard and a fake gamepad. Skips (with the reason) if Playwright's
// Chromium isn't installed on this machine.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { W, H } from "@game-studio-arcade/runtime";
import { startPlayer } from "../src/server.js";
import { makeData, readRecords } from "./helpers.js";

/** @type {any} */
let browser = null;
let skip = "";
try {
  const { chromium } = await import("playwright");
  // Playwright's own headless shell if it's installed, else the system
  // Chrome, still headless (no window, no focus stealing). Never installs one.
  browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ headless: true, channel: "chrome" }));
} catch (e) {
  skip = `no headless Chromium: ${String(/** @type {Error} */ (e).message).split("\n")[0]}`;
}

/** @type {ReturnType<typeof makeData>} */
let data;
/** @type {Awaited<ReturnType<typeof startPlayer>>} */
let s;
before(async () => {
  data = makeData();
  s = await startPlayer({ port: 0, libraryDir: data.carts, logsDir: data.logs, checker: "G" });
});
after(async () => {
  await browser?.close();
  await s?.close();
  data?.cleanup();
});

/** A page whose navigator.getGamepads() returns window.__pads (set from the test). */
async function openPage() {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    /** @type {any} */ (window).__pads = [null, null];
    Object.defineProperty(navigator, "getGamepads", { value: () => /** @type {any} */ (window).__pads });
  });
  const page = await ctx.newPage();
  /** @type {string[]} */
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(`${s.url}/`);
  await page.waitForFunction(() => /** @type {any} */ (window).player?.view === "list" && document.querySelectorAll("#carts button").length > 0);
  return { page, ctx, pageErrors };
}

/** @param {any} page */
const view = (page) => page.evaluate(() => /** @type {any} */ (window).player.view);
/** @param {any} page */
const focused = (page) => page.evaluate(() => /** @type {HTMLElement} */ (document.activeElement)?.dataset?.cart ?? document.activeElement?.textContent);

/** Set fake pad 0's pressed buttons (standard mapping indices), then let a few frames pass. */
async function pad(page, pressed) {
  await page.evaluate((p) => {
    /** @type {any} */ (window).__pads = [{ buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: p.includes(i) })), axes: [0, 0] }, null];
  }, pressed);
  await page.waitForTimeout(80);
}

test("keyboard: play a cart, leave with ★, answer its you-check rules, and it's logged", { skip: skip || false }, async () => {
  const { page, ctx, pageErrors } = await openPage();
  assert.equal(await focused(page), "smile", "the newest cart is selected first");
  assert.match(await page.textContent("#carts"), /Smile.*2 to check/s);

  await page.keyboard.press("KeyZ"); // A: play
  await page.waitForFunction(() => /** @type {any} */ (window).player.host?.state === "ready");
  assert.equal(await view(page), "play");

  // Size comes from the runtime's host, not the player (D70).
  const box = await page.evaluate(() => {
    const host = /** @type {any} */ (window).player.host;
    const r = host.iframe.getBoundingClientRect();
    return { w: r.width, h: r.height, k: host.scale };
  });
  assert.deepEqual(box, { w: W * box.k, h: H * box.k, k: box.k });
  assert.ok(box.k >= 2, `scaled up: x${box.k}`);

  await page.keyboard.down("ArrowRight");
  await page.waitForFunction(() => /** @type {any} */ (window).player.host.ticks > 30);
  await page.keyboard.up("ArrowRight");
  await page.keyboard.press("Digit1"); // P2's A: ignored with one controller (D111)
  assert.equal(await page.evaluate(() => /** @type {any} */ (window).player.host.players), 1);
  await page.keyboard.press("Escape"); // ★
  await page.waitForFunction(() => /** @type {any} */ (window).player.view === "check");

  assert.match(await page.textContent("#check-rule"), /sparkles look pretty/);
  assert.match(await page.textContent("#check-step"), /Check 1 of 2 · R2/);
  await page.keyboard.press("KeyZ"); // Yes is focused first
  await page.waitForFunction(() => document.getElementById("check-step")?.textContent?.includes("R4"));
  await page.fill("#check-note", "a bit loud");
  await page.click('button[data-answer="no"]');
  await page.waitForFunction(() => /** @type {any} */ (window).player.view === "list");
  await page.waitForFunction(() => document.querySelector("#carts")?.textContent?.includes("checked"));

  const plays = readRecords(data.logs, "play");
  assert.equal(plays.length, 1);
  const [play] = plays;
  assert.equal(play.cart_id, "smile");
  assert.equal(play.ended, "star");
  assert.deepEqual(play.sides, ["p1"]);
  assert.ok(play.ticks > 30, `ticks ${play.ticks}`);
  assert.equal(play.early_quit, true);
  assert.equal(play.errors, 0);

  const checks = readRecords(data.logs, "you_check");
  assert.equal(checks.length, 1);
  assert.equal(checks[0].play_id, play.id);
  assert.deepEqual(
    checks[0].answers.map((a) => [a.rule, a.answer, a.said]),
    [
      ["R2", "yes", null],
      ["R4", "no", "a bit loud"],
    ],
  );

  // Answered now: the next play goes straight back to the list.
  await page.keyboard.press("KeyZ");
  await page.waitForFunction(() => /** @type {any} */ (window).player.host?.state === "ready");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => /** @type {any} */ (window).player.view === "list");
  await page.waitForFunction(() => document.querySelector("#carts")?.textContent?.includes("2 plays"));

  // X asks again any time; B is "Later" and logs nothing.
  await page.keyboard.press("KeyC");
  assert.equal(await view(page), "check");
  await page.keyboard.press("KeyX");
  await page.waitForFunction(() => /** @type {any} */ (window).player.view === "list");
  assert.equal(readRecords(data.logs, "you_check").length, 1);
  assert.deepEqual(pageErrors, []);
  await ctx.close();
});

test("a cart that fails to start shows why, and A goes back", { skip: skip || false }, async () => {
  const { page, ctx } = await openPage();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  assert.equal(await focused(page), "broken");
  const before = readRecords(data.logs, "play").length;
  await page.keyboard.press("KeyZ");
  await page.waitForSelector("#play-error:not([hidden])");
  assert.match(await page.textContent("#play-error-text"), /broken on purpose/);
  await page.keyboard.press("KeyZ");
  await page.waitForFunction(() => /** @type {any} */ (window).player.view === "list");
  const last = readRecords(data.logs, "play").at(-1);
  assert.equal(last.cart_id, "broken");
  assert.equal(last.ended, "back");
  assert.ok(last.errors >= 1);
  await ctx.close();
});

test("gamepad: stick and A in the menu, guide leaves the game, and the pad's side is logged", { skip: skip || false }, async () => {
  const { page, ctx } = await openPage();
  await pad(page, [13]); // d-pad down
  await pad(page, []);
  assert.equal(await focused(page), "bare");
  await pad(page, [0]); // A
  await pad(page, []);
  await page.waitForFunction(() => /** @type {any} */ (window).player.host?.state === "ready");
  await page.waitForFunction(() => /** @type {any} */ (window).player.host.ticks > 10);
  await pad(page, [16]); // guide = ★
  await page.waitForFunction(() => /** @type {any} */ (window).player.view === "list");
  await pad(page, []);
  assert.equal(await view(page), "list", "the ★ that left the game doesn't also act in the menu");
  const last = readRecords(data.logs, "play").at(-1);
  assert.equal(last.cart_id, "bare");
  assert.equal(last.ended, "star");
  assert.deepEqual(last.sides, ["p1"]);
  await ctx.close();
});

test("--players 2 gives the cart a second controller, and P2's keys count (D110)", { skip: skip || false }, async () => {
  const d = makeData();
  const s2 = await startPlayer({ port: 0, libraryDir: d.carts, logsDir: d.logs, players: 2 });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  try {
    const page = await ctx.newPage();
    await page.goto(`${s2.url}/?cart=bare`);
    await page.waitForFunction(() => /** @type {any} */ (window).player?.host?.state === "ready");
    assert.equal(await page.evaluate(() => /** @type {any} */ (window).player.host.players), 2);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Digit1");
    await page.waitForFunction(() => /** @type {any} */ (window).player.host.ticks > 10);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => /** @type {any} */ (window).player.view === "list");
    assert.match(await page.textContent("#list-sub"), /2 controllers/);
    assert.deepEqual(readRecords(d.logs, "play")[0].sides, ["p1", "p2"]);
  } finally {
    await ctx.close();
    await s2.close();
    d.cleanup();
  }
});
