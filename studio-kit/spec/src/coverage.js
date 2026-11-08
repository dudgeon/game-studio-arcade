// Rule coverage: the part of validate_cart that ties spec.md's auto rules to
// checks.js (D11, D30).
import { execFile } from 'node:child_process';
import { readFile, access, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSpec } from './parse.js';

const CHILD = fileURLToPath(new URL('./load-checks-child.js', import.meta.url));

/**
 * Compare a spec's rules with the ids exported by checks.js.
 * @param {{id: string, kind: string, line?: number}[]} rules
 * @param {string[]} checkIds
 * @returns {{errors: import('../index.js').Issue[], warnings: import('../index.js').Issue[]}}
 */
export function checkCoverage(rules, checkIds) {
  /** @type {import("../index.js").Issue[]} */
  const errors = [];
  const byId = new Map(rules.map((r) => [r.id, r]));
  const have = new Set(checkIds);
  for (const r of rules) {
    if (r.kind === 'auto' && !have.has(r.id)) {
      errors.push({ file: 'spec.md', line: r.line ?? null, rule: r.id, message: `${r.id} is an auto rule with no check. Add "${r.id}" to checks.js, or make it a "you check" rule if the playtest can't prove it.` });
    }
  }
  for (const id of checkIds) {
    const r = byId.get(id);
    if (!r) {
      errors.push({ file: 'checks.js', line: null, rule: id, message: `checks.js has a check "${id}" but spec.md has no rule ${id}. The spec and checks have drifted: add the rule to the spec or remove the check.` });
    } else if (r.kind !== 'auto') {
      errors.push({ file: 'checks.js', line: null, rule: id, message: `checks.js has a check for ${id}, which is a "you check" rule. Either the playtest can prove it (make it auto) or a person checks it (remove the check).` });
    }
  }
  return { errors, warnings: [] };
}

/**
 * Read the check ids from a checks.js without trusting it: it is imported in a
 * child Node process that can read only the cart folder and can't start
 * processes or workers, with a clean environment and a timeout.
 * @param {string} checksPath
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<import('../index.js').CheckIds>}
 */
export async function readCheckIds(checksPath, { timeoutMs = 5000 } = {}) {
  const file = await realpath(resolve(checksPath));
  const source = await readFile(file, 'utf8');
  const lint = lintSource(source);
  if (lint) return { error: lint };

  const major = Number(process.versions.node.split('.')[0]);
  const permFlag = major >= 23 ? '--permission' : '--experimental-permission';
  const args = [
    permFlag,
    `--allow-fs-read=${dirname(file)}/`,
    `--allow-fs-read=${await realpath(CHILD)}`,
    '--disable-warning=ExperimentalWarning',
    CHILD,
    file,
  ];
  return new Promise((done) => {
    execFile(process.execPath, args, { env: {}, timeout: timeoutMs, maxBuffer: 1 << 20 }, (e, stdout) => {
      if (e && e.killed) return done({ error: `checks.js took longer than ${timeoutMs / 1000}s to load. Top-level code must only define the checks.` });
      try {
        done(JSON.parse(stdout));
      } catch {
        done({ error: `checks.js could not be read${e ? `: ${e.message.split('\n')[0]}` : ''}.` });
      }
    });
  });
}

// Checks must be self-contained (D30). Catch the common cases before running.
function lintSource(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  if (/^\s*import[\s{*'"]/m.test(code) || /\bimport\s*\(/.test(code)) return 'checks.js must not import anything. Everything a check needs comes through the test handle `t`.';
  if (/\brequire\s*\(/.test(code)) return 'checks.js must not use require(). Everything a check needs comes through the test handle `t`.';
  if (!/\bexport\s+default\b/.test(code)) return 'checks.js needs `export default { R1: async (t) => { … }, … }`.';
  return null;
}

/**
 * The rule-coverage part of validate_cart for one cart folder.
 * @param {string} cartDir
 * @returns {Promise<import('../index.js').CoverageReport>}
 */
export async function validateRuleCoverage(cartDir) {
  /** @type {import("../index.js").Issue[]} */
  const errors = [];
  /** @type {import("../index.js").Issue[]} */
  const warnings = [];
  const specPath = join(cartDir, 'spec.md');
  const checksPath = join(cartDir, 'checks.js');

  let spec;
  try {
    spec = parseSpec(await readFile(specPath, 'utf8'));
  } catch {
    return { ok: false, rules: [], checks: [], errors: [{ file: 'spec.md', line: null, message: 'The cart has no spec.md.' }], warnings };
  }
  for (const e of spec.errors) errors.push({ file: 'spec.md', ...e });
  for (const w of spec.warnings) warnings.push({ file: 'spec.md', ...w });

  const autos = spec.rules.filter((r) => r.kind === 'auto');
  let checks = [];
  const exists = await access(checksPath).then(() => true, () => false);
  if (!exists) {
    if (autos.length) errors.push({ file: 'checks.js', line: null, message: `The cart has no checks.js, but spec.md has ${autos.length} auto rule(s): ${autos.map((r) => r.id).join(', ')}.` });
  } else {
    const read = await readCheckIds(checksPath);
    if (read.error !== undefined) {
      errors.push({ file: 'checks.js', line: null, message: read.error });
    } else {
      checks = read.keys;
      for (const k of read.nonFunctions) errors.push({ file: 'checks.js', line: null, rule: k, message: `Check "${k}" must be a function: \`${k}: async (t) => { … }\`.` });
      const cov = checkCoverage(spec.rules, checks);
      errors.push(...cov.errors);
      warnings.push(...cov.warnings);
    }
  }
  return {
    ok: errors.length === 0,
    rules: spec.rules.map(({ id, kind, text }) => ({ id, kind, text })),
    checks,
    errors,
    warnings,
  };
}
