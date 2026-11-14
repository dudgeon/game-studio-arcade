// @ts-check
/** @typedef {{ flow: Arcade.Lib.Flow, sc: Arcade.Lib.Score, b: Arcade.Lib.Body, cam: Arcade.Lib.Camera, sq: Arcade.Lib.Spring, ground: boolean, left: boolean, stars: Arcade.Lib.Thing[], won: boolean, bits: Arcade.Lib.Particle[], art: Record<string, Arcade.Sprite> }} State */

// Scroller template: run and jump through a world wider than the screen. Change CFG, MAP and draw.
const CFG = { lives: 3, max: 2, accel: 0.2, friction: 0.2, gravity: 0.25, jump: -4.8, star: 10, flag: 50 };
const T = 16; // tile size in pixels
// "#" ground, "*" star, "^" spikes, "F" flag, "@" start. The bottom row sits on the bottom of the screen.
const MAP = [
  "................................................",
  "................................................",
  "..................................*.............",
  "..............*.......*..........###............",
  ".............###....####......*.................",
  "....................................##..........",
  ".@...*....^.....*.......^^.......^.........F....",
  "##############################..################",
];
const WORLD = MAP[0].length * T;
const DEEP = MAP.length * T;
const HERO = ["...bbbb...", "..bbbbbb..", "..b5bb5b..", "..b1bb1b..", "..bbbbbb..", "...b99b...", "..nnnnnn..", ".bnnnnnnb.", ".bnnnnnnb.", "..nnnnnn..", "..11..11..", ".11....11."];
const STAR = ["...ff...", "...ff...", "ffffffff", ".ffffff.", "..ffff..", ".ffffff.", ".ff..ff.", "f......f"];
const SPIKE = ["...44...", "..4444..", ".444444.", "44444444"];

/** Every map tile that is `ch`, as [column, row]. */
const find = (/** @type {string} */ ch) => MAP.flatMap((row, y) => [...row].flatMap((v, x) => (v === ch ? [[x, y]] : [])));

/** Put the runner back at the start, standing still. @param {State} s */
function toStart(s) {
  const [x, y] = find("@")[0];
  Object.assign(s.b, { x: x * T + 3, y: y * T + T - 12, vx: 0, vy: 0 });
  s.cam.x = 0;
}

/** @param {Arcade.G} g @param {State} s */
function newGame(g, s) {
  s.sc = g.lib.score.newScore(g, { lives: CFG.lives });
  s.stars = find("*").map(([x, y]) => ({ kind: "star", x: x * T + 4, y: y * T + 4, w: 8, h: 8 }));
  s.won = false;
  toStart(s);
}

