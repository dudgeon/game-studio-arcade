// @ts-check
// Title -> play -> game over (and any other screens) as a tiny state machine
// kept in the cart's state. Switch on `flow.mode` in update and draw.

/**
 * The current screen. `t` counts frames since entering it (0 on the frame
 * `go` is called, 1 after the next `tick`); `prev` is the screen before.
 * @typedef {{ mode: string, t: number, prev: string | null }} Flow
 */

/**
 * A flow starting on `mode` (default "title").
 * @param {string} [mode]
 * @returns {Flow}
 */
export function newFlow(mode = "title") {
  return { mode, t: 0, prev: null };
}

/**
 * Switch to `mode` and restart its frame count.
 * Going to the mode you're already in restarts the count too.
 * @param {Flow} flow
 * @param {string} mode
 */
export function go(flow, mode) {
  flow.prev = flow.mode;
  flow.mode = mode;
  flow.t = 0;
}

/**
 * Count one frame in the current mode. Call it once at the top of update.
 * Returns the frame count.
 * @param {Flow} flow
 */
export function tick(flow) {
  flow.t += 1;
  return flow.t;
}

/**
 * Which player pressed to start: 1, 2, or 0 for nobody. Ignores presses in
 * the first `after` frames of the mode (default 30, half a second), so a
 * button still being mashed when a game ends doesn't skip the game-over
 * screen. `buttons` defaults to START and A; `players` to both. If both
 * players press on the same frame, player 1 wins.
 * @param {Arcade.G} g
 * @param {Flow} flow
 * @param {{ after?: number, buttons?: readonly Arcade.Button[], players?: readonly Arcade.Player[] }} [opts]
 * @returns {0 | Arcade.Player}
 */
export function startPressed(g, flow, opts = {}) {
  if (flow.t < (opts.after ?? 30)) return 0;
  const buttons = opts.buttons ?? ["start", "a"];
  for (const p of opts.players ?? [1, 2]) {
    if (buttons.some((b) => g.btnp(b, p))) return p;
  }
  return 0;
}
