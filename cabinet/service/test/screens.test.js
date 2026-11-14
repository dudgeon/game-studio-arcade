// Every screen against strings meant to break it (D181). No browser: the font is a
// fixed grid, so this is arithmetic, plus real ink measured from the framebuffer.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Framebuffer } from "../../../runtime/src/gfx.js";
import { ASK_LIMITS, Painter, draw, flow, planLines, questionText } from "../launcher/screens.js";
import { GLYPH_H, H, W, check, clean, fit, widthOf, wrap } from "../launcher/text.js";
import { LONG } from "../test-support/stress.js";
import { bootBoard, cardView, coinsWord, usedCoins, resultItem, scoreLine, goneView, coinCheck, historyLines, howtoView, leaveView, notYours, offlineMake, unconnectedMake, postGame, potLimit, resting, resultView, whatToChange, whoView } from "../launcher/boards.js";
import { familyOfCart, gameRows } from "../launcher/shelf.js";
import { guestHowto, guestPostGame, guestRows } from "../launcher/guests.js";
import { redirectBoard } from "../launcher/redirect.js";

const STRINGS = Object.entries(LONG);

/** Every view the launcher can show, with one string in every slot. @param {string} s */
function viewsWith(s) {
  const rules = [
    { id: "R1", kind: "auto", text: s },
    { id: "R2", kind: "you-check", text: s },
  ];
  const q = { question: s, option_a: s, option_b: s };
  const say = { screen: "say", prompt: s, transcript: s, typed: s, sel: 0, tick: 0 };
  return {
    "shelf": { screen: "shelf", console: s, count: 12, sel: 0, items: [{ kind: "make", title: "Make a new game" }, { kind: "back", title: s, note: s, urgent: true }, ...Array.from({ length: 12 }, () => ({ kind: "cart", title: s, by: s, note: s }))] },
    "shelf, far down": { screen: "shelf", console: "Quarter Deck", count: 12, sel: 13, items: [{ kind: "make", title: "Make" }, ...Array.from({ length: 13 }, () => ({ kind: "cart", title: s, by: s }))] },
    "who": { screen: "who", sel: 1, makers: Array.from({ length: 20 }, () => ({ name: s })) },
    "say idle": { ...say, purpose: "request", phase: "idle" },
    "say answer": { ...say, purpose: "answer", phase: "idle" },
    "say listening": { ...say, purpose: "answer", phase: "listening", tick: 20 },
    "say hearing": { ...say, purpose: "answer", phase: "hearing" },
    "say silence": { ...say, purpose: "answer", phase: "silence" },
    "say confirm": { ...say, purpose: "request", phase: "confirm" },
    "say confirm, prompt": { ...say, purpose: "answer", phase: "confirm" },
    "say typing": { ...say, purpose: "answer", phase: "typing" },
    "name typing": { ...say, prompt: undefined, purpose: "name", phase: "typing" },
    "question": { screen: "question", ...q, maker: s, sel: 0 },
    "question D lit": { screen: "question", ...q, maker: s, sel: 3 },
    "reader": { screen: "reader", title: s, flowed: questionText(q), top: 0 },
    "reader, far down": { screen: "reader", title: s, flowed: questionText(q), top: 9999 },
    "plan": { screen: "plan", summary: s, rules, changes: [{ id: "R1", text: s }], maker: s, sel: 0, top: 0 },
    "plan, far down": { screen: "plan", summary: s, rules, maker: s, sel: 1, top: 9999 },
    "progress": { screen: "progress", lines: Array.from({ length: 12 }, () => s), maker: s, tick: 7 },
    "progress, none yet": { screen: "progress", lines: [] },
    "result ok": { screen: "result", ok: true, title: s, by: s, tiles: ["Play it now", "Back to the shelf"], sel: 0 },
    "result failed": { screen: "result", ok: false, message: s, by: s, tiles: ["Back to the shelf"], sel: 0 },
    "result, after a restart": { screen: "result", ok: true, title: s, by: s, note: "It finished while the cabinet was restarting.", tiles: ["Play it now", "Back to the shelf"], sel: 0 },
    "shelf with results": { screen: "shelf", console: "Quarter Deck", count: 3, sel: 1, items: [{ kind: "make", title: "Make a new game", note: s, urgent: true }, { kind: "result", title: "New game ready!", by: s, note: s, urgent: true }, { kind: "result", title: "A new game didn't finish", by: s, urgent: true }, { kind: "cart", title: s, by: s }] },
    "check": { screen: "check", title: s, rule: s, i: 0, n: 3, sel: 0 },
    "notice": { screen: "notice", title: s, message: s, hint: "ESC: back to the shelf" },
    "leave": { screen: "leave", sel: 2 },
    "question, near the timeout": { screen: "question", ...q, maker: s, sel: 0, warn: true },
    "question, counting down": { screen: "question", ...q, maker: s, sel: 0, warn: true, warnLeft: 59 },
    ...boardsWith(s),
  };
}

