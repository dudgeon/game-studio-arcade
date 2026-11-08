// @ts-check
/** @typedef {{ x: number, y: number, w: number, h: number, vx: number, vy: number }} Ball */
/** @typedef {{ flow: Arcade.Lib.Flow, sc: Arcade.Lib.Score, pad: Arcade.Lib.Box, ball: Ball | null, serve: Arcade.Lib.Timer, pops: Arcade.Lib.Pop[], art: Arcade.Sprite }} State */

// Paddle template: a ball off the walls, swat it back. Change CFG and draw.
const CFG = { lives: 3, padSpeed: 3, padH: 24, ballX: 1.5, ballUp: 0.25, ballMax: 4, tilt: 1.5, points: 1, serveFrames: 30, reserveFrames: 60 };
const TOP = 10; // the HUD band above the court
const B = 6; // ball size
const BALL = ["..55..", ".5555.", "555555", "555555", ".5555.", "..55.."];

/** @param {Arcade.G} g @param {State} s */
function newGame(g, s) {
  s.sc = g.lib.score.newScore(g, { lives: CFG.lives });
  s.pad = { x: 6, y: (g.H - CFG.padH) / 2, w: 4, h: CFG.padH };
  s.ball = null;
  s.serve = g.lib.timers.timer(CFG.serveFrames);
}

/** A new ball from the middle, heading for the right wall. */
const serveBall = (/** @type {Arcade.G} */ g) => ({ x: g.W / 2, y: (g.H + TOP) / 2, w: B, h: B, vx: CFG.ballX, vy: g.pick([-1, -0.5, 0.5, 1]) });

/** @type {Arcade.Cart<State>} */
export default {
  init(g) {
    const s = /** @type {State} */ ({ flow: g.lib.flow.newFlow() });
    s.pops = [];
    s.art = g.sprite(BALL);
    newGame(g, s);
    return s;
  },

  update(g, s) {
    const { flow, timers, collide, score, fx } = g.lib;
    flow.tick(s.flow);
    fx.tick(s.pops);
    if (s.flow.mode !== "play") {
      if (flow.startPressed(g, s.flow)) {
        if (s.flow.mode === "title") newGame(g, s);
        flow.go(s.flow, s.flow.mode === "title" ? "play" : "title");
      }
      return;
    }

    const p = s.pad;
    if (g.btn("up")) p.y -= CFG.padSpeed;
    if (g.btn("down")) p.y += CFG.padSpeed;
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
      b.vx = Math.min(CFG.ballMax, -b.vx + CFG.ballUp);
      b.vy = ((b.y + B / 2 - (p.y + p.h / 2)) / (p.h / 2)) * CFG.tilt || 0.5; // tilt by where it hit (A3)
      score.addPoints(s.sc, CFG.points);
      g.sfx("blip");
      fx.pop(s.pops, `+${CFG.points}`, p.x + 14, b.y - 6, g.colors.gold);
    }
    if (b.x < -B) {
      fx.pop(s.pops, "MISS", 16, b.y - 6, g.colors.coral);
      s.ball = null;
      g.sfx("lose");
      timers.restart(s.serve, CFG.reserveFrames);
      if (score.loseLife(s.sc) === 0) {
        score.commit(g, s.sc);
        flow.go(s.flow, "over");
      }
    }
  },

  draw(g, s) {
    const { fx } = g.lib;
    const c = g.colors;
    g.cls(c.navy);
    if (s.flow.mode === "title") {
      const art = fx.title(g, "WALL BALL", s.sc.best, { color: c.gold });
      g.spr(s.art, art.cx - 18, art.cy - 18, { scale: 6 });
      return;
    }
    g.rectfill(0, TOP - 2, g.W, 2, c.white);
    g.rectfill(g.W - 2, TOP, 2, g.H - TOP, c.white);
    g.rectfill(s.pad.x, s.pad.y, s.pad.w, s.pad.h, c.gold);
    g.rectfill(s.pad.x, s.pad.y, 1, s.pad.h, c.yellow);
    g.rectfill(s.pad.x + s.pad.w - 1, s.pad.y, 1, s.pad.h, c.orange);
    if (s.ball) g.spr(s.art, s.ball.x, s.ball.y);
    g.text(`SCORE ${s.sc.score}  BEST ${s.sc.best}`, 2, 0, c.white);
    fx.lives(g, s.sc.lives, g.W - 2, 0);
    fx.draw(g, s.pops);
    if (s.flow.mode === "over") fx.banner(g, "GAME OVER", s.sc.newBest ? "NEW BEST!" : `SCORE ${s.sc.score}`);
  },

  probe(g, s) {
    return { W: g.W, H: g.H, top: TOP, mode: s.flow.mode, pad: { y: s.pad.y, h: s.pad.h }, ball: s.ball && { x: s.ball.x, y: s.ball.y, vx: s.ball.vx, vy: s.ball.vy }, score: s.sc.score, lives: s.sc.lives, best: s.sc.best };
  },

  poke(g, s, o) {
    if (o.lives !== undefined) s.sc.lives = o.lives;
  },
};
