// House runtime cart API (D3, D10, D11, D21).
//
// Global declarations, so a cart can be type-checked from anywhere with no
// import paths: put this file (and test-hook.d.ts for checks.js) in the tsc
// file list and annotate the cart with JSDoc:
//
//   // @ts-check
//   /** @typedef {{ x: number, score: number }} State */
//   /** @type {Arcade.Cart<State>} */
//   export default {
//     init(g) { return { x: g.W / 2, score: 0 }; },
//     update(g, s) { if (g.btn("right")) s.x += 1; },
//     draw(g, s) { g.cls(0); g.text("HI", s.x, 120, g.colors.white); },
//     probe(g, s) { return { x: s.x, score: s.score }; },
//   };
//
// Rules a cart lives by: the screen is 256x192 with 32 fixed colors; input is
// the cabinet's buttons only (g.players controllers, 1 on the cabinet); no DOM, no network, no timers, no Math.random
// (use g.rand); persistence only through g.save()/g.load().

declare namespace Arcade {
  /** Screen width in pixels. */
  type Width = 256;
  /** Screen height in pixels. */
  type Height = 192;

  /** A palette index, 0..31. See `G.colors` for names. */
  type Color = number;

  /** The cabinet's buttons per player. ★ (the Picade's ESC button, Escape on the dev keyboard) leaves the game and goes back to the shelf (D88); it belongs to the cabinet and never reaches a cart. */
  type Button = "up" | "down" | "left" | "right" | "a" | "b" | "x" | "y" | "start";

  /**
   * Player number, 1..8: player p uses controller p. The console has
   * `g.players` controllers (1 on the cabinet, D110); a player beyond that
   * has no controller, so its buttons always read as not held (D112). For a
   * game for more people than controllers, take turns with `g.lib.turns`.
   */
  type Player = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

  /** The 32 palette names, mapped to their index. */
  interface Colors {
    black: 0; night: 1; slate: 2; gray: 3; silver: 4; white: 5;
    maroon: 6; red: 7; coral: 8; pink: 9;
    brown: 10; orange: 11; tan: 12; peach: 13;
    gold: 14; yellow: 15;
    forest: 16; green: 17; lime: 18; mint: 19;
    teal: 20; aqua: 21;
    navy: 22; blue: 23; sky: 24; ice: 25;
    indigo: 26; purple: 27; lilac: 28;
    plum: 29; magenta: 30; rose: 31;
  }

  /** A palette-indexed sprite made by `g.sprite()`. */
  interface Sprite {
    readonly w: number;
    readonly h: number;
    /** w*h palette indices, row-major; -1 is transparent. */
    readonly data: Int8Array;
  }

  interface SprOptions {
    flipX?: boolean;
    flipY?: boolean;
    /** Integer scale, 1..8. Default 1. */
    scale?: number;
    /** Draw every opaque pixel in this one color (flashes, shadows). */
    color?: Color;
    /** Turn the sprite about its pivot, in radians, clockwise (D475). It stays pixel art: whole pixels, no blending. */
    rot?: number;
    /** Smooth size, any number above 0 (on top of `scale`): 1.5 is half as big again. Grows from the pivot. */
    zoom?: number;
    /** Stretch across only, times `zoom`: with `zoomY`, squash and stretch. */
    zoomX?: number;
    /** Stretch up and down only, times `zoom`. */
    zoomY?: number;
    /** The point that stays put under `rot` and `zoom`, as fractions of the sprite: default [0.5, 0.5], the middle; [0.5, 1] is its feet. */
    pivot?: readonly [number, number];
    /** Draw it this many steps darker, 0..5 (shadows, distance). */
    shade?: number;
  }

  interface TextOptions {
    /** Integer scale, 1..8. Default 1: glyphs are 5x7 (plus a descender row), 6 pixels apart, lines 9 apart. */
    scale?: number;
    /** Where `x` sits relative to the text. Default "left". */
    align?: "left" | "center" | "right";
  }

  /** Chip-synth waveforms. */
  type Wave = "square" | "pulse" | "triangle" | "saw" | "noise";

  /** One note on the 4-voice chip synth. */
  interface Tone {
    /** Pitch as a note name ("C4", "F#5", "Bb3") or a frequency in Hz. Default "A4". */
    note?: string | number;
    /** Default "square". */
    wave?: Wave;
    /** Length in frames (60 per second). Default 8. */
    frames?: number;
    /** Volume 0..1. Default 0.5. */
    vol?: number;
    /** Pitch change over the note, in semitones (e.g. 12 slides up an octave). Default 0. */
    slide?: number;
    /** Voice 0..3. A new tone on a busy voice replaces it. Default: the next free voice, else the oldest. */
    voice?: number;
  }

