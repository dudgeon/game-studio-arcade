// A version's name (D471-D474): its rules, where it sits in the spec and cart.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION_NAME_MAX, checkCartJson, cleanVersionName, formatSpec, isVersionName, nameChangelogLine, parseSpec, sameVersionName, versionLabel, versionNameTaken } from '../index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SLOTH = fs.readFileSync(path.join(here, 'fixtures/sloth-snacks/spec.md'), 'utf8');

test('a name is tidied: plain ASCII, single spaces, no quotes, no full stop from speech, a capital first', () => {
  assert.equal(VERSION_NAME_MAX, 16);
  assert.equal(cleanVersionName('Faster logs'), 'Faster logs');
  assert.equal(cleanVersionName('  turbo   frog. '), 'Turbo frog');
  assert.equal(cleanVersionName('"Zoë’s way"'), "Zoe's way");
  assert.equal(cleanVersionName('2 frogs!'), '2 frogs!');
  assert.equal(cleanVersionName('🐸 hop'), 'Hop');
  for (const bad of ['', '   ', '...', '🐸', null, undefined, 7, {}]) assert.equal(cleanVersionName(bad), null, String(bad));
});

test('a name longer than 16 characters is nobody\'s guess: null, or cut at a whole word when asked', () => {
  const long = 'the one where every log goes faster';
  assert.equal(cleanVersionName('Sixteen letters!'), 'Sixteen letters!');
  assert.equal(cleanVersionName(long), null);
  assert.equal(cleanVersionName(long, { cut: true }), 'The one where');
  assert.equal(cleanVersionName('Supercalifragilistic', { cut: true }), 'Supercalifragili');
  assert.ok(/** @type {string} */ (cleanVersionName(long, { cut: true })).length <= VERSION_NAME_MAX);
});

test('names are compared without capitals; isVersionName is what cart.json may hold', () => {
  assert.ok(sameVersionName('Faster logs', ' faster LOGS '));
  assert.ok(!sameVersionName('Faster logs', 'Faster log'));
  assert.ok(versionNameTaken('Turbo', ['Log Hopper', 'turbo']));
  assert.ok(!versionNameTaken('Turbo', ['Log Hopper', null]));
  assert.ok(isVersionName('Faster logs'));
  for (const bad of ['faster logs', 'Faster logs.', ' Faster logs', 'A name that is far too long', '', 3, null]) assert.ok(!isVersionName(bad), String(bad));
});

test('a label has the number where a list needs the order; an unnamed version is its number', () => {
  assert.equal(versionLabel({ version: 3, version_name: 'Faster logs' }), 'Faster logs (v3)');
  assert.equal(versionLabel({ version: 2, version_name: null }), 'v2');
  assert.equal(versionLabel({}), 'v1');
});

test('the spec\'s Changelog carries the name in quotes after the number, and round-trips (D472)', () => {
  const text = SLOTH.replace(/(## Changelog\n\n(?:- .*\n)+)/, '$1- v3 "Faster logs": Birds are faster.\n');
  const spec = parseSpec(text);
  assert.deepEqual(spec.errors, []);
  const last = spec.changelog.at(-1);
  assert.deepEqual([last?.id, last?.n, last?.name, last?.text], ['v3', 3, 'Faster logs', 'Birds are faster.']);
  assert.equal(spec.changelog[0].name, undefined, 'an unnamed line is as it was');
  assert.equal(formatSpec(spec), text);
  // History is never a reason to refuse a game (D197): an odd name in the spec parses.
  assert.deepEqual(parseSpec(text.replace('"Faster logs"', '"a very long name that would never fit a tag"')).errors, []);
});

test('nameChangelogLine puts the name on its version\'s line, once, and nowhere else', () => {
  const named = nameChangelogLine(SLOTH, 2, 'Faster logs');
  assert.match(named, /^- v2 "Faster logs": /m);
  assert.equal(parseSpec(named).changelog.find((c) => c.id === 'v2')?.name, 'Faster logs');
  assert.equal(nameChangelogLine(named, 2, 'Other'), named, 'a line that has a name keeps it');
  assert.equal(nameChangelogLine(SLOTH, 9, 'Faster logs'), SLOTH, 'no such line: nothing changes');
  assert.equal(nameChangelogLine('# T\n\nno changelog here\n', 1, 'X'), '# T\n\nno changelog here\n');
  // Only the Changelog: a rule that happens to start the same way is left alone.
  assert.equal(named.split('\n').filter((l) => l.includes('"Faster logs"')).length, 1);
});

test('cart.json: version_name is a known field; a name that wouldn\'t show is an error the agent can fix', () => {
  const base = { id: 'sloth-snacks', title: 'Sloth Snacks', players: 1, version: 3 };
  const ok = checkCartJson(JSON.stringify({ ...base, version_name: 'Faster logs' }));
  assert.deepEqual([ok.errors, ok.warnings], [[], []]);
  assert.deepEqual(checkCartJson(JSON.stringify(base)).errors, [], 'no name is fine: every cart made before names');
  const bad = checkCartJson(JSON.stringify({ ...base, version_name: 'a name much too long to fit' }));
  assert.equal(bad.errors.length, 1);
  assert.match(bad.errors[0].message, /"version_name".*at most 16 characters/);
});
