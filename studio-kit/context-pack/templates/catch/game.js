// @ts-check
// Catch template: things fall; catch the good, avoid the bad. Change CFG, the kinds and draw.
/** @typedef {Arcade.Lib.Thing & { id: number }} Faller */
/** @typedef {{ flow: Arcade.Lib.Flow, sc: Arcade.Lib.Score, player: Arcade.Lib.Thing, things: Faller[], spawn: Arcade.Lib.Timer, played: number, kinds: string[], caught: Record<string, number>, landed: Record<string, number> }} State */

const CFG = { lives: 3, speed: 3, spawnEvery: 50, fall: 1, fallStep: 0.25, fallEvery: 600, fallMax: 2.5, badEvery: 5, points: 10, ground: 8, top: 10, size: 8, playerW: 16, playerH: 12 };
const GOOD = "apple";
const BAD = "rock";

/** @param {Arcade.G} g @param {State} s */
function newGame(g, s) {
  s.sc = g.lib.score.newScore(g, { lives: CFG.lives });
  s.player = { kind: "player", x: (g.W - CFG.playerW) / 2, y: g.H - CFG.ground - CFG.playerH, w: CFG.playerW, h: CFG.playerH };
  s.things = [];
  s.spawn = g.lib.timers.timer(CFG.spawnEvery, true);
  s.played = 0;
  s.kinds = [];
  s.caught = { [GOOD]: 0, [BAD]: 0 };
  s.landed = { [GOOD]: 0, [BAD]: 0 };
}

const fallAt = (/** @type {number} */ played) => Math.min(CFG.fallMax, CFG.fall + CFG.fallStep * Math.floor(played / CFG.fallEvery));

/** One life gone; at the last one, game over. @param {Arcade.G} g @param {State} s */
function hurt(g, s) {
  if (g.lib.score.loseLife(s.sc) > 0) return;
  g.lib.score.commit(g, s.sc);
  g.sfx("lose");
  g.lib.flow.go(s.flow, "over");
}

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

    const me = s.player;
    if (g.btn("left")) me.x -= CFG.speed;
    if (g.btn("right")) me.x += CFG.speed;
    me.x = Math.max(0, Math.min(g.W - me.w, me.x));

    s.played += 1;
    if (timers.tick(s.spawn)) {
      const kind = (s.kinds.length + 1) % CFG.badEvery === 0 ? BAD : GOOD;
      s.kinds.push(kind);
      s.things.push({ id: s.kinds.length, kind, x: g.rnd(g.W - CFG.size), y: CFG.top, w: CFG.size, h: CFG.size });
    }
    const v = fallAt(s.played);
    for (const t of s.things) t.y += v;

    const hits = collide.resolve([me, ...s.things], [
      { a: GOOD, b: "player", kill: "a" },
      { a: BAD, b: "player", kill: "a" },
    ]);
    for (const h of hits) {
      s.caught[h.a.kind] += 1;
      if (h.a.kind === GOOD) {
        score.addPoints(s.sc, CFG.points);
        g.sfx("coin");
      } else {
        g.sfx("hit");
        hurt(g, s);
      }
    }
    for (const t of s.things) {
      if (t.dead || t.y + CFG.size < g.H - CFG.ground) continue;
      t.dead = true;
      s.landed[t.kind] += 1;
      if (t.kind === GOOD) {
        g.sfx("pop");
        hurt(g, s);
      }
    }
    s.things = /** @type {Faller[]} */ (collide.alive(s.things));
  },

  draw(g, s) {
    const c = g.colors;
    g.cls(c.sky);
    const mid = g.W / 2;
    if (s.flow.mode === "title") {
      g.text("APPLE CATCH", mid, g.H / 3, c.red, { scale: 2, align: "center" });
      if (g.frame % 60 < 30) g.text("PRESS START", mid, g.H / 2, c.white, { align: "center" });
      g.text(`BEST ${s.sc.best}`, mid, g.H / 2 + 20, c.night, { align: "center" });
      return;
    }
    g.rectfill(0, g.H - CFG.ground, g.W, CFG.ground, c.green);
    for (const t of s.things) {
      if (t.kind === GOOD) g.circfill(t.x + 4, t.y + 4, 4, c.red);
      else g.rectfill(t.x, t.y, CFG.size, CFG.size, c.slate);
    }
    g.rectfill(s.player.x, s.player.y, s.player.w, s.player.h, c.brown);
    g.text(`SCORE ${s.sc.score}  LIVES ${s.sc.lives}  BEST ${s.sc.best}`, 2, 1, c.night);
    if (s.flow.mode === "over") g.text("GAME OVER", mid, g.H / 2 - 8, c.red, { scale: 2, align: "center" });
  },

  probe(g, s) {
    const things = s.things.map((t) => ({ id: t.id, kind: t.kind, x: t.x, y: t.y, w: t.w, h: t.h }));
    return { W: g.W, H: g.H, mode: s.flow.mode, player: { x: s.player.x, y: s.player.y, w: s.player.w, h: s.player.h }, things, score: s.sc.score, lives: s.sc.lives, best: s.sc.best, played: s.played, kinds: s.kinds, caught: s.caught, landed: s.landed };
  },

  poke(g, s, o) {
    if (o.lives !== undefined) s.sc.lives = o.lives;
  },
};