  /** Built-in sound effects. */
  type Sfx = "blip" | "select" | "jump" | "coin" | "pop" | "hit" | "explode" | "powerup" | "lose" | "win";

  interface SfxOptions {
    /** Shift the effect up or down, in semitones. Default 0. */
    pitch?: number;
    /** Volume 0..1. Default 0.5. */
    vol?: number;
    voice?: number;
  }

  /**
   * AI in a game (D480). A game never waits: `next` and `pick` answer in the same frame, with a fresh
   * answer when the cabinet has one and the game's own fallback otherwise. In a playtest there are only fallbacks.
   */
  interface Ai {
    /**
     * Declare lines the game wants made up, in `init`. `ask` says what one line is; `fallback` is at
     * least 3 lines of the game's own; `max` is the longest line it can show (20..120, default 80).
     */
    lines(name: string, opts: { ask: string; fallback: readonly string[]; max?: number }): void;
    /** The next line for a declared `lines` ask. Always a line, at once. */
    next(name: string): string;
    /** Declare a choice between 2..8 of the game's own words, in `init`. */
    choice(name: string, opts: { ask: string; options: readonly string[] }): void;
    /**
     * One of a declared choice's options, at once. `facts` are numbers, true/false or one of the
     * options (at most 8); the answer to them is used at the next `pick`.
     */
    pick(name: string, facts?: Record<string, number | boolean | string>): string;
    /**
     * Declare a voice ask, in `init` (D489): while the player holds `hold` (a, b, x or y) the cabinet
     * listens, and it hands back the one of `actions` (2..8 of the game's own words) the player meant.
     * The game never gets the microphone or the words. Give every action a button too: with no
     * microphone, and in a playtest, nothing is ever heard.
     */
    voice(name: string, opts: { ask: string; actions: readonly string[]; hold: "a" | "b" | "x" | "y" }): void;
    /** The action the cabinet heard for a voice ask since the last call, or null. Each is given once. */
    heard(name: string): string | null;
  }

  /** The console handle passed to every cart function. */
  interface G {
    readonly W: Width;
    readonly H: Height;
    /** Frames since `init` (0 during init, 1 in the first update). The clock is a fixed 60 Hz. */
    readonly frame: number;
    /** Palette names to indices, e.g. `g.colors.red`. */
    readonly colors: Readonly<Colors>;
    /** The palette as "#rrggbb" strings, index 0..31. */
    readonly palette: readonly string[];
    /** The starter library (D50): pure helpers, shared by every cart. Carts reach it here instead of importing it. */
    readonly lib: typeof import("./lib/index.js");
    /**
     * How many controllers this console has, 1..8 (D110). The cabinet has 1.
     * Games are single player by default; a game for two or more people takes
     * turns on the controllers there are (`g.lib.turns` hands them over).
     */
    readonly players: number;
    /** Made-up lines and choices from a small model, with the game's own fallbacks (D480). */
    readonly ai: Ai;

    // Input. `p` defaults to 1. A player beyond `g.players` never holds anything.
    /** Is the button held this frame? */
    btn(b: Button, p?: Player): boolean;
    /** Was the button pressed this frame (up last frame, down now)? */
    btnp(b: Button, p?: Player): boolean;
    /** Was the button released this frame? */
    btnr(b: Button, p?: Player): boolean;

