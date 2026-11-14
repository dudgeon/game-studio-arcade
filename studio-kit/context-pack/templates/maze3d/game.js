// @ts-check
/** @typedef {{ flow: Arcade.Lib.Flow, sc: Arcade.Lib.Score, eye: Arcade.Lib.Eye, turn: number, go: number, gems: { spr: Arcade.Sprite, x: number, y: number, size: number, lift: number }[], clock: Arcade.Lib.Timer, won: boolean, pops: Arcade.Lib.Pop[], bits: Arcade.Lib.Particle[], walls: Record<string, Arcade.Sprite>, art: Record<string, Arcade.Sprite> }} State */

// First-person maze template: walk a maze seen from inside and find the gems. Change CFG, MAP and draw.
const CFG = { turn: 0.045, turnStep: 0.005, walk: 0.06, walkStep: 0.006, reach: 0.5, gem: 10, frames: 3600 };
// One character per tile: "#" brick, "B" blue panel, "." open, "*" a gem, "@" where you start (facing right).
const MAP = [
  "############",
  "#@...#...*.#",
  "#.##.#.BB#.#",
  "#.#*.......#",
  "#.#.##B#.#.#",
  "#...#..*.#.#",
  "#.#...##..*#",
  "#*#.#....#.#",
  "############",
];
const paint = (/** @type {number} */ n, /** @type {(x: number, y: number) => string} */ f) => Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => f(x, y)).join(""));
const BRICK = paint(16, (x, y) => (y % 4 === 3 || (x + (y >> 2) * 4) % 8 === 7 ? "a" : (x * 3 + y * 7) % 17 === 0 ? "8" : "7"));
const PANEL = paint(16, (x, y) => (x === 0 || y === 0 || x === 15 || y === 15 ? "m" : (x + y) % 6 === 0 ? "o" : "n"));
const GEM = ["...ll...", "..lppl..", ".lpllll.", "lpllllll", ".llllll.", "..llll..", "...ll...", "........"];
// The maze the walker and the rays see: gems and the start are open floor.
const MAZE = MAP.map((row) => row.replace(/[*@]/g, "."));
/** The middle of every tile that is `ch`. */
const find = (/** @type {string} */ ch) => MAP.flatMap((row, y) => [...row].flatMap((v, x) => (v === ch ? [{ x: x + 0.5, y: y + 0.5 }] : [])));

/** @param {Arcade.G} g @param {State} s */
function newGame(g, s) {
  s.sc = g.lib.score.newScore(g, { lives: 1 });
  s.eye = { ...find("@")[0], angle: 0 };
  s.turn = 0;
  s.go = 0;
  s.gems = find("*").map((at) => ({ spr: s.art.gem, ...at, size: 0.4, lift: 0.2 }));
  s.clock = g.lib.timers.timer(CFG.frames);
  s.won = false;
}

/** @type {Arcade.Cart<State>} */
export default {
  init(g) {
    g.glide();
    const s = /** @type {State} */ ({ flow: g.lib.flow.newFlow() });
    s.pops = [];
    s.bits = [];
    s.art = { gem: g.sprite(GEM) };
    s.walls = { "#": g.sprite(BRICK), B: g.sprite(PANEL) };
    newGame(g, s);
    return s;
  },

  update(g, s) {
    const { flow, fx, motion, raycast, particles, timers, score } = g.lib;
    const c = g.colors;
    flow.tick(s.flow);
    fx.tick(s.pops);
    particles.tick(s.bits);
    if (s.flow.mode !== "play") {
      if (flow.startPressed(g, s.flow)) {
        if (s.flow.mode === "title") newGame(g, s);
        flow.go(s.flow, s.flow.mode === "title" ? "play" : "title");
      }
      return;
    }

    // Turning and walking both build up and ease off; walls stop the walker and it slides along them.
    const eye = s.eye;
    const st = motion.stick(g);
    s.turn = motion.approach(s.turn, st.x * CFG.turn, CFG.turnStep);
    s.go = motion.approach(s.go, -st.y * CFG.walk, CFG.walkStep);
    eye.angle += s.turn;
    raycast.walk(MAZE, eye, Math.cos(eye.angle) * s.go, Math.sin(eye.angle) * s.go);

    for (const gem of s.gems) gem.lift = 0.2 + 0.08 * Math.sin((g.frame + gem.x * 20) / 14); // they bob
    const near = s.gems.findIndex((gem) => Math.hypot(gem.x - eye.x, gem.y - eye.y) < CFG.reach);
    if (near >= 0) {
      s.gems.splice(near, 1);
      score.addPoints(s.sc, CFG.gem);
      g.sfx("coin");
      fx.pop(s.pops, `+${CFG.gem}`, g.W / 2, g.H / 2, c.yellow);
      particles.burst(g, s.bits, g.W / 2, g.H * 0.6, { n: 20, speed: 2.5, size: 2, colors: [c.aqua, c.ice, c.white] });
      s.won = s.gems.length === 0;
    }
    if (s.won || timers.tick(s.clock)) {
      score.commit(g, s.sc);
      g.sfx(s.won ? "win" : "lose");
      flow.go(s.flow, "over");
    }
  },

  draw(g, s) {
    const { fx, raycast, particles } = g.lib;
    const c = g.colors;
    if (s.flow.mode === "title") {
      g.cls(c.navy);
      const art = fx.title(g, "GEM MAZE", s.sc.best, { color: c.aqua });
      g.spr(s.art.gem, art.cx - 16, art.cy - 16, { scale: 4 });
      return;
    }
    raycast.draw(g, s.eye, MAZE, s.walls, { floor: c.forest, ceil: c.navy, things: s.gems });
    particles.draw(g, s.bits);
    g.text(`GEMS LEFT ${s.gems.length}  SCORE ${s.sc.score}`, 2, 1, c.white);
    g.text(`TIME ${Math.ceil(s.clock.left / 60)}`, g.W - 2, 1, c.white, { align: "right" });
    fx.draw(g, s.pops);
    if (s.flow.mode === "over") fx.banner(g, s.won ? "YOU WIN!" : "TIME UP", s.sc.newBest ? "NEW BEST!" : `SCORE ${s.sc.score}`, s.won ? c.green : c.red);
  },

  probe(g, s) {
    const gems = s.gems.map((gem) => ({ x: gem.x, y: gem.y }));
    return { W: g.W, H: g.H, mode: s.flow.mode, eye: s.eye, turn: s.turn, go: s.go, inWall: !g.lib.raycast.open(MAZE, s.eye.x, s.eye.y), gems, map: MAZE, score: s.sc.score, left: s.clock.left, won: s.won };
  },
};
