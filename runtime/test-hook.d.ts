// House runtime test hook (D10, D11, D21): the `t` handle every check gets.
//
// A cart's checks.js is an ES module whose default export maps each auto rule
// id in spec.md to an async check:
//
//   // @ts-check
//   /** @type {Arcade.Checks} */
//   export default {
//     async R1(t) {
//       await t.input([{ frames: 30, p1: "right" }]);
//       await t.step(30);
//       const p = await t.probe();
//       if (!(p.x > 128)) throw new Error(`holding right for 30 frames should move the cat right, x=${p.x}`);
//     },
//   };
//
// A check passes by returning and fails by throwing; the error message is the
// reason shown in playtest.json, so write it for a person. Checks import
// nothing (no node:assert): they must run the same in Node and in a browser.
//
// Every check starts from a fresh cart: seed 1, nothing saved, frame 0, one
// controller (g.players === 1, as on the cabinet), init already run. Time
// only moves when the check calls step(): the clock is frames, not wall time,
// so a report reproduces on any machine.
//
// The same handle is implemented three ways, all with this exact shape:
//   - headless in Node (runtime/headless.js): no browser, no pixels on screen;
//   - inside the cart frame (runtime/frame.js), driven by the host page;
//   - on the host page as `window.arcade.test` (runtime/host.js), which
//     forwards to the frame; this is what Playwright drives.

declare namespace Arcade {
  /**
   * Buttons held for one input step: an array of buttons, or a
   * space-separated string such as "right a". "" or [] holds nothing.
   */
  type Held = readonly Button[] | string;

  /**
   * Hold these buttons for `frames` frames. Players left out hold nothing.
   * A player beyond the run's controller count (1 unless `reset({ players })`
   * says otherwise, D110) has no controller, so what it holds is ignored.
   */
  interface InputStep {
    /** How many frames this step lasts, >= 1. */
    frames: number;
    p1?: Held;
    p2?: Held;
    p3?: Held;
    p4?: Held;
    p5?: Held;
    p6?: Held;
    p7?: Held;
    p8?: Held;
  }

  /** A queue of input steps, played in order, one frame per stepped frame. */
  type InputScript = readonly InputStep[];

  /** A captured frame: what the screen shows after the last draw. */
  interface Frame {
    /** g.frame when this was drawn. */
    frame: number;
    width: 256;
    height: 192;
    /** Palette indices (0..31), row-major: pixel (x, y) is pixels[y * width + x]. */
    pixels: ArrayLike<number>;
    /** Hash of the pixels (hex). Same seed + same input => same hash. */
    hash: string;
  }

  interface ResetOptions {
    /** RNG seed for the new run. Default 1. */
    seed?: number;
    /** Keep what the cart saved with g.save() (e.g. to test a high score that survives a restart). Default false. */
    keepSave?: boolean;
    /**
     * Controllers for the new run, 1..8 (g.players). Default: the run's
     * starting count, which is 1 (the cabinet) unless the harness says
     * otherwise. Use `{ players: 2 }` to check a side-by-side game.
     */
    players?: number;
  }

  /** A sound the cart started, for checks like "a sound plays when a line clears". */
  interface SoundEvent {
    frame: number;
    /** "tone" for g.tone, otherwise the g.sfx name. */
    kind: "tone" | Sfx;
    voice: number;
  }

  /** A dev warning: something the cart did that works but is probably a mistake. */
  interface Warning {
    frame: number;
    message: string;
  }

  interface TestHandle {
    /**
     * Advance n frames (default 1): each frame runs update, consuming one
     * frame of the input queue (nothing held once it is empty), and the last
     * one runs draw. Rejects with the cart's error if update or draw throws.
     */
    step(n?: number): Promise<void>;
    /** Append steps to the input queue. Nothing happens until step(). */
    input(script: InputScript): Promise<void>;
    /** The cart's `probe(g, s)` result right now (JSON-cloned), or null if it has none. */
    probe(): Promise<any>;
    /**
     * Set up a situation (D163): calls the cart's optional `poke(g, s, o)` export, e.g. `{ lives: 99 }`
     * so the player survives long enough to read the late game. Never poke the thing the rule is about.
     */
    poke(o: unknown): Promise<void>;
    /** Capture the current screen. */
    frame(): Promise<Frame>;
    /** Sounds started since the last reset, oldest first. */
    sounds(): Promise<SoundEvent[]>;
    /** Round scores the cart reported with g.score() since the last reset, oldest first (D215). */
    scores(): Promise<number[]>;
    /**
     * Dev warnings since the last reset, each kind once: today, a color outside
     * 0..31 (it still draws, wrapped into the palette). For the palette check.
     * Optional so older handle wrappers stay valid; every runtime handle has it.
     */
    warnings?(): Promise<Warning[]>;
    /** Restart the cart from init with a fresh RNG and an empty input queue. */
    reset(opts?: ResetOptions): Promise<void>;
  }

  /** The handle a check gets: `t` plus the tested bot helper `t.bot` (D162). */
  interface CheckHandle extends TestHandle {
    bot: import("./lib/bot.js").Bot;
  }

  /** A cart's checks.js default export: one check per auto rule id ("R1", "R3"...). */
  type Checks = Record<string, (t: CheckHandle) => Promise<void> | void>;
}
