// Comparing two cabinets' data, and the plan that brings one in line with the other (D293).
// Pure: manifests in, a plan out. The mini runs it; helper.mjs carries it out on the cabinet.
import { GROWS } from "./helper.mjs";

/**
 * @typedef {Record<string, { size: number, hash: string, mode: string }>} Files
 * @typedef {{
 *   same: string[],
 *   missing: string[],
 *   grown: { rel: string, from: number }[],
 *   changed: { rel: string, untouched: boolean }[],
 *   extra: { rel: string, reason: string }[],
 * }} Drift
 */

/**
 * How the target differs from the source.
 * @param {Files} source the truth: the real cabinet, or the twin for the one-time seed
 * @param {Files} target the copy
 * @param {Record<string, string> | null} baseline rel to hash, as the last sync left the target; null if none
 * @returns {Drift}
 */
export function drift(source, target, baseline) {
  /** @type {Drift} */
  const d = { same: [], missing: [], grown: [], changed: [], extra: [] };
  for (const [rel, s] of Object.entries(source)) {
    const t = target[rel];
    if (!t) d.missing.push(rel);
    else if (t.hash === s.hash) d.same.push(rel);
    else if (GROWS(rel) && t.size < s.size) d.grown.push({ rel, from: t.size });
    else d.changed.push({ rel, untouched: Boolean(baseline && baseline[rel] === t.hash) });
  }
  for (const rel of Object.keys(target)) {
    if (source[rel]) continue;
    d.extra.push({ rel, reason: baseline && rel in baseline ? "gone from the real cabinet" : "made on the twin" });
  }
  return d;
}

/** True if nothing needs doing. @param {Drift} d */
export const inSync = (d) => !d.missing.length && !d.grown.length && !d.changed.length && !d.extra.length;

/** The carts each side has that the other lacks, by folder: what a person reads first. @param {Files} source @param {Files} target */
export function shelfDrift(source, target) {
  const carts = (/** @type {Files} */ f) => new Set(Object.keys(f).filter((r) => /^carts\/[^/.][^/]*\/cart\.json$/.test(r)).map((r) => r.split("/")[1]));
  const s = carts(source);
  const t = carts(target);
  return { onlySource: [...s].filter((x) => !t.has(x)).sort(), onlyTarget: [...t].filter((x) => !s.has(x)).sort() };
}

/**
 * Turns a drift, and what was read from the source, into helper.mjs's apply input.
 * A grown log whose old part doesn't match is a changed file after all.
 * Nothing the target changed itself is overwritten: it's set aside first (D294).
 * @param {Drift} d
 * @param {Files} source
 * @param {Files} target
 * @param {Record<string, { from: number, b64: string, hash: string, prefix: string | null }>} got
 */
export function applyInput(d, source, target, got) {
  /** @type {{ rel: string, expect: string | null, reason: string }[]} */
  const setAside = [];
  /** @type {{ rel: string, expect: string | null, b64: string, mode?: string }[]} */
  const write = [];
  /** @type {{ rel: string, expect: string | null, b64: string }[]} */
  const append = [];
  const whole = (/** @type {string} */ rel) => {
    const g = got[rel];
    if (!g || g.from !== 0) throw new Error(`${rel} wasn't read whole`);
    return g.b64;
  };
  for (const rel of d.missing) write.push({ rel, expect: null, b64: whole(rel), mode: source[rel].mode });
  for (const { rel, from } of d.grown) {
    const g = got[rel];
    if (g && g.prefix === target[rel].hash) append.push({ rel, expect: target[rel].hash, b64: g.b64 });
    else throw new Error(`${rel}: the target's copy isn't the start of the source's; read it whole`);
    void from;
  }
  for (const { rel, untouched } of d.changed) {
    if (!untouched) setAside.push({ rel, expect: target[rel].hash, reason: "changed on the twin" });
    write.push({ rel, expect: target[rel].hash, b64: whole(rel), mode: source[rel].mode });
  }
  for (const { rel, reason } of d.extra) setAside.push({ rel, expect: target[rel].hash, reason });
  return { setAside, write, append };
}
