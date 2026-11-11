// @ts-check
/** @typedef {{ flow: Arcade.Lib.Flow, sc: Arcade.Lib.Score, peng: { x: number, y: number, w: number, h: number, vx: number, kind: string }, things: (Arcade.Lib.Thing & { skin: number })[], played: number, nextIn: number, spawned: number, fish: number, boots: number, hop: number, ouch: number, splash: { x: number, t: number }[], sprites: any }} State */

const ACCEL = 0.25; // speed gained per frame while a direction is held
const MAX_VX = 3.5;
const SLIDE = 0.96; // speed kept each frame after letting go
const PW = 16; // penguin size
const PH = 16;
const TOP = 11; // score bar; things start falling under it
const ICE = 14; // height of the ice floor
const LEVEL_FRAMES = 600;

const level = (/** @type {number} */ played) => Math.floor(played / LEVEL_FRAMES);
const fallSpeedAt = (/** @type {number} */ played) => Math.min(3, 1 + 0.2 * level(played));
const bootChanceAt = (/** @type {number} */ played) => Math.min(0.4, 0.15 + 0.05 * level(played));
const spawnEveryAt = (/** @type {number} */ played) => Math.max(30, 70 - 5 * level(played));

/** @param {Arcade.G} g */
const groundY = (g) => g.H - ICE;

/** @param {Arcade.G} g @param {State} s */
function newGame(g, s) {
  s.sc = g.lib.score.newScore(g, { lives: 3 });
  s.peng = { x: (g.W - PW) / 2, y: groundY(g) - PH, w: PW, h: PH, vx: 0, kind: "penguin" };
  s.things = [];
  s.played = 0;
  s.nextIn = 30;
  s.spawned = 0;
  s.fish = 0;
  s.boots = 0;
  s.hop = 0;
  s.ouch = 0;
  s.splash = [];
}

/** Sprites, made once. 0 black, 5 white, b orange, 4 silver, a brown, c tan, 7 red, 2 slate. */
/** @param {Arcade.G} g */
function makeSprites(g) {
  return {
    peng: g.sprite([
      "....00000000....",
      "...0000000000...",
      "..000000000000..",
      "..005500005500..",
      "..005000000500..",
      "..000bbbbbb000..",
      ".0000bbbbbb0000.",
      ".00005555550000.",
      "0000055555500000",
      "0000055555500000",
      "0000055555500000",
      "0000055555500000",
      ".00005555550000.",
      "..000555555000..",
      "...bbb....bbb...",
      "..bbbbb..bbbbb..",
    ]),
    fish: g.sprite([
      "....bbbb........",
      "..bbbbbbbb...b..",
      ".bbbbbbbbbb.bbb.",
      "bb50bbbbbbbbbbb.",
      "bbbbbbbbbbbbbbb.",
      ".b44444444b.bbb.",
      "..bbbbbbbb...b..",
      "....bbbb........",
    ]),
    boot: g.sprite([
      "..000000....",
      "..0cccc0....",
      "..0cccc0....",
      "..0aaaa0....",
      "..0aaaa0....",
      "..0aaaa0....",
      "..0aaaa0....",
      "..0aaaa0000.",
      ".00aaaaaaaa0",
      "00aaaaaaaaa0",
      "0aaaaaaaaaa0",
      "022222222220",
    ]),
  };
}

