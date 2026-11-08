# Sprites

`g.sprite(rows)` makes a sprite once, in `init`; `g.spr(sp, x, y, { flipX, flipY, scale, color })` draws it. One character per pixel: `.` is transparent, `0`–`9` and `a`–`v` are colors 0–31 (`a` 10 brown, `b` 11 orange, `e` 14 gold, `f` 15 yellow, `h` 17 green, `n` 23 blue, `o` 24 sky). See `cart-api` for all 32.

**Every row must be the same length, or `g.sprite` throws.** So draw once and get it right:
- Count on a fixed width: pick 8 or 12 or 16 and write each row to it. Don't pad or slice rows in code.
- Check before moving on, without running the game: `node -e 'for (const r of ["..11..",".1111."]) console.log(r.length)'`.
- Keep rows in one constant in `game.js`, and redraw by replacing that constant, not the file.

**What reads at this size.** The screen is 256×192 on a 10" panel. A thing players must tell apart at a glance is 12–16 pixels, with one strong silhouette and color each. An 8×8 thing is a blob: fine for a bullet, not for a fish that must not look like a boot. Use a dark outline or a background color that contrasts with everything moving. For a big title-screen picture use `scale: 3` on the same sprite. `flipX` gives you facing left and right from one sprite; two frames swapped on `g.frame % 16 < 8` give a walk.

```js
const CAT = ["..1...1.", ".1f1.1f1", ".1fffff1", ".1f1f1f1", ".1fffff1", "..11111.", "..1f1f1.", "..1.1.1."];
// in init: s.cat = g.sprite(CAT);   in draw: g.spr(s.cat, s.x, s.y, { flipX: s.left, scale: 2 });
```

Plain shapes (`circfill`, `rectfill`) are cheapest and often enough for backgrounds and small things.
