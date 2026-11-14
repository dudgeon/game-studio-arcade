// @ts-check
// Sprite stacking (D477): a chunky 3D object from flat slices. Each slice is a
// top-down picture of the object at one height; drawn one above the next and
// all turned together, they look solid from any side.

/**
 * Draw a stack with the middle of its bottom slice at x, y, turned by `angle` (radians). `slices` go from
 * the bottom up; repeat a sprite to make it thicker. Options: `gap` is pixels between slices (default 1),
 * `zoom` its size (default 1), `shade` darkens the bottom by that many steps, lightening to the top, and
 * `shadow` is a color for a flat shadow under it.
 * @param {Arcade.G} g @param {readonly Arcade.Sprite[]} slices @param {number} x @param {number} y @param {number} [angle]
 * @param {{ gap?: number, zoom?: number, shade?: number, shadow?: Arcade.Color }} [o]
 */
export function draw(g, slices, x, y, angle = 0, o = {}) {
  const zoom = o.zoom ?? 1;
  const gap = (o.gap ?? 1) * zoom;
  const n = slices.length;
  if (o.shadow !== undefined && n) g.spr(slices[0], x - slices[0].w / 2 + gap, y - slices[0].h / 2 + gap, { rot: angle, zoom, color: o.shadow });
  for (let i = 0; i < n; i++) {
    const s = slices[i];
    const shade = o.shade && n > 1 ? Math.round(o.shade * (1 - i / (n - 1))) : 0;
    g.spr(s, x - s.w / 2, y - s.h / 2 - i * gap, { rot: angle, zoom, shade });
  }
}

/**
 * How tall a stack stands on screen, in pixels, so things can be sorted and placed around it.
 * @param {readonly Arcade.Sprite[]} slices @param {{ gap?: number, zoom?: number }} [o]
 */
export function height(slices, o = {}) {
  return Math.max(0, slices.length - 1) * (o.gap ?? 1) * (o.zoom ?? 1);
}
