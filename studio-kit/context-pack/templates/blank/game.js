// @ts-check
// Blank start: title, play, game over, a best score, and a dot to steer. Everything else is yours.
/** @typedef {{ flow: Arcade.Lib.Flow, sc: Arcade.Lib.Score, x: number, y: number, tick: Arcade.Lib.Timer, round: Arcade.Lib.Timer }} State */

const CFG = { speed: 2, roundFrames: 1800, size: 6, top: 10 };

/** @param {Arcade.G} g @param {State} s */
function newGame(g, s) {
  s.sc = g.lib.score.newScore(g, { lives: 1 });
  s.x = g.W / 2;
  s.y = g.H / 2;
  s.tick = g.lib.timers.timer(60, true);
  s.round = g.lib.timers.timer(CFG.roundFrames);
}

/** @type {Arcade.Cart<State>} */
export default {
  init(g) {
    const s = /** @type {State} */ ({ flow: g.lib.flow.newFlow() });
    newGame(g, s);
    return s;
  },

  update(g, s) {
    const { flow, timers, score } = g.lib;
    flow.tick(s.flow);
    if (s.flow.mode !== "play") {
      if (flow.startPressed(g, s.flow)) {
        if (s.flow.mode === "title") newGame(g, s);
        flow.go(s.flow, s.flow.mode === "title" ? "play" : "title");
      }
      return;
    }
    if (g.btn("left")) s.x -= CFG.speed;
    if (g.btn("right")) s.x += CFG.speed;
    if (g.btn("up")) s.y -= CFG.speed;
    if (g.btn("down")) s.y += CFG.speed;
    s.x = Math.max(0, Math.min(g.W - CFG.size, s.x));
    s.y = Math.max(CFG.top, Math.min(g.H - CFG.size, s.y));
    if (timers.tick(s.tick)) score.addPoints(s.sc, 1);
    if (timers.tick(s.round)) {
      score.commit(g, s.sc);
      g.sfx("win");
      flow.go(s.flow, "over");
    }
  },

  draw(g, s) {
    const c = g.colors;
    g.cls(c.night);
    const mid = g.W / 2;
    if (s.flow.mode === "title") {
      g.text("BLANK", mid, g.H / 3, c.sky, { scale: 2, align: "center" });
      if (g.frame % 60 < 30) g.text("PRESS START", mid, g.H / 2, c.white, { align: "center" });
      g.text(`BEST ${s.sc.best}`, mid, g.H / 2 + 20, c.gold, { align: "center" });
      return;
    }
    g.rectfill(s.x, s.y, CFG.size, CFG.size, c.sky);
    g.text(`SCORE ${s.sc.score}  BEST ${s.sc.best}`, 2, 1, c.white);
    if (s.flow.mode === "over") g.text("GAME OVER", mid, g.H / 2 - 8, c.red, { scale: 2, align: "center" });
  },

  probe(g, s) {
    return { W: g.W, H: g.H, top: CFG.top, mode: s.flow.mode, x: s.x, y: s.y, size: CFG.size, score: s.sc.score, best: s.sc.best, left: s.round.left };
  },
};
