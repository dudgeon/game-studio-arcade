// The Wi-Fi screens in headless Chromium, with the cabinet's own keys (D82), against the real service and a
// pretend Wi-Fi (--wifi-demo): the hold that opens them, the list, the keyboard, a join, and back (D413, D414).
// Skips, with the reason, if there's no headless Chromium on this machine.
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

test("a grown-up holds ENT and COIN, picks a network, types its password with the stick, and joins", { skip: skip || false, timeout: 120_000 }, async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "gsa-wifi-"));
  plantSeed(data, { state: "seen" });
  const service = /** @type {any} */ (await startServiceProcess({ replay: FIXTURE, data, pace: 10, args: ["--wifi-demo"] }));
  const { browser, page, problems } = await openBrowser(service.url);
  const L = (/** @type {string} */ what) => page.evaluate((/** @type {string} */ w) => /** @type {any} */ (window).launcher[w](), what);
  const until = (/** @type {string} */ screen) => page.waitForFunction((/** @type {string} */ s) => /** @type {any} */ (window).launcher.screen() === s, screen, { timeout: 20_000 });
  const text = (/** @type {string} */ id) => page.evaluate((/** @type {string} */ i) => /** @type {any} */ (window).launcher.boxes().find((/** @type {any} */ b) => b.id === i)?.text, id);
  const tap = async (/** @type {string} */ key, n = 1) => {
    for (let i = 0; i < n; i++) {
      await page.keyboard.press(key, { delay: 40 });
      await page.waitForTimeout(30);
    }
  };
  try {
    await until("shelf");
    // COIN alone is still the pot's; ESC comes back.
    await tap("F2");
    await until("pot");
    await tap("Escape");
    await until("shelf");
    // A short hold does nothing.
    await page.keyboard.down("F1");
    await page.keyboard.down("F2");
    await page.waitForTimeout(700);
    assert.equal(await text("wifi-hold"), "Keep holding for Wi-Fi");
    await page.keyboard.up("F2");
    await page.keyboard.up("F1");
    await page.waitForTimeout(200);
    assert.equal(await L("screen"), "shelf");
    // The full hold opens the list.
    await page.keyboard.down("F1");
    await page.keyboard.down("F2");
    await until("wifi-list");
    await page.keyboard.up("F2");
    await page.keyboard.up("F1");
    await page.waitForFunction(() => /** @type {any} */ (window).launcher.boxes().some((/** @type {any} */ b) => b.id === "wifi-net-1"), null, { timeout: 20_000 });
    assert.equal(await text("wifi-status"), "On: Home Wi-Fi");
    assert.equal(await text("wifi-net-1"), "Home Wi-Fi Guest");
    // The second network asks for its password. "q" is lit: type q, w, e, r, t, y, u, i with the stick and A.
    await tap("ArrowDown");
    await tap("KeyZ");
    await until("wifi-keys");
    for (let i = 0; i < 8; i++) {
      await tap("KeyZ");
      await tap("ArrowRight");
    }
    assert.equal(await text("wifi-field"), "qwertyui");
    await tap("Enter"); // 1UP joins
    await until("wifi-result");
    assert.equal(await text("wifi-result"), "On Wi-Fi");
    assert.equal(await text("wifi-result-name"), "Home Wi-Fi Guest");
    await tap("KeyZ");
    await until("shelf");
    assert.deepEqual(await L("faults"), [], "nothing overran, on any frame");
    assert.deepEqual(problems, []);
    // The password is in no file the service keeps.
    const kept = fs.readdirSync(data, { recursive: true, encoding: "utf8" }).filter((f) => fs.statSync(path.join(data, f)).isFile());
    for (const f of kept) assert.ok(!fs.readFileSync(path.join(data, f), "utf8").includes("qwertyui"), `${f} holds the password`);
  } finally {
    if (process.env.WIFI_SHOT) await page.screenshot({ path: process.env.WIFI_SHOT });
    await browser.close();
    service.stop();
  }
});
