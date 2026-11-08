// @ts-check
/** @typedef {{ flow: Arcade.Lib.Flow, sc: Arcade.Lib.Score, board: Arcade.Lib.Grid, x: number, y: number, rep: Arcade.Lib.Repeat, round: Arcade.Lib.Timer }} State */

const T = 16; // tile size in pixels
const TOP = 16; // HUD band above the garden
const GEMS = 3;

/** Put a gem on a random empty tile that isn't under the gardener. */
function addGem(/** @type {Arcade.G} */ g, /** @type {State} */ s) {
  const { grid } = g.lib;
  for (;;) {
    const x = g.rnd(s.board.w), y = g.rnd(s.board.h);
    if (grid.get(s.board, x, y) === 0 && !(x === s.x && y === s.y)) return grid.set(s.board, x, y, g.pick([g.colors.pink, g.colors.aqua]));
  }
}

/** @param {Arcade.G} g @param {State} s */
function newGame(g, s) {
  const { grid, timers, score } = g.lib;
  s.sc = score.newScore(g, { lives: 1 });
  s.board = grid.make(Math.floor(g.W / T), Math.floor((g.H - TOP) / T));
  s.x = s.board.w >> 1;
  s.y = s.board.h >> 1;
  s.rep = timers.repeat(12, 6);
  s.round = timers.timer(timers.seconds(30));
  for (let i = 0; i < GEMS; i++) addGem(g, s);
}

/** @type {Arcade.Cart<State>} */
export default {
  init(g) {
    const s = /** @type {State} */ ({ flow: g.lib.flow.newFlow() });
    newGame(g, s);
    return s;
  },

  update(g, s) {
    const { flow, timers, grid, score } = g.lib;
    flow.tick(s.flow);
    if (s.flow.mode !== "play") {
      if (flow.startPressed(g, s.flow)) {
        if (s.flow.mode === "title") newGame(g, s);
        flow.go(s.flow, s.flow.mode === "title" ? "play" : "title");
      }
      return;
    }

    const step = grid.stickStep(g, 1, true);
    if (timers.repeatTick(s.rep, step !== null) && step && grid.inBounds(s.board, s.x + step[0], s.y + step[1])) {
      s.x += step[0];
      s.y += step[1];
    }
    if (grid.get(s.board, s.x, s.y) > 0) {
      grid.set(s.board, s.x, s.y, 0);
      score.addPoints(s.sc, 10);
      g.sfx("coin");
      addGem(g, s);
    }
    if (timers.tick(s.round)) {
      score.commit(g, s.sc);
      g.sfx("win");
      flow.go(s.flow, "over");
    }
  },

  draw(g, s) {
    const c = g.colors;
    g.cls(c.forest);
    const mid = g.W / 2;
    if (s.flow.mode === "title") {
      g.text("GEM GARDEN", mid, g.H / 3, c.mint, { scale: 2, align: "center" });
      if (g.frame % 60 < 30) g.text("PRESS START", mid, g.H / 2, c.white, { align: "center" });
      g.text(`BEST ${s.sc.best}`, mid, g.H / 2 + 20, c.gold, { align: "center" });
      return;
    }
    const b = s.board;
    for (let y = 0; y < b.h; y++) {
      for (let x = 0; x < b.w; x++) {
        const px = x * T, py = TOP + y * T;
        g.rectfill(px, py, T - 1, T - 1, (x + y) % 2 ? c.green : c.forest);
        const gem = g.lib.grid.get(b, x, y);
        if (gem) g.circfill(px + 7, py + 7, (g.frame + x * 7) % 40 < 6 ? 5 : 4, gem); // twinkle
      }
    }
    g.circfill(s.x * T + 7, TOP + s.y * T + 7, 6, c.peach);
    const left = Math.ceil(s.round.left / 60);
    g.text(`SCORE ${s.sc.score}  TIME ${s.flow.mode === "over" ? 0 : left}  BEST ${s.sc.best}`, 2, 4, c.white);
    if (s.flow.mode === "over") g.text("TIME'S UP", mid, g.H / 2 - 8, c.yellow, { scale: 2, align: "center" });
  },

  probe(g, s) {
    const gems = [];
    for (let y = 0; y < s.board.h; y++) for (let x = 0; x < s.board.w; x++) if (g.lib.grid.get(s.board, x, y)) gems.push({ x, y });
    return { mode: s.flow.mode, cols: s.board.w, rows: s.board.h, x: s.x, y: s.y, gems, score: s.sc.score, best: s.sc.best, left: s.round.left };
  },
};
