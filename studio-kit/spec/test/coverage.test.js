import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { copyFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkCoverage, readCheckIds, validateRuleCoverage } from '../index.js';

const fx = (p) => fileURLToPath(new URL(`./fixtures/${p}`, import.meta.url));
const SPEC = fx('sloth-snacks/spec.md');

// Build a throwaway cart from the sloth spec plus a fixture's checks.js (or none).
function cart(checksFixture) {
  const dir = mkdtempSync(join(tmpdir(), 'gsa-spec-'));
  copyFileSync(SPEC, join(dir, 'spec.md'));
  if (checksFixture) copyFileSync(fx(`${checksFixture}/checks.js`), join(dir, 'checks.js'));
  return dir;
}

test('checkCoverage: every auto rule needs a check', () => {
  const rules = [{ id: 'R1', kind: 'auto' }, { id: 'R2', kind: 'auto' }, { id: 'R3', kind: 'you-check' }];
  const { errors } = checkCoverage(rules, ['R1']);
  assert.deepEqual(errors.map((e) => e.rule), ['R2']);
  assert.match(errors[0].message, /auto rule with no check/);
});

test('checkCoverage: checks with no rule, or on a you-check rule, are errors', () => {
  const rules = [{ id: 'R1', kind: 'auto' }, { id: 'R3', kind: 'you-check' }];
  const { errors } = checkCoverage(rules, ['R1', 'R3', 'R8']);
  assert.deepEqual(errors.map((e) => e.rule).sort(), ['R3', 'R8']);
});

test('checkCoverage: full coverage is clean', () => {
  assert.deepEqual(checkCoverage([{ id: 'R1', kind: 'auto' }], ['R1']).errors, []);
});

test('validateRuleCoverage: a complete cart passes', async () => {
  const r = await validateRuleCoverage(fx('sloth-snacks'));
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
  assert.deepEqual(r.checks, ['R1', 'R2', 'R3', 'R5']);
  assert.equal(r.rules.length, 5);
});

test('validateRuleCoverage: drifted checks are all flagged', async () => {
  const r = await validateRuleCoverage(cart('drifted'));
  assert.equal(r.ok, false);
  const byRule = Object.fromEntries(r.errors.map((e) => [e.rule, e.message]));
  assert.match(byRule.R3, /auto rule with no check/);
  assert.match(byRule.R5, /must be a function/);
  assert.match(byRule.R6, /"you check" rule/);
  assert.match(byRule.R9, /no rule R9/);
});

test('validateRuleCoverage: no checks.js with auto rules is an error', async () => {
  const r = await validateRuleCoverage(cart(null));
  assert.equal(r.ok, false);
  assert.match(r.errors[0].message, /no checks\.js.*R1, R2, R3, R5/);
});

test('validateRuleCoverage: no spec.md is an error', async () => {
  const r = await validateRuleCoverage(mkdtempSync(join(tmpdir(), 'gsa-spec-')));
  assert.equal(r.ok, false);
  assert.match(r.errors[0].message, /no spec\.md/);
});

test('validateRuleCoverage: spec parse errors are reported with the file', async () => {
  const dir = cart('sloth-snacks');
  writeFileSync(join(dir, 'spec.md'), '# X\n\nmaker: A · with: — · parent: — · session: —\n\n## Rules\n\n- R1: x\n');
  const r = await validateRuleCoverage(dir);
  assert.equal(r.ok, false);
  assert.ok(r.errors.every((e) => e.file === 'spec.md' || e.file === 'checks.js'));
  assert.ok(r.errors.some((e) => /needs its kind/.test(e.message)));
});

test('readCheckIds: imports are rejected before anything runs', async () => {
  const r = await readCheckIds(fx('imports/checks.js'));
  assert.match(r.error ?? "", /must not import/);
});

test('readCheckIds: require() is rejected', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gsa-spec-'));
  writeFileSync(join(dir, 'checks.js'), "const fs = require('fs');\nexport default {};\n");
  assert.match((await readCheckIds(join(dir, 'checks.js'))).error ?? "", /require/);
});

test('readCheckIds: no default export is rejected', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gsa-spec-'));
  writeFileSync(join(dir, 'checks.js'), 'export const R1 = async () => {};\n');
  assert.match((await readCheckIds(join(dir, 'checks.js'))).error ?? "", /export default/);
  writeFileSync(join(dir, 'checks.js'), 'export default [1, 2];\n');
  assert.match((await readCheckIds(join(dir, 'checks.js'))).error ?? "", /object keyed by rule id/);
});

test('readCheckIds: reading files outside the cart is blocked by the permission model', async () => {
  const r = await readCheckIds(fx('reads-files/checks.js'));
  assert.match(r.error ?? "", /self-contained/);
});

test('readCheckIds: the child gets a clean environment', async () => {
  process.env.GSA_SPEC_TEST_SECRET = 'leak';
  const dir = mkdtempSync(join(tmpdir(), 'gsa-spec-'));
  writeFileSync(join(dir, 'checks.js'), 'export default { [process.env.GSA_SPEC_TEST_SECRET ?? "clean"]: async () => {} };\n');
  const r = await readCheckIds(join(dir, 'checks.js'));
  delete process.env.GSA_SPEC_TEST_SECRET;
  assert.deepEqual(r.keys, ['clean']);
});

test('readCheckIds: a syntax error is reported', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gsa-spec-'));
  mkdirSync(join(dir, 'x'));
  writeFileSync(join(dir, 'x', 'checks.js'), 'export default { R1: async (t) => { };\n');
  assert.match((await readCheckIds(join(dir, 'x', 'checks.js'))).error ?? "", /failed to load/);
});

test('readCheckIds: top-level code that hangs times out', async () => {
  const r = await readCheckIds(fx('hangs/checks.js'), { timeoutMs: 500 });
  assert.match(r.error ?? "", /longer than 0.5s/);
});
