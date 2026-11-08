import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateCart, lintCartSource, checkCartJson, annotate, formatIssues } from '../index.js';

const VALID = fileURLToPath(new URL('./fixtures/valid-cart/', import.meta.url));
const BIN = fileURLToPath(new URL('../bin/validate-cart.js', import.meta.url));

/** A copy of the valid cart with some files changed. */
function variant(changes) {
  const dir = mkdtempSync(join(tmpdir(), 'gsa-validate-test-'));
  cpSync(VALID, dir, { recursive: true });
  for (const [file, edit] of Object.entries(changes)) {
    if (edit === null) rmSync(join(dir, file));
    else writeFileSync(join(dir, file), typeof edit === 'function' ? edit(readFileSync(join(dir, file), 'utf8')) : edit);
  }
  return dir;
}
const of = (report, check) => report.errors.filter((e) => e.check === check);
const lint = (src) => lintCartSource(src, { file: 'game.js' }).map((i) => i.message);

test('validateCart: the valid fixture passes all four checks', async () => {
  const r = await validateCart(VALID);
  assert.deepEqual(formatIssues(r), []);
  assert.equal(r.ok, true);
  assert.equal(r.cart.id, 'sloth-snacks');
  assert.deepEqual(r.checks, ['R1', 'R2', 'R3', 'R5']);
  assert.equal(r.skipped, undefined);
});

test('validateCart: rule coverage errors come through', async () => {
  const r = await validateCart(variant({ 'checks.js': (s) => s.replace(/^\s*R5:.*$/m, '') }), { types: false });
  assert.equal(r.ok, false);
  assert.deepEqual(of(r, 'coverage').map((e) => e.rule), ['R5']);
});

