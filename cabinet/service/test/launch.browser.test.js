// launch_on_cabinet against the real launcher (D344, D515): from the shelf; refused mid-game, saying so; over an
// after-game screen only once nobody has touched it, putting it away; and a refusal that names the screen.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseScript, plantSeed, runSteps, startServiceProcess } from "../scripts/drive.js";

const FIXTURE = path.resolve(import.meta.dirname, "../../../studio-kit/cli/fixtures/penguin-catch");
const TOKEN = "L".repeat(40);
const QUIET_MS = 1500;

let skip = "";
try {
  const { chromium } = await import("playwright");
  const b = await chromium.launch({ headless: true }).catch(() => chromium.launch({ headless: true, channel: "chrome" }));
  await b.close();
} catch (e) {
  skip = `no headless Chromium: ${String(/** @type {Error} */ (e).message).split("\n")[0]}`;
}

test("launch_on_cabinet: from the shelf, never mid-game, over an after-game screen once it's left alone", { skip: skip || false, timeout: 120_000 }, async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "gsa-launch-"));
  plantSeed(data, { state: "seen" });
  const service = /** @type {any} */ (await startServiceProcess({ replay: FIXTURE, data, pace: 10, args: ["--manager-token", TOKEN, "--examples", "--no-gate"] }));
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ headless: true, channel: "chrome" }));
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    await page.addInitScript((ms) => (/** @type {any} */ (window).launchQuietMs = ms), QUIET_MS);
    await page.goto(service.url);
    const run = (/** @type {string} */ s) => runSteps({ page, url: service.url, steps: parseScript(s), timeoutMs: 30_000 });
    const board = () => page.evaluate(() => /** @type {any} */ (window).launcher.board());
    let n = 0;
    const launch = async (/** @type {string} */ id) => {
      const r = await fetch(`${service.url}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name: "launch_on_cabinet", arguments: { id } } }) });
      return (await r.json()).result;
    };
    await run("wait S1");
    // From the shelf.
    const fromShelf = await launch("hello");
    assert.equal(fromShelf.isError, false, fromShelf.content[0].text);
    await run("wait G0");
    // Mid-game: refused, and it says so.
    await run("press a\nwait G1");
    const midGame = await launch("hello");
    assert.equal(midGame.isError, true);
    assert.match(midGame.content[0].text, /someone is playing/);
    assert.equal(await board(), "G1", "the game carried on");
    // Just after the game, with a key just pressed: refused, naming the screen and what to do.
    await run("press esc");
    await page.waitForFunction(() => /^G[2-6]$/.test(/** @type {any} */ (window).launcher.board()));
    const after = await board();
    const busy = await launch("hello");
    assert.equal(busy.isError, true);
    assert.match(busy.content[0].text, new RegExp(`after-game screen .*${after}`));
    assert.match(busy.content[0].text, /Try again in a minute/);
    assert.match(busy.content[0].text, /Don't drive it there with the cabinet's keys/);
    assert.equal(await board(), after);
    // Left alone: launch puts it away and says what it replaced.
    await page.waitForTimeout(QUIET_MS + 300);
    const quiet = await launch("hello");
    assert.equal(quiet.isError, false, quiet.content[0].text);
    assert.match(quiet.structuredContent.replaced, new RegExp(`put away the .*${after} screen`));
    await run("wait G0");
  } finally {
    await browser.close();
    service.stop();
  }
});
