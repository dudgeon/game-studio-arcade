// @ts-check
/** @typedef {{ row: number, dir: number, base: number, w: number, pos: number }} Lane */
/** @typedef {{ flow: Arcade.Lib.Flow, sc: Arcade.Lib.Score, frog: { x: number, row: number, hop: number, down: boolean }, lanes: Lane[], dying: number, splash: { x: number, y: number } | null, lastDeath: string, crossings: number, pops: Arcade.Lib.Pop[], art: Record<string, Arcade.Sprite> }} State */

// Log Hopper: a frog hops over a river on floating logs. Numbers live in CFG.
const CFG = {
  lives: 3,
  tile: 16,
  rows: 12,
  startRow: 11,
  midRow: 6,
  goalRow: 1,
  dyingFrames: 30,
  crossScore: 100,
  speedStep: 0.1,
  speedMax: 0.5,
  ring: 320, // 4 logs, 80 apart
  spacing: 80,
  logs: 4,
  hopFrames: 8,
};
// river lanes, from the start bank up: row, direction (+1 right), start speed, log length
const LANES = [
  [10, 1, 0.5, 64], [9, -1, 0.7, 48], [8, 1, 0.6, 48], [7, -1, 0.8, 56],
  [5, 1, 0.6, 48], [4, -1, 0.9, 40], [3, 1, 0.7, 48], [2, -1, 1.0, 40],
];
const FROG = [
  "..gg....gg..",
  ".g55g..g55g.",
  ".g05gggg50g.",
  "..gihhhhig..",
  "..ghhhhhhg..",
  ".gghhhhhhgg.",
  "gihhhhhhhhig",
  "gghhhhhhhhgg",
  ".gghhhhhhgg.",
  "..ghhhhhhg..",
  ".ggg.gg.ggg.",
  ".gg......gg.",
];
const HOP_LIFT = [1, 2, 3, 4, 4, 3, 2, 1];

/** @param {State} s */
const startX = (s, g) => (g.W - CFG.tile) / 2;
const speedOf = (/** @type {State} */ s, /** @type {Lane} */ l) => l.base + Math.min(CFG.speedMax, CFG.speedStep * s.crossings);
const isRiver = (/** @type {number} */ row) => row >= 2 && row <= 10 && row !== CFG.midRow;
const logX = (/** @type {Lane} */ l, /** @type {number} */ k) => ((((l.pos + k * CFG.spacing) % CFG.ring) + CFG.ring) % CFG.ring) - 64;
/** is there a log of this lane under x? */
const logUnder = (/** @type {Lane} */ l, /** @type {number} */ cx) => {
  for (let k = 0; k < CFG.logs; k++) {
    const x = logX(l, k);
    if (cx >= x && cx < x + l.w) return true;
  }
  return false;
};
const laneOf = (/** @type {State} */ s, /** @type {number} */ row) => s.lanes.find((l) => l.row === row);

/** @param {Arcade.G} g @param {State} s */
function respawn(g, s) {
  s.frog = { x: startX(s, g), row: CFG.startRow, hop: 0, down: false };
  s.dying = 0;
  s.splash = null;
}

/** @param {Arcade.G} g @param {State} s */
function newGame(g, s) {
  s.sc = g.lib.score.newScore(g, { lives: CFG.lives });
  s.crossings = 0;
  s.lastDeath = "";
  s.lanes = LANES.map(([row, dir, base, w]) => ({ row, dir, base, w, pos: g.rnd(CFG.spacing) }));
  s.pops = [];
  respawn(g, s);
}

/** the frog is lost: life gone now, back at the start after dyingFrames
 * @param {Arcade.G} g @param {State} s @param {string} why */
