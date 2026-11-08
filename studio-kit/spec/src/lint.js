// The D13 lint: game.js and checks.js may not reach the DOM, the network, the
// host, eval, the wall clock or Math.random (D10, D13, D21, D31). The iframe
// sandbox is the real boundary; this lint tells the agent early and in words.
//
// A small tokenizer strips comments, strings and regexes first, so a word in a
// string or comment never trips it, and `s.document` or `{ fetch: 1 }` (property
// names) are fine. tsc under the cart config catches unknown globals as well.

/** @typedef {{ type: 'ident' | 'punct' | 'str' | 'num' | 'tmpl' | 'regex', value: string, line: number }} Token */
/** @typedef {{ text: string, line: number }} Comment */

const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const PUNCT3 = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??='];
const PUNCT2 = ['=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>'];
const isIdStart = (c) => /[A-Za-z_$#\u0080-￿]/.test(c);
const isIdPart = (c) => /[\w$\u0080-￿]/.test(c);

/**
 * Split JavaScript into tokens. Not a full parser: enough to tell code from
 * strings, comments and regexes, with line numbers.
 * @param {string} src
 * @returns {{ tokens: Token[], comments: Comment[], escapes: number[] }}
 */
export function tokenize(src) {
  /** @type {Token[]} */
  const tokens = [];
  /** @type {Comment[]} */
  const comments = [];
  /** @type {number[]} */
  const escapes = [];
  let i = 0;
  let line = 1;
  /** brace depth inside each open `${`, innermost last */
  const tmpl = [];
  const n = src.length;

  const regexAllowed = () => {
    const p = tokens[tokens.length - 1];
    if (!p) return true;
    if (p.type === 'ident') return REGEX_AFTER_WORD.has(p.value);
    if (p.type === 'punct') return p.value !== ')' && p.value !== ']';
    return false;
  };

  // Read a template literal body from i (just past ` or }), up to ` or ${.
  const templateBody = () => {
    const start = line;
    while (i < n) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '\n') line++;
      if (c === '`') { i++; tokens.push({ type: 'tmpl', value: '', line: start }); return; }
      if (c === '$' && src[i + 1] === '{') { i += 2; tokens.push({ type: 'tmpl', value: '', line: start }); tmpl.push(0); return; }
      i++;
    }
  };

  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? n : end;
      comments.push({ text: src.slice(i, stop), line });
      i = stop;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      const text = src.slice(i, stop);
      comments.push({ text, line });
      line += (text.match(/\n/g) ?? []).length;
      i = stop;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let value = '';
      while (j < n && src[j] !== c && src[j] !== '\n') {
        if (src[j] === '\\') { value += src[j + 1] ?? ''; j += 2; continue; }
        value += src[j++];
      }
      tokens.push({ type: 'str', value, line });
      i = j + 1;
      continue;
    }
    if (c === '`') { i++; templateBody(); continue; }
    if (tmpl.length && c === '{') { tmpl[tmpl.length - 1]++; tokens.push({ type: 'punct', value: c, line }); i++; continue; }
    if (tmpl.length && c === '}') {
      if (tmpl[tmpl.length - 1] === 0) { tmpl.pop(); i++; templateBody(); continue; }
      tmpl[tmpl.length - 1]--;
      tokens.push({ type: 'punct', value: c, line });
      i++;
      continue;
    }
    if (c === '/' && regexAllowed()) {
      let j = i + 1;
      let cls = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') cls = true;
        else if (src[j] === ']') cls = false;
        else if (src[j] === '/' && !cls) break;
        j++;
      }
      j++;
      while (j < n && isIdPart(src[j])) j++;
      tokens.push({ type: 'regex', value: src.slice(i, j), line });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < n && (/[\w.]/.test(src[j]) || ((src[j] === '+' || src[j] === '-') && /[eE]/.test(src[j - 1]) && !/^0[xX]/.test(src.slice(i, j))))) j++;
      tokens.push({ type: 'num', value: src.slice(i, j), line });
      i = j;
      continue;
    }
    if (c === '\\') { escapes.push(line); i++; continue; }
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < n && (isIdPart(src[j]) || src[j] === '\\')) {
        if (src[j] === '\\') escapes.push(line);
        j++;
      }
      tokens.push({ type: 'ident', value: src.slice(i, j), line });
      i = j;
      continue;
    }
    const p = PUNCT3.find((s) => src.startsWith(s, i)) ?? PUNCT2.find((s) => src.startsWith(s, i)) ?? c;
    tokens.push({ type: 'punct', value: p, line });
    i += p.length;
  }
  return { tokens, comments, escapes };
}

const why = {
  dom: 'Carts have no DOM or browser APIs (D13): draw with g, read buttons with g.btn, save with g.save.',
  network: 'Carts have no network (D13). Everything a cart needs is in the cart folder.',
  host: 'Carts run in a sandboxed frame, not Node: there is no process, require or global object (D13, D21).',
  code: 'Carts may not build code from strings (no eval or Function).',
  timers: 'Carts may not use timers: the runtime calls update 60 times a second (D10). Count frames instead (g.frame, or g.lib.timers).',
  clock: 'Carts may not read the clock: time is frames, so playtests reproduce (D10). Use g.frame.',
  random: 'Carts may not use Math.random or crypto: use the seeded g.rnd / g.pick, so playtests reproduce (D10).',
};

