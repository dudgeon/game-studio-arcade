// Parser and formatter for a cart's spec.md (D1, D30).
// Plain ESM with no dependencies, so it runs unchanged in the offline sandbox.

/** The known sections, in the order a spec must use. */
export const SECTIONS = ['Pitch', 'Rules', 'Controls', 'Look & sound', 'Assumptions', 'Changelog'];

/** Byline keys, in order. A value of "—" means none. */
export const BYLINE_KEYS = ['maker', 'with', 'parent', 'session'];

const NONE = '—';
const KIND_TEXT = { auto: 'auto', 'you-check': 'you check' };

const RULE_RE = /^- (R(\d+)) \((auto|you check)\): (.*)$/;
const ASSUMPTION_RE = /^- (A(\d+)): (.*)$/;
// A dotted version (v1.1) counts as its whole number: a changelog line is history,
// and a kid's working game is never refused over one (D197).
// A version's name sits in quotes after its number (D472): `- v3 "Faster logs": ...`.
const CHANGE_RE = /^- (v(\d+)(?:\.\d+)?)(?: "([^"]*)")?: (.*)$/;

// Item kinds for the structured sections.
const LISTS = {
  Rules: { key: 'rules', re: RULE_RE, form: '- R<n> (auto): <text>  or  - R<n> (you check): <text>' },
  Assumptions: { key: 'assumptions', re: ASSUMPTION_RE, form: '- A<n>: <text>' },
  Changelog: { key: 'changelog', re: CHANGE_RE, form: '- v<n>: <text>  or  - v<n> "<name>": <text>' },
};

/**
 * Parse spec.md text. Never throws: problems come back in `errors` (the spec
 * is unusable as written) and `warnings` (worth fixing, not blocking).
 * @param {string} text
 * @returns {import('../index.js').Spec}
 */
export function parseSpec(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  /** @type {import('../index.js').Issue[]} */
  const errors = [];
  /** @type {import('../index.js').Issue[]} */
  const warnings = [];
  /** @param {number | null} line @param {string} message */
  const err = (line, message) => errors.push({ line, message });
  /** @param {number | null} line @param {string} message */
  const warn = (line, message) => warnings.push({ line, message });

  /** @type {import('../index.js').Spec} */
  const spec = {
    title: null,
    byline: { maker: null, with: null, parent: null, session: null },
    sections: [],
    rules: [],
    assumptions: [],
    changelog: [],
    errors,
    warnings,
  };

  let i = 0;
  const skipBlank = () => { while (i < lines.length && lines[i].trim() === '') i++; };

  // Title.
  skipBlank();
  const titleMatch = /^# (.+)$/.exec(lines[i] ?? '');
  if (titleMatch) {
    spec.title = titleMatch[1].trim();
    i++;
  } else {
    err(i + 1, 'The first line must be the title: "# <Title>".');
  }

  // Byline.
  skipBlank();
  if (i < lines.length && !lines[i].startsWith('#')) {
    parseByline(lines[i], i + 1, spec.byline, err);
    i++;
  } else {
    err(i + 1, `The line after the title must be the byline: "${BYLINE_KEYS.map((k) => `${k}: …`).join(' · ')}".`);
  }

  // Anything before the first section is not allowed.
  skipBlank();
  while (i < lines.length && !lines[i].startsWith('## ')) {
    if (lines[i].trim() !== '') err(i + 1, 'Text between the byline and the first "##" section has nowhere to go. Move it into a section.');
    i++;
  }

  // Sections.
  while (i < lines.length) {
    const heading = lines[i].slice(3).trim();
    const headingLine = i + 1;
    i++;
    const start = i;
    while (i < lines.length && !lines[i].startsWith('## ')) i++;
    const bodyLines = lines.slice(start, i);
    /** @type {import("../index.js").Section} */
    const section = { heading, line: headingLine };

    if (spec.sections.some((s) => s.heading === heading)) {
      err(headingLine, `Section "${heading}" appears twice.`);
    }
    if (!SECTIONS.includes(heading)) {
      warn(headingLine, `Unknown section "${heading}". It is kept as written; the known ones are: ${SECTIONS.join(', ')}.`);
    }

    if (LISTS[heading]) {
      section.items = parseList(LISTS[heading], bodyLines, start + 1, err);
      spec[LISTS[heading].key].push(...section.items);
    } else {
      section.body = trimBlankLines(bodyLines).join('\n');
      if (heading.startsWith('#')) err(headingLine, 'Use "##" for sections; deeper headings belong inside a section body.');
    }
    spec.sections.push(section);
  }

  // Required sections and order.
  const known = spec.sections.filter((s) => SECTIONS.includes(s.heading));
  for (const name of SECTIONS) {
    if (!known.some((s) => s.heading === name)) err(null, `Missing section "## ${name}".`);
  }
  let last = -1;
  for (const s of known) {
    const at = SECTIONS.indexOf(s.heading);
    if (at < last) err(s.line, `Section "${s.heading}" is out of order. The order is: ${SECTIONS.join(', ')}.`);
    last = Math.max(last, at);
  }

  // Ids: unique within each list; ascending is expected.
  checkIds(spec.rules, 'Rule', err, warn);
  checkIds(spec.assumptions, 'Assumption', err, warn);
  checkIds(spec.changelog, 'Changelog entry', err, warn);
  if (known.some((s) => s.heading === 'Rules') && spec.rules.length === 0) err(null, 'The Rules section has no rules.');

  return spec;
}

