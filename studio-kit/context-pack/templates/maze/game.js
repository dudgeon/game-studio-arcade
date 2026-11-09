// @ts-check
// Maze template: walk tile by tile, walls stop you, grab pickups before time runs out. Change CFG, MAP and draw.
/** @typedef {{ flow: Arcade.Lib.Flow, sc: Arcade.Lib.Score, gems: Arcade.Lib.Grid, x: number, y: number, rep: Arcade.Lib.Repeat, round: Arcade.Lib.Timer, pops: Arcade.Lib.Pop[], art: Record<string, Arcade.Sprite> }} State */

const CFG = { tile: 16, top: 16, gems: 3, points: 10, roundFrames: 1800, repeatDelay: 12, repeatRate: 6 };
// "#" is a wall, "." is floor, "@" is where you start.
const MAP = [
  "................",
  ".##.###..###.##.",
  ".#............#.",
  ".#.##.####.##.#.",
  "......#..#......",
  ".##.#..@...#.##.",
  "......#..#......",
  ".#.##.####.##.#.",
  ".#............#.",
  ".##.###..###.##.",
  "................",
];
const WALKER = ["...dddddd...", "..dddddddd..", "..d11dd11d..", "..d51dd51d..", "..dddddddd..", "...dd77dd...", "..nnnnnnnn..", ".dnnnnnnnnd.", ".dnnnnnnnnd.", "..nnnnnnnn..", "..11....11..", "..11....11.."];
const GEM = ["..555..", ".5ccc5.", "5ccccc5", ".5ccc5.", "..5c5..", "...5..."];
const COLS = MAP[0].length;
const ROWS = MAP.length;
const isFloor = (/** @type {number} */ x, /** @type {number} */ y) => y >= 0 && y < ROWS && x >= 0 && x < COLS && MAP[y][x] !== "#";

/** Put a gem on a random free floor tile that isn't under the player. */
function addGem(/** @type {Arcade.G} */ g, /** @type {State} */ s) {
  const { grid } = g.lib;
  for (;;) {
    const x = g.rnd(COLS), y = g.rnd(ROWS);
    if (isFloor(x, y) && grid.get(s.gems, x, y) === 0 && !(x === s.x && y === s.y)) return grid.set(s.gems, x, y, g.pick([g.colors.pink, g.colors.aqua]));
  }
}

/** @param {Arcade.G} g @param {State} s */
function newGame(g, s) {
  const { grid, timers, score } = g.lib;
  s.sc = score.newScore(g, { lives: 1 });
  s.gems = grid.make(COLS, ROWS);
  s.y = MAP.findIndex((r) => r.includes("@"));
  s.x = MAP[s.y].indexOf("@");
  s.rep = timers.repeat(CFG.repeatDelay, CFG.repeatRate);
  s.round = timers.timer(CFG.roundFrames);
  for (let i = 0; i < CFG.gems; i++) addGem(g, s);
}

/** @type {Arcade.Cart<State>} */
export default {
  init(g) {
    const s = /** @type {State} */ ({ flow: g.lib.flow.newFlow() });
    s.pops = [];
    s.art = { walker: g.sprite(WALKER), gem: g.sprite(GEM) };
    newGame(g, s);
    return s;
  },

  update(g, s) {
    const { flow, timers, grid, score, fx } = g.lib;
    flow.tick(s.flow);
    fx.tick(s.pops);
    if (s.flow.mode !== "play") {
      if (flow.startPressed(g, s.flow)) {
        if (s.flow.mode === "title") newGame(g, s);
        flow.go(s.flow, s.flow.mode === "title" ? "play" : "title");
      }
      return;
    }

    const step = grid.stickStep(g, 1, true);
    if (timers.repeatTick(s.rep, step !== null) && step && isFloor(s.x + step[0], s.y + step[1])) {
      s.x += step[0];
      s.y += step[1];
    }
    if (grid.get(s.gems, s.x, s.y) > 0) {
      grid.set(s.gems, s.x, s.y, 0);
      score.addPoints(s.sc, CFG.points);
      g.sfx("coin");
      fx.pop(s.pops, `+${CFG.points}`, s.x * CFG.tile + 8, CFG.top + s.y * CFG.tile - 6, g.colors.yellow);
      addGem(g, s);
    }
    if (timers.tick(s.round)) {
      score.commit(g, s.sc);
      g.sfx("win");
      flow.go(s.flow, "over");
    }
  },

  draw(g, s) {
    const { fx } = g.lib;
    const c = g.colors;
    g.cls(c.forest);
    if (s.flow.mode === "title") {
      const art = fx.title(g, "GEM MAZE", s.sc.best, { color: c.mint });
      g.spr(s.art.walker, art.cx - 24, art.cy - 24, { scale: 4 });
      return;
    }
    const T = CFG.tile;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const px = x * T, py = CFG.top + y * T;
        if (!isFloor(x, y)) {
          g.rectfill(px, py, T, T, c.teal);
          g.rectfill(px, py, T, 2, c.aqua);
        }
        const gem = g.lib.grid.get(s.gems, x, y);
        if (gem) g.spr(s.art.gem, px + 1, py + 2, { scale: 2, color: (g.frame + x * 7) % 40 < 6 ? c.white : gem }); // twinkle
      }
    }
    g.spr(s.art.walker, s.x * T + 2, CFG.top + s.y * T + 2);
    const left = s.flow.mode === "over" ? 0 : Math.ceil(s.round.left / 60);
    g.text(`SCORE ${s.sc.score}  TIME ${left}  BEST ${s.sc.best}`, 2, 4, c.white);
    fx.draw(g, s.pops);
    if (s.flow.mode === "over") fx.banner(g, "TIME'S UP", s.sc.newBest ? "NEW BEST!" : `SCORE ${s.sc.score}`, c.yellow);
  },

  probe(g, s) {
    const gems = [];
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (g.lib.grid.get(s.gems, x, y)) gems.push({ x, y });
    return { mode: s.flow.mode, map: MAP, x: s.x, y: s.y, gems, score: s.sc.score, best: s.sc.best, left: s.round.left };
  },
};
