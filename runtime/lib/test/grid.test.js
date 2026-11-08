import { test } from "node:test";
import assert from "node:assert/strict";
import * as grid from "../grid.js";
import { fakeG, asG } from "./fake-g.js";

/** Draw a grid as rows of "#" and "." (top to bottom) for readable asserts. */
const picture = (gr) =>
  Array.from({ length: gr.h }, (_, y) => gr.cells.slice(y * gr.w, (y + 1) * gr.w).map((v) => (v ? "#" : ".")).join(""));

/** Cells as a sorted string, to compare shapes regardless of order. */
const key = (s) => s.cells.map(([x, y]) => `${x},${y}`).sort().join(" ");

test("make, get, set, inBounds", () => {
  const g = grid.make(4, 3);
  assert.equal(g.cells.length, 12);
  assert.equal(grid.get(g, 1, 1), 0);
  grid.set(g, 1, 1, 7);
  assert.equal(grid.get(g, 1, 1), 7);
  assert.equal(grid.get(g, 4, 0), -1);
  assert.equal(grid.get(g, -1, 0, 99), 99);
  grid.set(g, 10, 10, 5); // ignored
  assert.equal(g.cells.filter((v) => v).length, 1);
  assert.equal(grid.inBounds(g, 3, 2), true);
  assert.equal(grid.inBounds(g, 3, 3), false);
  assert.equal(grid.inBounds(g, 0.5, 0), false);
  assert.equal(JSON.stringify(grid.make(2, 1, 3)), '{"w":2,"h":1,"cells":[3,3]}', "a grid is plain JSON");
});

test("shape: cells and box size from rows", () => {
  const s = grid.shape([".#.", "###"]);
  assert.equal(s.n, 3);
  assert.equal(key(s), "0,1 1,0 1,1 2,1");
  assert.equal(grid.shape(["#", "#", "#", "#"]).n, 4);
  assert.equal(grid.shape(["# #"]).cells.length, 2, "space is empty");
});

test("rotate: clockwise inside the box; four turns and +1/-1 round-trip", () => {
  const bar = grid.shape(["###", "...", "..."]);
  assert.equal(key(grid.rotate(bar)), "2,0 2,1 2,2", "a top bar turns into a right column");
  assert.equal(key(grid.rotate(bar, 2)), "0,2 1,2 2,2");
  assert.equal(key(grid.rotate(bar, -1)), "0,0 0,1 0,2");
  const t = grid.shape([".#.", "###", "..."]);
  assert.equal(key(grid.rotate(t, 4)), key(t));
  assert.equal(key(grid.rotate(grid.rotate(t, 1), -1)), key(t));
  assert.equal(key(grid.rotate(t, 1)), key(grid.rotate(t, -3)));
  const sq = grid.shape(["##", "##"]);
  assert.equal(key(grid.rotate(sq)), key(sq), "a 2x2 square doesn't move");
  assert.notEqual(grid.rotate(t).cells, t.cells, "returns a new shape");
});

test("fits, tryMove: walls, floor, filled cells, and entering from above", () => {
  const g = grid.make(4, 4);
  const p = { shape: grid.shape(["##"]), x: 0, y: 0 };
  assert.equal(grid.tryMove(g, p, -1, 0), false, "left wall");
  assert.equal(grid.tryMove(g, p, 2, 0), true);
  assert.equal(grid.tryMove(g, p, 1, 0), false, "right wall");
  assert.deepEqual([p.x, p.y], [2, 0]);
  grid.set(g, 2, 2, 1);
  assert.equal(grid.tryMove(g, p, 0, 1), true);
  assert.equal(grid.tryMove(g, p, 0, 1), false, "blocked by a filled cell");
  assert.equal(grid.fits(g, p.shape, 0, -1), true, "above the top is free");
  assert.equal(grid.fits(g, p.shape, 0, 4), false, "below the floor is not");
});

test("tryRotate: kicks off a wall, and fails cleanly when boxed in", () => {
  const g = grid.make(5, 5);
  // A vertical bar against the left wall: turning it flat needs a kick right.
  const bar = { shape: grid.shape(["#..", "#..", "#.."]), x: -0, y: 1 };
  // rotate(+1) puts the bar on the box's top row; -1 on the bottom row. Make
  // the in-place turn collide by filling where it would land.
  grid.set(g, 2, 1, 9);
  const ok = grid.tryRotate(g, bar, 1);
  assert.equal(ok, true);
  assert.notEqual(`${bar.x},${bar.y}`, "0,1", "it moved to fit");
  for (const [x, y] of grid.cellsAt(bar.shape, bar.x, bar.y)) assert.equal(grid.get(g, x, y), 0);

  const full = grid.make(3, 3, 1);
  grid.set(full, 1, 0, 0);
  grid.set(full, 1, 1, 0);
  grid.set(full, 1, 2, 0);
  const stuck = { shape: grid.shape([".#.", ".#.", ".#."]), x: 0, y: 0 };
  const before = JSON.stringify(stuck);
  assert.equal(grid.tryRotate(full, stuck, 1), false);
  assert.equal(JSON.stringify(stuck), before, "unchanged when it can't turn");
  assert.equal(grid.tryRotate(full, stuck, 1, [[0, 0]]), false);
});

test("dropDistance and place", () => {
  const g = grid.make(3, 5);
  grid.set(g, 1, 4, 1);
  const p = { shape: grid.shape([".#.", "###"]), x: 0, y: 0 };
  assert.equal(grid.dropDistance(g, p), 2);
  p.y += grid.dropDistance(g, p);
  assert.equal(grid.dropDistance(g, p), 0);
  assert.equal(grid.place(g, p, 2), 0);
  assert.deepEqual(picture(g), ["...", "...", ".#.", "###", ".#."]);
  const high = { shape: grid.shape(["#", "#"]), x: 0, y: -1 };
  assert.equal(grid.place(g, high, 3), 1, "one cell above the top: report it");
  assert.equal(grid.get(g, 0, 0), 3);
});

test("fullRows and clearRows drop the rows above", () => {
  const g = grid.make(3, 4);
  g.cells = [
    0, 5, 0,
    1, 1, 1,
    2, 0, 2,
    3, 3, 3,
  ];
  assert.deepEqual(grid.fullRows(g), [1, 3]);
  assert.equal(grid.clearRows(g), 2);
  assert.deepEqual(g.cells, [0, 0, 0, 0, 0, 0, 0, 5, 0, 2, 0, 2]);
  assert.equal(grid.clearRows(g), 0, "nothing full, nothing cleared");
  assert.equal(grid.clearRows(g, [0, 0, 99]), 1, "duplicates and bad rows ignored");
  assert.equal(g.cells.length, 12);
});

test("stickStep: btnp by default, btn when held, one axis only", () => {
  const f = fakeG();
  const g = asG(f);
  assert.equal(grid.stickStep(g), null);
  f.press("left");
  assert.deepEqual(grid.stickStep(g), [-1, 0]);
  f.hold();
  assert.equal(grid.stickStep(g), null, "held, not newly pressed");
  assert.deepEqual(grid.stickStep(g, 1, true), [-1, 0]);
  f.press("up");
  assert.deepEqual(grid.stickStep(g), [0, -1], "up beats left");
  f.releaseAll();
  f.press("down", 2);
  assert.equal(grid.stickStep(g, 1), null);
  assert.deepEqual(grid.stickStep(g, 2), [0, 1]);
});
