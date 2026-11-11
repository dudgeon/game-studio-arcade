import { test } from "node:test";
import assert from "node:assert/strict";
import * as score from "../score.js";
import { fakeG, asG } from "./fake-g.js";

test("newScore: defaults, saved best, custom lives and key", () => {
  assert.deepEqual(score.newScore(asG(fakeG())), { score: 0, lives: 3, best: 0, newBest: false, key: "best" });
  const g = asG(fakeG({ save: { best: 500, best2: 40 } }));
  assert.equal(score.newScore(g).best, 500);
  const two = score.newScore(g, { lives: 1, key: "best2" });
  assert.equal(two.best, 40);
  assert.equal(two.lives, 1);
  assert.equal(score.newScore(asG(fakeG({ save: "junk" }))).best, 0, "a non-object save is ignored");
  assert.equal(score.newScore(asG(fakeG({ save: { best: "x" } }))).best, 0, "a non-number best is ignored");
});

test("addPoints raises best and sets newBest; never below 0", () => {
  const sc = score.newScore(asG(fakeG({ save: { best: 100 } })));
  assert.equal(score.addPoints(sc, 60), 60);
  assert.equal(sc.newBest, false);
  score.addPoints(sc, 60);
  assert.equal(sc.best, 120);
  assert.equal(sc.newBest, true);
  score.addPoints(sc, -500);
  assert.equal(sc.score, 0);
  assert.equal(sc.best, 120, "best stays");
});

test("lives: lose, gain, cap, and game over", () => {
  const sc = score.newScore(asG(fakeG()), { lives: 2 });
  assert.equal(score.loseLife(sc), 1);
  assert.equal(score.isOver(sc), false);
  assert.equal(score.gainLife(sc, 5, 3), 3);
  assert.equal(score.loseLife(sc, 10), 0);
  assert.equal(score.isOver(sc), true);
});

test("commit saves only a new high score and keeps other saved fields", () => {
  const f = fakeG({ save: { best: 100, sound: false } });
  const g = asG(f);
  const sc = score.newScore(g);
  score.addPoints(sc, 50);
  assert.equal(score.commit(g, sc), false);
  assert.equal(f.saves, 0, "no write when it didn't beat the best");
  score.addPoints(sc, 100);
  assert.equal(score.commit(g, sc), true);
  assert.deepEqual(g.load(), { best: 150, sound: false });

  const empty = fakeG();
  assert.equal(score.commit(asG(empty), score.newScore(asG(empty))), false, "a 0 score with nothing saved writes nothing");
  assert.equal(empty.saves, 0);
});

test("the high score survives a new game (newScore reloads it)", () => {
  const g = asG(fakeG());
  const first = score.newScore(g);
  score.addPoints(first, 300);
  score.commit(g, first);
  const second = score.newScore(g);
  assert.equal(second.best, 300);
  assert.equal(second.score, 0);
});

test("loadField and saveField merge into one save object", () => {
  const g = asG(fakeG({ save: [1, 2] }));
  assert.equal(score.loadField(g, "x", 7), 7);
  score.saveField(g, "x", 1);
  assert.deepEqual(g.load(), { x: 1 }, "a non-object save is replaced");
  score.saveField(g, "y", { a: 2 });
  assert.deepEqual(g.load(), { x: 1, y: { a: 2 } });
  assert.deepEqual(score.loadField(g, "y"), { a: 2 });
  assert.equal(score.loadField(g, "missing"), null);
  assert.throws(() => score.saveField(g, "big", "x".repeat(5000)), /4 KB/);
});

test("commit reports the round's score to the cabinet with g.score (D215), new best or not", () => {
  /** @type {number[]} */
  const reported = [];
  const f = fakeG({ save: { best: 100 } });
  const g = asG({ ...f, save: f.save, load: f.load, score: (/** @type {number} */ n) => reported.push(n) });
  const sc = score.newScore(g);
  score.addPoints(sc, 40);
  score.commit(g, sc);
  sc.score = 250;
  score.commit(g, sc);
  assert.deepEqual(reported, [40, 250]);
  // An older runtime with no g.score: commit still saves.
  assert.doesNotThrow(() => score.commit(asG(fakeG()), score.newScore(asG(fakeG()))));
});
