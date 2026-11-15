// @ts-check
// A floor in perspective (D477): the ground stretches away to a horizon and
// turns under you, with sprites standing on it. For racers and flying games.
// The world is flat, measured in the floor picture's pixels; x and y are a
// place on it and `angle` is which way you face (radians, 0 is +x).

/**
 * Where you look from: a place on the floor, the way you face, and optionally how high you are
 * (default 16), the horizon's screen row (default 40% down) and the field of view (radians, default 1.2).
 * @typedef {{ x: number, y: number, angle: number, height?: number, horizon?: number, fov?: number }} View
 */

// An ordered-dither pattern: which pixels of a 4x4 block are on at each of 16 densities.
const BAYER = Object.freeze([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]);

/** @param {Arcade.G} g @param {View} cam */
function lens(g, cam) {
  return {
    f: g.W / 2 / Math.tan((cam.fov ?? 1.2) / 2),
    hz: Math.floor(cam.horizon ?? g.H * 0.4),
    hgt: cam.height ?? 16,
    cos: Math.cos(cam.angle),
    sin: Math.sin(cam.angle),
  };
}

/**
 * One big floor picture from a small map: each character of `map` is a tile, and `tiles` gives each
 * character's rows (all tiles square and the same size). Make it once, in init.
 * @param {Arcade.G} g @param {readonly string[]} map @param {Readonly<Record<string, readonly string[]>>} tiles
 * @returns {Arcade.Sprite}
 */
export function texture(g, map, tiles) {
  const first = Object.values(tiles)[0];
  if (!first) throw new Error("floor.texture() needs at least one tile");
  const n = first.length;
  const rows = [];
  for (const line of map) {
    for (let r = 0; r < n; r++) {
      let row = "";
      for (const ch of line) {
        const t = tiles[ch];
        if (!t) throw new Error(`floor.texture(): the map has "${ch}" but there's no tile for it`);
        if (t.length !== n || t[r].length !== n) throw new Error(`floor.texture(): tile "${ch}" isn't ${n} by ${n} like the first one`);
        row += t[r];
      }
      rows.push(row);
    }
  }
  return g.sprite(rows);
}

/**
 * Draw the floor from the horizon down, repeating the picture for ever. `fog` is how far (in floor pixels)
 * before the ground gets a step darker; 0 (the default) is no fog. With `haze`, a color, the distance fades
 * into that color in a dither instead (use the sky's lowest band): clear up to `fog`, all haze at four times it.
 * Draws in screen coordinates and resets the camera.
 * @param {Arcade.G} g @param {View} cam @param {Arcade.Sprite} tex @param {{ fog?: number, haze?: Arcade.Color }} [o]
 */
export function draw(g, cam, tex, o = {}) {
  const { f, hz, hgt, cos, sin } = lens(g, cam);
  const fog = o.fog ?? 0;
  const haze = o.haze;
  g.camera();
  for (let r = Math.max(0, hz); r < g.H; r++) {
    const z = (hgt * f) / (r + 0.5 - hz);
    const thick = fog > 0 && haze !== undefined ? Math.max(0, Math.min(16, Math.floor(((z / fog - 1) * 16) / 3))) : 0;
    if (thick >= 16) {
      g.rectfill(0, r, g.W, 1, /** @type {number} */ (haze));
      continue;
    }
    const step = z / f;
    const lat = (0.5 - g.W / 2) * step;
    g.texRow(tex, 0, r, g.W, cam.x + cos * z - sin * lat, cam.y + sin * z + cos * lat, -sin * step, cos * step, fog > 0 && haze === undefined ? Math.min(5, Math.floor(z / fog)) : 0);
    for (let i = 0; i < 4 && thick > 0; i++) {
      if (BAYER[(r & 3) * 4 + i] < thick) for (let x = i; x < g.W; x += 4) g.pset(x, r, /** @type {number} */ (haze));
    }
  }
}

/**
 * Draw the sky above the horizon: `colors` as even bands from the top down, then an optional `strip`
 * sprite (hills, a skyline) sitting on the horizon and sliding sideways as you turn.
 * @param {Arcade.G} g @param {View} cam @param {readonly Arcade.Color[]} colors @param {Arcade.Sprite} [strip]
 */
export function sky(g, cam, colors, strip) {
  const { f, hz } = lens(g, cam);
  g.camera();
  const n = Math.max(1, colors.length);
  for (let i = 0; i < colors.length; i++) {
    const y0 = Math.floor((hz * i) / n);
    g.rectfill(0, y0, g.W, Math.floor((hz * (i + 1)) / n) - y0, colors[i]);
  }
  if (strip) for (let j = 0; j < strip.h; j++) g.texRow(strip, 0, hz - strip.h + j, g.W, cam.angle * f, j, 1, 0);
}

/**
 * Where a place on the floor is on screen: `x`, `y` is where it touches the ground, `zoom` how big a floor
 * pixel is there, and `depth` how far away. Null when it's behind you or too close.
 * @param {Arcade.G} g @param {View} cam @param {number} x @param {number} y
 * @returns {{ x: number, y: number, zoom: number, depth: number } | null}
 */
export function project(g, cam, x, y) {
  const { f, hz, hgt, cos, sin } = lens(g, cam);
  const dx = x - cam.x;
  const dy = y - cam.y;
  const z = dx * cos + dy * sin;
  if (!(z > 1)) return null;
  return { x: g.W / 2 + ((dy * cos - dx * sin) * f) / z, y: hz + (hgt * f) / z, zoom: f / z, depth: z };
}

/**
 * Draw things standing on the floor, far ones first, each shrunk by its distance with its feet on the ground.
 * A thing is `{ spr, x, y }` in floor coordinates; `zoom` makes it bigger and `flipX` mirrors it.
 * `fog` darkens far ones, as in `draw`; `far` leaves out anything beyond that distance (with haze, four times its `fog`).
 * @param {Arcade.G} g @param {View} cam
 * @param {readonly { spr: Arcade.Sprite, x: number, y: number, zoom?: number, flipX?: boolean }[]} things
 * @param {{ fog?: number, far?: number }} [o]
 */
export function sprites(g, cam, things, o = {}) {
  const fog = o.fog ?? 0;
  const seen = [];
  for (const t of things) {
    const p = project(g, cam, t.x, t.y);
    if (!p || p.depth > (o.far ?? Infinity)) continue;
    const zoom = p.zoom * (t.zoom ?? 1);
    const half = (t.spr.w * zoom) / 2;
    if (zoom < 0.04 || p.x + half < 0 || p.x - half >= g.W) continue;
    seen.push({ t, p, zoom });
  }
  seen.sort((a, b) => b.p.depth - a.p.depth);
  g.camera();
  for (const { t, p, zoom } of seen) {
    g.spr(t.spr, p.x - t.spr.w / 2, p.y - t.spr.h, { zoom, pivot: [0.5, 1], flipX: t.flipX, shade: fog > 0 ? Math.min(5, Math.floor(p.depth / fog)) : 0 });
  }
}
