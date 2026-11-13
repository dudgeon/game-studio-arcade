// @ts-check
// Checks for Candy Cat Drop. The tests set up boards with t.poke ({ empty, rows, piece })
// only to reach a situation fast; every rule's own subject is played for real.

const ROW9 = "#########."; // nine blocks and a gap in the right-most column

/** Cells of the piece, moved so the top-left is (0,0), as a sorted string. */
const norm = (p) => {
  const cs = p.piece.cells;
  const mx = Math.min(...cs.map((c) => c[0]));
  const my = Math.min(...cs.map((c) => c[1]));
  return cs.map((c) => `${c[0] - mx},${c[1] - my}`).sort().join(" ");
};
const minX = (p) => Math.min(...p.piece.cells.map((c) => c[0]));
const maxX = (p) => Math.max(...p.piece.cells.map((c) => c[0]));
const minY = (p) => Math.min(...p.piece.cells.map((c) => c[1]));

/** Drop a vertical I piece (already poked in) down the right-most column. Returns the probe 2 frames after the drop. */
async function dropI(t) {
  await t.bot.press("a");
  await t.bot.reach((p) => (maxX(p) < 9 ? "right" : ""), (p) => maxX(p) === 9, "the right-most column");
  return t.bot.press("up");
}

/** Fill the bottom n rows except the right-most column, then drop an I into the gap. */
async function clearRows(t, n, extra = {}) {
  const rows = { ...extra };
  for (let i = 0; i < n; i++) rows[17 - i] = ROW9;
  await t.poke({ empty: true, rows, piece: "I" });
  return dropI(t);
}

/** Press up over and over (a drop each time) until the round ends or the pass screen comes up. */
async function dieFast(t) {
  let k = 0;
  const r = await t.bot.play(() => (k++ % 2 === 0 ? "up" : ""), { every: 3, max: 3000, anyMode: true, until: (p) => p.passing || p.mode === "over" });
  t.bot.ok(r.reached, `the stack never reached the top; ended at ${JSON.stringify(r.p).slice(0, 200)}`);
  return r.p;
}

async function pickPlayers(t, n) {
  await t.step(31);
  await t.bot.press(n === 2 ? "down" : "up");
  const p = await t.bot.press("start");
  t.bot.eq([p.mode, p.count], ["play", n], "mode and players after START");
  return p;
}

