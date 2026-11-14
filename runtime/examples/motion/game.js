// @ts-check
// Motion showcase (D475-D479): four short scenes that use every motion and depth module, gliding.
// Not a game for the shelf: it's the proof cart, and its playtest is where the frame times come from.
/**
 * @typedef {{
 *   scene: number, idle: number, t: number, bits: Arcade.Lib.Particle[], art: Record<string, Arcade.Sprite>,
 *   run: { b: Arcade.Lib.Body, cam: Arcade.Lib.Camera, sq: Arcade.Lib.Spring, onGround: boolean, left: boolean, walked: number, coins: { x: number, y: number, gone: number }[], got: number },
 *   drive: { view: Arcade.Lib.View, turn: number, lean: number, ground: Arcade.Sprite, trees: { spr: Arcade.Sprite, x: number, y: number }[] },
 *   maze: { eye: Arcade.Lib.Eye, turn: number, go: number, walls: Record<string, Arcade.Sprite>, gems: { spr: Arcade.Sprite, x: number, y: number, size: number, lift: number }[], got: number },
 *   spin: { angle: number, rate: number, car: Arcade.Sprite[], tower: Arcade.Sprite[] },
 * }} State
 */

const SCENES = ["RUN", "DRIVE", "MAZE", "SPIN"];
const IDLE = 150; // frames with nothing pressed before the next scene starts by itself
const BUTTONS = /** @type {const} */ (["up", "down", "left", "right", "a", "b", "x", "y"]);

// --- RUN: a side-scroller. "#" is ground.
const TILE = 8;
const COLS = 80;
const ROWS = 24;
const RUN = { max: 2.2, accel: 0.2, friction: 0.2, gravity: 0.25, jump: -4.6 };
const LAND = Array.from({ length: ROWS }, (_, y) =>
  Array.from({ length: COLS }, (_, x) => (y >= 21 || (y === 17 && x % 20 > 11 && x % 20 < 17) || (y === 13 && x % 20 > 2 && x % 20 < 7) ? "#" : ".")).join(""),
);
const RUNNER = [
  ["...bbbb...", "..bbbbbb..", "..b5bb5b..", "..b1bb1b..", "..bbbbbb..", "...b99b...", "..nnnnnn..", ".bnnnnnnb.", ".bnnnnnnb.", "..nnnnnn..", "..11..11..", ".11....11."],
  ["...bbbb...", "..bbbbbb..", "..b5bb5b..", "..b1bb1b..", "..bbbbbb..", "...b99b...", "..nnnnnn..", ".bnnnnnnb.", ".bnnnnnnb.", "..nnnnnn..", "...1111...", "...1111..."],
];
const COIN = ["..eeee..", ".effffe.", "eff5fffe", "eff5fffe", "efffffee", "efffffee", ".effffe.", "..eeee.."];

// --- DRIVE: a ring road on a floor in perspective. Tiles are 8x8; the map is 16x16 tiles and repeats.
const paint = (/** @type {number} */ n, /** @type {(x: number, y: number) => string} */ f) => Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => f(x, y)).join(""));
const TILES = {
  g: paint(8, (x, y) => ((x * 3 + y * 5) % 11 === 0 ? "g" : "h")),
  f: paint(8, (x, y) => (x === 3 && y === 3 ? "9" : x === 6 && y === 6 ? "f" : "h")),
  r: paint(8, (x, y) => ((x * 7 + y * 3) % 13 === 0 ? "2" : "3")),
  w: paint(8, (x, y) => (x > 2 && x < 5 && y > 1 && y < 6 ? "5" : "3")),
};
const TRACK = paint(16, (x, y) => {
  const d = Math.hypot(x - 7.5, y - 7.5);
  return d >= 4 && d < 6.6 ? (Math.abs(d - 5.3) < 0.45 && (x + y) % 2 ? "w" : "r") : (x * 5 + y * 3) % 7 === 0 ? "f" : "g";
});
const TREE = ["......hhhh......", "....hhhhhhhh....", "...hhhihhhhhh...", "..hhhihhhhhhhh..", "..hhhhhhhhghhh..", ".hhhhhhhhhhghhh.", ".hhihhhhhhhhhhh.", ".hhhhhhhgghhhhh.", "..hhhhhhhghhhh..", "...hhhhhhhhhh...", ".....hhaahh.....", ".......aa.......", ".......aa.......", ".......aa.......", "......aaaa......", ".....aaaaaa....."];
const CAR = ["....777777......", "...77oooo77.....", "..777oooo777....", ".77777777777777.", "7777777777777777", "7f777777777777f7", "7777777777777777", ".11177777777111.", ".111........111."];

