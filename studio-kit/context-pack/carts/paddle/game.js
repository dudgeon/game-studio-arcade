// @ts-check
/** @typedef {{ x: number, y: number, w: number, h: number, vx: number, vy: number }} Ball */
/** @typedef {{ flow: Arcade.Lib.Flow, sc: Arcade.Lib.Score, pad: Arcade.Lib.Box, ball: Ball | null, serve: Arcade.Lib.Timer }} State */

const TOP = 10; // the HUD band above the court
const B = 4; // ball size

/** @param {Arcade.G} g @param {State} s */
function newGame(g, s) {
  s.sc = g.lib.score.newScore(g, { lives: 3 });
  s.pad = { x: 6, y: (g.H - 24) / 2, w: 4, h: 24 };
  s.ball = null;
  s.serve = g.lib.timers.timer(30);
}

/** A new ball from the middle, heading for the right wall. */
const serveBall = (/** @type {Arcade.G} */ g) => ({ x: g.W / 2, y: (g.H + TOP) / 2, w: B, h: B, vx: 1.5, vy: g.pick([-1, -0.5, 0.5, 1]) });

/** @type {Arcade.Cart<State>} */
export default {
  init(g) {
    const s = /** @type {State} */ ({ flow: g.lib.flow.newFlow() });
    newGame(g, s);
    return s;
  },

  update(g, s) {
    const { flow, timers, collide, score } = g.lib;
    flow.tick(s.flow);
    if (s.flow.mode !== "play") {
      if (flow.startPressed(g, s.flow)) {
        if (s.flow.mode === "title") newGame(g, s);
        flow.go(s.flow, s.flow.mode === "title" ? "play" : "title");
      }
      return;
    }

    const p = s.pad;
    if (g.btn("up")) p.y -= 3;
    if (g.btn("down")) p.y += 3;
    p.y = Math.max(TOP, Math.min(g.H - p.h, p.y));

    if (!s.ball) {
      if (timers.tick(s.serve)) s.ball = serveBall(g);
      return;
    }
    const b = s.ball;
    b.x += b.vx;
    b.y += b.vy;
    if (b.y < TOP) { b.y = TOP; b.vy = -b.vy; }
    if (b.y > g.H - B) { b.y = g.H - B; b.vy = -b.vy; }
    if (b.x > g.W - B) { b.x = g.W - B; b.vx = -b.vx; }
    if (b.vx < 0 && collide.overlap(b, p)) {
      b.x = p.x + p.w;
      b.vx = Math.min(4, -b.vx + 0.25);
      b.vy = ((b.y + B / 2 - (p.y + p.h / 2)) / (p.h / 2)) * 1.5 || 0.5; // tilt by where it hit (A3)
      score.addPoints(s.sc, 1);
      g.sfx("blip");
    }
    if (b.x < -B) {
      s.ball = null;
      g.sfx("lose");
      timers.restart(s.serve, 60);
      if (score.loseLife(s.sc) === 0) {
        score.commit(g, s.sc);
        flow.go(s.flow, "over");
      }
    }
  },

  draw(g, s) {
    const c = g.colors;
    g.cls(c.navy);
    const mid = g.W / 2;
    if (s.flow.mode === "title") {
      g.text("WALL BALL", mid, g.H / 3, c.gold, { scale: 2, align: "center" });
      if (g.frame % 60 < 30) g.text("PRESS START", mid, g.H / 2, c.white, { align: "center" });
      g.text(`BEST ${s.sc.best}`, mid, g.H / 2 + 20, c.gold, { align: "center" });
      return;
    }
    g.rectfill(0, TOP - 2, g.W, 2, c.white);
    g.rectfill(g.W - 2, TOP, 2, g.H - TOP, c.white);
    g.rectfill(s.pad.x, s.pad.y, s.pad.w, s.pad.h, c.gold);
    if (s.ball) g.rectfill(s.ball.x, s.ball.y, B, B, c.white);
    g.text(`SCORE ${s.sc.score}  LIVES ${s.sc.lives}  BEST ${s.sc.best}`, 2, 0, c.white);
    if (s.flow.mode === "over") g.text("GAME OVER", mid, g.H / 2 - 8, c.red, { scale: 2, align: "center" });
  },

  probe(g, s) {
    return { W: g.W, H: g.H, top: TOP, mode: s.flow.mode, pad: { y: s.pad.y, h: s.pad.h }, ball: s.ball && { x: s.ball.x, y: s.ball.y, vx: s.ball.vx, vy: s.ball.vy }, score: s.sc.score, lives: s.sc.lives, best: s.sc.best };
  },
};
