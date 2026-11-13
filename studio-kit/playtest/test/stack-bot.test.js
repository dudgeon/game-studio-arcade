// The falling-blocks player (D307): its placement maths, and a real game of Candy Cat Drop
// played with button presses only. Candy Cat Drop is Tester's live make from the Phase 0
// stand-in request (docs/phase-0.md), so no kid's words are in it.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { dropAt, normalize, playStack, rate } from "../bin/stack-bot.js";

const CANDY = path.join(import.meta.dirname, "fixtures/candy-cat-drop");

test("dropAt lands a shape on the stack and clears full rows", () => {
  const board = ["....", "....", "#..#", "#..#"];
  const o = normalize([[5, 5], [6, 5], [5, 6], [6, 6]]);
  const d = /** @type {any} */ (dropAt(board, o, 1));
  assert.equal(d.lines, 2, "the O fills the gap in both rows");
  assert.deepEqual(d.after, ["....", "....", "....", "...."]);
  assert.equal(dropAt(board, o, 3), null, "off the right edge");
  assert.ok(rate(d.after, d.lines) > rate(["....", "....", "#..#", "#..#"], 0), "clearing rates higher than leaving holes");
});

test("a careful player clears lines in Candy Cat Drop: POP, sparkles, a happy cat, the score per the rules", async () => {
  const r = await playStack(CANDY, { pieces: 40, finish: true });
  assert.ok(r.final.lines >= 8, `cleared ${r.final.lines} lines in 40 pieces`);
  assert.ok(r.sawPops, "rows go POP");
  assert.ok(r.sawSparks, "with sparkles");
  assert.deepEqual([...r.moods].sort(), ["calm", "happy", "sad"], "the cat is calm, happy after a clear, and sad when the stack is high");
  // The spec: one row 100, two 300, three 500, four 800, times the level.
  for (const c of r.clears) assert.equal(c.scoreAdded % 100, 0, JSON.stringify(c));
  assert.equal(r.clears[0].scoreAdded, 100, "a single row at level 1 is 100");
  assert.equal(r.final.mode, "over", "the game ends when the stack tops out");
  assert.deepEqual(r.reported, [r.final.score], "and reports its score with g.score (D215)");
});
