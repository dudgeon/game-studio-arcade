#!/usr/bin/env node
// gsa-spec rules <spec.md>      print the rules as JSON
// gsa-spec check <spec.md>      parse; print errors and warnings
// gsa-spec format <spec.md>     print the canonical form
// gsa-spec coverage <cart-dir>  rule coverage (part of validate_cart); JSON report
import { readFile } from 'node:fs/promises';
import { parseSpec, formatSpec, validateRuleCoverage } from '../index.js';

const [cmd, target] = process.argv.slice(2);
const usage = 'usage: gsa-spec rules|check|format <spec.md>  |  gsa-spec coverage <cart-dir>';
if (!cmd || !target) { console.error(usage); process.exit(2); }

if (cmd === 'coverage') {
  const report = await validateRuleCoverage(target);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}
const spec = parseSpec(await readFile(target, 'utf8'));
if (cmd === 'rules') {
  console.log(JSON.stringify(spec.rules.map(({ id, kind, text }) => ({ id, kind, text })), null, 2));
} else if (cmd === 'format') {
  process.stdout.write(formatSpec(spec));
} else if (cmd === 'check') {
  for (const e of spec.errors) console.log(`error  ${target}:${e.line ?? '-'}  ${e.message}`);
  for (const w of spec.warnings) console.log(`warn   ${target}:${w.line ?? '-'}  ${w.message}`);
  if (!spec.errors.length) console.log(`ok  ${spec.rules.length} rules (${spec.rules.filter((r) => r.kind === 'auto').length} auto)`);
} else { console.error(usage); process.exit(2); }
process.exit(spec.errors.length ? 1 : 0);
