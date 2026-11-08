// @ts-check
// Catch template: things fall; catch the good, avoid the bad. Change CFG and ART.
/** @typedef {Arcade.Lib.Thing & { id: number }} Faller */
/** @typedef {{ flow: Arcade.Lib.Flow, sc: Arcade.Lib.Score, player: Arcade.Lib.Thing, things: Faller[], spawn: Arcade.Lib.Timer, played: number, kinds: string[], caught: Record<string, number>, landed: Record<string, number>, pops: Arcade.Lib.Pop[], art: Record<string, Arcade.Sprite> }} State */

const CFG = { lives: 3, speed: 3, spawnEvery: 50, fall: 1, fallStep: 0.25, fallEvery: 600, fallMax: 2.5, badEvery: 5, points: 10, ground: 8, top: 10, size: 10, playerW: 16, playerH: 6 };
const GOOD = "apple";
const BAD = "rock";
const ART = {
  player: ["aaaaaaaaaaaaaaaa", "acccccccccccccca", ".acacacacacacac.", ".accccccccccccc.", ".acacacacacacac.", "..aaaaaaaaaaaa.."],
  [GOOD]: [".....a.hh.", "..77a777h.", ".78777777.", "7887777777", "7877777777", "7777777777", "7777777777", ".77777777.", ".77777777.", "..777777.."],
};

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

/** @param {Arcade.G} g @param {State} s */
function hurt(g, s) {
  if (g.lib.score.loseLife(s.sc) > 0) return;
  g.lib.score.commit(g, s.sc);
  g.sfx("lose");
  s.things = [];
  g.lib.flow.go(s.flow, "over");
}

/** @type {Arcade.Cart<State>} */
export default {
  init(g) {
    const s = /** @type {State} */ ({ flow: g.lib.flow.newFlow() });
    s.pops = [];
    s.art = { player: g.sprite(ART.player), [GOOD]: g.sprite(ART[GOOD]) };
    newGame(g, s);
    return s;
  },

  update(g, s) {
    const { flow, timers, collide, score, fx } = g.lib;
    const c = g.colors;
    flow.tick(s.flow);
    fx.tick(s.pops);
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
        fx.pop(s.pops, `+${CFG.points}`, me.x + 8, me.y - 8, c.white);
      } else {
        g.sfx("hit");
        fx.pop(s.pops, "OUCH", me.x + 8, me.y - 8, c.red);
        hurt(g, s);
      }
    }
    for (const t of s.things) {
      if (t.dead || t.y + CFG.size < g.H - CFG.ground) continue;
      t.dead = true;
      s.landed[t.kind] += 1;
      if (t.kind === GOOD) {
        g.sfx("pop");
        fx.pop(s.pops, "MISS", t.x + 6, t.y - 4, c.maroon);
        hurt(g, s);
      }
    }
    s.things = /** @type {Faller[]} */ (collide.alive(s.things));
  },

  draw(g, s) {
    const { fx } = g.lib;
    const c = g.colors;
    g.cls(c.sky);
    g.rectfill(0, g.H - CFG.ground, g.W, CFG.ground, c.green);
    if (s.flow.mode === "title") {
      const art = fx.title(g, "APPLE CATCH", s.sc.best, { color: c.red, ink: c.night });
      g.spr(s.art[GOOD], art.cx - 18, art.cy - 18, { scale: 3 });
      return;
    }
    for (const t of s.things) {
      if (t.kind === GOOD) g.spr(s.art[GOOD], t.x, t.y);
      else g.circfill(t.x + 5, t.y + 5, 5, c.slate);
    }
    g.spr(s.art.player, s.player.x, s.player.y);
    g.text(`SCORE ${s.sc.score}  BEST ${s.sc.best}`, 2, 1, c.night);
    fx.lives(g, s.sc.lives, g.W - 2, 1);
    fx.draw(g, s.pops);
    if (s.flow.mode === "over") fx.banner(g, "GAME OVER", s.sc.newBest ? "NEW BEST!" : `SCORE ${s.sc.score}`);
  },

  probe(g, s) {
    return { W: g.W, H: g.H, mode: s.flow.mode, player: s.player, things: s.things, score: s.sc.score, lives: s.sc.lives, best: s.sc.best, played: s.played, kinds: s.kinds, caught: s.caught, landed: s.landed };
  },

  poke(g, s, o) {
    if (o.lives !== undefined) s.sc.lives = o.lives;
  },
};