/** The arcade's boards (D201) with one string in every slot it can reach. @param {string} s */
function boardsWith(s) {
  const makers = [{ maker: "owen", name: s, coins: 19, cents: 193, makes: 3 }, { maker: "alina", name: s, coins: 6, cents: 56, makes: 1 }, { maker: "sam", name: s, coins: 3, cents: 31, makes: 1 }, { maker: "zed", name: s, coins: 1, cents: 9, makes: 1 }];
  const pot = (/** @type {number} */ coins) => ({ coins, cents: coins * 10 + 1, month: "2026-11", refill_on: "2026-12-01", full_coins: 100, makers, last_month: { month: "2026-10", makers, ended_cents: -52, ended_coins: -5 }, usual: { new: 6, change: 3 }, minutes: { new: 7, change: 4 }, over_usual: 1.5 });
  const cart = { id: "penguin-catch", title: s, version: 2, maker: "alina", parent: "penguin-catch@1", family: "penguin-catch", branch: "penguin-catch", plays: 0, pitch: s, controls: [s, s, s, s, s], youCheck: [{ id: "R12", text: s }], created: "2026-11-11T10:00:00Z" };
  const carts = [
    { ...cart, version: 1, id: "penguin-catch", branch: null, family: null, parent: null, created: "2026-11-10T10:00:00Z" },
    cart,
    { ...cart, id: "owens", version: 1, maker: "owen", branch: null, created: "2026-11-11T11:00:00Z" },
    { id: "starter", title: s, version: 1, maker: null, parent: null, plays: 3 },
  ];
  const nameOf = () => s;
  const fam = /** @type {any} */ (familyOfCart(/** @type {any} */ (carts), "penguin-catch"));
  const result = { id: 1, ok: true, kind: "new", title: s, maker: "alina", maker_name: s, cost_cents: 68, coins: 7, pot_before_cents: 850, pot_after_cents: 782, note: s };
  const change = { ...result, kind: "change", version: 3, changed: s, parent: { id: "penguin-catch", title: s, version: 2, maker: "alina" } };
  const rules = [1, 2, 3, 4, 5, 6].map((n) => ({ id: `R${n}`, kind: n > 4 ? "you-check" : "auto", text: s, ...(n === 2 ? { was: s } : {}) }));
  const plan = { screen: "plan", summary: s, controls: s, top_rules: ["R1", "R2", "R5", "R6"], rules, right: s, usual: { new: 6, change: 3 }, sel: 0 };
  return {
    "B1 power on": { screen: "boot", console: s, tick: 30 },
    "B2": bootBoard("controls", pot(100)),
    "B3": bootBoard("pot", pot(100)),
    "B4": bootBoard("month", pot(100)),
    "S1 family rows": { screen: "shelf", console: s, pot: -12, sel: 2, items: [{ kind: "make", title: "Make a new game", note: s, cost: 6 }, ...gameRows(/** @type {any} */ (carts), nameOf).map((r) => ({ ...r, hasCard: true }))] },
    "S1 tags": { screen: "shelf", console: s, pot: 100, sel: 1, items: [{ kind: "make", title: "Make a new game", cost: 6 }, { kind: "cart", title: s, by: s, version: "v12", tags: [{ text: "NEW", kind: "new" }, { text: "2 to check", kind: "check" }], hasCard: true, cart }] },
    "S2 waiting": { screen: "shelf", console: s, pot: 50, sel: 0, items: [{ kind: "back", title: `Claude is waiting for ${s}`, note: s, urgent: true }, { kind: "waiting", title: "Make a new game", note: `After ${s}'s game is done` }] },
    "E1": { screen: "shelf", console: s, offline: true, sel: 0, items: [{ kind: "offline", title: "Make a new game", note: "Needs Wi-Fi right now", urgent: true }] },
    "E11": { screen: "shelf", console: s, offline: true, unconnected: true, sel: 0, items: [{ kind: "unconnected", title: "Make a new game", note: "Not connected to Claude yet", urgent: true }] },
    "S3": cardView({ cart, family: fam.family, line: fam.line, nameOf, usual: { change: 3 } }),
    "A1": { screen: "pot", pot: pot(62) },
    "A1 nobody yet": { screen: "pot", pot: { ...pot(100), makers: [] } },
    "A1 negative": { screen: "pot", pot: pot(-12) },
    "A2": { screen: "history", flowed: historyLines([{ kind: "charge", at: "2026-11-11T10:00:00Z", who: "alina", name: s, what: "new game", title: s, coins: 7, cost_cents: 68, outcome: "didn't finish" }, { kind: "topup", at: "2026-11-10T10:00:00Z", cents: 200, reason: s }, { kind: "reset", at: "2026-11-09T10:00:00Z", reason: s }, { kind: "refill", at: "2026-11-01T00:00:00Z", pot_after_cents: 1000 }]), top: 0 },
    "G0": howtoView(cart, nameOf),
    "G0 guest": guestHowto({ id: "teti", guest: true, title: s, by: s, howToPlay: { goal: s, controls: [s, s, s, s, s] } }),
    "G6 guest": guestPostGame({ id: "teti", guest: true, title: s, by: s }),
    "G6 guest, a score": guestPostGame({ id: "teti-geoff", guest: true, title: s, by: s }, { score: 999_999_999, best: 999_999_999, bestBefore: 5 }),
    "G6 guest, a best": guestPostGame({ id: "teti-geoff", guest: true, title: s, by: s }, { score: 12, best: 999_999_999, bestBefore: 999_999_999 }),
    "S1 guest family": { screen: "shelf", console: s, pot: 100, sel: 2, items: [{ kind: "make", title: "Make a new game", cost: 6 }, ...guestRows([{ id: "teti", guest: true, title: s, by: s }, { id: "teti-geoff", guest: true, title: s, by: s, maker: "geoff", parent: "teti" }], () => s)] },
    "G3": postGame({ cart, noRule: { id: "R12", text: s }, versions: 3, usual: { change: 3 } }),
    "G4": postGame({ cart, noRule: null, versions: 3, usual: { change: 3 } }),
    "G4 with a score": postGame({ cart, noRule: null, versions: 3, usual: { change: 2 }, score: 999_999_999, best: 999_999_999, bestBefore: 5 }),
    "G3 with a score": postGame({ cart, noRule: { id: "R12", text: s }, versions: 3, usual: { change: 2 }, score: 120, best: 340, bestBefore: 340 }),
    "G5 with a score": postGame({ cart: { ...cart, maker: null }, noRule: null, versions: 1, usual: { change: 2 }, score: 120, best: 340, bestBefore: 340 }),
    "G5": postGame({ cart: { ...cart, maker: null }, noRule: null, versions: 1, usual: { change: 3 } }),
    "M1": whoView({ makers: Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, name: s })), pot: pot(40) }),
    "R1": whoView({ makers: [{ id: "alina", name: s }, { id: "owen", name: s }], pot: pot(40), change: { cart } }),
    "R2": notYours({ cart, makerName: s, ownerName: s }),
    "M3": coinCheck({ kind: "new", pot: pot(100), maker: s }),
    "R3": coinCheck({ kind: "change", pot: pot(-5), maker: s, parentVersion: 12 }),
    "R4 with a fix": whatToChange({ noRule: { text: s }, makerName: s }),
    "R4": whatToChange({ makerName: s }),
    "M9": plan,
    "M9 re-shown mid-build": { ...plan, changes: [{ id: "R2", text: s }], rightCoin: true, right: "12 used" },
    "M7 with coins used": { screen: "question", question: s, option_a: s, option_b: s, maker: "123 used", makerCoin: true, sel: 0 },
    "M9 without the new fields": { ...plan, controls: undefined, top_rules: undefined, cartControls: [s] },
    "R6": { ...plan, mode: "change", parentVersion: 12, changes: [{ id: "R2", text: s }] },
    "R6 from changes only": { ...plan, mode: "change", rules: rules.map(({ was, ...r }) => r), changes: [{ id: "R2", text: s }] },
    "M10": { screen: "progress", kind: "new", lines: [s, s], maker: s, step: 2, used_cents: 46, usual: 6, minutesLeft: 3, tick: 3 },
    "R7 over usual": { screen: "progress", kind: "change", lines: [s], maker: s, step: 3, used_cents: 300, usual: 3, minutesLeft: -2 },
    "M11": resultView(result, pot(78)),
    "L4": resultView({ ...result, cost_cents: 140, coins: 14, over_usual: true, why_more: s }, pot(60)),
    "L3": resultView({ ...result, cost_cents: 140, coins: 14, over_pot: true, pot_before_cents: 70, pot_after_cents: -70 }, pot(-7)),
    "R8": resultView(change, pot(70)),
    "R8 own version": resultView({ ...change, version: 1 }, pot(70)),
    "E3": resultView({ ...result, ok: false, failed: true, request: s, message: s }, pot(70)),
    "failed, no request": resultView({ ...result, ok: false, message: s }, pot(70)),
    "L1": potLimit({ kind: "new", pot: pot(5), why: "low" }),
    "L2": potLimit({ kind: "new", pot: pot(-3), why: "empty" }),
    "L2 for a change": potLimit({ kind: "change", pot: pot(2), why: "low" }),
    "L5": resting(),
    "E2": offlineMake(),
    "E12": unconnectedMake(),
    "E8": leaveView({ usedCents: 123 }),
    "gone, walked away, with the cost and a retry": goneView({ kind: "timed_out", message: s, cost_cents: 999, retry: { maker: "m", request: s, kind: "change" } }, { new: 6, change: 2 }),
    "E5 with a retry": goneView({ kind: "restarted", message: s, retry: { maker: "m", request: s, kind: "new" } }, { new: 6, change: 2 }),
    "E6": goneView({ kind: "restarted", message: "Your game may still finish: look for it on the shelf." }, { new: 6, change: 2 }),
    "E10": redirectBoard({ say: "Let's make it a little different. How about this?", alternative: s.slice(0, 160) }),
    "E10 for an answer": redirectBoard({ alternative: s.slice(0, 160), answer: true }),
  };
}

