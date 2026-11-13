// @ts-check
// Candy Cat Drop: falling candy blocks, POP and sparkles on full rows, and a little cat who cheers and worries.

const CFG = {
  cols: 10, rows: 18, cell: 8, boardY: 4,
  fall0: 48, fallStep: 4, fallMin: 12, linesPerLevel: 5,
  softEvery: 3, repeatDelay: 12, repeatRate: 4,
  happyFrames: 90, sadHeight: 12,
  sparkLife: 40, sparkPerCell: 3,
  points: [0, 100, 300, 500, 800],
};

const KINDS = "IOTSZJL";
const SHAPES = {
  I: ["....", "####", "....", "...."],
  O: ["##", "##"],
  T: [".#.", "###", "..."],
  S: [".##", "##.", "..."],
  Z: ["##.", ".##", "..."],
  J: ["#..", "###", "..."],
  L: ["..#", "###", "..."],
};

// Candy look per kind (value 1..7 on the board; 8 is a plain gray jelly used only by test setup).
// base, light, dark, pattern: 0 stripes, 1 sprinkles, 2 swirl
const CANDY = {
  1: ["aqua", "ice", "teal", 0],
  2: ["yellow", "white", "orange", 1],
  3: ["magenta", "pink", "purple", 2],
  4: ["lime", "mint", "green", 0],
  5: ["red", "coral", "maroon", 1],
  6: ["blue", "sky", "navy", 2],
  7: ["orange", "peach", "brown", 0],
  8: ["silver", "white", "gray", 1],
};

/** @typedef {any} State */

const fallFor = (level) => Math.max(CFG.fallMin, CFG.fall0 - CFG.fallStep * (level - 1));
const levelFor = (lines) => 1 + Math.floor(lines / CFG.linesPerLevel);

/** @param {any} g @param {string} type */
function makePiece(g, type) {
  const shape = g.lib.grid.shape(SHAPES[type]);
  return { type, shape, x: Math.floor((CFG.cols - shape.n) / 2), y: type === "I" ? -1 : 0 };
}

