// g.ai (D480, D486): a game always gets a line or a choice in the same frame; a
// headless run has nobody to ask, so it runs on the cart's fallbacks and repeats;
// a host's answers are used when they come, and anything odd in one is dropped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { headless } from "../src/headless.js";
import { createMachine } from "../src/machine.js";

const JOKES = ["Why did the duck cross the road? To prove he wasn't chicken!", "What time does a duck wake up? At the quack of dawn!", "What do ducks eat with soup? Quackers!"];
const MOODS = ["sneaky", "angry", "scared"];

/** A cart that takes a line and a pick every update. @param {(g: any) => void} [extra] */
const duck = (extra) => ({
  init(g) {
    g.ai.lines("joke", { ask: "A short, silly duck joke for a kid.", fallback: JOKES });
    g.ai.choice("mood", { ask: "How does the boss act next?", options: MOODS });
    extra?.(g);
    return { said: [], moods: [], rolls: [] };
  },
  update(g, s) {
    s.said.push(g.ai.next("joke"));
    s.moods.push(g.ai.pick("mood", { round: s.said.length, last: s.moods.at(-1) ?? "sneaky" }));
    s.rolls.push(g.rand());
  },
  draw() {},
  probe: (_g, s) => s,
});

test("headless: only fallbacks, every one before a repeat, never the same twice running, and the same each run", async () => {
  const run = async (/** @type {number} */ seed) => {
    const t = await headless(duck(), { seed });
    await t.step(30);
    return /** @type {any} */ (await t.probe());
  };
  const a = await run(7);
  assert.ok(a.said.every((/** @type {string} */ l) => JOKES.includes(l)));
  for (let i = 0; i < 30; i += 3) assert.deepEqual([...a.said.slice(i, i + 3)].sort(), [...JOKES].sort(), "each bag of three is all three");
  for (let i = 1; i < 30; i++) assert.notEqual(a.said[i], a.said[i - 1]);
  assert.ok(a.moods.every((/** @type {string} */ m) => MOODS.includes(m)));
  assert.ok(new Set(a.moods).size > 1, "the seeded random does vary");
  assert.deepEqual(await run(7), a, "the same seed plays the same");
  assert.notDeepEqual((await run(8)).moods, a.moods);
});

test("using g.ai doesn't change what g.rand gives the game", async () => {
  const plain = { init: () => ({ rolls: [] }), update: (/** @type {any} */ g, /** @type {any} */ s) => void s.rolls.push(g.rand()), draw() {}, probe: (/** @type {any} */ _g, /** @type {any} */ s) => s };
  const a = await headless(plain, { seed: 3 });
  const b = await headless(duck(), { seed: 3 });
  await a.step(10);
  await b.step(10);
  assert.deepEqual(/** @type {any} */ (await b.probe()).rolls, /** @type {any} */ (await a.probe()).rolls);
});

test("a host's answers: fresh lines are dealt first, a pick is used once, and one call is in the air per ask", () => {
  const m = createMachine({ cart: duck(), seed: 1 });
  const first = m.drainAi();
  assert.deepEqual(first.map((a) => [a.kind, a.name]), [["lines", "joke"], ["choice", "mood"]]);
  assert.equal(first[0].ask, "A short, silly duck joke for a kid.");
  assert.equal(first[0].max, 80);
  assert.deepEqual(first[1].options, MOODS);
  for (let i = 0; i < 5; i++) m.update();
  assert.deepEqual(m.drainAi(), [], "nothing more is asked while the first calls are out");

  m.aiDeliver({ id: first[0].id, ok: true, lines: ["Quack one", "Quack two", "Quack three", "Quack four", "Quack five"] });
  m.aiDeliver({ id: first[1].id, ok: true, pick: "scared" });
  m.update();
  const s = /** @type {any} */ (m.probe());
  assert.equal(s.said.at(-1), "Quack one");
  assert.equal(s.moods.at(-1), "scared");
  const again = m.drainAi();
  assert.deepEqual(again.map((a) => a.kind), ["choice"], "the pick's facts go out for next time; lines aren't low yet");
  assert.deepEqual(again[0].facts, { round: 6, last: s.moods.at(-2) });
  m.update();
  assert.deepEqual(m.drainAi(), [], "four left: not low yet");
  m.update();
  assert.deepEqual(m.drainAi().map((a) => a.kind), ["lines"], "three left: ask for more");
  for (let i = 0; i < 2; i++) m.update();
  assert.deepEqual(/** @type {any} */ (m.probe()).said.slice(-4), ["Quack two", "Quack three", "Quack four", "Quack five"]);
  m.update();
  assert.ok(JOKES.includes(/** @type {any} */ (m.probe()).said.at(-1)), "fresh ones used up: back to the fallbacks");
});

