# g.lib.stack: chunky 3D objects from slices

A stack is a list of sprites, each a top-down picture of the object at one height, bottom first. Drawn one above the next and turned together, it looks solid from every side: cars, boats, tanks, towers, cakes. Repeat a sprite to make that part thicker.

```js
const BODY = ["..7777..", ".777777.", "77777777", "77777777", "77777777", "77777777", ".777777.", "..7777.."];
const ROOF = ["........", "..8888..", ".888888.", ".8o88o8.", ".888888.", ".888888.", "..8888..", "........"];
const body = g.sprite(BODY), roof = g.sprite(ROOF);               // init
s.art.car = [body, body, body, roof, roof];                        // 5 slices tall

s.car.angle += st.x * 0.05;                                        // update: steer
stack.draw(g, s.art.car, s.car.x, s.car.y, s.car.angle, { shadow: c.night, shade: 1 }); // draw
```

Draw a slice as seen from above with its front toward the right; angle 0 then faces right (+x), matching `Math.cos(angle)`, `Math.sin(angle)` for moving. Sort stacks by `y` before drawing so nearer ones cover farther ones.

### `stack.draw(g, slices, x, y, angle?, opts?)`
Draws the stack with the middle of its bottom slice at x, y, turned by `angle` radians. `opts`: `gap` pixels between slices (default 1), `zoom` size (default 1), `shade` darkens the bottom slice by that many steps, fading to none at the top, `shadow` a color for a flat shadow underneath.

### `stack.height(slices, opts?)`
How many pixels tall the stack stands on screen, for placing things on top.
