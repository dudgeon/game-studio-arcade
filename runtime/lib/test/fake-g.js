// A minimal stand-in for the console handle, enough for library tests until
// runtime/headless.js lands. Only what the library touches: frame, input and saves.

/**
 * @param {{ frame?: number, save?: unknown, players?: number }} [opts]
 */
export function fakeG(opts = {}) {
  /** @type {any} */
  let saved = opts.save === undefined ? null : structuredClone(opts.save);
  /** @type {Set<string>} */
  const down = new Set();
  /** @type {Set<string>} */
  const pressed = new Set();
  const g = {
    frame: opts.frame ?? 0,
    players: opts.players ?? 1,
    saves: 0,
    /** Hold buttons this frame: press("left", 1), press("start", 2). Each call is a fresh press. */
    press(/** @type {string} */ b, p = 1) {
      down.add(`${p}:${b}`);
      pressed.add(`${p}:${b}`);
    },
    /** Keep held buttons down but clear this frame's presses. */
    hold() {
      pressed.clear();
    },
    releaseAll() {
      down.clear();
      pressed.clear();
    },
    btn: (/** @type {string} */ b, p = 1) => down.has(`${p}:${b}`),
    btnp: (/** @type {string} */ b, p = 1) => pressed.has(`${p}:${b}`),
    btnr: () => false,
    save(/** @type {unknown} */ data) {
      const json = JSON.stringify(data);
      if (json === undefined) throw new Error("not JSON");
      if (json.length > 4096) throw new Error("over 4 KB");
      saved = JSON.parse(json);
      g.saves += 1;
    },
    load: () => (saved === null ? null : structuredClone(saved)),
  };
  return g;
}

/** The fake as the cart-facing type, for calling library functions. */
export function asG(/** @type {ReturnType<typeof fakeG>} */ f) {
  return /** @type {Arcade.G} */ (/** @type {unknown} */ (f));
}