/** @type {Arcade.Cart<State>} */
export default {
  init(g) {
    g.glide(); // positions keep their fractions on screen, so the scrolling slides
    const { flow, motion, camera } = g.lib;
    const s = /** @type {State} */ ({ flow: flow.newFlow(), b: motion.body(0, 0, 10, 12), cam: camera.newCamera() });
    s.sq = { x: 0, v: 0 };
    s.bits = [];
    s.art = { hero: g.sprite(HERO), star: g.sprite(STAR), spike: g.sprite(SPIKE) };
    newGame(g, s);
    return s;
  },

  update(g, s) {
    const { flow, motion, camera, particles, score, collide } = g.lib;
    const c = g.colors;
    flow.tick(s.flow);
    particles.tick(s.bits);
    if (s.flow.mode !== "play") {
      if (flow.startPressed(g, s.flow)) {
        if (s.flow.mode === "title") newGame(g, s);
        flow.go(s.flow, s.flow.mode === "title" ? "play" : "title");
      }
      return;
    }

    // Speed builds up and dies away; gravity pulls; the map's "#" tiles and the world's ends are solid.
    const b = s.b;
    const st = motion.stick(g);
    motion.drive(b, st.x, null, CFG);
    if (st.x) s.left = st.x < 0;
    if (g.btnp("a") && s.ground) {
      b.vy = CFG.jump;
      g.sfx("jump");
    }
    const fall = b.vy;
    const hit = motion.move(b, { gravity: CFG.gravity, solid: (x, y, w, h) => x < 0 || x + w > WORLD || motion.mapHit(MAP, T, x, y, w, h) });
    if (hit.y === 1 && !s.ground && fall > 2) s.sq.v += fall * 0.06; // squash on landing
    s.ground = hit.y === 1;
    motion.spring(s.sq, 0);

    for (const star of s.stars) {
      if (star.dead || !collide.overlap(b, star)) continue;
      star.dead = true;
      score.addPoints(s.sc, CFG.star);
      g.sfx("coin");
      particles.burst(g, s.bits, star.x + 4, star.y + 4, { colors: [c.yellow, c.gold, c.white] });
    }
    const touches = (/** @type {string} */ ch) => motion.mapHit(MAP, T, b.x + 2, b.y + 6, 6, 6, ch);
    if (b.y > DEEP || touches("^")) {
      g.sfx("hit");
      camera.shake(g, s.cam, 4);
      toStart(s);
      if (score.loseLife(s.sc) > 0) return;
    } else if (touches("F")) {
      s.won = true;
      score.addPoints(s.sc, CFG.flag);
      g.sfx("win");
    } else {
      // The screen trails the runner, inside the world; its bottom stays on the map's bottom row.
      camera.follow(g, s.cam, b, { bounds: { x: 0, y: DEEP - g.H, w: WORLD, h: g.H } });
      return;
    }
    score.commit(g, s.sc);
    if (!s.won) g.sfx("lose");
    flow.go(s.flow, "over");
  },

  draw(g, s) {
    const { fx, camera, parallax, particles } = g.lib;
    const c = g.colors;
    g.cls(c.sky);
    if (s.flow.mode === "title") {
      const art = fx.title(g, "STAR RUN", s.sc.best, { color: c.yellow, ink: c.night });
      g.spr(s.art.hero, art.cx - 15, art.cy - 18, { scale: 3 });
      return;
    }
    // Far hills scroll slowest, nearer bushes faster, the world fastest.
    parallax.layer(g, s.cam, { speed: 0.2, w: 128, y: g.H - 88 }, () => {
      g.circfill(34, 70, 56, c.teal);
      g.circfill(100, 84, 44, c.teal);
    });
    parallax.layer(g, s.cam, { speed: 0.5, w: 96, y: g.H - 60 }, (i) => g.circfill(i % 2 ? 30 : 60, 56, 34, c.forest));
    camera.use(g, s.cam);
    const first = Math.max(0, Math.floor(s.cam.x / T) - 1);
    MAP.forEach((row, ty) => {
      for (let tx = first; tx < row.length && tx * T < s.cam.x + g.W + T; tx++) {
        const x = tx * T, y = ty * T;
        if (row[tx] === "#") {
          g.rectfill(x, y, T, T, c.brown);
          if (MAP[ty - 1]?.[tx] !== "#") g.rectfill(x, y, T, 4, c.green);
        } else if (row[tx] === "^") g.spr(s.art.spike, x, y + 8, { scale: 2 });
        else if (row[tx] === "F") {
          g.rectfill(x + 7, y - 16, 2, 32, c.white);
          g.rectfill(x + 9, y - 16 + Math.sin(g.frame / 10), 12, 8, c.red);
        }
      }
    });
    for (const star of s.stars) if (!star.dead) g.spr(s.art.star, star.x, star.y + 2 * Math.sin((g.frame + star.x) / 12));
    g.spr(s.art.hero, s.b.x, s.b.y, { flipX: s.left, zoomX: 1 + s.sq.x, zoomY: 1 - s.sq.x, pivot: [0.5, 1] });
    particles.draw(g, s.bits);
    g.camera();
    g.text(`SCORE ${s.sc.score}  BEST ${s.sc.best}`, 2, 1, c.night);
    fx.lives(g, s.sc.lives, g.W - 2, 1);
    if (s.flow.mode === "over") fx.banner(g, s.won ? "YOU WIN!" : "GAME OVER", s.sc.newBest ? "NEW BEST!" : `SCORE ${s.sc.score}`, s.won ? c.green : c.red);
  },

  probe(g, s) {
    const stars = s.stars.filter((t) => !t.dead).length;
    return { W: g.W, H: g.H, mode: s.flow.mode, x: s.b.x, y: s.b.y, vx: s.b.vx, onGround: s.ground, cam: s.cam.x, world: WORLD, flag: find("F")[0][0] * T, score: s.sc.score, lives: s.sc.lives, stars, won: s.won };
  },

  poke(g, s, o) {
    if (o.lives !== undefined) s.sc.lives = o.lives;
    if (o.x !== undefined) s.b.x = o.x;
  },
};