/** Global names a cart must not use, by reason. */
export const FORBIDDEN = /** @type {Record<keyof typeof why, string[]>} */ ({
  dom: ['window', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'cookieStore',
    'alert', 'confirm', 'prompt', 'requestAnimationFrame', 'cancelAnimationFrame', 'addEventListener', 'removeEventListener', 'dispatchEvent',
    'postMessage', 'Image', 'Audio', 'AudioContext', 'OffscreenCanvas', 'HTMLElement', 'HTMLCanvasElement', 'MutationObserver', 'customElements', 'opener'],
  network: ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport', 'RTCPeerConnection', 'Worker', 'SharedWorker',
    'importScripts', 'BroadcastChannel', 'MessageChannel', 'sendBeacon', 'serviceWorker'],
  host: ['globalThis', 'global', 'process', 'Buffer', 'require', 'module', '__dirname', '__filename', 'Deno', 'Bun'],
  code: ['eval', 'Function'],
  timers: ['setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'queueMicrotask', 'requestIdleCallback'],
  clock: ['Date', 'performance'],
  random: ['crypto'],
});
const REASON_OF = new Map(Object.entries(FORBIDDEN).flatMap(([k, names]) => names.map((nm) => [nm, k])));

/**
 * Lint one cart source file.
 * @param {string} source
 * @param {{ file: string, imports?: boolean }} opts  imports: false when another check already reports imports (checks.js)
 * @returns {import('../index.js').Issue[]}
 */
export function lintCartSource(source, { file, imports = true }) {
  const { tokens, comments, escapes } = tokenize(source);
  /** @type {import('../index.js').Issue[]} */
  const out = [];
  const seen = new Set();
  const add = (line, key, message) => {
    if (seen.has(`${line}:${key}`)) return;
    seen.add(`${line}:${key}`);
    out.push({ file, line, check: 'lint', message });
  };

  for (const c of comments) {
    const m = c.text.match(/@ts-(nocheck|ignore|expect-error)\b/);
    if (m) add(c.line, m[0], `${file} uses ${m[0]}. Fix the type error instead of hiding it; validate_cart type-checks every cart.`);
  }
  for (const line of escapes) add(line, 'escape', `${file} has a backslash escape outside a string. Write names out plainly.`);

  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    const prev = tokens[k - 1];
    const next = tokens[k + 1];
    if (t.type === 'str' && t.value === 'constructor' && prev?.value === '[') {
      add(t.line, 'constructor', `${file} reaches for ["constructor"]. ${why.code}`);
      continue;
    }
    if (t.type !== 'ident') continue;
    const member = prev?.type === 'punct' && (prev.value === '.' || prev.value === '?.');

    if (imports && !member) {
      if (t.value === 'import' && !(next?.value === ':')) {
        add(t.line, 'import', `${file} must import nothing (D21). The starter library is g.lib; everything else comes through g.`);
        continue;
      }
      if (t.value === 'export' && exportsFrom(tokens, k)) {
        add(t.line, 'import', `${file} must import nothing (D21), and that includes \`export … from\`.`);
        continue;
      }
    }
    if (member) {
      if (t.value === 'constructor') add(t.line, 'constructor', `${file} reaches for .constructor. ${why.code}`);
      if (t.value === 'random' && tokens[k - 2]?.value === 'Math') add(t.line, 'Math.random', `${file} uses Math.random. ${why.random}`);
      continue;
    }
    if (t.value === 'Math' && next?.value === '[') { add(t.line, 'Math[', `${file} uses Math[…]. Call Math functions by name. ${why.random}`); continue; }
    const reason = REASON_OF.get(t.value);
    if (!reason) continue;
    if (!imports && t.value === 'require') continue;
    // A property name in an object literal or class (`{ fetch: 1 }`, `{ fetch() {} }`) isn't a use.
    const keyLike = (prev?.value === '{' || prev?.value === ',' || prev?.value === ';') && (next?.value === ':' || next?.value === '(');
    if (keyLike && next?.value === ':') continue;
    if (keyLike && next?.value === '(' && closesThenBrace(tokens, k + 1)) continue;
    add(t.line, t.value, `${file} uses ${t.value}. ${why[/** @type {keyof typeof why} */ (reason)]}`);
  }
  return out;
}

// `export { a } from "x"` or `export * from "x"`
function exportsFrom(tokens, k) {
  for (let j = k + 1; j < tokens.length && j < k + 200; j++) {
    const v = tokens[j].value;
    if (tokens[j].type === 'ident' && v === 'from' && tokens[j + 1]?.type === 'str') return true;
    if (v === ';' || (tokens[j].type === 'ident' && ['const', 'let', 'var', 'function', 'class', 'default', 'async'].includes(v))) return false;
  }
  return false;
}

// For a method shorthand `name(...) {`: the ( at k closes and is followed by {.
function closesThenBrace(tokens, k) {
  let depth = 0;
  for (let j = k; j < tokens.length; j++) {
    if (tokens[j].value === '(') depth++;
    else if (tokens[j].value === ')' && --depth === 0) return tokens[j + 1]?.value === '{';
  }
  return false;
}
