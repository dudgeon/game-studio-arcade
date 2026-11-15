# g.lib.parallax: background layers with depth

Far things scroll slower than near things. Draw the layers back to front before the world.

```js
// draw, with s.cam from g.lib.camera:
g.cls(c.sky);
parallax.layer(g, s.cam, { speed: 0.2, w: 128, y: 70 }, (i) => {   // far hills
  g.circfill(40, 60, 50, c.teal);
  g.circfill(100, 70, 40, c.teal);
});
parallax.layer(g, s.cam, { speed: 0.5, w: 96, y: 110 }, (i) => {   // nearer trees
  g.spr(s.art.tree, i % 2 ? 20 : 50, 0);
});
camera.use(g, s.cam);    // layer() leaves the camera reset
drawWorld(g, s);
```

### `parallax.layer(g, cam, opts, draw)`
Draws one repeating layer. `draw(i)` draws one strip in its own coordinates, x from 0 to `w`; it's called for every strip on screen with the camera already set, and `i` is the strip's number so strips can differ. Keep what it draws inside 0..`w`, or it's cut where the next strip starts.

`opts`: `speed` is how fast the layer scrolls against the world (0 stays put, like the sky; 0.2 far away; 0.5 nearer; 1 moves with the ground), `w` the strip's width (at least 8), `y` moves the layer down the screen, `speedY` scrolls it up and down (default 0).
