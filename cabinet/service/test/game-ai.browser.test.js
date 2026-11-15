// g.ai end to end in headless Chromium (D480): a cart in its sandboxed frame asks, the
// runtime host hands the ask to the launcher's game-ai.js, the real service answers with
// a stand-in model, and the fresh line and pick reach the cart. Also: the frame itself
// can't reach the service. Skips, with the reason, if there's no headless Chromium.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readLog } from "@game-studio-arcade/studio-cli/src/log.js";
import { createGameAi } from "../src/game-ai.js";
import { playTracker } from "../src/gate.js";
import { makersStore } from "../src/makers.js";
import { startService } from "../src/server.js";
import { stubSpeech } from "../src/speech.js";

let skip = "";
/** @type {any} */
let chromium = null;
try {
  ({ chromium } = await import("playwright"));
  const b = await chromium.launch({ headless: true }).catch(() => chromium.launch({ headless: true, channel: "chrome" }));
  await b.close();
} catch (e) {
  skip = `no headless Chromium: ${String(/** @type {Error} */ (e).message).split("\n")[0]}`;
}

const GAME = `export default {
  init(g) {
    g.ai.lines("joke", { ask: "A short, silly duck joke for a kid.", fallback: ["Fallback one", "Fallback two", "Fallback three"], max: 60 });
    g.ai.choice("mood", { ask: "How does the boss act next?", options: ["sneaky", "angry", "scared"] });
    g.ai.voice("spell", { ask: "Which spell does the wizard cast?", actions: ["fire", "ice"], hold: "y" });
    return { said: [], moods: [], reached: "untried", cast: [] };
  },
  update(g, s) {
    const spell = g.ai.heard("spell");
    if (spell) s.cast.push(spell);
    if (g.frame % 30 === 0) { s.said.push(g.ai.next("joke")); s.moods.push(g.ai.pick("mood", { round: s.said.length })); }
    if (g.frame === 5) {
      try { fetch("/api/game-ai", { method: "POST", body: "{}" }).then((r) => (s.reached = "status " + r.status), () => (s.reached = "blocked")); } catch { s.reached = "blocked"; }
    }
  },
  draw(g) { g.cls(1); },
  probe(g, s) { return s; },
};
`;

test("a cart's asks reach the service through the launcher and fresh answers reach the cart; the frame can't call the service", { skip: skip || false, timeout: 60_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gsa-game-ai-web-"));
  const carts = path.join(dir, "carts");
  fs.mkdirSync(path.join(carts, "duck-dash"), { recursive: true });
  fs.writeFileSync(path.join(carts, "duck-dash", "game.js"), GAME);
  fs.writeFileSync(path.join(carts, "duck-dash", "cart.json"), JSON.stringify({ id: "duck-dash", title: "Duck Dash", players: 1, version: 3 }));
  /** @type {any[]} */
  const asked = [];
  const model = async (/** @type {any} */ a) => {
    asked.push(a);
    return { tokens: { input: 300, output: 100 }, cost: 0.00008, ...(a.kind === "lines" ? { lines: ["Fresh quack one", "Fresh quack two", "A line that says shit", "Fresh quack three"] } : { pick: a.kind === "voice" ? "ice" : "scared" }) };
  };
  const speech = stubSpeech();
  const plays = playTracker();
  plays.set(true, "duck-dash");
  const s = await startService({ studio: /** @type {any} */ ({}), makers: makersStore({ file: path.join(dir, "makers.json") }), speech, libraryDir: carts, logsDir: path.join(dir, "logs"), plays, gameAi: createGameAi({ logsDir: path.join(dir, "logs"), keepDir: path.join(dir, "game-ai"), model }), port: 0 });
  const browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ headless: true, channel: "chrome" }));
  try {
    const page = await browser.newPage();
    await page.goto(`${s.url}/api/config`);
    await page.evaluate(async () => {
      // Paths on the service, not files here: kept in variables so the type-check doesn't look for them.
      const [hostJs, aiJs] = ["/runtime/src/host.js", "/launcher/game-ai.js"];
      const { createHost } = await import(hostJs);
      const { gameAiFor, voiceFor } = await import(aiJs);
      const w = /** @type {any} */ (window);
      w.host = createHost({ container: document.body, cartUrl: "/carts/duck-dash/game.js", persist: false, ai: gameAiFor("duck-dash", "pl_web"), voice: voiceFor("duck-dash", "pl_web", document.body) });
      await w.host.ready;
    });
    const probe = () => page.evaluate(() => /** @type {any} */ (window).host.test.probe());
    let state = await probe();
    const until = Date.now() + 20_000;
    while (!(state.said.some((/** @type {string} */ l) => l.startsWith("Fresh")) && state.moods.includes("scared") && state.reached !== "untried") && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 100));
      state = await probe();
    }
    assert.ok(state.said.some((/** @type {string} */ l) => l.startsWith("Fresh")), `a fresh line reached the cart: ${JSON.stringify(state.said)}`);
    assert.ok(state.moods.includes("scared"), "and the model's pick");
    assert.ok(!state.said.some((/** @type {string} */ l) => /shit/.test(l)), "a line the word list stops never reaches the cart");
    assert.notEqual(state.reached, "status 200", `the cart frame can't use the service itself (${state.reached})`);
    assert.deepEqual(asked[0], { kind: "lines", name: "joke", ask: "A short, silly duck joke for a kid.", max: 60 });
    assert.ok(asked.some((a) => a.kind === "choice" && a.facts?.round >= 1), "a pick's facts went with its ask");
    // Voice (D489): hold the game's talk button and speak. The cabinet's own sign shows while the mic is on,
    // and the cart gets the action, not the words. A tap is thrown away.
    speech.feed?.({ text: "freeze that duck" });
    await page.keyboard.down("KeyV");
    await page.waitForFunction(() => document.body.textContent?.includes("LISTENING"), null, { timeout: 5000 });
    await page.waitForTimeout(500);
    await page.keyboard.up("KeyV");
    for (const end = Date.now() + 10_000; !(state = await probe()).cast.length && Date.now() < end; ) await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(state.cast, ["ice"]);
    assert.equal(await page.evaluate(() => document.body.textContent?.includes("LISTENING")), false, "the sign goes when the mic does");
    assert.ok(!JSON.stringify(state).includes("freeze"), "the words never reach the cart");
    speech.feed?.({ text: "this was only a tap" });
    await page.keyboard.down("KeyV");
    await page.waitForTimeout(80);
    await page.keyboard.up("KeyV");
    await page.waitForTimeout(600);
    assert.deepEqual((await probe()).cast, ["ice"], "a tap does nothing");
    const talk = readLog(path.join(dir, "logs", "game_talk.jsonl"));
    assert.deepEqual(talk.map((t) => [t.cart_id, t.play_id, t.kind, t.said, t.action, t.outcome]), [["duck-dash", "pl_web", "voice", "freeze that duck", "ice", "heard"]]);

    const log = readLog(path.join(dir, "logs", "game_ai.jsonl"));
    assert.ok(log.length >= 2);
    assert.deepEqual([log[0].cart_id, log[0].cart_version, log[0].play_id, log[0].outcome, log[0].dropped], ["duck-dash", 3, "pl_web", "fresh", 1]);
  } finally {
    await browser.close();
    await s.close();
  }
});
