// @ts-check
/** @typedef {{ flow: Arcade.Lib.Flow, sc: Arcade.Lib.Score, car: { x: number, y: number, angle: number, speed: number, turn: number }, around: number, laps: number, clock: Arcade.Lib.Timer, lean: number, ground: Arcade.Sprite, trees: { spr: Arcade.Sprite, x: number, y: number }[], pops: Arcade.Lib.Pop[], art: Record<string, Arcade.Sprite> }} State */

// Racer template: drive laps round a ring road on a ground in perspective. Change CFG, the track and draw.
const CFG = { max: 2, accel: 0.03, coast: 0.02, grass: 0.8, turn: 0.04, turnStep: 0.004, lap: 100, frames: 3600 };
const T = 8; // a ground tile, in ground pixels
const N = 32; // the ground is N x N tiles, and repeats
const SIZE = N * T;
const MID = SIZE / 2;
const ROAD = 11 * T; // the road is a ring this far from the middle...
const HALF = 1.6 * T; // ...and this wide each side of that
const paint = (/** @type {number} */ n, /** @type {(x: number, y: number) => string} */ f) => Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => f(x, y)).join(""));
const TILES = {
  g: paint(T, (x, y) => ((x * 3 + y * 5) % 11 === 0 ? "g" : "h")), // grass
  f: paint(T, (x, y) => (x === 3 && y === 3 ? "9" : "h")), // a flower
  r: paint(T, (x, y) => ((x * 7 + y * 3) % 13 === 0 ? "2" : "3")), // road
  s: paint(T, (x, y) => ((x >> 1) + (y >> 1)) % 2 ? "5" : "1"), // the start line
};
const far = (/** @type {number} */ x, /** @type {number} */ y) => Math.hypot(x - MID, y - MID);
const onRoad = (/** @type {number} */ x, /** @type {number} */ y) => Math.abs(far(x, y) - ROAD) < HALF;
const TRACK = paint(N, (x, y) => (onRoad(x * T + 4, y * T + 4) ? (y === N / 2 && x > N / 2 ? "s" : "r") : (x * 5 + y * 3) % 7 === 0 ? "f" : "g"));
const TREE = ["....hhhh....", "..hhhhhhhh..", ".hhihhhhhhh.", "hhhhhhhghhhh", "hhihhhhhghhh", "hhhhhhhhhhhh", ".hhhhgghhhh.", "..hhhhhhhh..", "....haah....", ".....aa.....", ".....aa.....", "....aaaa...."];
const CAR = ["....777777......", "...77oooo77.....", "..777oooo777....", ".77777777777777.", "7777777777777777", "7f777777777777f7", "7777777777777777", ".11177777777111.", ".111........111."];

/** @param {Arcade.G} g @param {State} s */
function newGame(g, s) {
  s.sc = g.lib.score.newScore(g, { lives: 1 });
  s.car = { x: MID + ROAD, y: MID, angle: Math.PI / 2, speed: 0, turn: 0 }; // on the start line, facing round the ring
  s.around = 0;
  s.laps = 0;
  s.lean = 0;
  s.clock = g.lib.timers.timer(CFG.frames);
}

/** @type {Arcade.Cart<State>} */
export default {
  init(g) {
    g.glide();
    const s = /** @type {State} */ ({ flow: g.lib.flow.newFlow() });
    s.pops = [];
    s.art = { tree: g.sprite(TREE), car: g.sprite(CAR) };
    s.ground = g.lib.floor.texture(g, TRACK, TILES);
    s.trees = Array.from({ length: 24 }, (_, i) => ({ spr: s.art.tree, x: MID + Math.cos(i * 1.7) * (i % 3 ? 14 : 7) * T, y: MID + Math.sin(i * 1.7) * (i % 3 ? 14 : 7) * T }));
    newGame(g, s);
    return s;
  },

  update(g, s) {
    const { flow, fx, motion, timers, score } = g.lib;
    flow.tick(s.flow);
    fx.tick(s.pops);
    if (s.flow.mode !== "play") {
      if (flow.startPressed(g, s.flow)) {
        if (s.flow.mode === "title") newGame(g, s);
        flow.go(s.flow, s.flow.mode === "title" ? "play" : "title");
      }
      return;
    }

    // A is the pedal. Speed and steering both build up and ease off; grass is slow.
    const car = s.car;
    const st = motion.stick(g);
    const top = onRoad(car.x, car.y) ? CFG.max : CFG.grass;
    car.speed = car.speed > top ? Math.max(top, car.speed - 0.1) : motion.approach(car.speed, g.btn("a") ? top : 0, g.btn("a") ? CFG.accel : CFG.coast);
    car.turn = motion.approach(car.turn, st.x * CFG.turn, CFG.turnStep);
    car.angle += car.turn;
    s.lean = motion.damp(s.lean, st.x * 8, 0.1);
    // Laps: add up how far round the middle the car goes. The ground repeats, so the car wraps with it.
    const before = Math.atan2(car.y - MID, car.x - MID);
    car.x = (car.x + Math.cos(car.angle) * car.speed + SIZE) % SIZE;
    car.y = (car.y + Math.sin(car.angle) * car.speed + SIZE) % SIZE;
    const turned = Math.atan2(car.y - MID, car.x - MID) - before;
    s.around += Math.atan2(Math.sin(turned), Math.cos(turned));
    if (s.around >= (s.laps + 1) * 2 * Math.PI) {
      s.laps += 1;
      score.addPoints(s.sc, CFG.lap);
      g.sfx("powerup");
      fx.pop(s.pops, `LAP ${s.laps}  +${CFG.lap}`, g.W / 2, g.H / 3, g.colors.yellow, 60);
    }
    if (timers.tick(s.clock)) {
      score.commit(g, s.sc);
      g.sfx("win");
      flow.go(s.flow, "over");
    }
  },

  draw(g, s) {
    const { fx, floor } = g.lib;
    const c = g.colors;
    if (s.flow.mode === "title") {
      g.cls(c.sky);
      const art = fx.title(g, "RING RACER", s.sc.best, { color: c.red, ink: c.night });
      g.spr(s.art.car, art.cx - 32, art.cy - 18, { scale: 4 });
      return;
    }
    // The view sits a little behind the car and looks where it's going.
    const car = s.car;
    const view = { x: car.x - Math.cos(car.angle) * 22, y: car.y - Math.sin(car.angle) * 22, angle: car.angle, height: 12 };
    floor.sky(g, view, [c.blue, c.sky, c.ice]);
    floor.draw(g, view, s.ground, { fog: 40, haze: c.ice });
    floor.sprites(g, view, s.trees, { far: 150 });
    g.spr(s.art.car, g.W / 2 - 16 + s.lean, g.H - 32, { scale: 2, rot: s.lean * 0.012 });
    g.text(`LAPS ${s.laps}  SCORE ${s.sc.score}`, 2, 1, c.white);
    g.text(`TIME ${Math.ceil(s.clock.left / 60)}`, g.W - 2, 1, c.white, { align: "right" });
    fx.draw(g, s.pops);
    if (s.flow.mode === "over") fx.banner(g, "TIME UP", s.sc.newBest ? "NEW BEST!" : `SCORE ${s.sc.score}`, c.yellow);
  },

  probe(g, s) {
    const car = s.car;
    return { W: g.W, H: g.H, mode: s.flow.mode, car, onRoad: onRoad(car.x, car.y), far: far(car.x, car.y), road: ROAD, mid: MID, laps: s.laps, score: s.sc.score, left: s.clock.left };
  },
};
