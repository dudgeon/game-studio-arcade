// @ts-check
/** @typedef {{ flow: Arcade.Lib.Flow, sc: Arcade.Lib.Score, ship: Arcade.Lib.Thing, things: Arcade.Lib.Thing[], spawn: Arcade.Lib.Timer, safe: Arcade.Lib.Timer, tick: Arcade.Lib.Timer, played: number, pops: Arcade.Lib.Pop[], art: Record<string, Arcade.Sprite> }} State */

// Dodge template: free movement, things fly at you, stay alive. Change CFG and draw.
const CFG = { lives: 3, speed: 2, spawnEvery: 40, safeFrames: 90, comet: 1, cometStep: 0.5, cometEvery: 600, cometMax: 3 };
const SIZE = 8; // ship and comet size in pixels
const TOP = 10; // the HUD band; nothing flies there
const SHIP = ["55......", ".oo5....", ".ooo55..", "boooooo5", "boooooo5", ".ooo55..", ".oo5....", "55......"];
const COMET = ["..bb.f..", ".bffb..f", "bf55fb..", "bf55fbf.", ".bffb.f.", "..bb...f", "........", "........"];

/** @param {Arcade.G} g @param {State} s */
function newGame(g, s) {
  const { score, timers } = g.lib;
  s.sc = score.newScore(g, { lives: CFG.lives });
  s.ship = { kind: "ship", x: 16, y: (g.H - SIZE) / 2, w: SIZE, h: SIZE };
  s.things = [];
  s.spawn = timers.timer(CFG.spawnEvery, true);
  s.tick = timers.timer(60, true);
  s.safe = timers.timer(CFG.safeFrames);
  s.safe.done = true; // not safe at the start
  s.played = 0;
}

/** Comet speed after `played` frames of play (R5). */
const speedAt = (/** @type {number} */ played) => Math.min(CFG.cometMax, CFG.comet + CFG.cometStep * Math.floor(played / CFG.cometEvery));

/** @type {Arcade.Cart<State>} */
export default {
  init(g) {
    const s = /** @type {State} */ ({ flow: g.lib.flow.newFlow() });
    s.pops = [];
    s.art = { ship: g.sprite(SHIP), comet: g.sprite(COMET) };
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

    const sh = s.ship;
    if (g.btn("left")) sh.x -= CFG.speed;
    if (g.btn("right")) sh.x += CFG.speed;
    if (g.btn("up")) sh.y -= CFG.speed;
    if (g.btn("down")) sh.y += CFG.speed;
    sh.x = Math.max(0, Math.min(g.W - SIZE, sh.x));
    sh.y = Math.max(TOP, Math.min(g.H - SIZE, sh.y));

    s.played += 1;
    if (timers.tick(s.tick)) score.addPoints(s.sc, 1);
    if (timers.tick(s.spawn)) s.things.push({ kind: "comet", x: g.W, y: TOP + g.rnd(g.H - TOP - SIZE), w: SIZE, h: SIZE });
    const v = speedAt(s.played);
    for (const c of s.things) if (c.kind === "comet") c.x -= v;

    timers.tick(s.safe);
    const hits = collide.resolve([sh, ...s.things], [{ a: "comet", b: "ship", kill: s.safe.done ? "a" : "none" }]);
    s.things = collide.alive(s.things).filter((c) => c.x > -SIZE);
    if (hits.length && s.safe.done) {
      g.sfx("hit");
      fx.pop(s.pops, "OUCH", sh.x + 4, sh.y - 8, g.colors.red);
      timers.restart(s.safe);
      if (score.loseLife(s.sc) === 0) {
        score.commit(g, s.sc);
        g.sfx("lose");
        flow.go(s.flow, "over");
        s.things = [];
      }
    }
  },

  draw(g, s) {
    const { fx } = g.lib;
    const c = g.colors;
    g.cls(c.night);
    for (let i = 0; i < 24; i++) g.pset((((i * 53 - (g.frame >> 1)) % g.W) + g.W) % g.W, (i * 37) % g.H, c.slate);
    if (s.flow.mode === "title") {
      const art = fx.title(g, "COMET DODGE", s.sc.best, { color: c.sky });
      g.spr(s.art.ship, art.cx - 16, art.cy - 16, { scale: 4 });
      return;
    }
    for (const t of s.things) g.spr(s.art.comet, t.x, t.y);
    const blink = !s.safe.done && g.frame % 8 < 4;
    if (!blink) g.spr(s.art.ship, s.ship.x, s.ship.y);
    g.text(`SCORE ${s.sc.score}  BEST ${s.sc.best}`, 2, 1, c.white);
    fx.lives(g, s.sc.lives, g.W - 2, 1);
    fx.draw(g, s.pops);
    if (s.flow.mode === "over") fx.banner(g, "GAME OVER", s.sc.newBest ? "NEW BEST!" : `SCORE ${s.sc.score}`);
  },

  probe(g, s) {
    const comets = s.things.map((t) => ({ x: t.x, y: t.y }));
    return { W: g.W, H: g.H, mode: s.flow.mode, ship: { x: s.ship.x, y: s.ship.y }, comets, score: s.sc.score, lives: s.sc.lives, safe: !s.safe.done, speed: speedAt(s.played), played: s.played };
  },

  poke(g, s, o) {
    if (o.lives !== undefined) s.sc.lives = o.lives;
  },
};
