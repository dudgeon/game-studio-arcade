// A cabinet with no keyboard (the Picade's profile) in headless Chromium, with only its own keys (D82): a new
// maker says their name or types it with the stick, and an idea can be typed with the stick too (D430-D432).
// Skips, with the reason, if there's no headless Chromium on this machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBrowser, parseScript, plantSeed, runSteps, startServiceProcess } from "../scripts/drive.js";

const FIXTURE = path.resolve(import.meta.dirname, "../../../studio-kit/cli/fixtures/penguin-catch");

let skip = "";
try {
  const { chromium } = await import("playwright");
  const b = await chromium.launch({ headless: true }).catch(() => chromium.launch({ headless: true, channel: "chrome" }));
  await b.close();
} catch (e) {
  skip = `no headless Chromium: ${String(/** @type {Error} */ (e).message).split("\n")[0]}`;
}

/**
 * The Picade's profile, so the service says there's no keyboard. `speech` is what /api/config says the cabinet
 * hears with: the service here still answers from the stub's queue, which `say` feeds.
 * @param {string | null} speech @param {(c: { page: any, run: (s: string) => Promise<any>, L: (what: string) => Promise<any>, text: (id: string) => Promise<string>, data: string, problems: string[] }) => Promise<void>} body
 */
async function withPicade(speech, body) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "gsa-saykeys-"));
  plantSeed(data, { state: "seen" });
  const service = /** @type {any} */ (await startServiceProcess({ replay: FIXTURE, data, pace: 10, args: ["--profile", "picade"] }));
  const { browser, page, problems } = await openBrowser(service.url);
  try {
    const config = await (await fetch(`${service.url}/api/config`)).json();
    assert.equal(config.keyboard, false, "the Picade's profile has no keyboard");
    if (speech) {
      await page.route("**/api/config", (/** @type {any} */ route) => route.fulfill({ json: { ...config, speech } }));
      await page.reload();
      await page.waitForFunction(() => /** @type {any} */ (window).launcher);
    }
    await body({
      page,
      data,
      problems,
      run: (script) => runSteps({ page, url: service.url, steps: parseScript(script), timeoutMs: 120_000 }),
      L: (what) => page.evaluate((/** @type {string} */ w) => /** @type {any} */ (window).launcher[w](), what),
      text: (id) => page.evaluate((/** @type {string} */ i) => /** @type {any} */ (window).launcher.boxes().find((/** @type {any} */ b) => b.id === i)?.text, id),
    });
  } finally {
    await browser.close();
    service.stop();
  }
}

const makers = (/** @type {string} */ data) => JSON.parse(fs.readFileSync(path.join(data, "makers.json"), "utf8")).map((/** @type {any} */ m) => m.name);

test("a new maker says their name; misheard, they type it with the stick; an idea can be typed with the stick too", { skip: skip || false, timeout: 300_000 }, async () => {
  await withPicade("moonshine", async ({ page, run, L, text, data, problems }) => {
    // Someone new starts on the mic, not on a typing screen the Picade can't use.
    await run(`
      wait shelf
      press a
      wait who
      press a
      wait say idle
    `);
    assert.equal(await text("say-message"), "Hold any button and say your name");
    assert.match(await text("hint"), /^ENT: type instead/);
    // Said, and misheard: the name is on screen to check, and "Type it" opens the keyboard.
    await run(`
      say Elena
      hold a 300
      wait say confirm
    `);
    assert.equal(await text("say-transcript"), "Elena");
    assert.equal(await text("say-type"), "Type it");
    await run(`
      press down
      press down
      down a
      wait say keys
      sleep 700
      up a
    `);
    assert.equal(await text("keys-field"), "", "the button that picked the tile, still held, types nothing");
    // A-l-i-n-a with the stick: Q is lit. A is under it; L is the end of that row.
    await run(`
      press down
      press a
      press left
      press a
      press up
      press left
      press a
      press down
      press down
      press left
      press a
      press a
      press b
      press up
      press left
      press left
      press left
      press left
      press left
      press a
    `);
    assert.equal(await text("keys-field"), "Alina");
    assert.equal(await text("keys-for"), "Your first name");
    assert.deepEqual(await L("faults"), []);
    // 1UP is done; the name is checked like a spoken one, then it's on to the coin check.
    await run(`
      press start
      wait say confirm
    `);
    assert.equal(await text("say-transcript"), "Alina");
    await run(`
      press a
      wait M3
    `);
    assert.deepEqual(makers(data), ["Alina"]);
    // The idea: ENT opens the keyboard on the talk screen; ESC goes back to the mic, ENT opens it again.
    await run(`
      press coin
      wait say idle
      press ent
      wait say keys
      press esc
      wait say idle
      press f1
      wait say keys
      press a
      press x
      press right
      press a
    `);
    assert.equal(await text("keys-field"), "qW");
    // F1 itself (a keyboard's, or the Manager's) is stopped before Chromium can open its Help page (D433).
    const stopped = await page.evaluate(() =>
      ["F1", "F13"].map((code) => {
        const down = !dispatchEvent(new KeyboardEvent("keydown", { code, key: code, cancelable: true }));
        dispatchEvent(new KeyboardEvent("keyup", { code, key: code }));
        return down;
      }),
    );
    assert.deepEqual(stopped, [true, true]);
    assert.equal(await L("phase"), "keys", "ENT pressed again on the Picade's keyboard changes nothing");
    await run(`
      press start
      wait say confirm
    `);
    assert.equal(await text("say-transcript"), "qW");
    assert.equal(await L("board"), "M6");
    assert.deepEqual(await L("faults"), [], "nothing overran, on any frame");
    assert.deepEqual(problems, []);
  });
});

test("where the cabinet can't hear and has no keyboard, a new name starts on the stick's keyboard", { skip: skip || false, timeout: 300_000 }, async () => {
  await withPicade(null, async ({ run, L, text, data, problems }) => {
    await run(`
      wait shelf
      press a
      wait who
      press a
      wait say keys
      press a
      press right
      press a
      press start
      wait say confirm
    `);
    assert.equal(await text("say-transcript"), "Qw");
    assert.equal(await text("say-again"), "Type it again");
    await run(`
      press down
      press a
      wait say keys
    `);
    assert.equal(await text("keys-field"), "");
    // ESC from a name's keyboard that was the first screen goes back to "Who's making?".
    await run(`
      press esc
      wait who
    `);
    assert.deepEqual(await L("faults"), []);
    assert.deepEqual(problems, []);
    assert.equal(fs.existsSync(path.join(data, "makers.json")), false, "no name was kept");
  });
});