// --- MAZE: first person. "#" brick, "B" blue panel.
const MAZE = ["############", "#....#.....#", "#.##.#.BB#.#", "#.#........#", "#.#.##B#.#.#", "#...#....#.#", "#.#...##...#", "############"];
const BRICK = paint(16, (x, y) => (y % 4 === 3 || (x + (y >> 2) * 4) % 8 === 7 ? "a" : (x * 3 + y * 7) % 17 === 0 ? "8" : "7"));
const PANEL = paint(16, (x, y) => (x === 0 || y === 0 || x === 15 || y === 15 ? "m" : (x + y) % 6 === 0 ? "o" : "n"));
const GEM = ["...ll...", "..lppl..", ".lpllll.", "lpllllll", ".llllll.", "..llll..", "...ll...", "........"];

// --- SPIN: stacked slices. Each is the object seen from above, front to the right.
const BODY = ["..7777777777..", ".777777777777.", "77777777777777", "77777777777777", "77777777777777", "77777777777777", ".777777777777.", "..7777777777.."];
const CABIN = ["..............", "...88888888...", "..8ooo8888o8..", "..8ooo8888o8..", "..8ooo8888o8..", "..8ooo8888o8..", "...88888888...", ".............."];
const WHEELS = ["..11......11..", "..11......11..", "..............", "..............", "..............", "..............", "..11......11..", "..11......11.."];
const ring = (/** @type {number} */ r, /** @type {string} */ ch) => paint(16, (x, y) => (Math.hypot(x - 7.5, y - 7.5) < r ? ((x + y) % 5 === 0 ? "4" : ch) : "."));

/** @param {Arcade.G} g @param {State} s */
function burst(g, s, x, y, colors, n = 14) {
  g.lib.particles.burst(g, s.bits, x, y, { n, colors, speed: 2.4, size: 2 });
}

