// @ts-check
// Hello world: a little smiley you steer with the stick. A beeps and drops a
// sparkle, B changes color, START clears. The number of beeps is saved.

/** @typedef {{ face: Arcade.Sprite, x: number, y: number, color: number, beeps: number, best: number, sparks: { x: number, y: number, c: number, life: number }[] }} State */

/** @type {Arcade.Cart<State>} */
export default {
  init(g) {
    const saved = g.load();
    return { face: g.sprite(FACE), x: g.W / 2 - 8, y: g.H / 2 - 8, color: g.colors.yellow, beeps: 0, best: saved?.best ?? 0, sparks: [] };
  },

  update(g, s) {
    if (g.btn("left")) s.x -= 2;
    if (g.btn("right")) s.x += 2;
    if (g.btn("up")) s.y -= 2;
    if (g.btn("down")) s.y += 2;
    s.x = Math.max(0, Math.min(g.W - 16, s.x));
    s.y = Math.max(24, Math.min(g.H - 16, s.y));

    if (g.btnp("a")) {
      s.beeps += 1;
      g.sfx("blip", { pitch: s.beeps % 12 });
      for (let i = 0; i < 6; i++) {
        s.sparks.push({ x: s.x + 8 + g.rnd(17) - 8, y: s.y + 8 + g.rnd(17) - 8, c: g.pick([15, 9, 24, 28]), life: 20 + g.rnd(20) });
      }
      if (s.beeps > s.best) {
        s.best = s.beeps;
        g.save({ best: s.best });
      }
    }
    if (g.btnp("b")) s.color = (s.color + 1) % 32;
    if (g.btnp("start")) {
      s.beeps = 0;
      s.sparks = [];
      g.sfx("select");
    }

    for (const p of s.sparks) {
      p.y -= 0.5;
      p.life -= 1;
    }
    s.sparks = s.sparks.filter((p) => p.life > 0);
  },

  draw(g, s) {
    g.cls(g.colors.night);
    g.text("HELLO, ARCADE!", g.W / 2, 6, g.colors.white, { scale: 2, align: "center" });
    g.text(`beeps ${s.beeps}   best ${s.best}   frame ${g.frame}`, 4, g.H - 10, g.colors.silver);

    for (const p of s.sparks) g.pset(p.x, p.y, p.c);

    g.circfill(s.x + 8, s.y + 8, 8, s.color);
    g.circ(s.x + 8, s.y + 8, 8, g.colors.black);
    g.spr(s.face, s.x, s.y);
  },

  probe(g, s) {
    return { x: s.x, y: s.y, color: s.color, beeps: s.beeps, best: s.best, sparks: s.sparks.length };
  },
};

const FACE = [
  "................",
  "................",
  "................",
  "................",
  ".....0....0.....",
  ".....0....0.....",
  "................",
  "................",
  "....0......0....",
  ".....0....0.....",
  "......0000......",
  "................",
  "................",
  "................",
  "................",
  "................",
];