function parseByline(line, lineNo, byline, err) {
  const parts = line.split(' · ').map((p) => p.trim());
  const seen = [];
  for (const part of parts) {
    const m = /^([a-z]+): (.+)$/.exec(part);
    if (!m || !BYLINE_KEYS.includes(m[1])) {
      err(lineNo, `Byline part "${part}" isn't one of ${BYLINE_KEYS.map((k) => `"${k}: …"`).join(', ')}.`);
      continue;
    }
    seen.push(m[1]);
    byline[m[1]] = m[2].trim() === NONE ? null : m[2].trim();
  }
  if (seen.join() !== BYLINE_KEYS.join()) {
    err(lineNo, `The byline needs exactly ${BYLINE_KEYS.join(', ')}, in that order, separated by " · ". Use "${NONE}" for none.`);
  }
  if (byline.maker === null) err(lineNo, 'The byline needs a maker.');
}

function parseList(kind, bodyLines, firstLineNo, err) {
  /** @type {any[]} */
  const items = [];
  /** @type {any} */
  let current = null;
  bodyLines.forEach((raw, k) => {
    const lineNo = firstLineNo + k;
    if (raw.trim() === '') { current = null; return; }
    if (current && /^ {2,}\S/.test(raw)) {
      current.text += '\n' + raw.trim();
      return;
    }
    const m = kind.re.exec(raw);
    if (!m) {
      current = null;
      err(lineNo, `This line doesn't fit the form ${kind.form}.${hint(raw)}`);
      return;
    }
    current = { id: m[1], n: Number(m[2]), line: lineNo };
    if (kind.key === 'rules') {
      current.kind = m[3] === 'auto' ? 'auto' : 'you-check';
      current.text = m[4].trim();
    } else if (kind.key === 'changelog') {
      // The name isn't checked here: cart.json's `version_name` is, and a working game is never refused over history (D197).
      if (m[3] != null) current.name = m[3];
      current.text = m[4].trim();
    } else {
      current.text = m[3].trim();
    }
    if (current.text === '') err(lineNo, `${current.id} has no text.`);
    items.push(current);
  });
  return items;
}

// A nudge for the near misses an agent is most likely to write.
function hint(raw) {
  if (/\((you-check|you_check|manual|human)\)/i.test(raw)) return ' Write the kind as "(you check)".';
  if (/\((Auto|AUTO|automatic)\)/.test(raw)) return ' Write the kind as "(auto)".';
  if (/^- \*\*/.test(raw)) return ' Drop the bold around the id.';
  if (/^\d+\. /.test(raw)) return ' Use "- " list items, not numbers.';
  if (/^- R\d+ [^(]/.test(raw) || /^- R\d+:/.test(raw)) return ' Every rule needs its kind: "(auto)" or "(you check)".';
  return '';
}

function checkIds(items, label, err, warn) {
  const seen = new Set();
  let prev = 0;
  for (const it of items) {
    if (seen.has(it.id)) err(it.line, `${label} id ${it.id} is used twice. Ids are never reused; take the next free number.`);
    seen.add(it.id);
    if (it.n === 0) err(it.line, `${label} ids start at 1.`);
    if (it.n < prev) warn(it.line, `${it.id} comes after a higher id. Keep ids in ascending order.`);
    prev = Math.max(prev, it.n);
  }
}

function trimBlankLines(lines) {
  let a = 0;
  let b = lines.length;
  while (a < b && lines[a].trim() === '') a++;
  while (b > a && lines[b - 1].trim() === '') b--;
  return lines.slice(a, b).map((l) => l.replace(/\s+$/, ''));
}

/**
 * Write a parsed spec back out in canonical form. For a spec already in
 * canonical form, formatSpec(parseSpec(text)) === text.
 * @param {import('../index.js').Spec} spec
 * @returns {string}
 */
export function formatSpec(spec) {
  const out = [`# ${spec.title ?? ''}`, ''];
  out.push(BYLINE_KEYS.map((k) => `${k}: ${spec.byline?.[k] ?? NONE}`).join(' · '), '');
  for (const s of spec.sections) {
    out.push(`## ${s.heading}`, '');
    if (s.items) {
      const items = LISTS[s.heading] ? spec[LISTS[s.heading].key] : s.items;
      for (const it of items) out.push(formatItem(it));
    } else if (s.body) {
      out.push(s.body);
    }
    out.push('');
  }
  return out.join('\n');
}

function formatItem(it) {
  const [first, ...rest] = it.text.split('\n');
  const head = it.kind ? `- ${it.id} (${KIND_TEXT[it.kind]}): ${first}` : it.name != null ? `- ${it.id} "${it.name}": ${first}` : `- ${it.id}: ${first}`;
  return [head, ...rest.map((l) => `  ${l}`)].join('\n');
}

/**
 * Just the rules, for validate and the playtest.
 * @param {string} text
 * @returns {{id: string, kind: 'auto'|'you-check', text: string}[]}
 */
export function rulesOf(text) {
  return parseSpec(text).rules.map(({ id, kind, text: t }) => ({ id, kind, text: t }));
}
