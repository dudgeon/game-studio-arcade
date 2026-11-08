// cart.json: the machine record of a cart (HANDOFF §7, D31). The agent writes
// id, title and players; the CLI (and later the cabinet) adds the provenance
// fields when it files the cart. Present fields must have the right shape.

export const CART_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PARENT = /^[a-z0-9]+(?:-[a-z0-9]+)*@[1-9][0-9]*$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

const nullableString = (v) => v === null || (typeof v === 'string' && v.trim() !== '');

/** Field -> [test, what it should be]. */
const FIELDS = {
  id: [(v) => typeof v === 'string' && v.length <= 40 && CART_ID.test(v), 'lowercase letters, digits and single dashes, at most 40 characters, e.g. "sloth-snacks"'],
  title: [(v) => typeof v === 'string' && v.trim() !== '' && v.length <= 60, 'a non-empty string of at most 60 characters'],
  players: [(v) => v === 1 || v === 2, '1 or 2'],
  version: [(v) => Number.isInteger(v) && v >= 1, 'a whole number, 1 or more'],
  maker: [nullableString, 'a string such as "O", or null'],
  with: [nullableString, 'a string such as "A", or null'],
  parent: [(v) => v === null || (typeof v === 'string' && PARENT.test(v)), '"cart-id@version" or null'],
  session_id: [nullableString, 'a session id string, or null'],
  origin: [(v) => v === 'cabinet' || v === 'desktop', '"cabinet" or "desktop"'],
  created: [(v) => typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(v)), 'an ISO 8601 time such as "2026-11-07T21:00:00Z"'],
};
export const REQUIRED_CART_FIELDS = ['id', 'title', 'players'];

/**
 * Check a cart.json's text.
 * @param {string | null} text  null when the file is missing
 * @param {{ specTitle?: string | null }} [opts]
 * @returns {{ errors: import('../index.js').Issue[], warnings: import('../index.js').Issue[], value: any }}
 */
export function checkCartJson(text, { specTitle = null } = {}) {
  /** @type {import('../index.js').Issue[]} */
  const errors = [];
  /** @type {import('../index.js').Issue[]} */
  const warnings = [];
  const issue = (message) => ({ file: 'cart.json', line: null, check: /** @type {const} */ ('cart.json'), message });
  if (text === null) {
    errors.push(issue('The cart has no cart.json. Write one with at least {"id": "...", "title": "...", "players": 1}.'));
    return { errors, warnings, value: null };
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (e) {
    errors.push(issue(`cart.json isn't valid JSON: ${/** @type {Error} */ (e).message}`));
    return { errors, warnings, value: null };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(issue('cart.json must be a JSON object.'));
    return { errors, warnings, value: null };
  }
  for (const k of REQUIRED_CART_FIELDS) {
    if (!(k in value)) errors.push(issue(`cart.json needs "${k}": ${FIELDS[k][1]}.`));
  }
  for (const [k, v] of Object.entries(value)) {
    const f = FIELDS[k];
    if (!f) warnings.push(issue(`cart.json has an unknown field "${k}". Known fields: ${Object.keys(FIELDS).join(', ')}.`));
    else if (!f[0](v)) errors.push(issue(`cart.json "${k}" is ${JSON.stringify(v)}; it should be ${f[1]}.`));
  }
  if (specTitle && typeof value.title === 'string' && value.title.trim() !== specTitle.trim()) {
    warnings.push(issue(`cart.json title "${value.title}" differs from spec.md's title "${specTitle}".`));
  }
  return { errors, warnings, value };
}