/** @type {Arcade.Cart<State>} */
export default {
  init(g) {
    const s = /** @type {State} */ ({ flow: g.lib.flow.newFlow() });
    newGame(g, s);
    s.sprites = null;
    return s;
  },

  update(g, s) {
    const { flow, score, collide } = g.lib;
    flow.tick(s.flow);
    if (s.flow.mode !== "play") {
      if (flow.startPressed(g, s.flow)) {
        if (s.flow.mode === "title") newGame(g, s);
        flow.go(s.flow, s.flow.mode === "title" ? "play" : "title");
        if (s.flow.mode === "title") s.sc = score.newScore(g, { lives: 3 });
      }
      return;
    }

    // penguin: slippery ice
    const p = s.peng;
    const dir = (g.btn("right") ? 1 : 0) - (g.btn("left") ? 1 : 0);
    if (dir !== 0) p.vx = Math.max(-MAX_VX, Math.min(MAX_VX, p.vx + dir * ACCEL));
    else {
      p.vx *= SLIDE;
      if (Math.abs(p.vx) < 0.02) p.vx = 0;
    }
    p.x += p.vx;
    if (p.x < 0) { p.x = 0; p.vx = 0; }
    if (p.x > g.W - PW) { p.x = g.W - PW; p.vx = 0; }
    if (s.hop > 0) s.hop -= 1;
    if (s.ouch > 0) s.ouch -= 1;

    // things appear
    s.played += 1;
    s.nextIn -= 1;
    if (s.nextIn <= 0) {
      const boot = s.spawned >= 3 && g.rand() < bootChanceAt(s.played);
      const w = boot ? 12 : 15;
      const h = boot ? 12 : 8;
      s.things.push({ kind: boot ? "boot" : "fish", skin: g.rnd(2), x: g.rnd(g.W - w + 1), y: TOP, w, h });
      s.spawned += 1;
      if (boot) s.boots += 1;
      else s.fish += 1;
      s.nextIn = spawnEveryAt(s.played);
    }
    const v = fallSpeedAt(s.played);
    for (const t of s.things) t.y += v;

    // catching and missing
    let lost = false;
    const hits = collide.resolve([p, ...s.things], [
      { a: "fish", b: "penguin", kill: "a" },
      { a: "boot", b: "penguin", kill: "a" },
    ]);
    for (const h of hits) {
      if (h.a.kind === "fish") {
        score.addPoints(s.sc, 10);
        s.hop = 14;
        g.sfx("coin");
      } else {
        lost = true;
        s.ouch = 40;
        g.sfx("hit");
      }
    }
    const gy = groundY(g);
    for (const t of s.things) {
      if (t.dead || t.y + t.h < gy) continue;
      t.dead = true;
      s.splash.push({ x: t.x + t.w / 2, t: 0 });
      if (t.kind === "fish") {
        lost = true;
        g.sfx("pop");
      }
    }
    s.things = /** @type {State["things"]} */ (collide.alive(s.things));
    if (lost && score.loseLife(s.sc) === 0) {
      score.commit(g, s.sc);
      g.sfx("lose");
      s.things = [];
      flow.go(s.flow, "over");
    }
    for (const sp of s.splash) sp.t += 1;
    s.splash = s.splash.filter((sp) => sp.t < 15);
  },

  draw(g, s) {
    const c = g.colors;
    if (!s.sprites) s.sprites = makeSprites(g);
    const spr = s.sprites;
    g.cls(c.navy);
    // stars and snow
    for (let i = 0; i < 30; i++) {
      const x = (i * 71) % g.W;
      const y = (i * 43) % (g.H - 40);
      g.pset(x, y, (g.frame + i * 7) % 50 < 25 ? c.ice : c.sky);
    }
    for (let i = 0; i < 14; i++) {
      const x = (i * 97 + ((g.frame * (1 + (i % 3))) >> 4)) % g.W;
      const y = (i * 61 + (g.frame >> (1 + (i % 2)))) % (g.H - ICE);
      g.pset(x, y, c.white);
    }
    // ice floor
    const gy = groundY(g);
    g.rectfill(0, gy, g.W, ICE, c.ice);
    g.rectfill(0, gy, g.W, 2, c.white);
    for (let i = 0; i < 8; i++) g.line(i * 37 + 5, gy + 5, i * 37 + 17, gy + 9, c.sky);

    const mid = g.W / 2;
    if (s.flow.mode === "title") {
      g.text("PENGUIN", mid, 30, c.white, { scale: 3, align: "center" });
      g.text("CATCH", mid, 56, c.sky, { scale: 3, align: "center" });
      g.spr(spr.peng, mid - 16, gy - 32, { scale: 2 });
      g.spr(spr.fish, mid - 80, 90 + Math.floor(Math.sin(g.frame / 20) * 4));
      g.spr(spr.boot, mid + 70, 88 + Math.floor(Math.sin(g.frame / 20 + 2) * 4));
      g.text("CATCH FISH  NOT BOOTS", mid, 110, c.yellow, { align: "center" });
      if (g.frame % 60 < 30) g.text("PRESS START", mid, 124, c.white, { align: "center" });
      g.text(`BEST ${s.sc.best}`, mid, 138, c.gold, { align: "center" });
      return;
    }

    for (const t of s.things) {
      if (t.kind === "fish") {
        g.spr(spr.fish, t.x, t.y);
      } else {
        g.spr(spr.boot, t.x, t.y);
        if (g.frame % 20 < 10) g.circfill(t.x + 3, t.y - 2, 2, c.lime);
        else g.circfill(t.x + 6, t.y - 3, 2, c.green);
      }
    }
    for (const sp of s.splash) {
      const r = 2 + (sp.t >> 1);
      g.circ(sp.x, gy, r, c.white);
    }
    // penguin
    const p = s.peng;
    const hopY = s.hop > 0 ? Math.floor(Math.sin((s.hop / 14) * Math.PI) * 8) : 0;
    const flash = s.ouch > 0 && g.frame % 6 < 3;
    const lean = Math.max(-2, Math.min(2, Math.round(p.vx / 1.5)));
    if (flash) g.spr(spr.peng, p.x + lean, p.y, { color: c.red });
    else g.spr(spr.peng, p.x + lean, p.y - hopY, {});
    // v2: a red scarf, drawn over the sprite so it slides and hops with it.
    if (!flash) g.rectfill(p.x + lean + 3, p.y - hopY + 7, 10, 2, c.red);
    if (s.ouch > 0) g.text("OUCH!", p.x + 8, p.y - 10, c.yellow, { align: "center" });
    if (s.hop > 0) g.text("+10", p.x + 8, p.y - 12 - (14 - s.hop), c.yellow, { align: "center" });

    // HUD
    g.rectfill(0, 0, g.W, 9, c.night);
    g.text(`SCORE ${s.sc.score}`, 3, 1, c.white);
    g.text(`BEST ${s.sc.best}`, mid, 1, c.gold, { align: "center" });
    for (let i = 0; i < s.sc.lives; i++) g.spr(spr.fish, g.W - 18 * (i + 1), 1, { scale: 1 });
    if (s.flow.mode === "over") {
      g.rectfill(0, g.H / 2 - 30, g.W, 60, c.night);
      g.text("GAME OVER", mid, g.H / 2 - 22, c.red, { scale: 3, align: "center" });
      g.text(`SCORE ${s.sc.score}`, mid, g.H / 2 + 8, c.white, { align: "center" });
      if (s.sc.newBest && s.sc.score > 0) g.text("NEW BEST!", mid, g.H / 2 + 20, c.yellow, { align: "center" });
      else if (g.frame % 60 < 30) g.text("PRESS START", mid, g.H / 2 + 20, c.silver, { align: "center" });
    }
  },

  probe(g, s) {
    return {
      W: g.W,
      H: g.H,
      mode: s.flow.mode,
      peng: { x: s.peng.x, y: s.peng.y, w: s.peng.w, h: s.peng.h, vx: s.peng.vx },
      things: s.things.map((t) => ({ kind: t.kind, x: t.x, y: t.y, w: t.w, h: t.h })),
      ground: groundY(g),
      score: s.sc.score,
      lives: s.sc.lives,
      best: s.sc.best,
      played: s.played,
      fallSpeed: fallSpeedAt(s.played),
      bootChance: bootChanceAt(s.played),
      spawnEvery: spawnEveryAt(s.played),
      nextIn: s.nextIn,
      curve: [0, 599, 600, 1200, 3000, 6000, 12000].map((n) => ({ played: n, fallSpeed: fallSpeedAt(n), bootChance: bootChanceAt(n), spawnEvery: spawnEveryAt(n) })),
      spawned: s.spawned,
      fish: s.fish,
      boots: s.boots,
    };
  },
};