/** @type {Arcade.Cart<State>} */
export default {
  init(g) {
    g.glide();
    const { motion, camera, floor } = g.lib;
    const art = { run0: g.sprite(RUNNER[0]), run1: g.sprite(RUNNER[1]), coin: g.sprite(COIN), tree: g.sprite(TREE), car: g.sprite(CAR), gem: g.sprite(GEM) };
    art.hills = g.sprite(Array.from({ length: 10 }, (_, y) => Array.from({ length: 64 }, (_, x) => (9 - y < 4 + 3 * Math.sin(x / 5) + 2 * Math.sin(x / 2.3) ? "k" : ".")).join("")));
    const slice = (/** @type {string[]} */ rows) => g.sprite(rows);
    const [body, cabin, wheels] = [slice(BODY), slice(CABIN), slice(WHEELS)];
    return {
      scene: 0,
      idle: 0,
      t: 0,
      bits: [],
      art,
      run: {
        b: motion.body(24, 120, 10, 12),
        cam: camera.newCamera(),
        sq: { x: 0, v: 0 },
        onGround: false,
        left: false,
        walked: 0,
        coins: Array.from({ length: 12 }, (_, i) => ({ x: 70 + i * 48, y: i % 3 === 0 ? 150 : i % 3 === 1 ? 118 : 86, gone: 0 })),
        got: 0,
      },
      drive: {
        view: { x: 60 + 5.3 * 8, y: 60, angle: Math.PI / 2, height: 12 },
        turn: 0,
        lean: 0,
        ground: floor.texture(g, TRACK, TILES),
        trees: Array.from({ length: 14 }, (_, i) => ({ spr: art.tree, x: 60 + Math.cos(i * 0.9) * (i % 2 ? 62 : 22), y: 60 + Math.sin(i * 0.9) * (i % 2 ? 62 : 22) })),
      },
      maze: {
        eye: { x: 1.5, y: 1.5, angle: 0.4 },
        turn: 0,
        go: 0,
        walls: { "#": g.sprite(BRICK), B: g.sprite(PANEL) },
        gems: [[3.5, 1.5], [6.5, 3.5], [10.5, 1.5], [3.5, 5.5], [8.5, 5.5], [10.5, 6.5]].map(([x, y]) => ({ spr: art.gem, x, y, size: 0.4, lift: 0.2 })),
        got: 0,
      },
      spin: { angle: 0, rate: 0.02, car: [wheels, body, body, body, cabin, cabin], tower: [7, 6, 5, 4, 3].flatMap((r, i) => Array(4).fill(g.sprite(ring(r, "bceb8"[i])))) },
    };
  },

  update(g, s) {
    const { motion, camera, particles, raycast, collide } = g.lib;
    particles.tick(s.bits);
    s.t += 1;
    s.idle = BUTTONS.some((b) => g.btn(b)) ? 0 : s.idle + 1;
    if (g.btnp("start") || s.idle >= IDLE) {
      s.scene = (s.scene + 1) % SCENES.length;
      s.idle = 0;
      s.t = 0;
      s.bits = [];
      g.sfx("select");
      return;
    }
    const st = motion.stick(g);

    if (s.scene === 0) {
      const r = s.run;
      const b = r.b;
      motion.drive(b, st.x, null, RUN);
      if (st.x) r.left = st.x < 0;
      if (g.btnp("a") && r.onGround) {
        b.vy = RUN.jump;
        r.sq.v -= 0.12;
        g.sfx("jump");
      }
      const falling = b.vy;
      const hit = motion.move(b, { gravity: RUN.gravity, solid: (x, y, w, h) => x < 0 || x + w > COLS * TILE || motion.mapHit(LAND, TILE, x, y, w, h) });
      if (hit.y === 1 && !r.onGround && falling > 1.5) {
        r.sq.v += falling * 0.07; // squash on landing
        particles.burst(g, s.bits, b.x + 5, b.y + 12, { n: 6, speed: 1.2, angle: -Math.PI / 2, spread: 2.4, colors: [g.colors.silver, g.colors.white], life: 18 });
      }
      r.onGround = hit.y === 1;
      motion.spring(r.sq, 0, 0.25, 0.7);
      r.walked += Math.abs(b.vx);
      for (const coin of r.coins) {
        if (coin.gone > 0) coin.gone -= 1;
        else if (collide.overlap(b, { x: coin.x, y: coin.y, w: 8, h: 8 })) {
          coin.gone = 240;
          r.got += 1;
          burst(g, s, coin.x + 4, coin.y + 4, [g.colors.yellow, g.colors.gold, g.colors.white]);
          camera.shake(g, r.cam, 2, 8);
          g.sfx("coin");
        }
      }
      camera.follow(g, r.cam, b, { bounds: { x: 0, y: 0, w: COLS * TILE, h: g.H } });
    } else if (s.scene === 1) {
      const d = s.drive;
      // The road is a ring, so steering straight follows it; the stick turns in or out.
      d.turn = motion.approach(d.turn, 0.0285 + st.x * 0.03, 0.002);
      d.lean = motion.damp(d.lean, st.x * 10, 0.1);
      d.view.angle += d.turn;
      d.view.x += Math.cos(d.view.angle) * 1.2;
      d.view.y += Math.sin(d.view.angle) * 1.2;
    } else if (s.scene === 2) {
      const m = s.maze;
      m.turn = motion.approach(m.turn, st.x ? st.x * 0.045 : st.y ? 0 : 0.012, 0.005);
      m.go = motion.approach(m.go, -st.y * 0.06, 0.006);
      m.eye.angle += m.turn;
      raycast.walk(MAZE, m.eye, Math.cos(m.eye.angle) * m.go, Math.sin(m.eye.angle) * m.go);
      for (const gem of m.gems) {
        gem.lift = 0.2 + 0.08 * Math.sin((s.t + gem.x * 20) / 14);
        if (Math.hypot(gem.x - m.eye.x, gem.y - m.eye.y) < 0.45) {
          m.got += 1;
          burst(g, s, g.W / 2, g.H * 0.6, [g.colors.aqua, g.colors.ice, g.colors.white], 20);
          g.sfx("powerup");
          // Move it to the far end of the maze from here, so there's always one to find.
          gem.x = m.eye.x < 6 ? 10.5 : 1.5;
          gem.y = m.eye.y < 4 ? 6.5 : 1.5;
        }
      }
    } else {
      const sp = s.spin;
      sp.rate = motion.approach(sp.rate, 0.02 + st.x * 0.06, 0.003);
      sp.angle += sp.rate;
    }
  },

  draw(g, s) {
    const { motion, camera, parallax, anim, particles, floor, raycast, stack } = g.lib;
    const c = g.colors;

    if (s.scene === 0) {
      const r = s.run;
      g.cls(c.sky);
      g.circfill(g.W - 40, 34, 14, c.yellow);
      parallax.layer(g, r.cam, { speed: 0.2, w: 128, y: 104 }, () => {
        g.circfill(34, 70, 56, c.teal);
        g.circfill(100, 84, 44, c.teal);
      });
      parallax.layer(g, r.cam, { speed: 0.5, w: 96, y: 126 }, (i) => {
        g.circfill(i % 2 ? 30 : 60, 60, 34, c.forest);
        g.spr(s.art.tree, i % 2 ? 66 : 12, 26, { color: c.forest });
      });
      camera.use(g, r.cam);
      const view = camera.view(g, r.cam, TILE);
      for (let ty = 0; ty < ROWS; ty++) {
        for (let tx = Math.max(0, Math.floor(view.x / TILE)); tx < COLS && tx * TILE < view.x + view.w; tx++) {
          if (LAND[ty][tx] !== "#") continue;
          const top = ty === 0 || LAND[ty - 1][tx] !== "#";
          g.rectfill(tx * TILE, ty * TILE, TILE, TILE, top ? c.green : c.brown);
          if (top) g.rectfill(tx * TILE, ty * TILE + 3, TILE, TILE - 3, c.brown);
          else if ((tx * 7 + ty * 3) % 5 === 0) g.pset(tx * TILE + 3, ty * TILE + 4, c.tan);
        }
      }
      for (const coin of r.coins) {
        if (coin.gone > 0) continue;
        // A coin turning on its post: a zoom across, from the middle.
        g.spr(s.art.coin, coin.x, coin.y + 2 * Math.sin((s.t + coin.x) / 12), { zoomX: Math.max(0.15, Math.abs(Math.cos((s.t + coin.x) / 16))) });
      }
      const frame = r.onGround ? (anim.walk(2, r.walked, 7) ? s.art.run1 : s.art.run0) : s.art.run1;
      g.spr(frame, r.b.x, r.b.y, { flipX: r.left, zoomX: 1 + r.sq.x, zoomY: 1 - r.sq.x, pivot: [0.5, 1] });
      particles.draw(g, s.bits);
      g.camera();
      g.text(`COINS ${r.got}`, g.W - 2, 12, c.white, { align: "right" });
    } else if (s.scene === 1) {
      const d = s.drive;
      floor.sky(g, d.view, [c.blue, c.sky, c.ice], s.art.hills);
      floor.draw(g, d.view, d.ground, { fog: 40, haze: c.ice });
      floor.sprites(g, d.view, d.trees, { far: 150 });
      g.spr(s.art.car, g.W / 2 - 16 + d.lean, g.H - 30, { scale: 2, rot: d.lean * 0.012 });
    } else if (s.scene === 2) {
      const m = s.maze;
      raycast.draw(g, m.eye, MAZE, m.walls, { floor: c.forest, ceil: c.navy, things: m.gems });
      particles.draw(g, s.bits);
      g.text(`GEMS ${m.got}`, g.W - 2, 12, c.white, { align: "right" });
    } else {
      const sp = s.spin;
      g.cls(c.night);
      const mid = g.W / 2;
      for (let i = 0; i < 40; i++) g.pset((i * 53) % g.W, (i * 37) % g.H, c.slate);
      // Cars driving round a tower, drawn back to front so near ones cover far ones.
      const cars = Array.from({ length: 6 }, (_, i) => {
        const a = sp.angle + (i * Math.PI) / 3;
        return { x: mid + Math.cos(a) * 84, y: 110 + Math.sin(a) * 40, a: a + Math.PI / 2 };
      });
      const things = [...cars, { x: mid, y: 112, a: NaN }].sort((p, q) => p.y - q.y);
      for (const t of things) {
        if (Number.isNaN(t.a)) stack.draw(g, sp.tower, t.x, t.y, sp.angle * 0.5, { zoom: 2, shade: 2, shadow: c.black });
        else stack.draw(g, sp.car, t.x, t.y, t.a, { zoom: 2, shadow: c.black });
      }
      // A sprite turning and growing, to show g.spr's rot and zoom on their own.
      g.spr(s.art.coin, 20, g.H - 30, { rot: sp.angle * 2, zoom: 1.5 + Math.sin(s.t / 20) });
      g.spr(s.art.gem, g.W - 28, g.H - 30, { rot: -sp.angle * 2, zoom: 2 });
    }

    // Each scene's name drops in with a bounce.
    g.rectfill(0, 0, g.W, 10, c.black);
    g.text(SCENES[s.scene], g.W / 2, motion.tween(-10, 1, s.t, 40, "bounce"), c.yellow, { align: "center" });
    g.text("START: NEXT", 2, 1, c.gray);
  },

  probe(g, s) {
    const r = s.run;
    return {
      W: g.W,
      H: g.H,
      scene: s.scene,
      name: SCENES[s.scene],
      idle: s.idle,
      runner: { x: r.b.x, y: r.b.y, vx: r.b.vx, vy: r.b.vy, onGround: r.onGround },
      cam: { x: r.cam.x, y: r.cam.y },
      world: COLS * TILE,
      coins: r.got,
      view: { x: s.drive.view.x, y: s.drive.view.y, angle: s.drive.view.angle },
      eye: { x: s.maze.eye.x, y: s.maze.eye.y, angle: s.maze.eye.angle },
      eyeOpen: g.lib.raycast.open(MAZE, s.maze.eye.x, s.maze.eye.y),
      gems: s.maze.got,
      spin: s.spin.angle,
      bits: s.bits.length,
    };
  },
};
