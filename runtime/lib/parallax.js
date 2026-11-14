// @ts-check
// Parallax (D475): background layers that scroll slower than the world, so it has depth.

/**
 * Draw one repeating layer. `draw(i)` draws strip number `i` of the layer in its own coordinates, 0 to `w`
 * across; it's called for each strip on screen, with the camera already set. `speed` is how fast the layer
 * scrolls against the world: 0 stays put (the sky), 0.5 is far hills, 1 moves with the ground.
 * Leaves the camera reset, so call `camera.use` again before drawing the world.
 * @param {Arcade.G} g @param {{ x: number, y: number }} cam
 * @param {{ speed: number, w: number, y?: number, speedY?: number }} o `y` moves the layer down; `speedY` scrolls it up and down (default 0)
 * @param {(i: number) => void} draw
 */
export function layer(g, cam, o, draw) {
  const w = Math.floor(o.w);
  if (!(w >= 8)) throw new Error(`parallax.layer() needs a strip width w of at least 8, got ${o.w}`);
  const ox = cam.x * o.speed;
  const oy = cam.y * (o.speedY ?? 0) - (o.y ?? 0);
  for (let i = Math.floor(ox / w); i * w - ox < g.W; i++) {
    g.camera(ox - i * w, oy);
    draw(i);
  }
  g.camera();
}