/** The bounding box of real ink for one line, drawn alone. @param {{text: string, x: number, y: number, scale: number}} l */
function inkOf(l) {
  const fb = new Framebuffer();
  fb.cls(0);
  fb.text(l.text, l.x, l.y, 5, { scale: l.scale });
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (fb.pixels[y * W + x]) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }
  return { x0, y0, x1, y1 };
}

for (const [label, s] of STRINGS) {
  test(`every screen fits: ${label}`, () => {
    const p = new Painter();
    for (const [name, view] of Object.entries(viewsWith(s))) {
      draw(p, view);
      assert.deepEqual(check(p.boxes), [], `${name} with ${label}`);
      for (const b of p.boxes) {
        for (const l of b.lines) {
          const ink = inkOf(l);
          if (ink.x1 < 0) continue; // spaces only
          assert.ok(ink.x0 >= b.x && ink.x1 < b.x + b.w, `${name}/${b.id}: ink ${ink.x0}..${ink.x1} outside ${b.x}..${b.x + b.w} for "${l.text}"`);
          assert.ok(ink.y0 >= b.y && ink.y1 < b.y + b.h, `${name}/${b.id}: ink ${ink.y0}..${ink.y1} outside ${b.y}..${b.y + b.h} for "${l.text}"`);
        }
      }
    }
  });
}

