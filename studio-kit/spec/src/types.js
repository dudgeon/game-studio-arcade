// The type check: game.js and checks.js under runtime/tsconfig.cart.json
// (ES2023, no DOM, no Node, only the Arcade globals). D31.
//
// Both files are copied to a temp folder with `/** @type {Arcade.Cart<any>} */`
// (or `Arcade.Checks`) put in front of `export default`, on the same line, so
// `g` and `t` are typed even when the cart didn't annotate them: a bad button
// name or a missing draw() fails here. The cart folder is never written to.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenize } from './lint.js';

/** The runtime folder, next to studio-kit/ both in the repo and in the kit tarball. */
export const DEFAULT_RUNTIME_DIR = fileURLToPath(new URL('../../../runtime/', import.meta.url));

const ANNOTATION = { 'game.js': 'Arcade.Cart<any>', 'checks.js': 'Arcade.Checks' };

/**
 * Find a TypeScript compiler: the repo's devDependency, a `tsc` on PATH (the
 * sandbox's global TypeScript, D18), or the global npm root.
 * @returns {{ cmd: string, args: string[] } | null}
 */
export function findTsc() {
  try {
    const p = createRequire(import.meta.url).resolve('typescript/bin/tsc');
    return { cmd: process.execPath, args: [p] };
  } catch {}
  for (const d of (process.env.PATH ?? '').split(':')) {
    if (d && existsSync(join(d, 'tsc'))) return { cmd: join(d, 'tsc'), args: [] };
  }
  for (const root of ['/home/claude/.npm-global/lib/node_modules', '/usr/local/lib/node_modules', '/opt/homebrew/lib/node_modules']) {
    const p = join(root, 'typescript/bin/tsc');
    if (existsSync(p)) return { cmd: process.execPath, args: [p] };
  }
  return null;
}

/** Put the annotation in front of the file's `export default`, unless it already has one. */
export function annotate(source, type) {
  const { tokens, comments } = tokenize(source);
  const k = tokens.findIndex((t, j) => t.type === 'ident' && t.value === 'export' && tokens[j + 1]?.value === 'default');
  if (k < 0) return source;
  const line = tokens[k].line;
  if (comments.some((c) => c.text.includes(`@type {${type.split('<')[0]}`) && c.line >= line - 3 && c.line <= line)) return source;
  const lines = source.split('\n');
  lines[line - 1] = lines[line - 1].replace(/\bexport(\s+)default\b/, `/** @type {${type}} */ export$1default`);
  return lines.join('\n');
}

/**
 * Type-check a cart's game.js and checks.js.
 * @param {string} cartDir
 * @param {{ files: string[], runtimeDir?: string, tsc?: { cmd: string, args: string[] } | null, timeoutMs?: number }} opts
 * @returns {Promise<{ errors: import('../index.js').Issue[], skipped?: string }>}
 */
export async function typeCheckCart(cartDir, opts) {
  const runtimeDir = resolve(opts.runtimeDir ?? DEFAULT_RUNTIME_DIR);
  const tsc = opts.tsc === undefined ? findTsc() : opts.tsc;
  /** @type {import('../index.js').Issue[]} */
  const errors = [];
  const issue = (file, line, message) => ({ file, line, check: /** @type {const} */ ('types'), message });
  if (!tsc) return { errors: [issue(null, null, 'TypeScript (tsc) isn\'t available, so the cart could not be type-checked.')], skipped: 'no tsc' };
  const base = join(runtimeDir, 'tsconfig.cart.json');
  if (!existsSync(base)) return { errors: [issue(null, null, `The runtime's tsconfig.cart.json isn't at ${base}.`)], skipped: 'no runtime' };

  const work = await realpath(await mkdtemp(join(tmpdir(), 'gsa-validate-')));
  try {
    /** @type {Map<string, string>} temp path -> cart file name */
    const back = new Map();
    for (const f of opts.files) {
      const src = await readFile(join(cartDir, f), 'utf8');
      const dest = join(work, f);
      await writeFile(dest, annotate(src, ANNOTATION[f] ?? 'unknown'));
      back.set(dest, f);
    }
    const config = {
      extends: base,
      compilerOptions: { noEmit: true, incremental: false },
      include: [join(runtimeDir, 'cart.d.ts'), join(runtimeDir, 'test-hook.d.ts'), ...back.keys()],
    };
    await writeFile(join(work, 'tsconfig.json'), JSON.stringify(config, null, 2));
    const out = await new Promise((done) => {
      execFile(tsc.cmd, [...tsc.args, '-p', join(work, 'tsconfig.json'), '--pretty', 'false'], { cwd: work, timeout: opts.timeoutMs ?? 60000, maxBuffer: 8 << 20 }, (e, stdout, stderr) => {
        done({ e, text: `${stdout}${stderr}` });
      });
    });
    if (out.e?.killed) return { errors: [issue(null, null, 'tsc took too long and was stopped.')] };
    for (const raw of out.text.split('\n')) {
      const m = raw.match(/^(.*?)\((\d+),(\d+)\): error (TS\d+): (.*)$/);
      if (m) {
        const abs = resolve(work, m[1]);
        const file = back.get(abs) ?? relative(runtimeDir, abs).split(sep).join('/');
        errors.push(issue(file, Number(m[2]), `${m[5]} (${m[4]})`));
      } else if (/error TS\d+/.test(raw)) {
        errors.push(issue(null, null, raw.trim()));
      }
    }
    if (out.e && !errors.length) errors.push(issue(null, null, `tsc failed: ${out.text.trim().split('\n')[0] || out.e.message}`));
    return { errors };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
