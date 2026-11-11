// @ts-check
// Score, lives and a high score that survives restarts through g.save().
// g.save() keeps one value per cart, so these helpers read and write one
// field of a saved object and leave the cart's other saved fields alone.

/**
 * One player's score. `best` is the high score (loaded from the save);
 * `newBest` turns true once `score` beats the best it started with.
 * @typedef {{ score: number, lives: number, best: number, newBest: boolean, key: string }} Score
 */

/**
 * The saved value under `key`, or `fallback` if nothing is saved, the save
 * isn't an object, or the field is missing.
 * @param {Arcade.G} g
 * @param {string} key
 * @param {any} [fallback]
 */
export function loadField(g, key, fallback = null) {
  const data = g.load();
  if (data === null || typeof data !== "object" || Array.isArray(data) || !(key in data)) return fallback;
  return data[key];
}

/**
 * Save `value` under `key`, keeping every other field already saved. If the
 * existing save isn't an object it is replaced by `{ [key]: value }`.
 * Throws like g.save() if the result isn't JSON or is over 4 KB.
 * @param {Arcade.G} g
 * @param {string} key
 * @param {unknown} value
 */
export function saveField(g, key, value) {
  const data = g.load();
  const base = data !== null && typeof data === "object" && !Array.isArray(data) ? data : {};
  g.save({ ...base, [key]: value });
}

/**
 * A fresh score for a new game: score 0, `lives` lives (default 3), and the
 * saved high score from field `key` (default "best"; use "best2" etc. for a
 * separate table per mode). Call it in init and again when a new game starts.
 * @param {Arcade.G} g
 * @param {{ lives?: number, key?: string }} [opts]
 * @returns {Score}
 */
export function newScore(g, opts = {}) {
  const key = opts.key ?? "best";
  const saved = loadField(g, key, 0);
  return { score: 0, lives: opts.lives ?? 3, best: typeof saved === "number" ? saved : 0, newBest: false, key };
}

/**
 * Add points (may be negative; the score never goes below 0). Raises `best`
 * and sets `newBest` when the score passes it. Doesn't save; call `commit`.
 * Returns the new score.
 * @param {Score} sc
 * @param {number} points
 */
export function addPoints(sc, points) {
  sc.score = Math.max(0, sc.score + points);
  if (sc.score > sc.best) {
    sc.best = sc.score;
    sc.newBest = true;
  }
  return sc.score;
}

/**
 * Take away one life (or `n`), never below 0. Returns the lives left; 0 means game over.
 * @param {Score} sc
 * @param {number} [n]
 */
export function loseLife(sc, n = 1) {
  sc.lives = Math.max(0, sc.lives - n);
  return sc.lives;
}

/**
 * Give one life (or `n`), up to `max` if given. Returns the lives now.
 * @param {Score} sc
 * @param {number} [n]
 * @param {number} [max]
 */
export function gainLife(sc, n = 1, max = Infinity) {
  sc.lives = Math.min(max, sc.lives + n);
  return sc.lives;
}

/**
 * Is the game over (no lives left)?
 * @param {Score} sc
 */
export function isOver(sc) {
  return sc.lives <= 0;
}

/**
 * The game ended: report its score to the cabinet (g.score, D215) and save the
 * high score if this game beat it, keeping other saved fields. Call it once
 * when the game ends (not every frame). Returns true if a new high score was saved.
 * @param {Arcade.G} g
 * @param {Score} sc
 */
export function commit(g, sc) {
  // An older runtime has no g.score; the save still works there.
  if (typeof g.score === "function") g.score(Math.max(0, Math.min(999_999_999, Math.floor(sc.score))));
  const saved = loadField(g, sc.key, 0);
  if (typeof saved === "number" && sc.score <= saved) return false;
  saveField(g, sc.key, sc.score);
  return true;
}
