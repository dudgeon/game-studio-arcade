#!/usr/bin/env node
// A falling-blocks player for the headless runtime (D307): it plays a cart the way a careful
// person would, with only button presses (A turns, left/right taps move, up drops), choosing
// each placement by a standard heuristic (lines cleared, holes, height, bumpiness). It reads
// the board from the cart's probe() and never pokes, so what it sees is what play produces.
//
//   node studio-kit/playtest/bin/stack-bot.js CART_DIR [--pieces N] [--seed S] [--finish] [--json]
//   --finish: after the pieces, drop straight down until the game ends
//
// The cart's probe must give { mode, board: ["..#..", ...], piece: { cells: [[x, y], ...] } | null,
// score, lines, level } and may give { sparks, pops, cat }. It reports what happened.
import path from "node:path";
import { parseArgs } from "node:util";
import { loadCart, headless } from "../../../runtime/src/headless.js";

/** Cells moved so the top-left is (0, 0). @param {number[][]} cells */
export const normalize = (cells) => {
  const mx = Math.min(...cells.map((c) => c[0]));
  const my = Math.min(...cells.map((c) => c[1]));
  return cells.map(([x, y]) => [x - mx, y - my]);
};

/**
 * Where a shape would come to rest at column x, and the board after it (rows cleared).
 * @param {string[]} board @param {number[][]} shape normalized @param {number} x
 */
export function dropAt(board, shape, x) {
  const H = board.length;
  const W = board[0].length;
  const filled = (cx, cy) => cy >= 0 && board[cy][cx] === "#";
  if (shape.some(([cx]) => x + cx < 0 || x + cx >= W)) return null;
  let y = -4;
  const fits = (yy) => shape.every(([cx, cy]) => yy + cy < H && !filled(x + cx, yy + cy));
  if (!fits(y)) return null;
  while (fits(y + 1)) y++;
  if (shape.some(([, cy]) => y + cy < 0)) return null; // sticks out of the top
  const rows = board.map((r) => r.split(""));
  for (const [cx, cy] of shape) rows[y + cy][x + cx] = "#";
  const kept = rows.filter((r) => r.includes("."));
  const lines = H - kept.length;
  const after = [...Array.from({ length: lines }, () => ".".repeat(W).split("")), ...kept].map((r) => r.join(""));
  return { after, lines };
}

/** The usual stacking score: lines good; height, holes and bumps bad. @param {string[]} board @param {number} lines */
export function rate(board, lines) {
  const H = board.length;
  const W = board[0].length;
  const heights = [];
  let holes = 0;
  for (let x = 0; x < W; x++) {
    let top = H;
    for (let y = 0; y < H; y++) if (board[y][x] === "#") { top = y; break; }
    heights.push(H - top);
    for (let y = top + 1; y < H; y++) if (board[y][x] !== "#") holes++;
  }
  const agg = heights.reduce((a, b) => a + b, 0);
  let bump = 0;
  for (let x = 1; x < W; x++) bump += Math.abs(heights[x] - heights[x - 1]);
  return -0.51 * agg + 0.76 * lines - 0.36 * holes - 0.18 * bump;
}

/**
 * Play one game to its end, or `pieces` pieces.
 * @param {string} cartDir @param {{ pieces?: number, seed?: number, finish?: boolean }} [o]
 */
