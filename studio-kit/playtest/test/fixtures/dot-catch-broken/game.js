// @ts-check
// Dot Catch, deliberately broken: the harness must fail R1, R2 and R5 and the
// soak, no-errors, palette and deterministic generic checks, and pass R3.

/** @typedef {{ mode: "play" | "over", bx: number, dot: { x: number, y: number }, score: number, lives: number }} State */

const BW = 24;
const BY = 166;

/** @param {Arcade.G} g */
const newDot = (g) => ({ x: 10 + g.rnd(236), y: 0 });

/** @type {Arcade.Cart<State>} */
export default {
  init(g) {
    return { mode: "play", bx: 116, dot: newDot(g), score: 0, lives: 3 };
  },

  update(g, s) {
    if (s.mode === "over") {
      if (g.btnp("start")) /** @type {any} */ (s).restart(); // bug: no such method
      return;
    }
    if (g.btn("left")) s.bx -= 2;
    if (g.btn("right")) s.bx += 1; // bug: half speed
    if (g.btnp("b")) /** @type {any} */ (s).powerup.use(); // bug: crashes on B
    s.bx = Math.max(0, Math.min(g.W - BW, s.bx));
    s.dot.y += 2;
    if (s.dot.y >= BY && s.dot.y < BY + 2 && s.dot.x >= s.bx && s.dot.x < s.bx + BW) {
      s.score += 1; // bug: should be 10
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
      g.rectfill(68, 80, 120, 30, g.colors.red);
      return;
    }
    g.circfill(s.dot.x, s.dot.y, 3, g.colors.gold);
    g.pset(Math.floor(Math.random() * g.W), 20, g.colors.white); // bug: Math.random twinkle
    g.rectfill(s.bx, BY, BW, 6, g.colors.tan);
    for (let i = 0; i < s.lives; i++) g.rectfill(4 + i * 8, 4, 6, 6, 40); // bug: not a palette color
  },

  probe(g, s) {
    return { mode: s.mode, bx: s.bx, dot: { ...s.dot }, score: s.score, lives: s.lives };
  },
};
