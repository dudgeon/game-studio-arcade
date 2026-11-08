// @ts-check
// Screen polish (D170): pop-ups, life hearts, a title screen, a game-over banner.
// Pop-ups are plain data the cart keeps in its state; nothing here changes the game.

/** @typedef {{ text: string, x: number, y: number, color: Arcade.Color, left: number }} Pop */

const HEART = [".##.##.", "#######", "#######", ".#####.", "..###..", "...#..."];
const MAX_HEARTS = 12;

/**
 * Add a pop-up that drifts up and fades after `frames` frames (default 30).
 * @param {Pop[]} pops @param {string} text @param {number} x center @param {number} y @param {Arcade.Color} color @param {number} [frames]
 */
export function pop(pops, text, x, y, color, frames = 30) {
  pops.push({ text, x, y, color, left: frames });
}

/**
 * Run the pop-ups one frame: they drift up and the finished ones go. Call once per update, in every mode.
 * @param {Pop[]} pops
 */
export function tick(pops) {
  for (let i = pops.length - 1; i >= 0; i--) {
    pops[i].y -= 0.5;
    pops[i].left -= 1;
    if (pops[i].left <= 0) pops.splice(i, 1);
  }
}

/** Draw the pop-ups, kept on screen. @param {Arcade.G} g @param {readonly Pop[]} pops */
export function draw(g, pops) {
  for (const p of pops) {
    const half = g.textWidth(p.text) / 2;
    g.text(p.text, Math.max(half, Math.min(g.W - half, p.x)), Math.max(0, p.y), p.color, { align: "center" });
  }
}

/**
 * Draw `n` hearts in a row with its right edge at x (at most 12 show).
 * @param {Arcade.G} g @param {number} n @param {number} x @param {number} y @param {Arcade.Color} [color]
 */
export function lives(g, n, x, y, color = g.colors.red) {
  for (let i = 0; i < Math.min(n, MAX_HEARTS); i++) {
    const left = x - 7 - i * 9;
    HEART.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) if (row[dx] === "#") g.pset(left + dx, y + dy, color);
    });
  }
}

/**
 * A title screen: the name near the top, a blinking PRESS START and the best score near the bottom, and clear
 * space between them for a picture. Returns that space's center and height, so art drawn there can't cover the words.
 * @param {Arcade.G} g @param {string} name @param {number} best
 * @param {{ color?: Arcade.Color, ink?: Arcade.Color }} [o] the name's color, and the small words' color
 * @returns {{ cx: number, cy: number, h: number }}
 */
export function title(g, name, best, o = {}) {
  const mid = g.W / 2;
  const scale = g.textWidth(name, 2) <= g.W - 8 ? 2 : 1;
  const top = Math.floor(g.H / 8);
  const bottom = g.H - 46;
  const ink = o.ink ?? g.colors.white;
  g.text(name, mid, top, o.color ?? g.colors.yellow, { scale, align: "center" });
  if (g.frame % 60 < 30) g.text("PRESS START", mid, bottom + 4, ink, { align: "center" });
  g.text(`BEST ${best}`, mid, bottom + 16, ink, { align: "center" });
  const free = top + 9 * scale;
  return { cx: mid, cy: Math.floor((free + bottom) / 2), h: bottom - free };
}

/**
 * A panel in the middle of the screen with big words and an optional line under them, such as GAME OVER and the score.
 * @param {Arcade.G} g @param {string} text @param {string} [sub] @param {Arcade.Color} [color]
 */
export function banner(g, text, sub = "", color = g.colors.red) {
  const w = Math.min(g.W, Math.max(g.textWidth(text, 2), g.textWidth(sub)) + 16);
  const h = sub ? 34 : 24;
  const x = (g.W - w) / 2;
  const y = (g.H - h) / 2;
  g.rectfill(x, y, w, h, g.colors.night);
  g.rect(x, y, w, h, color);
  g.text(text, g.W / 2, y + 5, color, { scale: 2, align: "center" });
  if (sub) g.text(sub, g.W / 2, y + 23, g.colors.white, { align: "center" });
}