test('validateCart: a missing or malformed cart.json fails', async () => {
  const missing = await validateCart(variant({ 'cart.json': null }), { types: false });
  assert.match(of(missing, 'cart.json')[0].message, /no cart\.json/);
  const broken = await validateCart(variant({ 'cart.json': '{ "id": ' }), { types: false });
  assert.match(of(broken, 'cart.json')[0].message, /isn't valid JSON/);
  const bad = await validateCart(variant({ 'cart.json': '{"id":"Sloth Snacks","title":"Sloth Snacks","players":4,"origin":"phone"}' }), { types: false });
  assert.deepEqual(of(bad, 'cart.json').map((e) => e.message.match(/"(\w+)"/)?.[1]), ['id', 'players', 'origin']);
});

test('checkCartJson: the full record the CLI writes is valid; unknown fields and a title mismatch only warn', () => {
  const full = { id: 'frog-hop', title: 'Frog Hop', players: 1, version: 1, maker: 'A', with: null, parent: null, session_id: 'sesn_01', origin: 'cabinet', created: '2026-11-07T21:00:00.000Z' };
  assert.deepEqual(checkCartJson(JSON.stringify(full)).errors, []);
  const forked = checkCartJson(JSON.stringify({ ...full, parent: 'frog-hop@2', origin: 'desktop' }));
  assert.deepEqual(forked.errors, []);
  assert.equal(checkCartJson(JSON.stringify({ ...full, parent: 'frog-hop' })).errors.length, 1);
  assert.equal(checkCartJson(JSON.stringify({ ...full, created: 'yesterday' })).errors.length, 1);
  const w = checkCartJson(JSON.stringify({ ...full, colour: 'green' }), { specTitle: 'Toad Hop' });
  assert.deepEqual(w.errors, []);
  assert.equal(w.warnings.length, 2);
});

test('validateCart: the D13 lint catches DOM, network, eval, imports, timers, clock and Math.random', async () => {
  const bad = [
    'const t = document.title;',
    'fetch("/x");',
    'new WebSocket("ws://x");',
    'eval("1");',
    'new Function("return 1");',
    'setTimeout(() => {}, 10);',
    'const now = Date.now();',
    'const p = performance.now();',
    'const r = Math.random();',
    'const w = globalThis;',
    'const e = process.env;',
  ];
  const dir = variant({ 'game.js': (s) => `${s}\n${bad.join('\n')}\n` });
  const r = await validateCart(dir, { types: false });
  const lines = of(r, 'lint').map((e) => e.line);
  const first = readFileSync(join(VALID, 'game.js'), 'utf8').split('\n').length + 1;
  assert.deepEqual(lines, bad.map((_, k) => first + k));

  const imp = await validateCart(variant({ 'game.js': (s) => `import x from "./x.js";\n${s}` }), { types: false });
  assert.match(of(imp, 'lint')[0].message, /must import nothing/);
});

test('lint: words in strings, comments, templates, regexes and property names are fine', () => {
  assert.deepEqual(lint([
    '// document.title and fetch() in a comment',
    '/* Math.random() */',
    'const a = "document"; const b = \'fetch(x)\';',
    'const c = `setTimeout ${1 + 2} eval ${`nested ${"Date"}`}`;',
    'const d = /fetch|document/g.test(a);',
    'const e = { fetch: 1, document: 2, Date() { return 3; } };',
    'const f = s.document + s.window + e.fetch;',
    'const g2 = 10 / 2 / 5;',
  ].join('\n')), []);
});

test('lint: escape hatches are caught', () => {
  assert.equal(lint('// @ts-nocheck\nexport default {};').length, 1);
  assert.equal(lint('// @ts-ignore\nconst x = 1;').length, 1);
  assert.equal(lint('const f = [].constructor.constructor;').length, 1);
  assert.equal(lint('const f = x["constructor"];').length, 1);
  assert.equal(lint('const f = \\u0065val;').length, 1);
  assert.equal(lint('const r = Math["random"]();').length, 1);
  assert.equal(lint('export { a } from "./a.js";').length, 1);
  assert.equal(lint('const m = import.meta;').length, 1);
});

test('lint: checks.js imports are left to rule coverage, everything else still applies', () => {
  const issues = lintCartSource('import x from "y";\nconst r = Math.random();\nexport default {};', { file: 'checks.js', imports: false });
  assert.deepEqual(issues.map((i) => i.line), [2]);
});

test('validateCart: tsc under the cart rules catches bad buttons, a wrong cart shape, DOM and bad test-handle calls', async () => {
  const dir = variant({
    'game.js': (s) => s.replace('g.btn("left")', 'g.btn("jump")').replace('  draw(g, s) {', '  drow(g, s) {'),
    'checks.js': (s) => s.replace('await t.step(1); expect', 'await t.stepp(1); expect'),
  });
  const r = await validateCart(dir);
  const types = of(r, 'types');
  assert.ok(types.some((e) => e.file === 'game.js' && /"jump"/.test(e.message)), formatIssues(r).join('\n'));
  assert.ok(types.some((e) => e.file === 'game.js' && /drow/.test(e.message)), formatIssues(r).join('\n'));
  assert.ok(types.some((e) => e.file === 'checks.js' && /stepp/.test(e.message)), formatIssues(r).join('\n'));
  assert.ok(types.every((e) => typeof e.line === 'number'));
  // The cart folder is never written to.
  assert.ok(!readFileSync(join(dir, 'game.js'), 'utf8').includes('*/ export default'));
});

test('validateCart: tsc catches a DOM global that the lint list does not name', async () => {
  const r = await validateCart(variant({ 'game.js': (s) => `${s}\nconst el = parent.frames;\n` }));
  assert.deepEqual(of(r, 'lint'), []);
  assert.ok(of(r, 'types').some((e) => /parent/.test(e.message)), formatIssues(r).join('\n'));
});

test('validateCart: no tsc is an error, not a silent pass; types: false skips it', async () => {
  const none = await validateCart(VALID, { tsc: null });
  assert.equal(none.ok, false);
  assert.match(of(none, 'types')[0].message, /isn't available/);
  const off = await validateCart(VALID, { types: false });
  assert.equal(off.ok, true);
  assert.deepEqual(off.skipped, { types: 'turned off' });
});

test('annotate: adds the type on the same line, once', () => {
  const src = '// hi\nexport default {\n  init() { return {}; },\n};\n';
  const out = annotate(src, 'Arcade.Cart<any>');
  assert.equal(out.split('\n').length, src.split('\n').length);
  assert.match(out.split('\n')[1], /^\/\*\* @type \{Arcade\.Cart<any>\} \*\/ export default \{$/);
  const already = '/** @type {Arcade.Cart<State>} */\nexport default {};\n';
  assert.equal(annotate(already, 'Arcade.Cart<any>'), already);
  assert.equal(annotate('const s = "export default";\n', 'Arcade.Checks'), 'const s = "export default";\n');
});

test('bin: exit 0 on the valid cart, 1 with one line per error otherwise, 2 on bad usage', () => {
  const run = (args) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, [BIN, ...args], { encoding: 'utf8' }) };
    } catch (/** @type {any} */ e) {
      return { code: e.status, out: `${e.stdout}${e.stderr}` };
    }
  };
  const good = run([VALID]);
  assert.equal(good.code, 0, good.out);
  assert.match(good.out, /^ok {2}5 rules \(4 auto\), 4 checks$/m);
  const bad = run([variant({ 'cart.json': '{}' }), '--no-types']);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /^error {2}cart\.json {2}\[cart\.json\] cart\.json needs "id"/m);
  const json = run([VALID, '--json']);
  assert.equal(JSON.parse(json.out).ok, true);
  assert.equal(run([]).code, 2);
  assert.equal(run([VALID, '--fast']).code, 2);
});
