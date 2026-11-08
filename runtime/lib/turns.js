// @ts-check
// Turn-based play (D113): whose turn it is, handing over the controls on one
// controller, and one score per player. Optional: single-player games never
// use it. All state is one plain object kept in the cart's state.

/** The pass-screen ignores presses for this many frames, like flow.startPressed. */
const PASS_LOCKOUT = 30;

/**
 * Whose turn it is and everyone's score.
 * - `count`: players in the game (1..8).
 * - `up`: whose turn it is (1..count).
 * - `round`: 1 for the first time round the players, then 2, ...
 * - `rounds`: rounds in a game, or 0 for no limit.
 * - `scores[p - 1]`: player p's score.
 * - `passing`: true while the "pass the controls" screen is up.
 * - `t`: frames the pass screen has been up.
 * - `pass`: when to show it: "shared" (only when players share controllers), "always" or "never".
 * @typedef {{ count: number, up: Arcade.Player, round: number, rounds: number, scores: number[], passing: boolean, t: number, pass: "shared" | "always" | "never" }} Turns
 */

/**
 * @param {unknown} n
 * @param {string} what
 */
function checkCount(n, what) {
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 8) throw new Error(`${what} must be a whole number from 1 to 8, got ${n}`);
  return n;
}

/**
 * Turns for `count` players (default 2), player 1 first, no pass screen yet.
 * @param {number} [count]
 * @param {{ rounds?: number, pass?: "shared" | "always" | "never" }} [opts]
 * @returns {Turns}
 */
export function newTurns(count = 2, opts = {}) {
  checkCount(count, "newTurns(count)");
  const rounds = opts.rounds ?? 0;
  if (!(Number.isInteger(rounds) && rounds >= 0)) throw new Error(`newTurns rounds must be 0 (no limit) or more, got ${rounds}`);
  const pass = opts.pass ?? "shared";
  if (pass !== "shared" && pass !== "always" && pass !== "never") throw new Error(`newTurns pass must be "shared", "always" or "never", got ${pass}`);
  return { count, up: 1, round: 1, rounds, scores: new Array(count).fill(0), passing: false, t: 0, pass };
}

/**
 * Do players share controllers? True when the console has fewer controllers
 * (`g.players`) than there are players; then everyone plays on controller 1.
 * @param {Arcade.G} g
 * @param {Turns} tu
 */
export function shared(g, tu) {
  return g.players < tu.count;
}

/**
 * The controller player `p` (default: whoever is up) plays on: 1 when
 * players share, otherwise their own.
 * @param {Arcade.G} g
 * @param {Turns} tu
 * @param {Arcade.Player} [p]
 * @returns {Arcade.Player}
 */
export function controller(g, tu, p = tu.up) {
  return shared(g, tu) ? 1 : p;
}

/**
 * Is button `b` held by the player who is up, on their controller? Always
 * false while the pass screen is up, so the hand-over can't move anything.
 * @param {Arcade.G} g
 * @param {Turns} tu
 * @param {Arcade.Button} b
 */
export function btn(g, tu, b) {
  return !tu.passing && g.btn(b, controller(g, tu));
}

/**
 * Was button `b` pressed this frame by the player who is up? False while passing.
 * @param {Arcade.G} g
 * @param {Turns} tu
 * @param {Arcade.Button} b
 */
export function btnp(g, tu, b) {
  return !tu.passing && g.btnp(b, controller(g, tu));
}

/**
 * Is the game over: every one of `rounds` rounds played? Never, with no limit.
 * @param {Turns} tu
 */
export function isOver(tu) {
  return tu.rounds > 0 && tu.round > tu.rounds;
}

/**
 * End the current turn: the next player is up, and after the last player a
 * new round starts. Puts the pass screen up when the controls change hands
 * (see `pass`). After the last round, `isOver` turns true and nothing else
 * changes. Returns whoever is up now.
 * @param {Arcade.G} g
 * @param {Turns} tu
 * @returns {Arcade.Player}
 */
export function next(g, tu) {
  if (isOver(tu)) return tu.up;
  const up = /** @type {Arcade.Player} */ ((tu.up % tu.count) + 1);
  tu.up = up;
  if (up === 1) tu.round += 1;
  tu.t = 0;
  tu.passing = !isOver(tu) && tu.count > 1 && (tu.pass === "always" || (tu.pass === "shared" && shared(g, tu)));
  return up;
}

/**
 * Run the pass screen. Call it at the top of update and skip the rest of the
 * update while it returns true. It returns true while the screen is up, and
 * also on the frame the next player presses A or START (after the first 30
 * frames) to take over, so that press doesn't also act in the game.
 * @param {Arcade.G} g
 * @param {Turns} tu
 * @param {{ after?: number, buttons?: readonly Arcade.Button[] }} [opts]
 */
export function waiting(g, tu, opts = {}) {
  if (!tu.passing) return false;
  tu.t += 1;
  const buttons = opts.buttons ?? ["a", "start"];
  if (tu.t > (opts.after ?? PASS_LOCKOUT) && buttons.some((b) => g.btnp(b, controller(g, tu)))) {
    tu.passing = false;
    tu.t = 0;
  }
  return true;
}

/**
 * Draw the pass screen if it is up (otherwise draw nothing and return false):
 * "PLAYER 2" (or `names[1]`), "YOUR TURN", "PASS THE CONTROLS" when players
 * share, and a blinking "PRESS A" once presses count. Fills the screen with
 * `bg` (default night). Returns true if it drew.
 * @param {Arcade.G} g
 * @param {Turns} tu
 * @param {{ names?: readonly string[], color?: Arcade.Color, bg?: Arcade.Color, after?: number }} [opts]
 */
export function drawPass(g, tu, opts = {}) {
  if (!tu.passing) return false;
  const color = opts.color ?? g.colors.yellow;
  const cx = Math.floor(g.W / 2);
  const cy = Math.floor(g.H / 2);
  g.cls(opts.bg ?? g.colors.night);
  const name = String(opts.names?.[tu.up - 1] ?? `PLAYER ${tu.up}`).toUpperCase();
  g.text(name, cx, cy - 36, color, { scale: 3, align: "center" });
  g.text("YOUR TURN", cx, cy - 6, g.colors.white, { scale: 2, align: "center" });
  if (shared(g, tu)) g.text("PASS THE CONTROLS", cx, cy + 18, g.colors.silver, { align: "center" });
  if (tu.t > (opts.after ?? PASS_LOCKOUT) && Math.floor(tu.t / 20) % 2 === 0) {
    g.text("PRESS A", cx, cy + 36, color, { align: "center" });
  }
  return true;
}

/**
 * Add points to player `p`'s score (default: whoever is up). May be
 * negative; a score never goes below 0. Returns the new score.
 * @param {Turns} tu
 * @param {number} points
 * @param {Arcade.Player} [p]
 */
export function addScore(tu, points, p = tu.up) {
  if (!(Number.isInteger(p) && p >= 1 && p <= tu.count)) throw new Error(`addScore player must be 1 to ${tu.count}, got ${p}`);
  tu.scores[p - 1] = Math.max(0, tu.scores[p - 1] + points);
  return tu.scores[p - 1];
}

/**
 * The player with the highest score, or 0 if two or more share it.
 * @param {Turns} tu
 * @returns {0 | Arcade.Player}
 */
export function winner(tu) {
  const best = Math.max(...tu.scores);
  const top = tu.scores.flatMap((s, i) => (s === best ? [i + 1] : []));
  return top.length === 1 ? /** @type {Arcade.Player} */ (top[0]) : 0;
}
