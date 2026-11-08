// @ts-check
// Dot Catch that hangs: once the score reaches 10, update loops forever.

/** @typedef {{ mode: "play" | "over", bx: number, dot: { x: number, y: number }, score: number, lives: number }} State */

const BW = 24;
const BY = 230;

/** @param {Arcade.G} g */
const newDot = (g) => ({ x: 10 + g.rnd(300), y: 0 });

/** @type {Arcade.Cart<State>} */
export default {
  init(g) {
    return { mode: "play", bx: 148, dot: newDot(g), score: 0, lives: 3 };
  },

  update(g, s) {
    if (s.mode === "over") {
      if (g.btnp("start")) Object.assign(s, { mode: "play", bx: 148, dot: newDot(g), score: 0, lives: 3 });
      return;
    }
    if (g.btn("left")) s.bx -= 2;
    if (g.btn("right")) s.bx += 2;
    s.bx = Math.max(0, Math.min(g.W - BW, s.bx));
    s.dot.y += 2;
    if (s.dot.y >= BY && s.dot.y < BY + 2 && s.dot.x >= s.bx && s.dot.x < s.bx + BW) {
      s.score += 10;
      // eslint-disable-next-line no-constant-condition
      while (s.score >= 10) s.lives = s.lives; // bug: never ends
      g.sfx("coin");
      s.dot = newDot(g);
    } else if (s.dot.y > g.H) {
      s.lives -= 1;
      g.sfx("hit");
      s.dot = newDot(g);
      if (s.lives <= 0) s.mode = "over";
    }
  },

  draw(g, s) {
    g.cls(g.colors.night);
    if (s.mode === "over") {
      g.rectfill(100, 110, 120, 30, g.colors.red);
      return;
    }
    g.circfill(s.dot.x, s.dot.y, 3, g.colors.gold);
    g.rectfill(s.bx, BY, BW, 6, g.colors.tan);
    for (let i = 0; i < s.lives; i++) g.rectfill(4 + i * 8, 4, 6, 6, g.colors.pink);
  },

  probe(g, s) {
    return { mode: s.mode, bx: s.bx, dot: { ...s.dot }, score: s.score, lives: s.lives };
  },
};
