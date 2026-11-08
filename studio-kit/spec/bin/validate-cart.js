#!/usr/bin/env node
// validate-cart <cart-dir> [--json] [--no-types]
//
// validate_cart (D31): cart.json, rule coverage, the D13 lint and tsc under the
// cart rules. Prints one line per problem (or the full report with --json).
// Exit 0 if the cart is valid, 1 if not, 2 on bad usage.
import { validateCart, formatIssues } from '../index.js';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const dirs = args.filter((a) => !a.startsWith('--'));
if (dirs.length !== 1 || [...flags].some((f) => f !== '--json' && f !== '--no-types')) {
  console.error('usage: validate-cart <cart-dir> [--json] [--no-types]');
  process.exit(2);
}
const report = await validateCart(dirs[0], { types: !flags.has('--no-types') });
if (flags.has('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const line of formatIssues(report)) console.log(line);
  const autos = report.rules.filter((r) => r.kind === 'auto').length;
  const skipped = report.skipped?.types ? `; types skipped (${report.skipped.types})` : '';
  console.log(report.ok
    ? `ok  ${report.rules.length} rules (${autos} auto), ${report.checks.length} checks${skipped}`
    : `not valid  ${report.errors.length} error(s)`);
}
process.exit(report.ok ? 0 : 1);