export async function playStack(cartDir, o = {}) {
  const cart = await loadCart(path.join(path.resolve(cartDir), "game.js"));
  const t = await headless(cart, { seed: o.seed ?? 1 });
  const press = async (b, hold = 1, gap = 1) => {
    await t.input([{ frames: hold, p1: b }, { frames: gap }]);
    await t.step(hold + gap);
  };
  const probe = async () => /** @type {any} */ (await t.probe());
  /** @type {{ pieces: number, clears: { piece: number, rows: number, scoreAdded: number, level: number, cat: string }[], sawPops: boolean, sawSparks: boolean, moods: Set<string>, scoreSteps: number[] }} */
  const log = { pieces: 0, clears: [], sawPops: false, sawSparks: false, moods: new Set(), scoreSteps: [] };
  // Title, then a 1-player game.
  await t.step(30);
  await press("start", 2, 10);
  let p = await probe();
  if (p.mode !== "play") {
    await press("a", 2, 10);
    p = await probe();
  }
  let lastScore = p.score ?? 0;
  let lastLines = p.lines ?? 0;
  const maxPieces = o.pieces ?? 400;
  while (log.pieces < maxPieces) {
    p = await probe();
    if (p.mode === "over" || p.mode === "title") break;
    if (!p.piece) {
      await t.step(1);
      continue;
    }
    // Learn the piece's four turns by turning it, back to where it started.
    const shapes = [];
    for (let r = 0; r < 4; r++) {
      const q = await probe();
      if (!q.piece) break;
      shapes.push(normalize(q.piece.cells));
      await press("a");
    }
    let best = { score: -Infinity, r: 0, x: 0 };
    const seen = new Set();
    shapes.forEach((shape, r) => {
      const key = JSON.stringify(shape);
      if (seen.has(key)) return;
      seen.add(key);
      for (let x = -1; x < p.board[0].length; x++) {
        const d = dropAt(p.board, shape, x);
        if (!d) continue;
        const sc = rate(d.after, d.lines);
        if (sc > best.score) best = { score: sc, r, x };
      }
    });
    for (let r = 0; r < best.r; r++) await press("a");
    for (let i = 0; i < 12; i++) {
      const q = await probe();
      if (!q.piece) break;
      const mx = Math.min(...q.piece.cells.map((c) => c[0]));
      if (mx === best.x) break;
      await press(mx > best.x ? "left" : "right");
    }
    await press("up", 1, 2);
    log.pieces++;
    // What the drop did: a clear, POP, sparkles, the cat.
    for (let f = 0; f < 6; f++) {
      const q = await probe();
      if (q.pops > 0) log.sawPops = true;
      if (q.sparks > 0) log.sawSparks = true;
      if (q.cat) log.moods.add(q.cat);
      await t.step(1);
    }
    const q = await probe();
    if (q.lines > lastLines) {
      log.clears.push({ piece: log.pieces, rows: q.lines - lastLines, scoreAdded: q.score - lastScore, level: q.level, cat: q.cat });
    }
    if (q.score !== lastScore) log.scoreSteps.push(q.score - lastScore);
    lastScore = q.score ?? lastScore;
    lastLines = q.lines ?? lastLines;
  }
  // Then let it top out, to see how a game ends: the round's score reported, and the cat's face as the stack rises.
  if (o.finish) {
    // Wait out any happy dance from the last clear first, or it hides the rest of the cat's moods.
    await t.step(120);
    for (let i = 0; i < 600; i++) {
      const q = await probe();
      if (q.mode !== "play") break;
      if (q.cat) log.moods.add(q.cat);
      await press("up", 1, 3);
    }
    await t.step(30);
  }
  const end = await probe();
  return { ...log, moods: [...log.moods], final: { mode: end.mode, score: lastScore, lines: lastLines, level: end.level, height: end.height }, reported: await t.scores() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { pieces: { type: "string" }, seed: { type: "string" }, json: { type: "boolean" }, finish: { type: "boolean" } } });
  const r = await playStack(positionals[0], { pieces: values.pieces ? Number(values.pieces) : undefined, seed: values.seed ? Number(values.seed) : undefined, finish: values.finish });
  if (values.json) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`pieces ${r.pieces}; lines ${r.final.lines}; score ${r.final.score}; level ${r.final.level}; ended in ${r.final.mode}`);
    console.log(`clears: ${r.clears.map((c) => `${c.rows} row${c.rows > 1 ? "s" : ""} +${c.scoreAdded} (L${c.level}, cat ${c.cat})`).join("; ") || "none"}`);
    console.log(`POP seen: ${r.sawPops}; sparkles seen: ${r.sawSparks}; cat moods: ${r.moods.join(", ")}; scores reported by g.score: ${JSON.stringify(r.reported)}`);
  }
}