/** Keep the queue at 2 or more pieces, adding a shuffled bag of all 7 kinds when short. @param {any} g @param {State} s */
function fillQueue(g, s) {
  while (s.queue.length < 2) {
    const bag = KINDS.split("");
    for (let i = bag.length - 1; i > 0; i--) {
      const j = g.rnd(i + 1);
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    s.queue.push(...bag);
  }
}

/** Bring in the next piece. False if there is no room. @param {any} g @param {State} s */
function spawn(g, s) {
  fillQueue(g, s);
  const type = s.queue.shift();
  fillQueue(g, s);
  s.next = s.queue[0];
  s.piece = makePiece(g, type);
  s.spawned.push(type);
  g.lib.timers.restart(s.gravity, fallFor(s.level));
  return g.lib.grid.fits(s.board, s.piece.shape, s.piece.x, s.piece.y);
}

/** A fresh board and counters for one player's game. @param {any} g @param {State} s */
function newRound(g, s) {
  const { grid, timers } = g.lib;
  s.board = grid.make(CFG.cols, CFG.rows);
  s.score = 0;
  s.lines = 0;
  s.level = 1;
  s.queue = [];
  s.spawned = [];
  s.sparks = [];
  s.rings = [];
  s.pops = [];
  s.happy = 0;
  s.downN = 0;
  s.downBlock = false;
  s.gravity = timers.timer(fallFor(1), true);
  s.lrep = timers.repeat(CFG.repeatDelay, CFG.repeatRate);
  s.rrep = timers.repeat(CFG.repeatDelay, CFG.repeatRate);
  s.piece = null;
  spawn(g, s);
}

/** Rows from the top block to the floor. @param {State} s */
function stackHeight(s) {
  const { board } = s;
  for (let y = 0; y < board.h; y++) {
    for (let x = 0; x < board.w; x++) if (board.cells[y * board.w + x] !== 0) return board.h - y;
  }
  return 0;
}

/** @param {State} s */
function mood(s) {
  if (s.happy > 0) return "happy";
  if (stackHeight(s) >= CFG.sadHeight) return "sad";
  return "calm";
}

const boardX = (g) => Math.floor((g.W - CFG.cols * CFG.cell) / 2);

/** Rows just filled: burst sparkles, a pop, points, lines. @param {any} g @param {State} s @param {number[]} rows */
function popRows(g, s, rows) {
  const c = g.colors;
  const bx = boardX(g);
  const colors = [c.yellow, c.pink, c.aqua, c.white, c.lime, c.orange, c.lilac];
  for (const y of rows) {
    for (let x = 0; x < CFG.cols; x++) {
      const v = s.board.cells[y * CFG.cols + x];
      const cx = bx + x * CFG.cell + CFG.cell / 2;
      const cy = CFG.boardY + y * CFG.cell + CFG.cell / 2;
      s.rings.push({ x: cx, y: cy, life: 12, c: c[CANDY[v] ? CANDY[v][1] : "white"] });
      for (let k = 0; k < CFG.sparkPerCell; k++) {
        s.sparks.push({ x: cx, y: cy, vx: (g.rand() - 0.5) * 2.4, vy: -0.3 - g.rand() * 1.5, life: CFG.sparkLife, c: g.pick(colors) });
      }
    }
  }
  const mid = CFG.boardY + (rows[0] + rows[rows.length - 1]) / 2 * CFG.cell;
  g.lib.fx.pop(s.pops, "POP!", g.W / 2, mid, c.yellow, 40);
  const pts = CFG.points[Math.min(4, rows.length)] * s.level;
  g.lib.fx.pop(s.pops, `+${pts}`, g.W / 2, mid + 10, c.white, 40);
  s.score += pts;
  g.lib.grid.clearRows(s.board, rows);
  s.lines += rows.length;
  s.level = levelFor(s.lines);
  s.happy = CFG.happyFrames;
  g.sfx("pop");
  if (rows.length >= 4) g.sfx("powerup");
}

/** Lock the piece, clear rows, bring in the next piece (or end the round). @param {any} g @param {State} s */
function lockPiece(g, s) {
  const { grid, turns } = g.lib;
  const above = grid.place(s.board, s.piece, KINDS.indexOf(s.piece.type) + 1);
  s.piece = null;
  s.downBlock = true;
  const rows = grid.fullRows(s.board);
  if (rows.length) popRows(g, s, rows);
  else g.sfx("blip", { pitch: 0.6 });
  s.downN = 0;
  if (above > 0 || !spawn(g, s)) endRound(g, s);
}

/** @param {any} g @param {State} s */
function endRound(g, s) {
  const { turns, score, flow } = g.lib;
  turns.addScore(s.turns, s.score);
  turns.next(g, s.turns);
  if (turns.isOver(s.turns)) {
    const best = Math.max(...s.turns.scores);
    const sc = score.newScore(g, { lives: 1 });
    score.addPoints(sc, best);
    score.commit(g, sc);
    s.sc = sc;
    s.winner = s.turns.count > 1 ? turns.winner(s.turns) : 1;
    s.piece = null;
    g.sfx("lose");
    flow.go(s.flow, "over");
  } else {
    g.sfx("lose");
    newRound(g, s);
  }
}

/** @param {any} g @param {State} s */
function stepDown(g, s) {
  if (!g.lib.grid.tryMove(s.board, s.piece, 0, 1)) lockPiece(g, s);
}

/** @param {any} g @param {State} s @param {number} dir */
function turnPiece(g, s, dir) {
  if (g.lib.grid.tryRotate(s.board, s.piece, dir)) g.sfx("select", { vol: 0.5 });
}

/** @param {any} g @param {State} s @param {number} dx */
function slide(g, s, dx) {
  g.lib.grid.tryMove(s.board, s.piece, dx, 0);
}

export default {
  init(g) {
    const s = /** @type {State} */ ({ flow: g.lib.flow.newFlow(), players: 1, winner: 0, art: {} });
    s.sc = g.lib.score.newScore(g, { lives: 1 });
    s.turns = g.lib.turns.newTurns(1, { rounds: 1 });
    s.board = g.lib.grid.make(CFG.cols, CFG.rows);
    s.piece = null; s.next = null; s.spawned = [];
    s.score = 0; s.lines = 0; s.level = 1;
    s.sparks = []; s.rings = []; s.pops = []; s.happy = 0;
    s.gravity = g.lib.timers.timer(CFG.fall0, true);
    return s;
  },

  update(g, s) {
    const { flow, turns, timers, fx } = g.lib;
    flow.tick(s.flow);
    fx.tick(s.pops);
    for (let i = s.sparks.length - 1; i >= 0; i--) {
      const k = s.sparks[i];
      k.x += k.vx; k.y += k.vy; k.vy += 0.04; k.life -= 1;
      if (k.life <= 0) s.sparks.splice(i, 1);
    }
    for (let i = s.rings.length - 1; i >= 0; i--) if (--s.rings[i].life <= 0) s.rings.splice(i, 1);
    if (s.happy > 0) s.happy -= 1;

    if (s.flow.mode === "title") {
      if (g.btnp("up")) s.players = 1;
      if (g.btnp("down")) s.players = 2;
      if (flow.startPressed(g, s.flow)) {
        s.turns = turns.newTurns(s.players, { rounds: 1 });
        s.sc = g.lib.score.newScore(g, { lives: 1 });
        newRound(g, s);
        flow.go(s.flow, "play");
      }
      return;
    }
    if (s.flow.mode === "over") {
      if (flow.startPressed(g, s.flow)) flow.go(s.flow, "title");
      return;
    }

    if (turns.waiting(g, s.turns)) return;
    if (!s.piece) return;

    const lt = timers.repeatTick(s.lrep, turns.btn(g, s.turns, "left"));
    const rt = timers.repeatTick(s.rrep, turns.btn(g, s.turns, "right"));
    if (lt) slide(g, s, -1);
    else if (rt) slide(g, s, 1);
    if (turns.btnp(g, s.turns, "a")) turnPiece(g, s, 1);
    if (turns.btnp(g, s.turns, "b")) turnPiece(g, s, -1);

    if (turns.btnp(g, s.turns, "up")) {
      s.piece.y += g.lib.grid.dropDistance(s.board, s.piece);
      g.sfx("hit", { vol: 0.5 });
      lockPiece(g, s);
      return;
    }
    const down = turns.btn(g, s.turns, "down");
    if (!down) { s.downN = 0; s.downBlock = false; }
    else if (!s.downBlock) {
      s.downN += 1;
      if (s.downN % CFG.softEvery === 1) {
        stepDown(g, s);
        if (!s.piece) return;
      }
    }
    if (timers.tick(s.gravity)) stepDown(g, s);
  },

  draw(g, s) {
    const { fx, turns } = g.lib;
    const c = g.colors;
    if (s.flow.mode === "title") return drawTitle(g, s);
    if (s.flow.mode === "play" && turns.drawPass(g, s.turns, { color: c.pink, bg: c.plum })) return;
    drawBackdrop(g);
    drawSide(g, s);
    drawBoard(g, s);
    drawCat(g, g.W / 2, g.H - 3, mood(s), s.flow.t + g.frame);
    for (const k of s.sparks) drawSpark(g, k);
    for (const r of s.rings) g.circ(r.x, r.y, 2 + (12 - r.life) * 0.7, r.c);
    fx.draw(g, s.pops);
    if (s.flow.mode === "over") drawOver(g, s);
  },

  probe(g, s) {
    const { grid } = g.lib;
    const cells = s.piece ? grid.cellsAt(s.piece.shape, s.piece.x, s.piece.y) : null;
    const rows = [];
    for (let y = 0; y < s.board.h; y++) {
      let r = "";
      for (let x = 0; x < s.board.w; x++) r += s.board.cells[y * s.board.w + x] ? "#" : ".";
      rows.push(r);
    }
    return {
      W: g.W, H: g.H, mode: s.flow.mode,
      players: s.players, count: s.turns.count, up: s.turns.up, passing: s.turns.passing,
      scores: [...s.turns.scores], winner: s.flow.mode === "over" ? s.winner : null,
      board: rows, piece: s.piece ? { type: s.piece.type, cells } : null,
      next: s.next, spawned: [...s.spawned],
      score: s.score, lines: s.lines, level: s.level, fall: s.gravity.len,
      best: s.sc.best, height: stackHeight(s), sparks: s.sparks.length, pops: s.pops.length,
      cat: mood(s),
    };
  },

  poke(g, s, o) {
    const { grid, timers } = g.lib;
    if (o.empty) s.board = grid.make(CFG.cols, CFG.rows);
    if (o.rows) {
      for (const [ys, str] of Object.entries(o.rows)) {
        for (let x = 0; x < CFG.cols; x++) grid.set(s.board, x, Number(ys), String(str)[x] === "#" ? 8 : 0);
      }
    }
    if (o.piece) {
      s.piece = makePiece(g, o.piece);
      s.spawned[s.spawned.length - 1] = o.piece;
      timers.restart(s.gravity, fallFor(s.level));
    }
  },
};

// ---------- drawing ----------

/** One candy block with its top-left at x, y. @param {any} g @param {number} v @param {number} x @param {number} y */
function drawCandy(g, v, x, y) {
  const c = g.colors;
  const [bn, ln, dn, pat] = CANDY[v];
  const base = c[bn], light = c[ln], dark = c[dn];
  g.rectfill(x + 1, y, 6, 8, dark);
  g.rectfill(x, y + 1, 8, 6, dark);
  g.rectfill(x + 1, y + 1, 6, 5, base);
  g.rectfill(x + 1, y + 1, 6, 1, base);
  // shiny spot
  g.pset(x + 2, y + 2, c.white);
  g.pset(x + 3, y + 2, light);
  g.pset(x + 2, y + 3, light);
  if (pat === 0) {
    g.pset(x + 5, y + 2, light); g.pset(x + 4, y + 3, light); g.pset(x + 3, y + 4, light); g.pset(x + 2, y + 5, light);
  } else if (pat === 1) {
    g.pset(x + 5, y + 2, light); g.pset(x + 4, y + 4, light); g.pset(x + 2, y + 5, light); g.pset(x + 5, y + 5, light);
  } else {
    g.pset(x + 4, y + 3, light); g.pset(x + 5, y + 4, light); g.pset(x + 4, y + 5, light); g.pset(x + 3, y + 4, light);
  }
}

/** @param {any} g */
function drawBackdrop(g) {
  const c = g.colors;
  g.cls(c.plum);
  for (let i = 0; i < 28; i++) {
    const x = (i * 83 + 17) % g.W;
    const y = (i * 47 + 5) % g.H;
    if ((g.frame + i * 11) % 90 < 70) g.pset(x, y, i % 3 === 0 ? c.pink : c.lilac);
  }
}

/** @param {any} g @param {State} s */
function drawBoard(g, s) {
  const c = g.colors;
  const bx = boardX(g);
  const by = CFG.boardY;
  const w = CFG.cols * CFG.cell;
  const h = CFG.rows * CFG.cell;
  g.rectfill(bx - 3, by - 3, w + 6, h + 6, c.pink);
  g.rectfill(bx - 2, by - 2, w + 4, h + 4, c.magenta);
  g.rectfill(bx, by, w, h, c.night);
  for (let y = 0; y < CFG.rows; y++) {
    for (let x = 0; x < CFG.cols; x++) {
      if ((x + y) % 2 === 0) g.rectfill(bx + x * CFG.cell, by + y * CFG.cell, CFG.cell, CFG.cell, c.navy);
      const v = s.board.cells[y * CFG.cols + x];
      if (v) drawCandy(g, v, bx + x * CFG.cell, by + y * CFG.cell);
    }
  }
  if (s.piece && s.flow.mode === "play" && !s.turns.passing) {
    const { grid } = g.lib;
    const d = grid.dropDistance(s.board, s.piece);
    for (const [x, y] of grid.cellsAt(s.piece.shape, s.piece.x, s.piece.y + d)) {
      if (y >= 0) g.rect(bx + x * CFG.cell + 1, by + y * CFG.cell + 1, CFG.cell - 2, CFG.cell - 2, c.slate);
    }
    const v = KINDS.indexOf(s.piece.type) + 1;
    for (const [x, y] of grid.cellsAt(s.piece.shape, s.piece.x, s.piece.y)) {
      if (y >= 0) drawCandy(g, v, bx + x * CFG.cell, by + y * CFG.cell);
    }
  }
}

/** @param {any} g @param {State} s */
function drawSide(g, s) {
  const c = g.colors;
  const bx = boardX(g);
  const lx = 6;
  const label = (t, y, col) => g.text(t, lx, y, col);
  g.text(s.turns.count > 1 ? `PLAYER ${s.turns.up}` : "CANDY CAT", lx, 6, c.yellow);
  label("SCORE", 24, c.pink);
  g.text(String(s.score), lx, 34, c.white);
  label("LINES", 54, c.pink);
  g.text(String(s.lines), lx, 64, c.white);
  label("LEVEL", 84, c.pink);
  g.text(String(s.level), lx, 94, c.white);
  label("BEST", 114, c.pink);
  g.text(String(s.sc.best), lx, 124, c.white);
  // next piece
  const nx = bx + CFG.cols * CFG.cell + 12;
  g.text("NEXT", nx + 8, 6, c.pink);
  g.rectfill(nx, 18, 46, 40, c.night);
  g.rect(nx, 18, 46, 40, c.magenta);
  if (s.next) {
    const shape = g.lib.grid.shape(SHAPES[s.next]);
    const v = KINDS.indexOf(s.next) + 1;
    const rows = shape.cells.map((p) => p[1]);
    const cols = shape.cells.map((p) => p[0]);
    const w = (Math.max(...cols) - Math.min(...cols) + 1) * CFG.cell;
    const h = (Math.max(...rows) - Math.min(...rows) + 1) * CFG.cell;
    const ox = nx + Math.floor((46 - w) / 2) - Math.min(...cols) * CFG.cell;
    const oy = 18 + Math.floor((40 - h) / 2) - Math.min(...rows) * CFG.cell;
    for (const [x, y] of shape.cells) drawCandy(g, v, ox + x * CFG.cell, oy + y * CFG.cell);
  }
}

/** A tiny sparkle star. @param {any} g @param {{x:number,y:number,life:number,c:number}} k */
function drawSpark(g, k) {
  const x = Math.floor(k.x), y = Math.floor(k.y);
  if (k.life < 12 && k.life % 4 < 2) return;
  g.pset(x, y, g.colors.white);
  g.pset(x - 1, y, k.c); g.pset(x + 1, y, k.c); g.pset(x, y - 1, k.c); g.pset(x, y + 1, k.c);
  if (k.life > 24) { g.pset(x - 2, y, k.c); g.pset(x + 2, y, k.c); g.pset(x, y - 2, k.c); g.pset(x, y + 2, k.c); }
}

/** Little cat sitting on a candy cushion; feet at (cx, by). @param {any} g @param {number} cx @param {number} by @param {string} m @param {number} t */
function drawCat(g, cx, by, m, t) {
  const c = g.colors;
  const fur = c.orange, light = c.peach, dark = c.brown;
  const happy = m === "happy", sad = m === "sad";
  const bob = happy ? Math.floor(Math.abs(Math.sin(t * 0.25)) * 5) : 0;
  const sway = happy ? Math.round(Math.sin(t * 0.25) * 2) : 0;
  const slump = sad ? 2 : 0;
  // cushion
  g.rectfill(cx - 18, by - 3, 36, 4, c.pink);
  g.rectfill(cx - 16, by - 4, 32, 2, c.rose);
  const y0 = by - 4 - bob + slump; // base of the cat
  // tail
  const tw = happy ? Math.round(Math.sin(t * 0.4) * 4) : sad ? 0 : Math.round(Math.sin(t * 0.08) * 2);
  g.line(cx + 8, y0 - 3, cx + 13 + tw, y0 - 9, fur);
  g.line(cx + 8, y0 - 4, cx + 13 + tw, y0 - 10, fur);
  g.line(cx + 13 + tw, y0 - 9, cx + 14 + tw, y0 - 13, fur);
  g.circfill(cx + 14 + tw, y0 - 13, 1, light);
  // body
  g.circfill(cx, y0 - 7, 8, fur);
  g.rectfill(cx - 8, y0 - 4, 17, 5, fur);
  g.circfill(cx, y0 - 5, 4, light);
  // paws
  if (happy) {
    g.rectfill(cx - 11 - (sway > 0 ? 1 : 0), y0 - 21, 3, 6, fur); g.rectfill(cx + 9 + (sway < 0 ? 1 : 0), y0 - 21, 3, 6, fur);
    g.pset(cx - 10, y0 - 21, light); g.pset(cx + 10, y0 - 21, light);
  } else {
    g.rectfill(cx - 5, y0 - 1, 4, 2, light); g.rectfill(cx + 2, y0 - 1, 4, 2, light);
  }
  // head
  const hx = cx + (happy ? sway : 0);
  const hy = y0 - 17 + (sad ? 1 : 0);
  // ears
  const ey = sad ? 2 : 0;
  for (let i = 0; i < 6; i++) {
    g.rectfill(hx - 9 + i * (sad ? 0 : 0), hy - 6 + i + ey, Math.max(1, 6 - i), 1, fur);
    g.rectfill(hx + 4 + i, hy - 6 + i + ey, Math.max(1, 6 - i), 1, fur);
  }
  g.pset(hx - 8, hy - 3 + ey, c.pink); g.pset(hx + 8, hy - 3 + ey, c.pink);
  g.circfill(hx, hy, 8, fur);
  g.rectfill(hx - 8, hy - 1, 17, 4, fur);
  // cheeks
  g.circfill(hx - 6, hy + 3, 1, c.coral); g.circfill(hx + 6, hy + 3, 1, c.coral);
  // eyes and mouth
  if (happy) {
    // star eyes + big open smile
    for (const ex of [hx - 4, hx + 4]) {
      g.pset(ex, hy - 2, c.yellow); g.pset(ex - 1, hy - 1, c.yellow); g.pset(ex + 1, hy - 1, c.yellow);
      g.pset(ex, hy - 1, c.white); g.pset(ex, hy, c.yellow); g.pset(ex, hy - 3, c.yellow);
      g.pset(ex - 2, hy - 1, c.yellow); g.pset(ex + 2, hy - 1, c.yellow);
    }
    g.rectfill(hx - 3, hy + 2, 7, 1, c.maroon);
    g.rectfill(hx - 2, hy + 3, 5, 2, c.maroon);
    g.rectfill(hx - 1, hy + 4, 3, 1, c.red);
    // confetti stars around
    for (let i = 0; i < 4; i++) {
      const a = t * 0.1 + i * 1.57;
      const sx = Math.round(cx + Math.cos(a) * 20), sy = Math.round(y0 - 14 + Math.sin(a) * 10);
      g.pset(sx, sy, c.yellow); g.pset(sx - 1, sy, c.white); g.pset(sx + 1, sy, c.white); g.pset(sx, sy - 1, c.white); g.pset(sx, sy + 1, c.white);
    }
  } else if (sad) {
    // droopy eyes, slanted brows, frown, and a tear
    for (const ex of [hx - 4, hx + 4]) {
      g.rectfill(ex - 1, hy - 1, 3, 3, c.black);
      g.pset(ex - 1, hy - 1, c.white);
      g.rectfill(ex - 1, hy + 2, 3, 1, c.sky);
    }
    g.line(hx - 6, hy - 5, hx - 2, hy - 3, dark);
    g.line(hx + 6, hy - 5, hx + 2, hy - 3, dark);
    g.pset(hx - 1, hy + 4, c.black); g.pset(hx, hy + 3, c.black); g.pset(hx + 1, hy + 4, c.black);
    const ty = Math.floor(t / 6) % 8;
    g.circfill(hx - 6, hy + 3 + ty, 1, c.sky);
    g.pset(hx - 6, hy + 2 + ty, c.ice);
  } else {
    for (const ex of [hx - 4, hx + 4]) {
      g.rectfill(ex - 1, hy - 2, 3, 4, c.black);
      g.pset(ex - 1, hy - 2, c.white);
    }
    g.pset(hx - 1, hy + 3, c.black); g.pset(hx, hy + 4, c.black); g.pset(hx + 1, hy + 3, c.black);
    g.pset(hx, hy + 1, c.pink);
  }
  // whiskers
  g.line(hx - 9, hy + 1, hx - 12, hy, dark); g.line(hx - 9, hy + 3, hx - 12, hy + 4, dark);
  g.line(hx + 9, hy + 1, hx + 12, hy, dark); g.line(hx + 9, hy + 3, hx + 12, hy + 4, dark);
  // collar and bell
  g.rectfill(hx - 4, hy + 7, 9, 1, c.red);
  g.circfill(hx, hy + 9, 1, c.yellow);
}

/** @param {any} g @param {State} s */
function drawTitle(g, s) {
  const { fx } = g.lib;
  const c = g.colors;
  g.cls(c.plum);
  for (let i = 0; i < 30; i++) {
    const x = (i * 83 + 17) % g.W, y = (i * 47 + 5) % g.H;
    if ((g.frame + i * 11) % 90 < 70) g.pset(x, y, i % 3 === 0 ? c.pink : c.lilac);
  }
  const art = fx.title(g, "CANDY CAT DROP", s.sc.best, { color: c.pink, ink: c.white });
  // a row of candies and the cat
  const y = art.cy - art.h / 2 + 4;
  for (let i = 0; i < 7; i++) drawCandy(g, i + 1, g.W / 2 - 92 + i * 12 + (i > 3 ? 56 : 0), y + 4 + Math.round(Math.sin((g.frame + i * 8) * 0.1) * 2));
  drawCat(g, g.W / 2, y + 28, Math.floor(g.frame / 120) % 2 ? "happy" : "calm", g.frame);
  const sel = (n, label, yy) => {
    const on = s.players === n;
    g.text(`${on ? "> " : "  "}${label}${on ? " <" : "  "}`, g.W / 2, yy, on ? c.yellow : c.lilac, { align: "center" });
  };
  sel(1, "1 PLAYER", y + 38);
  sel(2, "2 PLAYERS", y + 48);
  g.text("LEFT/RIGHT MOVE  A/B TURN", g.W / 2, y + 62, c.white, { align: "center" });
  g.text("UP DROPS  DOWN SPEEDS UP", g.W / 2, y + 71, c.white, { align: "center" });
  g.text("FILL A LINE TO MAKE IT POP", g.W / 2, y + 80, c.white, { align: "center" });
}

/** @param {any} g @param {State} s */
function drawOver(g, s) {
  const c = g.colors;
  const two = s.turns.count > 1;
  const w = 172, h = two ? 62 : 52;
  const x = (g.W - w) / 2, y = (g.H - h) / 2 - 10;
  g.rectfill(x, y, w, h, c.night);
  g.rect(x, y, w, h, c.pink);
  g.text("ALL DONE!", g.W / 2, y + 5, c.pink, { scale: 2, align: "center" });
  if (two) {
    g.text(`PLAYER 1: ${s.turns.scores[0]}`, g.W / 2, y + 24, c.white, { align: "center" });
    g.text(`PLAYER 2: ${s.turns.scores[1]}`, g.W / 2, y + 34, c.white, { align: "center" });
    g.text(s.winner === 0 ? "IT'S A TIE!" : `PLAYER ${s.winner} WINS!`, g.W / 2, y + 46, c.yellow, { align: "center" });
  } else {
    g.text(`SCORE ${s.turns.scores[0]}`, g.W / 2, y + 26, c.white, { align: "center" });
    g.text(s.sc.newBest ? "NEW BEST!" : `BEST ${s.sc.best}`, g.W / 2, y + 38, c.yellow, { align: "center" });
  }
}