test("an answer that isn't what was asked for is dropped, and a failed call waits ten seconds before another", () => {
  const m = createMachine({ cart: duck(), seed: 1 });
  const [lines, choice] = m.drainAi();
  m.aiDeliver({ id: lines.id, ok: true, lines: ["fine line", 7, "", "café line", "x".repeat(81), null] });
  m.aiDeliver({ id: choice.id, ok: true, pick: "furious" });
  m.aiDeliver({ id: 999, ok: true, lines: ["from nowhere"] });
  m.aiDeliver(/** @type {any} */ (null));
  m.update();
  assert.equal(/** @type {any} */ (m.probe()).said.at(-1), "fine line");
  assert.ok(MOODS.includes(/** @type {any} */ (m.probe()).moods.at(-1)));
  const next = m.drainAi();
  assert.deepEqual(next.map((a) => a.kind), ["lines"], "the choice that failed isn't asked again yet");
  m.aiDeliver({ id: next[0].id, ok: false });
  for (let i = 0; i < 598; i++) m.update();
  assert.deepEqual(m.drainAi(), []);
  for (let i = 0; i < 3; i++) m.update();
  assert.deepEqual(m.drainAi().map((a) => a.kind).sort(), ["choice", "lines"]);
});

test("declarations are checked in init, so a playtest catches a bad one", async () => {
  const bad = (/** @type {(g: any) => void} */ fn, /** @type {RegExp} */ re) => assert.rejects(headless(duck(fn)), re);
  await bad((g) => g.ai.lines("more", { ask: "A cheer.", fallback: ["Yay!", "Woo!"] }), /at least 3 lines/);
  await bad((g) => g.ai.lines("more", { ask: "A cheer.", fallback: ["Yay!", "Woo!", "x".repeat(81)] }), /at most 80 characters/);
  await bad((g) => g.ai.lines("more", { ask: "A cheer.", fallback: ["Yay!", "Woo!", "Olé!"] }), /plain text/);
  await bad((g) => g.ai.lines("joke", { ask: "Again.", fallback: JOKES }), /declared twice/);
  await bad((g) => g.ai.lines("Bad Name", { ask: "A cheer.", fallback: JOKES }), /short name/);
  await bad((g) => g.ai.lines("more", { ask: "", fallback: JOKES }), /needs ask/);
  await bad((g) => g.ai.lines("more", { ask: "A cheer.", fallback: JOKES, max: 500 }), /20 to 120/);
  await bad((g) => g.ai.choice("way", { ask: "Which way?", options: ["left"] }), /2 to 8 different/);
  await bad((g) => g.ai.choice("way", { ask: "Which way?", options: ["left", "left"] }), /2 to 8 different/);
  await bad((g) => {
    for (let i = 0; i < 7; i++) g.ai.choice(`c${i}`, { ask: "Which?", options: ["a", "b"] });
  }, /at most 8/);
});

test("voice asks (D489): declared with a talk button, an action is heard once, and anything else is dropped", async () => {
  const cart = {
    init(/** @type {any} */ g) {
      g.ai.voice("spell", { ask: "Which spell does the wizard cast?", actions: ["fire", "ice", "heal"], hold: "y" });
      return { cast: /** @type {string[]} */ ([]) };
    },
    update(/** @type {any} */ g, /** @type {any} */ s) {
      const a = g.ai.heard("spell");
      if (a) s.cast.push(a);
    },
    draw() {},
    probe: (/** @type {any} */ _g, /** @type {any} */ s) => s,
  };
  const m = createMachine({ cart, seed: 1 });
  assert.deepEqual(m.aiVoices(), [{ kind: "voice", name: "spell", ask: "Which spell does the wizard cast?", actions: ["fire", "ice", "heal"], hold: "y" }]);
  assert.deepEqual(m.drainAi(), [], "a voice ask asks nothing on its own");
  m.update();
  m.aiHear({ name: "spell", action: "ice" });
  m.update();
  m.update();
  for (const odd of [{ name: "spell", action: "lightning" }, { name: "spell", action: "none" }, { name: "nope", action: "fire" }, { name: "spell", action: 7 }, /** @type {any} */ (null)]) m.aiHear(odd);
  m.update();
  assert.deepEqual(/** @type {any} */ (m.probe()).cast, ["ice"]);

  // In a playtest nothing is ever heard, so a game needs its buttons too.
  const t = await headless(cart);
  await t.step(120);
  assert.deepEqual(/** @type {any} */ (await t.probe()).cast, []);

  const bad = (/** @type {any} */ o, /** @type {RegExp} */ re) => assert.rejects(headless({ ...cart, init: (/** @type {any} */ g) => (g.ai.voice("v", o), {}) }), re);
  await bad({ ask: "Which?", actions: ["fire"], hold: "y" }, /2 to 8 different/);
  await bad({ ask: "Which?", actions: ["fire", "none"], hold: "y" }, /not "none"/);
  await bad({ ask: "Which?", actions: ["fire", "ice"], hold: "start" }, /button to hold while talking/);
  await bad({ ask: "Which?", actions: ["fire", "ice"] }, /button to hold while talking/);
  await assert.rejects(
    headless({ ...cart, init: (/** @type {any} */ g) => (g.ai.voice("one", { ask: "Which?", actions: ["a", "b"], hold: "x" }), g.ai.voice("two", { ask: "Which?", actions: ["a", "b"], hold: "x" }), {}) }),
    /already uses the x button/,
  );
});