test("tiles stay on screen with the longest question and options", () => {
  const p = new Painter();
  draw(p, { screen: "question", question: LONG.paragraph, option_a: LONG.paragraph, option_b: LONG.paragraph, sel: 0 });
  const d = /** @type {import("../launcher/text.js").BoxRecord} */ (p.boxes.find((b) => b.id === "q-d"));
  assert.ok(d.y + d.h <= H - GLYPH_H - 2, `D ends at ${d.y + d.h}, over the hint`);
  // D453: the question reads in pages, nothing cut; the option tiles keep the reader.
  const q = p.boxes.find((x) => x.id === "q-question");
  assert.equal(q?.cut, false);
  assert.ok((q?.pages ?? 1) > 1, "the long question has pages");
  for (const id of ["q-a", "q-b"]) {
    const b = p.boxes.find((x) => x.id === id);
    assert.equal(b?.cut, true, `${id} should be cut`);
    assert.equal(b?.readable, true);
  }
  assert.equal(p.boxes.find((b) => b.id === "hint")?.lines[0].text, "Left/right: pages. Up/down: choose.");
});

test("a question with no drawable words still shows real choices, not blank tiles", () => {
  const p = new Painter();
  draw(p, { screen: "question", question: LONG.onlyEmoji, option_a: LONG.onlyEmoji, option_b: "", sel: 0 });
  for (const id of ["q-question", "q-a", "q-b"]) assert.ok(p.boxes.find((b) => b.id === id)?.lines[0]?.text, `${id} is blank`);
});

test("a short question goes double size; a long one doesn't", () => {
  const p = new Painter();
  draw(p, { screen: "question", question: "What happens if you catch a boot?", option_a: "x", option_b: "y", sel: 0 });
  assert.equal(p.boxes.find((b) => b.id === "q-question")?.lines[0].scale, 2);
  draw(p, { screen: "question", question: LONG.sentence, option_a: "x", option_b: "y", sel: 0 });
  assert.equal(p.boxes.find((b) => b.id === "q-question")?.lines[0].scale, 1);
});