    // Drawing. Coordinates are integers (fractions are floored, unless the cart glides); everything clips to the screen and `clip()`.
    /** Fill the screen (ignores camera and clip). Default color 0. */
    cls(c?: Color): void;
    pset(x: number, y: number, c: Color): void;
    /** Palette index at a screen pixel (ignores camera), or 0 off screen. */
    pget(x: number, y: number): Color;
    line(x0: number, y0: number, x1: number, y1: number, c: Color): void;
    /** Outline of a w x h rectangle with its top-left at x, y. */
    rect(x: number, y: number, w: number, h: number, c: Color): void;
    rectfill(x: number, y: number, w: number, h: number, c: Color): void;
    circ(x: number, y: number, r: number, c: Color): void;
    circfill(x: number, y: number, r: number, c: Color): void;
    /** Draw text in the built-in font (printable ASCII; "\n" starts a new line). Returns its width in pixels. */
    text(s: string | number, x: number, y: number, c?: Color, opts?: TextOptions): number;
    /** Width in pixels that `text` would draw. */
    textWidth(s: string | number, scale?: number): number;
    /**
     * Make a sprite from rows of pixel characters, one per pixel:
     * "0".."9" and "a".."v" are palette indices 0..31; "." or " " is transparent.
     * Rows must be the same length. Make sprites once (in init or at module level via `init`).
     */
    sprite(rows: readonly string[]): Sprite;
    /** Draw a sprite with its top-left at x, y. */
    spr(s: Sprite, x: number, y: number, opts?: SprOptions): void;
    /** Offset all later drawing by -x, -y (scrolling). No arguments resets it. */
    camera(x?: number, y?: number): void;
    /** Limit drawing to a screen rectangle. No arguments resets it. */
    clip(x?: number, y?: number, w?: number, h?: number): void;
    /**
     * Glide (D476): from the next draw, positions keep their fractions instead of being floored, so slow
     * movement and scrolling slide by a quarter of a pixel on the cabinet instead of stepping a whole one.
     * The art stays the same chunky pixels. Call it once in `init`. It changes only what the screen shows:
     * `pget`, checks and saved frames still see whole pixels.
     */
    glide(on?: boolean): void;
    /**
     * A row of `n` pixels from x, y, each copied from sprite `tex` at (u, v), which moves by (du, dv) per pixel
     * and wraps at the sprite's edges. `shade` 0..5 darkens it. The building block for floors in perspective (D477).
     */
    texRow(tex: Sprite, x: number, y: number, n: number, u: number, v: number, du: number, dv: number, shade?: number): void;
    /**
     * A column of `n` pixels down from x, y, copied from column `u` of sprite `tex` starting at row `v`, which moves
     * by `dv` per pixel. `shade` 0..5 darkens it. The building block for walls (D477).
     */
    texCol(tex: Sprite, x: number, y: number, n: number, u: number, v: number, dv: number, shade?: number): void;

    // Randomness: seeded per run, so tests reproduce (D10). Never use Math.random.
    /** A float in [0, 1). */
    rand(): number;
    /** An integer in [0, n). */
    rnd(n: number): number;
    /** A random element of a non-empty array. */
    pick<T>(items: readonly T[]): T;

    // Sound: a 4-voice chip synth.
    tone(t: Tone): void;
    sfx(name: Sfx, opts?: SfxOptions): void;
    /** Silence one voice, or all voices. */
    stop(voice?: number): void;

    // Persistence, per cart. JSON-serializable data, at most 4 KB.
    /** Store data (replaces what was saved before). Throws if it isn't JSON or is over 4 KB. */
    save(data: unknown): void;
    /** The last saved data, or null if nothing has been saved. */
    load(): any;

    // Score (D215): what the cabinet shows after a play, with the best ever.
    /** A round's final score, once, when the round ends (game over). A whole number from 0 to 999,999,999. Games with no score don't call it. */
    score(n: number): void;
  }

  /** Starter library types (D50), so carts can annotate state without import paths, e.g. `Arcade.Lib.Grid`. */
  namespace Lib {
    type Grid = import("./lib/grid.js").Grid;
    type Shape = import("./lib/grid.js").Shape;
    type Piece = import("./lib/grid.js").Piece;
    type Box = import("./lib/collide.js").Box;
    type Thing = import("./lib/collide.js").Thing;
    type Rule = import("./lib/collide.js").Rule;
    type Hit = import("./lib/collide.js").Hit;
    type Timer = import("./lib/timers.js").Timer;
    type Repeat = import("./lib/timers.js").Repeat;
    type Score = import("./lib/score.js").Score;
    type Flow = import("./lib/flow.js").Flow;
    type Turns = import("./lib/turns.js").Turns;
    type Pop = import("./lib/fx.js").Pop;
    type Body = import("./lib/motion.js").Body;
    type Spring = import("./lib/motion.js").Spring;
    type Camera = import("./lib/camera.js").Camera;
    type Particle = import("./lib/particles.js").Particle;
    type View = import("./lib/floor.js").View;
    type Eye = import("./lib/raycast.js").Eye;
  }

  /**
   * A cart's game.js default export. The runtime calls `init` once, then
   * `update` and `draw` once per 60 Hz frame. Keep all game state in the
   * object `init` returns; `update`, `draw` and `probe` get it back as `s`.
   */
  interface Cart<S = any> {
    init(g: G): S;
    update(g: G, s: S): void;
    draw(g: G, s: S): void;
    /**
     * State the playtest can see (D11): return a small JSON-serializable
     * object with whatever the spec's auto rules talk about (score, lives,
     * positions, mode...). Called only by the test hook; never change state here.
     */
    probe?(g: G, s: S): unknown;
    /**
     * Optional test setup (D163), called only by a check's `t.poke(o)`, e.g.
     * `poke(g, s, o) { if (o.lives) s.sc.lives = o.lives; }`. Never runs in play.
     */
    poke?(g: G, s: S, o: any): void;
  }
}
