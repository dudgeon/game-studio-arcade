// @ts-check
/** @typedef {{ flow: Arcade.Lib.Flow, sc: Arcade.Lib.Score, ship: Arcade.Lib.Thing, things: Arcade.Lib.Thing[], spawn: Arcade.Lib.Timer, safe: Arcade.Lib.Timer, tick: Arcade.Lib.Timer, played: number }} State */

const SIZE = 8; // ship and comet size in pixels
const TOP = 10; // the HUD band; nothing flies there

/** @param {Arcade.G} g @param {State} s */
function newGame(g, s) {
  const { score, timers } = g.lib;
  s.sc = score.newScore(g, { lives: 3 });
  s.ship = { kind: "ship", x: 16, y: (g.H - SIZE) / 2, w: SIZE, h: SIZE };
  s.things = [];
  s.spawn = timers.timer(40, true);
  s.tick = timers.timer(60, true);
  s.safe = timers.timer(90);
  s.safe.done = true; // not safe at the start
  s.played = 0;
}

/** Comet speed after `played` frames of play (R5). */
const speedAt = (/** @type {number} */ played) => Math.min(3, 1 + 0.5 * Math.floor(played / 600));

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

    const sh = s.ship;
    if (g.btn("left")) sh.x -= 2;
    if (g.btn("right")) sh.x += 2;
    if (g.btn("up")) sh.y -= 2;
    if (g.btn("down")) sh.y += 2;
    sh.x = Math.max(0, Math.min(g.W - SIZE, sh.x));
    sh.y = Math.max(TOP, Math.min(g.H - SIZE, sh.y));

    s.played += 1;
    if (timers.tick(s.tick)) score.addPoints(s.sc, 1);
    if (timers.tick(s.spawn)) s.things.push({ kind: "comet", x: g.W, y: TOP + g.rnd(g.H - TOP - SIZE), w: SIZE, h: SIZE });
    const v = speedAt(s.played);
    for (const c of s.things) if (c.kind === "comet") c.x -= v;

    timers.tick(s.safe);
    const hits = collide.resolve([sh, ...s.things], [{ a: "comet", b: "ship", kill: s.safe.done ? "a" : "none" }]);
    if (hits.length && s.safe.done) {
      g.sfx("hit");
      timers.restart(s.safe);
      if (score.loseLife(s.sc) === 0) {
        score.commit(g, s.sc);
        g.sfx("lose");
        flow.go(s.flow, "over");
      }
    }
    s.things = collide.alive(s.things).filter((c) => c.x > -SIZE);
  },

  draw(g, s) {
    const c = g.colors;
    g.cls(c.night);
    for (let i = 0; i < 24; i++) g.pset((((i * 53 - (g.frame >> 1)) % g.W) + g.W) % g.W, (i * 37) % g.H, c.slate);
    const mid = g.W / 2;
    if (s.flow.mode === "title") {
      g.text("COMET DODGE", mid, g.H / 3, c.sky, { scale: 2, align: "center" });
      if (g.frame % 60 < 30) g.text("PRESS START", mid, g.H / 2, c.white, { align: "center" });
      g.text(`BEST ${s.sc.best}`, mid, g.H / 2 + 20, c.gold, { align: "center" });
      return;
    }
    for (const t of s.things) g.circfill(t.x + 4, t.y + 4, 4, c.orange);
    const blink = !s.safe.done && g.frame % 8 < 4;
    if (!blink) g.rectfill(s.ship.x, s.ship.y, SIZE, SIZE, c.sky);
    g.text(`SCORE ${s.sc.score}  LIVES ${s.sc.lives}  BEST ${s.sc.best}`, 2, 1, c.white);
    if (s.flow.mode === "over") g.text("GAME OVER", mid, g.H / 2 - 8, c.red, { scale: 2, align: "center" });
  },

  probe(g, s) {
    const comets = s.things.map((t) => ({ x: t.x, y: t.y }));
    return { W: g.W, H: g.H, mode: s.flow.mode, ship: { x: s.ship.x, y: s.ship.y }, comets, score: s.sc.score, lives: s.sc.lives, safe: !s.safe.done, speed: speedAt(s.played), played: s.played };
  },
};
