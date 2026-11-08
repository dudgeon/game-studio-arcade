// validate_cart (D6, D13, D30, D31): everything about a cart that can be
// checked without running it. The playtest harness runs it.
//
//   1. cart.json shape
//   2. rule coverage: spec.md's auto rules against checks.js (D30)
//   3. the D13 lint over game.js and checks.js
//   4. tsc over game.js and checks.js under runtime/tsconfig.cart.json
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkCartJson } from './cart-json.js';
import { validateRuleCoverage } from './coverage.js';
import { lintCartSource } from './lint.js';
import { typeCheckCart } from './types.js';

const readOrNull = (p) => readFile(p, 'utf8').catch(() => null);

/**
 * @param {string} cartDir
 * @param {import('../index.js').ValidateOptions} [opts]
 * @returns {Promise<import('../index.js').ValidateReport>}
 */
export async function validateCart(cartDir, opts = {}) {
  /** @type {import('../index.js').Issue[]} */
  const errors = [];
  /** @type {import('../index.js').Issue[]} */
  const warnings = [];

  // Rule coverage first: it parses the spec, and its issues are the most actionable.
  const coverage = await validateRuleCoverage(cartDir);
  for (const e of coverage.errors) errors.push({ check: 'coverage', ...e });
  for (const w of coverage.warnings) warnings.push({ check: 'coverage', ...w });
  const specText = await readOrNull(join(cartDir, 'spec.md'));
  const specTitle = specText?.match(/^#\s+(.+)$/m)?.[1].trim() ?? null;

  const cj = checkCartJson(await readOrNull(join(cartDir, 'cart.json')), { specTitle });
  errors.push(...cj.errors);
  warnings.push(...cj.warnings);

  const game = await readOrNull(join(cartDir, 'game.js'));
  const checks = await readOrNull(join(cartDir, 'checks.js'));
  if (game === null) errors.push({ file: 'game.js', line: null, check: 'lint', message: 'The cart has no game.js.' });
  else errors.push(...lintCartSource(game, { file: 'game.js' }));
  // checks.js imports are already reported by rule coverage.
  if (checks !== null) errors.push(...lintCartSource(checks, { file: 'checks.js', imports: false }));

  const files = [game !== null && 'game.js', checks !== null && 'checks.js'].filter((f) => typeof f === 'string');
  let typesSkipped;
  if (opts.types === false) typesSkipped = 'turned off';
  else if (files.length) {
    const t = await typeCheckCart(cartDir, { files, runtimeDir: opts.runtimeDir, tsc: opts.tsc, timeoutMs: opts.tscTimeoutMs });
    errors.push(...t.errors);
    typesSkipped = t.skipped;
  }
  const order = { coverage: 0, 'cart.json': 1, lint: 2, types: 3 };
  const byCheck = (a, b) => (order[a.check ?? 'coverage'] - order[b.check ?? 'coverage']);
  errors.sort(byCheck);
  warnings.sort(byCheck);
  return {
    ok: errors.length === 0,
    cart: cj.value,
    rules: coverage.rules,
    checks: coverage.checks,
    errors,
    warnings,
    ...(typesSkipped ? { skipped: { types: typesSkipped } } : {}),
  };
}

/** One line per issue, for people and agents: `error  game.js:12  [lint] …`. */
export function formatIssues(report) {
  const fmt = (level) => (i) => `${level}  ${i.file ?? '-'}${i.line ? `:${i.line}` : ''}  [${i.check ?? 'coverage'}]${i.rule ? ` ${i.rule}:` : ''} ${i.message}`;
  return [...report.errors.map(fmt('error')), ...report.warnings.map(fmt('warn '))];
}
