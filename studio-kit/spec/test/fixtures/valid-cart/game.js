// Fixture: a small cart that passes validate_cart. Deliberately not annotated
// with @type {Arcade.Cart}, so the type check has to add it. Strings and
// comments that mention document, fetch or Math.random must not trip the lint.
const LIMIT = { fetch: 3, left: 0 }; // a property called fetch is fine

export default {
  init(g) {
    const saved = g.load();
    return { x: 152, score: 0, lives: 3, best: saved?.best ?? 0, fruit: { x: g.rnd(300), y: 0 }, note: "no document here" };
  },

  update(g, s) {
    if (g.btn("left")) s.x = Math.max(LIMIT.left, s.x - 1);
    if (g.btn("right")) s.x = Math.min(g.W - 16, s.x + 1);
    s.fruit.y += 2;
    if (s.fruit.y > g.H) s.fruit = { x: g.rnd(300), y: 0 };
    if (Math.abs(s.fruit.x - s.x) < 16 && s.fruit.y > 230) {
      s.score += 10;
      g.sfx("blip");
      if (s.score > s.best) {
        s.best = s.score;
        g.save({ best: s.best });
      }
    }
  },

  draw(g, s) {
    g.cls(g.colors.black);
    g.rectfill(s.x, 236, 16, 8, g.colors.yellow);
    g.circfill(s.fruit.x, s.fruit.y, 4, g.colors.red);
    g.text(`score ${s.score} / ${`best ${s.best}`}`, 4, 4, g.colors.white);
    const ratio = s.score / 10 / 2; // division, not a regex
    if (ratio > 1e3) g.text("wow", 4, 14);
  },

  probe(_g, s) {
    return { x: s.x, score: s.score, lives: s.lives, best: s.best };
  },
};
