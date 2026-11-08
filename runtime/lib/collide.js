// @ts-check
// Collision: box overlap, plus "who destroys whom" between kinds of things.

/** A box: top-left x, y and size w, h in pixels. Any object with these fields works. */
/** @typedef {{ x: number, y: number, w: number, h: number }} Box */

/** Something in play: a box with a kind ("bullet", "enemy"...). `dead` is set by `resolve`. */
/** @typedef {Box & { kind: string, dead?: boolean }} Thing */

/**
 * One destroy rule: when a thing of kind `a` overlaps a thing of kind `b`,
 * `kill` says which is destroyed ("a", "b", "both" or "none": just report the hit).
 * @typedef {{ a: string, b: string, kill: "a" | "b" | "both" | "none" }} Rule
 */

/** @typedef {{ a: Thing, b: Thing, rule: Rule }} Hit */

/**
 * Do two boxes overlap? Touching edges don't count.
 * @param {Box} a
 * @param {Box} b
 */
export function overlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Is the point (px, py) inside the box?
 * @param {Box} box
 * @param {number} px
 * @param {number} py
 */
export function contains(box, px, py) {
  return px >= box.x && px < box.x + box.w && py >= box.y && py < box.y + box.h;
}

/**
 * Every overlapping pair [a, b] with a from `as` and b from `bs`. Skips dead
 * things and a thing paired with itself, so `hits(list, list)` is safe
 * (each pair then appears twice, once each way).
 * @template {Box & { dead?: boolean }} A
 * @template {Box & { dead?: boolean }} B
 * @param {readonly A[]} as
 * @param {readonly B[]} bs
 * @returns {[A, B][]}
 */
export function hits(as, bs) {
  /** @type {[A, B][]} */
  const out = [];
  for (const a of as) {
    if (a.dead) continue;
    for (const b of bs) {
      if (b.dead || /** @type {unknown} */ (a) === b) continue;
      if (overlap(a, b)) out.push([a, b]);
    }
  }
  return out;
}

/**
 * Apply destroy rules to a list of things: for each rule in order, every live
 * `a`-kind thing that overlaps a live `b`-kind thing is a hit, and the rule's
 * `kill` sets `dead = true` on a, b or both. A thing killed earlier in the
 * call takes no further part. Returns the hits in order (for score and
 * sound); remove the dead afterwards with `alive`.
 * @param {Thing[]} things
 * @param {readonly Rule[]} rules
 * @returns {Hit[]}
 */
export function resolve(things, rules) {
  /** @type {Hit[]} */
  const out = [];
  for (const rule of rules) {
    for (const a of things) {
      if (a.kind !== rule.a) continue;
      for (const b of things) {
        if (a.dead) break;
        if (b === a || b.dead || b.kind !== rule.b || !overlap(a, b)) continue;
        out.push({ a, b, rule });
        if (rule.kill === "a" || rule.kill === "both") a.dead = true;
        if (rule.kill === "b" || rule.kill === "both") b.dead = true;
      }
    }
  }
  return out;
}

/**
 * The things that aren't dead, as a new array.
 * @template {object} T
 * @param {readonly T[]} things
 * @returns {T[]}
 */
export function alive(things) {
  return things.filter((t) => !(/** @type {{ dead?: boolean }} */ (t)).dead);
}
