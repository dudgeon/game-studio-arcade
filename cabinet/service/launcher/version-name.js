// @ts-check
// What a version is called on the cabinet's screens (D474). A version has a
// number, its order, and since D471 a name its maker picked: "Faster logs". The
// name is what shows; the number shows small beside it where a list needs the
// order. A version with no name (every one made before names, and any first
// version) shows by its number, as it always did. Pure, so tests and the
// contact sheet use the same words.

/** What the name question's D tile says: Claude chooses (D471). */
export const YOU_PICK = "You pick";

/** The shelf row's tag (S1): the name, or "v3"; nothing on a first version. @param {{ version?: number | null, version_name?: string | null }} c */
export function shelfTag(c) {
  if (c.version_name) return c.version_name;
  return (c.version ?? 1) > 1 ? `v${c.version}` : null;
}

/** A version in a sentence: "Faster logs", or "Version 3". @param {number | null | undefined} version @param {string | null | undefined} [name] */
export function versionWords(version, name) {
  return name || `Version ${version ?? 1}`;
}

/**
 * A row in "See other versions" (S3): "Faster logs (newest)" with "v3 Nov 14" beside it; "Version 2" with the day.
 * @param {{ version?: number | null, version_name?: string | null }} c @param {boolean} newest @param {string} day
 */
export function versionRow(c, newest, day) {
  const text = `${versionWords(c.version, c.version_name)}${newest ? " (newest)" : ""}`;
  return { text, note: c.version_name ? [`v${c.version ?? 1}`, day].filter(Boolean).join(" ") : day };
}

/** R7's header: "Making Faster logs" once the name is picked. @param {string | null | undefined} name */
export function makingTitle(name) {
  return name ? `Making ${name}` : "Changing your game";
}

/**
 * R8's title and its "still saved" line.
 * @param {{ version: number, version_name?: string | null, parent?: { version?: number | null, version_name?: string | null, maker_name?: string | null } | null }} r
 */
export function readyWords(r) {
  if (!(r.version > 1)) return { title: "Your own version is ready!", saved: r.parent?.maker_name ? `${r.parent.maker_name}'s game stays the same.` : "The old game stays the same." };
  return {
    title: `${versionWords(r.version, r.version_name)} is ready!`,
    saved: `${versionWords(r.parent?.version ?? r.version - 1, r.parent?.version_name)} is still saved.`,
  };
}
