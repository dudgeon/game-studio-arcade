// Runs in a child Node process with the permission model on (see coverage.js).
// Imports a cart's checks.js and prints what its default export holds.
const path = process.argv[2];
try {
  const mod = await import(new URL(`file://${path}`).href);
  const checks = mod.default;
  if (checks === null || typeof checks !== 'object' || Array.isArray(checks)) {
    out({ error: 'checks.js must have a default export that is an object keyed by rule id, like `export default { R1: async (t) => { … } }`.' });
  } else {
    const keys = Object.keys(checks);
    out({ keys, nonFunctions: keys.filter((k) => typeof checks[k] !== 'function') });
  }
} catch (/** @type {any} */ e) {
  const denied = e && e.code === 'ERR_ACCESS_DENIED';
  out({ error: denied
    ? 'checks.js tried to read files or start processes. Checks must be self-contained and use only the test handle `t`.'
    : `checks.js failed to load: ${e && e.message ? e.message : String(e)}` });
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj));
}