/** @type {Arcade.Checks} */
export default {
  async R1(t) {
    await t.bot.start();
    await t.poke({ piece: "T" });
    const a = await t.bot.wait(1);
    let p = await t.bot.hold("right", 12);
    t.bot.eq(minX(p), minX(a) + 1, "left edge of the piece after holding right 12 frames");
    p = await t.bot.hold("right", 1);
    t.bot.eq(minX(p), minX(a) + 2, "after holding right 13 frames (the repeat after 12)");
    p = await t.bot.hold("right", 4);
    t.bot.eq(minX(p), minX(a) + 3, "after holding right 17 frames (a repeat every 4)");
    p = await t.bot.hold("right", 60);
    t.bot.eq(maxX(p), 9, "right-most column at the right wall");
    p = await t.bot.hold("left", 120);
    t.bot.eq(minX(p), 0, "left-most column at the left wall");
    const q = await t.bot.press("right");
    t.bot.eq(minX(q), 1, "a single press moves one cell");
    // blocks stop it too: a wall of blocks to the right
    await t.poke({ empty: true, rows: { 0: ".......#..", 1: ".......#..", 2: ".......#..", 3: ".......#.." }, piece: "T" });
    const b = await t.bot.hold("right", 60);
    t.bot.eq(maxX(b), 6, "right edge of the T, stopped by the block wall at column 7");
  },

  async R2(t) {
    await t.bot.start();
    await t.poke({ piece: "T" });
    const o = norm(await t.bot.wait(1));
    const a1 = norm(await t.bot.press("a"));
    t.bot.ok(a1 !== o, "A should turn a T piece");
    await t.bot.press("a");
    await t.bot.press("a");
    t.bot.eq(norm(await t.bot.press("a")), o, "the T after 4 turns with A");
    const b1 = norm(await t.bot.press("b"));
    t.bot.ok(b1 !== o && b1 !== a1, "B should turn the other way from A");
    t.bot.eq(norm(await t.bot.press("a")), o, "A after B undoes it");
    // nudged aside against the wall: a vertical I at the right wall turned flat must stay on the board
    await t.poke({ empty: true, rows: {}, piece: "I" });
    await t.bot.press("a");
    await t.bot.reach((p) => (maxX(p) < 9 ? "right" : ""), (p) => maxX(p) === 9, "the right wall");
    const f = await t.bot.press("b");
    const ys = new Set(f.piece.cells.map((c) => c[1]));
    t.bot.ok(ys.size === 1 && maxX(f) <= 9 && minX(f) >= 0, `the I should turn flat and be nudged inside the board, got ${JSON.stringify(f.piece.cells)}`);
    // blocked: a vertical I in a one-wide shaft can't turn flat anywhere, so the turn doesn't happen
    await t.poke({ empty: true, rows: {}, piece: "I" });
    await t.bot.press("a");
    await t.bot.hold("down", 12);
    const rows = {};
    for (let y = 2; y < 14; y++) rows[y] = "#####.####";
    await t.poke({ rows });
    const v1 = await t.bot.wait(1);
    const v2 = await t.bot.press("b");
    t.bot.eq(v2.piece.cells, v1.piece.cells, "a turn with no room does nothing");
  },

  async R3(t) {
    await t.bot.start();
    await t.poke({ piece: "T" });
    const a = await t.bot.wait(1);
    const p = await t.bot.hold("down", 30);
    const dy = minY(p) - minY(a);
    t.bot.ok(dy >= 9 && dy <= 11, `holding down 30 frames should move the piece about 10 rows, moved ${dy}`);
    const q = await t.bot.hold("", 10);
    t.bot.eq(minY(q), minY(p), "with down let go, the piece falls slowly again");
  },

  async R4(t) {
    await t.bot.start();
    await t.poke({ piece: "T" });
    const a = await t.bot.wait(1);
    t.bot.eq(a.spawned.length, 1, "pieces so far");
    const p = await t.bot.press("up", 0);
    t.bot.eq(p.spawned.length, 2, "a new piece appears in the same frame as the drop");
    const bottom = p.board[17];
    t.bot.ok(bottom.includes("#"), "the dropped piece should be locked on the bottom row");
    t.bot.eq(p.board.join("").split("#").length - 1, 4, "locked cells");
    t.bot.ok(minY(p) <= 1, "the new piece is at the top");
  },

  async R5(t) {
    const a = await t.bot.start();
    t.bot.eq([a.level, a.fall], [1, 48], "level and frames per row at the start");
    const y0 = minY(a);
    let p = await t.bot.wait(45);
    t.bot.eq(minY(p), y0, "row after 46 frames");
    p = await t.bot.wait(5);
    t.bot.eq(minY(p), y0 + 1, "row after 51 frames");
    p = await t.bot.wait(40);
    t.bot.eq(minY(p), y0 + 1, "row after 91 frames");
    p = await t.bot.wait(8);
    t.bot.eq(minY(p), y0 + 2, "row after 99 frames");
    // it lands by itself and locks
    const r = await t.bot.reach(() => "", (q) => q.spawned.length === 2, "a piece landing by itself", { every: 12, max: 2000 });
    t.bot.eq(r.board.join("").split("#").length - 1, 4, "locked cells after the first piece landed");
    t.bot.ok(minY(r) <= 1, "the next piece starts at the top");
  },

  async R6(t) {
    let p = await t.bot.start();
    let k = 0;
    while (p.spawned.length < 14) {
      const want = p.next;
      if (k % 3 === 0) await t.bot.hold("left", 30);
      else if (k % 3 === 2) await t.bot.hold("right", 30);
      p = await t.bot.press("up", 1); // one frame of release after, so the next press counts as a new press
      t.bot.ok(p.mode === "play", `ran out of room after ${p.spawned.length} pieces`);
      t.bot.eq(p.piece.type, want, "the piece that comes out is the one that was shown as next");
      k++;
    }
    const kinds = "IJLOSTZ".split("").join("");
    for (const [a, b] of [[0, 7], [7, 14]]) {
      t.bot.eq(p.spawned.slice(a, b).slice().sort().join(""), kinds, `kinds in pieces ${a + 1} to ${b}`);
    }
  },

  async R7(t) {
    await t.bot.start();
    await t.poke({ empty: true, rows: { 16: "#.........", 17: ROW9 }, piece: "I" });
    const p = await dropI(t);
    t.bot.eq(p.lines, 1, "lines after one row was filled");
    t.bot.eq(p.board[17], "#........#", "the bottom row after the clear (the row above dropped down, plus the I's top block)");
    t.bot.eq(p.board[16], ".........#", "the row above that");
    t.bot.eq(p.board.join("").split("#").length - 1, 4, "blocks left on the board");
    // two at once
    await t.poke({ empty: true, rows: { 16: ROW9, 17: ROW9 }, piece: "I" });
    const q = await dropI(t);
    t.bot.eq(q.lines, 3, "lines after two more");
  },

  async R8(t) {
    const want = { 1: 100, 2: 300, 3: 500, 4: 800 };
    for (const n of [1, 2, 3, 4]) {
      await t.reset();
      await t.bot.start();
      const p = await clearRows(t, n);
      t.bot.eq([p.lines, p.score], [n, want[n]], `lines and score after clearing ${n} at once`);
    }
  },

  async R9(t) {
    await t.bot.start();
    let score = 0;
    let lines = 0;
    let p = await t.probe();
    while (lines < 52) {
      const level = 1 + Math.floor(lines / 5);
      p = await clearRows(t, 4);
      lines += 4;
      score += 800 * level;
      t.bot.eq(p.lines, lines, "lines");
      t.bot.eq(p.score, score, `score (800 times level ${level} for four rows)`);
      const nl = 1 + Math.floor(lines / 5);
      t.bot.eq([p.level, p.fall], [nl, Math.max(12, 48 - 4 * (nl - 1))], `level and frames per row at ${lines} lines`);
    }
    t.bot.eq(p.fall, 12, "never faster than one row every 12 frames");
  },

  async R10(t) {
    await t.bot.start();
    const a = await t.bot.wait(1);
    t.bot.eq([a.sparks, a.pops], [0, 0], "sparkles and pop-ups before a clear");
    const p = await clearRows(t, 1);
    t.bot.ok(p.sparks >= 20, `at least 20 sparkles should burst, got ${p.sparks}`);
    t.bot.ok(p.pops >= 1, "a POP! pop-up should show");
    const q = await t.bot.wait(25);
    t.bot.ok(q.sparks > 0, "sparkles should still be flying 27 frames later");
    const r = await t.bot.wait(20);
    t.bot.eq(r.sparks, 0, "sparkles 47 frames after the clear");
  },

  async R11(t) {
    await t.bot.start();
    const a = await t.bot.wait(1);
    t.bot.eq(a.cat, "calm", "cat before any clear");
    const p = await clearRows(t, 2);
    t.bot.eq(p.cat, "happy", "cat right after a clear");
    const q = await t.bot.wait(80);
    t.bot.eq(q.cat, "happy", "cat 82 frames after the clear");
    const r = await t.bot.wait(14);
    t.bot.eq(r.cat, "calm", "cat 96 frames after the clear");
  },

  async R12(t) {
    await t.bot.start();
    await t.poke({ empty: true, rows: { 7: "#........." } });
    t.bot.eq((await t.bot.wait(1)).cat, "calm", "cat with a stack 11 rows tall");
    await t.poke({ empty: true, rows: { 6: "#........." } });
    const s = await t.bot.wait(1);
    t.bot.eq([s.height, s.cat], [12, "sad"], "height and cat with a stack 12 rows tall");
    // a clear makes him happy even though the stack is tall; later he is sad again
    const p = await clearRows(t, 1, { 5: "#........." });
    t.bot.eq(p.cat, "happy", "happy wins over sad right after a clear");
    const q = await t.bot.wait(100);
    t.bot.eq(q.cat, "sad", "sad again once the happy time is over");
  },

  async R13(t) {
    await t.bot.start();
    /** @type {any} */
    let last = null;
    let k = 0;
    const r = await t.bot.play(() => (k++ % 2 === 0 ? "up" : ""), { every: 3, max: 3000, anyMode: true, until: (p) => { if (p.mode === "play") last = p; return p.mode === "over"; } });
    t.bot.ok(r.reached, "the game should end when the stack fills up");
    t.bot.ok(last && last.height >= 12, `the last playing frame should have a tall stack, got ${last && last.height}`);
    t.bot.eq(r.p.mode, "over", "mode when a new piece has no room");
    // the game-over screen is up within one frame: the probe right after the lock already says so
  },

  async R14(t) {
    let p = await t.probe();
    t.bot.eq([p.mode, p.players], ["title", 1], "title mode and players");
    p = await t.bot.press("down");
    t.bot.eq(p.players, 2, "players after down");
    p = await t.bot.press("up");
    t.bot.eq(p.players, 1, "players after up");
    p = await pickPlayers(t, 2);
    t.bot.eq([p.up, p.passing], [1, false], "player 1 is up first");
    p = await dieFast(t);
    t.bot.eq([p.mode, p.passing, p.up], ["play", true, 2], "after player 1's game: pass screen, player 2 up");
    await t.step(10);
    const early = await t.bot.press("a");
    t.bot.ok(early.passing, "the pass screen waits (A in the first 30 frames does nothing)");
    await t.step(31);
    p = await t.bot.press("a");
    t.bot.eq([p.passing, p.up, p.mode], [false, 2, "play"], "player 2 playing after the pass");
    t.bot.eq(p.board.join("").split("#").length - 1, 0, "player 2 starts on an empty board");
    p = await dieFast(t);
    t.bot.eq(p.mode, "over", "mode after both games");
  },

  async R15(t) {
    await pickPlayers(t, 2);
    await dieFast(t);
    await t.step(31);
    await t.bot.press("a");
    await clearRows(t, 1);
    let p = await dieFast(t);
    t.bot.eq(p.mode, "over", "mode after both games");
    t.bot.eq(p.scores, [0, 100], "both scores");
    t.bot.eq(p.winner, 2, "winner");
    // a tie
    await t.reset();
    await pickPlayers(t, 2);
    await dieFast(t);
    await t.step(31);
    await t.bot.press("a");
    p = await dieFast(t);
    t.bot.eq([p.mode, p.scores, p.winner], ["over", [0, 0], 0], "mode, scores and winner for a tie");
  },

  async R16(t) {
    await t.bot.start();
    await clearRows(t, 1);
    const p = await dieFast(t);
    t.bot.eq([p.mode, p.score], ["over", 100], "mode and score at the end");
    t.bot.eq(await t.scores(), [100], "scores reported to the cabinet");
    await t.reset({ keepSave: true });
    const q = await t.probe();
    t.bot.eq([q.mode, q.best], ["title", 100], "mode and best after a restart");
  },
};