test("chat (D495): a character's line is given once; with no line to give, one of the cart's own; never anything odd", async () => {
  const OWN = ["Hmph. Ask me later.", "The bridge is closed for lunch.", "My beard is tired of talking."];
  const cart = {
    init(/** @type {any} */ g) {
      g.ai.chat("wizard", { who: "A grumpy but kind wizard who guards a bridge.", fallback: OWN, hold: "x", max: 60 });
      g.ai.voice("spell", { ask: "Which spell?", actions: ["fire", "ice"], hold: "y" });
      return { lines: /** @type {string[]} */ ([]) };
    },
    update(/** @type {any} */ g, /** @type {any} */ s) {
      const l = g.ai.reply("wizard");
      if (l) s.lines.push(l);
    },
    draw() {},
    probe: (/** @type {any} */ _g, /** @type {any} */ s) => s,
  };
  const m = createMachine({ cart, seed: 1 });
  assert.deepEqual(m.aiVoices(), [
    { kind: "chat", name: "wizard", who: "A grumpy but kind wizard who guards a bridge.", max: 60, hold: "x" },
    { kind: "voice", name: "spell", ask: "Which spell?", actions: ["fire", "ice"], hold: "y" },
  ]);
  assert.deepEqual(m.drainAi(), [], "a chat asks nothing until the player talks");
  m.aiHear({ name: "wizard", reply: "None shall pass without a riddle!" });
  m.update();
  m.update();
  assert.deepEqual(/** @type {any} */ (m.probe()).lines, ["None shall pass without a riddle!"]);
  // No line from the cabinet (offline, held back): the character says one of its own.
  for (let i = 0; i < 3; i++) {
    m.aiHear({ name: "wizard", fallback: true });
    m.update();
  }
  assert.deepEqual([.../** @type {any} */ (m.probe()).lines.slice(1)].sort(), [...OWN].sort());
  // A line that's too long, not plain, or not a string never reaches the game as it is.
  for (const odd of ["x".repeat(61), "café time", 7, ""]) {
    m.aiHear({ name: "wizard", reply: odd });
    m.update();
    assert.ok(OWN.includes(/** @type {any} */ (m.probe()).lines.at(-1)), String(odd));
  }
  const before = /** @type {any} */ (m.probe()).lines.length;
  m.aiHear({ name: "wizard" });
  m.aiHear({ name: "wizard", action: "fire" });
  m.aiHear({ name: "nobody", reply: "hello" });
  m.update();
  assert.equal(/** @type {any} */ (m.probe()).lines.length, before, "nothing to say: nothing said");

  const t = await headless(cart);
  await t.step(120);
  assert.deepEqual(/** @type {any} */ (await t.probe()).lines, [], "in a playtest nobody talks");

  const bad = (/** @type {any} */ o, /** @type {RegExp} */ re) => assert.rejects(headless({ ...cart, init: (/** @type {any} */ g) => (g.ai.chat("c", o), {}) }), re);
  await bad({ who: "", fallback: OWN, hold: "x" }, /needs who/);
  await bad({ who: "A cat.", fallback: OWN.slice(0, 2), hold: "x" }, /at least 3 lines/);
  await bad({ who: "A cat.", fallback: OWN, hold: "x", max: 500 }, /40 to 160/);
  await bad({ who: "A cat.", fallback: OWN, hold: "start" }, /button to hold while talking/);
  await assert.rejects(
    headless({ ...cart, init: (/** @type {any} */ g) => (g.ai.voice("v", { ask: "Which?", actions: ["a", "b"], hold: "x" }), g.ai.chat("c", { who: "A cat.", fallback: OWN, hold: "x" }), {}) }),
    /already uses the x button/,
  );
});

test("outside init nothing can be declared, an undeclared ask is an error, and facts can't carry free text", async () => {
  const late = { init: () => ({}), update: (/** @type {any} */ g) => g.ai.lines("joke", { ask: "A joke.", fallback: JOKES }), draw() {} };
  await assert.rejects((await headless(late)).step(1), /belongs in init/);
  const m = createMachine({ cart: duck(), seed: 1 });
  assert.throws(() => m.g.ai.next("nope"), /isn't declared/);
  assert.throws(() => m.g.ai.pick("joke"), /isn't declared/);
  assert.throws(() => m.g.ai.pick("mood", { said: "anything a player typed" }), /number, true\/false or one of this choice's options/);
  assert.throws(() => m.g.ai.pick("mood", { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9 }), /at most 8/);
  assert.ok(MOODS.includes(m.g.ai.pick("mood", { won: true, score: 12, last: "angry" })));
  assert.ok(Object.isFrozen(m.g.ai));
});
