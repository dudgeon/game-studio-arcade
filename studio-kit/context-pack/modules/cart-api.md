# Cart API

`game.js` imports nothing. All state lives in what `init` returns, passed back as `s`.

```js
// @ts-check
/** @typedef {{ x: number, sc: Arcade.Lib.Score, flow: Arcade.Lib.Flow }} State */
/** @type {Arcade.Cart<State>} */
export default {
  init(g) { return { x: g.W / 2, /* ... */ }; },
  update(g, s) { if (g.btn("right")) s.x += 2; },
  draw(g, s) { g.cls(g.colors.night); g.text(`SCORE ${s.sc.score}`, 4, 4, g.colors.white); },
  probe(g, s) { return { W: g.W, H: g.H, x: s.x }; },        // what checks see; plain JSON; never changes state
  poke(g, s, o) { if (o.lives) s.sc.lives = o.lives; },       // optional test setup; never runs in play
};
```

Types for JSDoc: `Arcade.Lib.Grid Shape Piece Box Thing Rule Hit Timer Repeat Score Flow Turns Pop`. The type-check catches a misspelled button or sound.

**Clock:** 60 Hz; `update` then `draw`. `g.frame` counts frames but doesn't restart with a new game, so count play frames in `s`.

**Input:** `g.btn(b, p?)` held, `g.btnp(b, p?)` pressed this frame, `g.btnr(b, p?)` released this frame. `b` is `up down left right a b x y start`; `p` defaults to 1. `g.players` is controllers: 1 on the cabinet. ★ belongs to the cabinet and never reaches a cart.

**Screen:** `g.W` × `g.H` is 256×192 (never write the numbers). Fractions are floored; everything clips.
- `g.cls(c?)`, `g.pset(x, y, c)`, `g.pget(x, y)`, `g.line(x0, y0, x1, y1, c)`
- `g.rect(x, y, w, h, c)`, `g.rectfill(x, y, w, h, c)`, `g.circ(x, y, r, c)`, `g.circfill(x, y, r, c)`
- `g.text(s, x, y, c?, { scale?, align? })` returns its width; `align` is `left center right`; `g.textWidth(s, scale?)`. Glyphs are 5×7, 6 apart, lines 9 apart. Printable ASCII only: no ★ or ♥ in text.
- `g.sprite(rows)` once in `init`, `g.spr(sp, x, y, { flipX?, flipY?, scale?, color? })`. See the `sprites` guide.
- `g.camera(x?, y?)` offsets later drawing; `g.clip(x?, y?, w?, h?)` limits it. No arguments resets.

**Colors,** `g.colors.<name>`, or 0–31: 0 black, 1 night, 2 slate, 3 gray, 4 silver, 5 white, 6 maroon, 7 red, 8 coral, 9 pink, 10 brown, 11 orange, 12 tan, 13 peach, 14 gold, 15 yellow, 16 forest, 17 green, 18 lime, 19 mint, 20 teal, 21 aqua, 22 navy, 23 blue, 24 sky, 25 ice, 26 indigo, 27 purple, 28 lilac, 29 plum, 30 magenta, 31 rose.

**Random:** `g.rand()` in [0, 1), `g.rnd(n)` an integer below n, `g.pick(list)`. Seeded, so tests repeat.

**Sound:** `g.sfx(name, { pitch?, vol?, voice? })`: `blip select jump coin pop hit explode powerup lose win`. `g.tone({ note: "C5", wave, frames, vol, slide, voice })`, `wave` is `square pulse triangle saw noise`; `g.stop(voice?)`. 4 voices.

**Saves:** `g.save(data)`, `g.load()`: one JSON value, at most 4 KB. For high scores use `g.lib.score`.

**Assets:** none needed; carts draw with shapes and sprites.
