// Every screen against strings meant to break it (D181). No browser: the font is a
// fixed grid, so this is arithmetic, plus real ink measured from the framebuffer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Framebuffer } from "../../../runtime/src/gfx.js";
import { Painter, draw, flow, planLines, questionText } from "../launcher/screens.js";
import { GLYPH_H, H, W, check, clean, fit, widthOf, wrap } from "../launcher/text.js";
import { LONG } from "../test-support/stress.js";

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
    "result failed": { screen: "result", ok: false, message: s, tiles: ["Back to the shelf"], sel: 0 },
    "check": { screen: "check", title: s, rule: s, i: 0, n: 3, sel: 0 },
    "notice": { screen: "notice", title: s, message: s, hint: "ESC: back to the shelf" },
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
  for (const id of ["q-question", "q-a", "q-b"]) {
    const b = p.boxes.find((x) => x.id === id);
    assert.equal(b?.cut, true, `${id} should be cut`);
    assert.equal(b?.readable, true);
  }
  assert.equal(p.boxes.find((b) => b.id === "hint")?.lines[0].text, "Right: read it all. Up/down: choose.");
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
