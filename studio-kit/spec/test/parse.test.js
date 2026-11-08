import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSpec, formatSpec, rulesOf } from '../index.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const TEMPLATE = read('../template.md');
const SLOTH = read('./fixtures/sloth-snacks/spec.md');

// A minimal valid spec with the given Rules body, for targeted error tests.
const withRules = (rules, extra = '') => `# T

maker: A · with: — · parent: — · session: —

## Pitch

p

## Rules

${rules}

## Controls

c

## Look & sound

l
${extra}
## Assumptions

- A1: a

## Changelog

- v1: first
`;

const messages = (spec) => spec.errors.map((e) => e.message).join('\n');

for (const [name, text] of [['template', TEMPLATE], ['sloth-snacks fixture', SLOTH]]) {
  test(`${name} parses with no errors or warnings`, () => {
    const spec = parseSpec(text);
    assert.deepEqual(spec.errors, []);
    assert.deepEqual(spec.warnings, []);
  });

  test(`${name} round-trips: format(parse(x)) === x`, () => {
    assert.equal(formatSpec(parseSpec(text)), text);
  });
}

test('template rules: ids and kinds', () => {
  assert.deepEqual(rulesOf(TEMPLATE).map((r) => [r.id, r.kind]), [['R1', 'auto'], ['R2', 'auto'], ['R3', 'you-check']]);
});

test('fixture: byline, rules with continuation, gaps, assumptions, changelog', () => {
  const spec = parseSpec(SLOTH);
  assert.equal(spec.title, 'Sloth Snacks');
  assert.deepEqual(spec.byline, { maker: 'O', with: 'A', parent: null, session: 'sesn_fixture01' });
  assert.deepEqual(spec.rules.map((r) => r.id), ['R1', 'R2', 'R3', 'R5', 'R6']);
  assert.equal(spec.rules[2].text, 'Touching an acorn takes away one life. At 0 lives the game-over screen shows\nwithin 30 frames.');
  assert.equal(spec.rules[2].line, 13);
  assert.equal(spec.rules[4].kind, 'you-check');
  assert.deepEqual(spec.assumptions.map((a) => a.id), ['A1', 'A2']);
  assert.deepEqual(spec.changelog.map((c) => c.id), ['v1', 'v2']);
  assert.match(spec.sections.find((s) => s.heading === 'Controls')?.body ?? '', /^- Player 1/);
});

test('editing the structure and formatting gives a spec that parses back the same', () => {
  const spec = parseSpec(SLOTH);
  spec.rules.push({ id: 'R7', n: 7, kind: 'auto', text: 'A new rule.\nOn two lines.', line: 0 });
  spec.changelog.push({ id: 'v3', n: 3, text: 'Added R7.', line: 0 });
  const again = parseSpec(formatSpec(spec));
  assert.deepEqual(again.errors, []);
  assert.deepEqual(again.rules.map((r) => [r.id, r.kind, r.text]), spec.rules.map((r) => [r.id, r.kind, r.text]));
  assert.equal(formatSpec(again), formatSpec(spec));
});

test('non-canonical but valid input normalizes, then round-trips', () => {
  const messy = withRules('- R1 (auto): a   \n\n- R2 (you check): b').replace('## Pitch\n\np', '## Pitch\n\n\np\n\n');
  const spec = parseSpec(messy);
  assert.deepEqual(spec.errors, []);
  const canon = formatSpec(spec);
  assert.notEqual(canon, messy);
  assert.equal(formatSpec(parseSpec(canon)), canon);
});

test('CRLF line endings parse', () => {
  assert.deepEqual(parseSpec(SLOTH.replace(/\n/g, '\r\n')).errors, []);
});

test('a rule without a kind is an error with a hint', () => {
  const spec = parseSpec(withRules('- R1: jumps'));
  assert.match(messages(spec), /needs its kind/);
  assert.equal(spec.errors[0].line, 11);
});

test('near-miss kinds and forms get specific hints', () => {
  assert.match(messages(parseSpec(withRules('- R1 (you-check): x'))), /"\(you check\)"/);
  assert.match(messages(parseSpec(withRules('- R1 (Auto): x'))), /"\(auto\)"/);
  assert.match(messages(parseSpec(withRules('- **R1** (auto): x'))), /bold/);
  assert.match(messages(parseSpec(withRules('1. R1 (auto): x'))), /not numbers/);
});

test('prose inside Rules is an error (it would be lost on format)', () => {
  assert.match(messages(parseSpec(withRules('Some notes.\n- R1 (auto): x'))), /doesn't fit the form/);
});

test('duplicate ids are errors; out-of-order ids are warnings; gaps are fine', () => {
  const dup = parseSpec(withRules('- R1 (auto): x\n- R1 (auto): y'));
  assert.match(messages(dup), /R1 is used twice/);
  const order = parseSpec(withRules('- R3 (auto): x\n- R1 (auto): y'));
  assert.deepEqual(order.errors, []);
  assert.match(order.warnings[0].message, /ascending/);
  assert.deepEqual(parseSpec(withRules('- R1 (auto): x\n- R7 (auto): y')).errors, []);
});

test('R0 and empty rule text are errors', () => {
  assert.match(messages(parseSpec(withRules('- R0 (auto): x'))), /start at 1/);
  assert.match(messages(parseSpec(withRules('- R1 (auto): '))), /no text/);
});

test('empty Rules section is an error', () => {
  assert.match(messages(parseSpec(withRules(''))), /no rules/);
});

test('missing, duplicate and out-of-order sections are errors', () => {
  assert.match(messages(parseSpec(SLOTH.replace(/## Look & sound[\s\S]*?(?=## Assumptions)/, ''))), /Missing section "## Look & sound"/);
  assert.match(messages(parseSpec(SLOTH + '\n## Pitch\n\nagain\n')), /appears twice/);
  const swapped = SLOTH.replace('## Pitch', '## TMP').replace('## Controls', '## Pitch').replace('## TMP', '## Controls');
  assert.match(messages(parseSpec(swapped)), /out of order/);
});

test('an unknown section is kept and warned about, and round-trips', () => {
  const text = withRules('- R1 (auto): x', '\n## Levels\n\nThree levels.\n');
  const spec = parseSpec(text);
  assert.deepEqual(spec.errors, []);
  assert.match(spec.warnings[0].message, /Unknown section "Levels"/);
  assert.match(formatSpec(spec), /## Levels\n\nThree levels\.\n/);
});

test('title and byline problems', () => {
  assert.match(messages(parseSpec(SLOTH.replace('# Sloth Snacks', 'Sloth Snacks'))), /title/);
  assert.match(messages(parseSpec(SLOTH.replace(' · with: A', ''))), /exactly maker, with, parent, session/);
  assert.match(messages(parseSpec(SLOTH.replace('maker: O', 'maker: —'))), /needs a maker/);
  assert.match(messages(parseSpec(SLOTH.replace('with: A', 'pal: A'))), /isn't one of/);
});

test('text between the byline and the first section is an error', () => {
  assert.match(messages(parseSpec(SLOTH.replace('## Pitch', 'stray\n\n## Pitch'))), /nowhere to go/);
});

test('parseSpec never throws on junk', () => {
  for (const junk of ['', '\n\n', '## Rules', '# only a title', '- R1 (auto): x']) {
    const spec = parseSpec(junk);
    assert.ok(spec.errors.length > 0, JSON.stringify(junk));
  }
});