test("the reader holds every word of a cut question, and shows them all when scrolled", () => {
  const q = { question: LONG.paragraph, option_a: LONG.word, option_b: LONG.sentence };
  const flowed = questionText(q);
  const p = new Painter();
  const seen = [];
  for (let top = 0; top < flowed.length; top++) {
    const v = { screen: "reader", flowed, top };
    draw(p, v);
    assert.deepEqual(check(p.boxes), []);
    const box = p.boxes.find((b) => b.id === "reader");
    seen[top] = box?.lines[0]?.text;
  }
  const all = flowed.map((l) => l.text).join("");
  for (const w of LONG.paragraph.split(" ")) assert.ok(all.includes(w.slice(0, 10)), `missing ${w}`);
  assert.ok(all.replaceAll(" ", "").includes(LONG.word), "the long word, across its broken lines");
  assert.equal(all.includes("..."), false, "the reader never cuts");
});

test("the plan holds every rule in full, with you-check marked", () => {
  const rules = [{ id: "R1", kind: "auto", text: LONG.paragraph }, { id: "R2", kind: "you-check", text: "Looks like a penguin." }];
  const lines = planLines({ summary: LONG.sentence, rules });
  const all = lines.map((l) => l.text).join(" ");
  assert.ok(all.includes("Looks like a penguin. (you check)"));
  assert.equal(lines.filter((l) => l.text.startsWith("1.")).length, 1, "numbers, not spec ids");
  assert.ok(lines.every((l) => widthOf(l.text) <= W - 12 - 8), "room for the scroll bar");
});

test("what the brief tells Claude about ask_player is what the screen holds (D190)", () => {
  const tool = JSON.parse(fs.readFileSync(new URL("../../../studio-kit/managed-agent/agents/tools/ask_player.json", import.meta.url), "utf8"));
  const f = tool.input_schema.properties;
  assert.deepEqual(ASK_LIMITS, { bigQuestion: 60, question: 240, option: 111 });
  assert.match(f.question.description, new RegExp(`about ${ASK_LIMITS.bigQuestion} characters`));
  assert.match(f.question.description, new RegExp(`${ASK_LIMITS.question} characters`));
  assert.match(f.option_a.description, new RegExp(`${ASK_LIMITS.option} characters`));
  assert.match(f.option_b.description, new RegExp(`${ASK_LIMITS.option} characters`));
  assert.match(tool.description, /plain ASCII/);
  const p = new Painter();
  const words = (/** @type {number} */ n) => "x".repeat(n);
  draw(p, { screen: "question", question: words(ASK_LIMITS.bigQuestion), option_a: words(ASK_LIMITS.option), option_b: words(ASK_LIMITS.option), sel: 0 });
  assert.equal(p.boxes.find((b) => b.id === "q-question")?.lines[0].scale, 2, "the most at double size is still double size");
  assert.ok(p.boxes.filter((b) => b.cut).length === 0, "at their limits, nothing is cut");
  draw(p, { screen: "question", question: words(ASK_LIMITS.question), option_a: words(ASK_LIMITS.option + 1), option_b: "y", sel: 0 });
  assert.equal(p.boxes.find((b) => b.id === "q-question")?.cut, false, "the most at single size fits");
  assert.equal(p.boxes.find((b) => b.id === "q-a")?.cut, true, "one over the limit is cut");
});

test("near the timeout, the hint says so; it's never cut (D188)", () => {
  const p = new Painter();
  draw(p, { screen: "question", question: "q", option_a: "a", option_b: "b", sel: 0, warn: true });
  assert.equal(p.boxes.find((b) => b.id === "hint")?.lines[0].text, "Still there? Move the stick!");
  draw(p, { screen: "question", question: "q", option_a: "a", option_b: "b", sel: 0 });
  assert.notEqual(p.boxes.find((b) => b.id === "hint")?.lines[0].text, "Still there? Move the stick!");
});

test("clean leaves only what the font can draw", () => {
  for (const [label, s] of STRINGS) assert.match(clean(s), /^[\x20-\x7e]*$/, label);
  assert.equal(clean("“It’s” — café…"), `"It's" - cafe...`);
  assert.equal(clean("🐧 Penguin"), "Penguin");
  assert.equal(clean("a\nb"), "a b");
  assert.equal(clean("a\n\n\n\nb", { keepLines: true }), "a\n\nb");
});

