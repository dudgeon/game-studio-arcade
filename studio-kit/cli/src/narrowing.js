// Did a change to a rule's check make it test less? (D49) Comparing two versions
// of a check can't prove this; these signals catch the common ways it happens and
// send the rest to the person reading the log. A false alarm costs a kid one extra
// question, so they lean towards asking.

/** Checks throw to fail, directly or through a small helper such as expect(). */
const ASSERTION = /\b(?:expect|assert\w*|ok|must|fail|check)\s*\(|\bthrow\b/g;

export function countAssertions(code) {
  return (code.match(ASSERTION) ?? []).length;
}

/** Every number in a literal list of two or more, such as [100, 700, 1300]. */
export function listedNumbers(code) {
  const out = new Set();
  for (const m of code.matchAll(/\[\s*(-?\d+(?:\.\d+)?(?:\s*,\s*-?\d+(?:\.\d+)?)+)\s*,?\s*\]/g)) {
    for (const n of m[1].split(",")) out.add(Number(n));
  }
  return out;
}

/**
 * @param {string} before the rule's check in the frozen snapshot
 * @param {string} after the rule's check in the final cart
 * @returns {{narrowed: boolean, dropped_points: number[], assertions: [number, number], any_seed: boolean}}
 */
export function narrowingSignals(before, after) {
  const was = listedNumbers(before);
  const now = listedNumbers(after);
  const dropped = [...was].filter((n) => !now.has(n));
  const a = countAssertions(before);
  const b = countAssertions(after);
  // Passing on any one of several seeds isn't losing words, so it's noted, not counted.
  const anySeed = !/seed/i.test(before) && /seed/i.test(after);
  return { narrowed: dropped.length > 0 || b < a, dropped_points: dropped, assertions: [a, b], any_seed: anySeed };
}
