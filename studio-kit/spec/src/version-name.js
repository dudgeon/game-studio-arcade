// A version's name (D471-D474): a short label on a version's number, picked by
// the maker when a change's plan is agreed. The number stays as the order; the
// name is what people see. Plain ESM with no dependencies: the sandbox's
// validator, the CLI, the cabinet service and the desktop plugin share it.

/** As long as a maker's name (D87): it fits a shelf tag and a result title. */
export const VERSION_NAME_MAX = 16;

/**
 * A name as it's kept: plain ASCII (the cabinet's font), single spaces, no
 * quotes (the spec's Changelog quotes it), no full stop that speech-to-text
 * added, first letter a capital. Null when nothing is left, or when it's longer
 * than 16 characters and `cut` isn't set. With `cut`, a long name ends at its
 * last whole word that fits.
 * @param {unknown} raw
 * @param {{ cut?: boolean }} [o]
 * @returns {string | null}
 */
export function cleanVersionName(raw, o = {}) {
  if (typeof raw !== 'string') return null;
  let s = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\x20-\x7e]+/g, ' ')
    .replace(/["\\`<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:]+$/, '')
    .trim();
  if (!s) return null;
  if (s.length > VERSION_NAME_MAX) {
    if (!o.cut) return null;
    const head = s.slice(0, VERSION_NAME_MAX + 1);
    const at = head.lastIndexOf(' ');
    s = (at >= 3 ? head.slice(0, at) : s.slice(0, VERSION_NAME_MAX)).replace(/[\s.,;:'-]+$/, '');
    if (!s) return null;
  }
  return s[0].toUpperCase() + s.slice(1);
}

/** The same name, whatever its capitals. @param {unknown} a @param {unknown} b */
export function sameVersionName(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Is this name already another version's? @param {string} name @param {readonly unknown[]} taken */
export function versionNameTaken(name, taken) {
  return taken.some((t) => sameVersionName(t, name));
}

/** A cart.json `version_name` as written: a name cleanVersionName would leave alone. @param {unknown} v */
export function isVersionName(v) {
  return typeof v === 'string' && cleanVersionName(v) === v;
}

/**
 * What a version is called, with its number where a list needs the order:
 * "Faster logs (v3)", or "v3" for one with no name (every version made before
 * names, and any first version).
 * @param {{ version?: number | null, version_name?: string | null }} c
 */
export function versionLabel(c) {
  const v = `v${c.version ?? 1}`;
  return c.version_name ? `${c.version_name} (${v})` : v;
}

/**
 * Put a version's name on its Changelog line: `- v3 "Faster logs": ...`. The
 * spec is the source of truth, so the name is there even if the agent left it
 * out. Returns the text unchanged when the line isn't there or already has a name.
 * @param {string} specText @param {number} version @param {string} name
 */
export function nameChangelogLine(specText, version, name) {
  const lines = specText.split('\n');
  const at = lines.findIndex((l) => /^## Changelog\s*$/.test(l));
  if (at < 0) return specText;
  const re = new RegExp(`^- v${version}: `);
  for (let i = at + 1; i < lines.length && !lines[i].startsWith('## '); i++) {
    if (/^- v\d+(?:\.\d+)? "/.test(lines[i]) && new RegExp(`^- v${version} "`).test(lines[i])) return specText;
    if (re.test(lines[i])) {
      lines[i] = lines[i].replace(re, `- v${version} "${name}": `);
      return lines.join('\n');
    }
  }
  return specText;
}