test("wrap breaks by word, and a word only if it must", () => {
  assert.deepEqual(wrap("one two three", 7), ["one two", "three"]);
  assert.deepEqual(wrap("abcdefghij", 4), ["abcd", "efgh", "ij"]);
  assert.deepEqual(wrap("ab abcdefghij", 4), ["ab", "abcd", "efgh", "ij"]);
});

test("fit cuts deliberately and says so", () => {
  const f = fit("one two three four five six", 7, 2);
  assert.equal(f.cut, true);
  assert.equal(f.lines.length, 2);
  assert.ok(f.lines[1].endsWith("..."));
  assert.ok(f.lines.every((l) => l.length <= 7));
  assert.deepEqual(fit("one", 7, 2), { lines: ["one"], cut: false, total: 1 });
  const w = fit("W".repeat(100), 10, 2);
  assert.ok(w.lines.every((l) => l.length <= 10));
});

test("check catches real overruns", () => {
  const box = (/** @type {any} */ o) => ({ id: "b", text: "", x: 0, y: 0, w: 60, h: 8, cut: false, onCut: "ok", readable: false, lines: [], ...o });
  const line = (/** @type {string} */ text, x = 0, y = 0) => ({ text, x, y, scale: 1 });
  assert.match(check([box({ lines: [line("this line is much too wide for it")] })])[0], /wider/);
  assert.match(check([box({ lines: [line("ok", 0, 4)] })])[0], /below/);
  assert.match(check([box({ x: 250 })])[0], /off screen/);
  assert.match(check([box({ cut: true, onCut: "reader" })])[0], /no way to read/);
  assert.deepEqual(check([box({ cut: true, onCut: "ok" })]), []);
  assert.match(check([box({ lines: [line("café")] })])[0], /can't draw/);
  const a = box({ id: "a", lines: [line("x")] });
  const c = box({ id: "c", x: 10, lines: [line("x", 10)] });
  assert.match(check([a, c])[0], /overlaps/);
  assert.match(check([box({ cut: true, onCut: "never" })])[0], /our own words/);
});

test("flow keeps blank lines between paragraphs and fits the scroll column", () => {
  const f = flow("one\n\ntwo");
  assert.deepEqual(f.map((l) => l.text), ["one", "", "two"]);
});

test("coins are counted in words a kid would say: 1 coin, 2 coins (the shelf's failed-make row)", () => {
  assert.equal(coinsWord(1), "1 coin");
  assert.equal(coinsWord(0), "0 coins");
  assert.equal(coinsWord(-1), "-1 coin");
  assert.equal(coinsWord(7), "7 coins");
  const row = (/** @type {number} */ cents) => resultItem({ ok: false, failed: true, cost_cents: cents, maker_name: "Tester", request: "x" });
  assert.equal(row(9).note, "used 1 coin", "the live change's 9c (D214)");
  assert.equal(row(68).note, "used 7 coins");
  assert.equal(row(9).by, "by Tester");
  assert.equal(resultItem({ ok: true, kind: "change", title: "Log Hopper", maker_name: "Tester" }).title, "A change is ready!");
  assert.equal(resultItem({ ok: false, message: "x", maker: "owen" }).note, undefined, "no cost known, nothing said");
});

test("a guest's G0, from its real guest.json: nothing cut, and no author in the header (it was cut to \"by...\")", () => {
  const meta = JSON.parse(fs.readFileSync(new URL("../../../guests/teti/guest.json", import.meta.url), "utf8"));
  const p = new Painter();
  draw(p, { ...guestHowto({ ...meta, guest: true }), board: "G0" });
  assert.deepEqual(check(p.boxes), []);
  assert.deepEqual(p.boxes.filter((b) => b.cut).map((b) => b.id), [], "every box on teti's G0 shows its words in full");
  const words = p.boxes.flatMap((b) => b.lines.map((l) => l.text)).join(" | ");
  assert.doesNotMatch(words, /\bby\b/, "the header has no author; the shelf row says who made it");
  assert.match(words, /Fill whole rows/);
  assert.equal(p.boxes.filter((b) => /^howto-control-/.test(b.id)).length, 4, "all four control lines show");
});

test("score and best after a play (D215): this play's score, the best ever, a new best said so; nothing for no score", () => {
  assert.deepEqual(scoreLine({ score: null, best: 340 }), [], "a game that reports nothing shows no score line");
  assert.equal(scoreLine({ score: 120, best: 340, bestBefore: 340 })[0].text, "Score: 120. Best: 340.");
  assert.equal(scoreLine({ score: 400, best: 400, bestBefore: 340 })[0].text, "Score: 400. A new best!");
  assert.equal(scoreLine({ score: 50, best: 50, bestBefore: null })[0].text, "Score: 50. A new best!", "the first score is the best so far");
  assert.equal(scoreLine({ score: 0, best: 0, bestBefore: null })[0].text, "Score: 0. Best: 0.", "zero isn't a record");
  assert.equal(scoreLine({ score: 120, best: null, bestBefore: 340 })[0].text, "Score: 120. Best: 120.", "a best not yet logged still reads sensibly");
});

test("guest family rows: the original, then someone's version indented under it, by its maker (D234)", () => {
  const nameOf = (/** @type {string} */ id) => /** @type {Record<string, string>} */ ({ geoff: "Geoff" })[id] ?? id;
  const rows = guestRows(
    [
      { id: "teti-geoff", guest: true, title: "teti", by: "TitanPlayz100", maker: "geoff", parent: "teti" },
      { id: "teti", guest: true, title: "teti", by: "TitanPlayz100" },
      { id: "lonely", guest: true, title: "Lonely", by: "Someone", maker: "geoff", parent: "not-here" },
    ],
    nameOf,
  );
  assert.deepEqual(rows.map((r) => [r.cart.id, r.indent, r.by, r.tags[0].text, r.hasCard]), [
    ["teti", 0, "by TitanPlayz100", "free game", false],
    ["teti-geoff", 1, "by Geoff", "free game", false],
    ["lonely", 0, "by Geoff", "free game", false],
  ]);
  const p = new Painter();
  draw(p, { screen: "shelf", console: "Quarter Deck", pot: 92, sel: 1, items: rows });
  assert.deepEqual(check(p.boxes), []);
  const x = (/** @type {number} */ n) => p.boxes.find((b) => b.id === `shelf-title-${n}`)?.x ?? -1;
  assert.ok(x(1) > x(0), "the version's row is indented under the original");
});

test("a guest's G6 shows the score line only when it reported one (D235)", () => {
  const words = (/** @type {any} */ v) => {
    const p = new Painter();
    draw(p, v);
    assert.deepEqual(check(p.boxes), []);
    return p.boxes.flatMap((b) => b.lines.map((l) => l.text)).join(" | ");
  };
  assert.doesNotMatch(words(guestPostGame({ id: "teti", title: "teti" })), /Score/, "the original teti: no score line");
  assert.match(words(guestPostGame({ id: "teti-geoff", title: "teti" }, { score: 340, best: 340, bestBefore: null })), /Score: 340\. A new best!/);
  assert.match(words(guestPostGame({ id: "teti-geoff", title: "teti" }, { score: 120, best: 340, bestBefore: 340 })), /Score: 120\. Best: 340\./);
});

test("R8 for someone else's own version names whose game stays the same (D302)", () => {
  const r = resultView({ id: 1, ok: true, kind: "change", version: 1, title: "Snowball Drop", maker_name: "Tester2", cost_cents: 13, pot_after_cents: 882, parent: { id: "rock-rain", maker: "tester", maker_name: "Tester" } }, null);
  assert.ok(r.blocks.some((b) => b.text === "Tester's game stays the same."));
});

test("a few cents read as less than 1 coin, never 0 or -0 (D305)", () => {
  assert.equal(usedCoins(1), "less than 1 coin");
  assert.equal(usedCoins(4), "less than 1 coin");
  assert.equal(usedCoins(5), "1 coin");
  assert.equal(usedCoins(109), "11 coins");
  const lines = historyLines([{ kind: "charge", at: "2026-11-12T10:00:00Z", who: "tester", name: "Tester", what: "new game", coins: 0, cost_cents: 1, outcome: "stopped" }, { kind: "charge", at: "2026-11-12T10:00:00Z", who: "tester", name: "Tester", what: "new game", coins: 7, cost_cents: 68, outcome: "on the shelf" }]).map((l) => l.text).join(" | ");
  assert.match(lines, /less than 1 coin \(1c\), stopped/);
  assert.doesNotMatch(lines, /-0 coin/);
  assert.match(lines, /-7 coins \(68c\)/);
  assert.equal(resultItem({ ok: false, failed: true, cost_cents: 3, maker_name: "T", request: "x" }).note, "used less than 1 coin");
});

test("a cabinet with no key yet says so, not \"No Wi-Fi\" (D252)", () => {
  const b = unconnectedMake();
  const words = [b.title, ...b.blocks.map((x) => x.text), b.hint].join(" ");
  assert.match(words, /Not connected to Claude yet/);
  assert.match(words, /A grown-up needs to finish setting up\./);
  assert.doesNotMatch(words, /Wi-?Fi/i);
  // The shelf header and the Make row, drawn at 1024x768 with the console's own name: whole, and not about Wi-Fi.
  const p = new Painter();
  draw(p, { screen: "shelf", console: "Quarter Deck", offline: true, unconnected: true, sel: 0, items: [{ kind: "unconnected", title: "Make a new game", note: "Not connected to Claude yet", urgent: true }] });
  assert.deepEqual(check(p.boxes), []);
  const shown = p.boxes.flatMap((b) => b.lines.map((l) => l.text)).join(" | ");
  assert.match(shown, /Not connected(?! to)/, "the header");
  assert.match(shown, /Not connected to Claude yet/, "the Make row, whole");
  assert.doesNotMatch(shown, /Wi-?Fi/i);
  // And the board, whole.
  draw(p, b);
  assert.deepEqual(check(p.boxes), []);
  const board = p.boxes.flatMap((x) => x.lines.map((l) => l.text)).join(" ");
  assert.match(board, /A grown-up needs to finish setting up\./);
});

// ---------- D453: long words in pages ----------

test("D453: a long transcript reads in pages, every word on one of them, with the page count on the last row", async () => {
  const { paginate, wrap, colsFor } = await import("../launcher/text.js");
  const { turnPage, seenAll, pageOf } = await import("../launcher/pages.js");
  const words = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
  /** @type {any} */
  const v = { screen: "say", phase: "confirm", purpose: "idea", transcript: words, sel: 0 };
  const p = new Painter();
  draw(p, v);
  const t = /** @type {any} */ (p.boxes.find((b) => b.id === "say-transcript"));
  assert.equal(t.cut, false);
  assert.ok(t.pages >= 3, `${t.pages} pages`);
  assert.equal(t.lines.at(-1).text, `1 of ${t.pages} >`);
  assert.deepEqual(check(p.boxes), []);
  // "Yes" waits until every page has been seen.
  assert.equal(p.boxes.find((b) => b.id === "say-yes")?.text, "Read it all first");
  assert.equal(seenAll(v, p.boxes), false);
  /** @type {string[]} */
  const shown = [];
  for (let i = 0; i < t.pages; i++) {
    const q = new Painter();
    draw(q, v);
    const box = /** @type {any} */ (q.boxes.find((b) => b.id === "say-transcript"));
    shown.push(...box.lines.slice(0, -1).map((/** @type {any} */ l) => l.text));
    assert.deepEqual(check(q.boxes), [], `page ${i + 1}`);
    turnPage(v, "right", q.boxes);
  }
  assert.equal(shown.join(" "), words, "every word, once, in order");
  const last = new Painter();
  draw(last, v);
  assert.equal(seenAll(v, last.boxes), true);
  assert.equal(last.boxes.find((b) => b.id === "say-yes")?.text, "Yes! That's it");
  turnPage(v, "left", last.boxes);
  assert.equal(pageOf(v, words), t.pages - 2, "left goes back");
  // A new transcript starts on page 1, with nothing seen.
  const v2 = { ...v, transcript: `${words} more` };
  const n = new Painter();
  draw(n, v2);
  assert.equal(pageOf(v2, v2.transcript), 0);
  assert.equal(seenAll(v2, n.boxes), false);
  // Short words don't page.
  const s = new Painter();
  draw(s, { ...v, transcript: "a cat that catches fish", pages: undefined });
  assert.equal(s.boxes.find((b) => b.id === "say-transcript")?.pages, undefined);
  assert.equal(s.boxes.find((b) => b.id === "say-yes")?.text, "Yes! That's it");
  assert.equal(paginate("", 10, 3, 0).pages, 1);
  assert.equal(wrap(words, colsFor(244)).length > 30, true);
});

test("D453/D455: after Add more, the pages hold the earlier words and the new ones", () => {
  const before = Array.from({ length: 150 }, (_, i) => `early${i}`).join(" ");
  const p = new Painter();
  draw(p, { screen: "say", phase: "confirm", purpose: "idea", added: before, transcript: "and then the new bit", sel: 0 });
  const t = /** @type {any} */ (p.boxes.find((b) => b.id === "say-transcript"));
  assert.ok(t.pages > 1);
  assert.equal(t.text, `${before} and then the new bit`);
});

test("D453: a long rule to check and a long question read in pages", () => {
  const long = Array.from({ length: 200 }, (_, i) => `rule${i}`).join(" ");
  const c = new Painter();
  draw(c, { screen: "check", rule: long, sel: 0, n: 1, of: 1, title: "Game" });
  const r = /** @type {any} */ (c.boxes.find((b) => b.id === "check-rule"));
  assert.ok(r.pages > 1);
  assert.deepEqual(check(c.boxes), []);
});