function die(g, s, why) {
  const { score, fx } = g.lib;
  score.loseLife(s.sc);
  s.lastDeath = why;
  s.dying = CFG.dyingFrames;
  s.splash = { x: s.frog.x + CFG.tile / 2, y: s.frog.row * CFG.tile + CFG.tile / 2 };
  g.sfx("hit");
  fx.pop(s.pops, why === "edge" ? "WHOOPS" : "SPLASH", s.splash.x, s.splash.y - 10, g.colors.white);
}

/** @type {Arcade.Cart<State>} */
export default {
  init(g) {
    const s = /** @type {State} */ ({ flow: g.lib.flow.newFlow() });
    s.art = { frog: g.sprite(FROG) };
    newGame(g, s);
    return s;
  },

  update(g, s) {
    const { flow, score, fx } = g.lib;
    flow.tick(s.flow);
    fx.tick(s.pops);
    if (s.flow.mode !== "play") {
      if (flow.startPressed(g, s.flow)) {
        if (s.flow.mode === "title") newGame(g, s);
        flow.go(s.flow, s.flow.mode === "title" ? "play" : "title");
      }
      return;
    }
    const f = s.frog;
    const T = CFG.tile;

    // the frog rides the log it sits on
    if (!s.dying && isRiver(f.row)) {
      const l = laneOf(s, f.row);
      if (l) f.x += l.dir * speedOf(s, l);
    }
    // the logs float on
    for (const l of s.lanes) l.pos += l.dir * speedOf(s, l);

    if (s.dying) {
      s.dying -= 1;
      if (s.dying === 0) {
        if (score.isOver(s.sc)) {
          score.commit(g, s.sc);
          g.sfx("lose");
          flow.go(s.flow, "over");
        } else respawn(g, s);
      }
      return;
    }

    // one hop for each press
    if (f.hop > 0) f.hop -= 1;
    let dx = 0;
    let dr = 0;
    if (g.btnp("up")) dr = -1;
    else if (g.btnp("down")) dr = 1;
    else if (g.btnp("left")) dx = -T;
    else if (g.btnp("right")) dx = T;
    const nr = f.row + dr;
    const nx = f.x + dx;
    if ((dx || dr) && nr >= CFG.goalRow && nr <= CFG.startRow && nx >= 0 && nx <= g.W - T) {
      f.row = nr;
      f.x = nx;
      f.hop = CFG.hopFrames;
      if (dr) f.down = dr > 0;
      g.sfx("jump");
    }

    // where did it land?
    if (f.row === CFG.goalRow) {
      score.addPoints(s.sc, CFG.crossScore);
      s.crossings += 1;
      g.sfx("coin");
      fx.pop(s.pops, `+${CFG.crossScore}`, f.x + T / 2, f.row * T, g.colors.yellow);
      respawn(g, s);
      return;
    }
    if (isRiver(f.row)) {
      const l = laneOf(s, f.row);
      const cx = f.x + T / 2;
      if (cx < 0 || cx >= g.W) die(g, s, "edge");
      else if (!l || !logUnder(l, cx)) die(g, s, "water");
    }
  },

  draw(g, s) {
    const { fx } = g.lib;
    const c = g.colors;
    const T = CFG.tile;
    g.cls(c.night);
    if (s.flow.mode === "title") {
      const art = fx.title(g, "LOG HOPPER", s.sc.best, { color: c.lime });
      g.spr(s.art.frog, art.cx - 18, art.cy - 32, { scale: 3 });
      g.text("STICK: HOP, ONE PRESS = ONE HOP", g.W / 2, art.cy + 10, c.white, { align: "center" });
      g.text("RIDE LOGS TO THE FAR BANK", g.W / 2, art.cy + 20, c.white, { align: "center" });
      return;
    }
    // banks and river
    for (let row = 1; row < CFG.rows; row++) {
      const y = row * T;
      if (isRiver(row)) {
        g.rectfill(0, y, g.W, T, c.blue);
        for (let i = 0; i < 9; i++) {
          const rx = (i * 37 + row * 23 + (g.frame >> 3) * (row % 2 ? 1 : -1) * 2 + 512) % g.W;
          g.line(rx, y + 3 + ((i * 5 + row) % 9), rx + 5, y + 3 + ((i * 5 + row) % 9), c.sky);
        }
      } else {
        g.rectfill(0, y, g.W, T, c.forest);
        for (let i = 0; i < 16; i++) g.pset((i * 41 + row * 17) % g.W, y + 2 + ((i * 7) % 12), c.green);
        if (row === CFG.goalRow) {
          for (let i = 0; i < 8; i++) {
            g.circfill(16 + i * 32, y + 8, 5, c.green);
            g.circfill(16 + i * 32 - 1, y + 7, 1, c.yellow);
          }
        }
      }
    }
    // logs
    for (const l of s.lanes) {
      const y = l.row * T + 2;
      for (let k = 0; k < CFG.logs; k++) {
        const x = Math.round(logX(l, k));
        g.rectfill(x, y, l.w, T - 4, c.brown);
        g.rectfill(x, y, l.w, 2, c.orange);
        g.rect(x, y, l.w, T - 4, c.maroon);
        for (let gx = x + 8; gx < x + l.w - 6; gx += 11) g.line(gx, y + 4, gx + 4, y + 4, c.maroon);
        g.circfill(x + 2, y + 6, 4, c.tan);
        g.circ(x + 2, y + 6, 2, c.brown);
        g.circfill(x + l.w - 3, y + 6, 4, c.tan);
        g.circ(x + l.w - 3, y + 6, 2, c.brown);
      }
    }
    // frog (or its splash)
    const f = s.frog;
    if (s.dying && s.splash) {
      const t = CFG.dyingFrames - s.dying;
      const r = 3 + (t >> 1);
      g.circ(s.splash.x, s.splash.y, r, c.white);
      if (t > 4) g.circ(s.splash.x, s.splash.y, r - 4, c.ice);
      if (t < 12) for (let i = 0; i < 6; i++) g.circfill(s.splash.x + (i - 2.5) * 4, s.splash.y - 3 - ((t * (i % 3 + 2)) >> 1) + t * t / 16, 1, c.white);
    } else {
      const lift = f.hop > 0 ? HOP_LIFT[CFG.hopFrames - f.hop] : 0;
      if (lift) g.circfill(f.x + T / 2, f.row * T + 13, 5, c.navy);
      g.spr(s.art.frog, Math.round(f.x) + 2, f.row * T + 2 - lift, { flipY: f.down });
    }
    // top strip
    g.rectfill(0, 0, g.W, T, c.night);
    g.text(`SCORE ${s.sc.score}  BEST ${s.sc.best}`, 2, 4, c.white);
    fx.lives(g, s.sc.lives, g.W - 2, 5, c.lime);
    fx.draw(g, s.pops);
    if (s.flow.mode === "over") fx.banner(g, "GAME OVER", s.sc.newBest ? "NEW BEST!" : `SCORE ${s.sc.score}`);
  },

  probe(g, s) {
    return {
      W: g.W,
      H: g.H,
      tile: CFG.tile,
      mode: s.flow.mode,
      frog: { x: s.frog.x, cx: s.frog.x + CFG.tile / 2, row: s.frog.row },
      startX: startX(s, g),
      lanes: s.lanes.map((l) => ({ row: l.row, dir: l.dir, speed: speedOf(s, l), base: l.base, logs: [0, 1, 2, 3].map((k) => ({ x: logX(l, k), w: l.w })) })),
      score: s.sc.score,
      lives: s.sc.lives,
      best: s.sc.best,
      crossings: s.crossings,
      dying: s.dying,
      lastDeath: s.lastDeath,
    };
  },

  poke(g, s, o) {
    if (o.lives !== undefined) s.sc.lives = o.lives;
    if (o.crossings !== undefined) s.crossings = o.crossings;
  },
};
