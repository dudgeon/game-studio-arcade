export interface Issue {
  file?: string | null;
  line: number | null;
  rule?: string;
  /** Which part of validate_cart found it. Absent on issues from the parser or validateRuleCoverage alone. */
  check?: 'coverage' | 'cart.json' | 'lint' | 'types';
  message: string;
}
export interface Rule { id: string; n: number; kind: 'auto' | 'you-check'; text: string; line: number }
export interface Item { id: string; n: number; text: string; line: number }
export interface Section { heading: string; line: number; body?: string; items?: (Rule | Item)[] }
export interface Spec {
  title: string | null;
  byline: { maker: string | null; with: string | null; parent: string | null; session: string | null };
  sections: Section[];
  rules: Rule[];
  assumptions: Item[];
  changelog: Item[];
  errors: Issue[];
  warnings: Issue[];
}
export interface CoverageReport {
  ok: boolean;
  rules: { id: string; kind: 'auto' | 'you-check'; text: string }[];
  checks: string[];
  errors: Issue[];
  warnings: Issue[];
}
export const SECTIONS: readonly string[];
export const BYLINE_KEYS: readonly string[];
export function parseSpec(text: string): Spec;
export function formatSpec(spec: Spec): string;
export function rulesOf(text: string): { id: string; kind: 'auto' | 'you-check'; text: string }[];
export function checkCoverage(rules: { id: string; kind: string; line?: number }[], checkIds: string[]): { errors: Issue[]; warnings: Issue[] };
export function readCheckIds(checksPath: string, opts?: { timeoutMs?: number }): Promise<CheckIds>;
export function validateRuleCoverage(cartDir: string): Promise<CoverageReport>;
/** What readCheckIds found: the check ids, or why it could not read them. */
export type CheckIds =
  | { keys: string[]; nonFunctions: string[]; error?: undefined }
  | { error: string; keys?: undefined; nonFunctions?: undefined };

export interface ValidateOptions {
  /** false skips the tsc pass (a machine without TypeScript). Default: run it. */
  types?: boolean;
  /** The runtime folder holding cart.d.ts, test-hook.d.ts and tsconfig.cart.json. Default: ../../runtime from this package. */
  runtimeDir?: string;
  /** The compiler to run; null means none is available. Default: findTsc(). */
  tsc?: { cmd: string; args: string[] } | null;
  tscTimeoutMs?: number;
}
export interface ValidateReport {
  /** True when there are no errors. Warnings never fail a cart. */
  ok: boolean;
  /** The parsed cart.json, or null if it is missing or not a JSON object. */
  cart: any;
  rules: { id: string; kind: 'auto' | 'you-check'; text: string }[];
  checks: string[];
  /** Sorted by check: coverage, cart.json, lint, types. */
  errors: Issue[];
  warnings: Issue[];
  skipped?: { types?: string };
}
export function validateCart(cartDir: string, opts?: ValidateOptions): Promise<ValidateReport>;
export function formatIssues(report: { errors: Issue[]; warnings: Issue[] }): string[];
export const CART_ID: RegExp;
export const REQUIRED_CART_FIELDS: readonly string[];
export function checkCartJson(text: string | null, opts?: { specTitle?: string | null }): { errors: Issue[]; warnings: Issue[]; value: any };
export const FORBIDDEN: Record<'dom' | 'network' | 'host' | 'code' | 'timers' | 'clock' | 'random', string[]>;
export function tokenize(src: string): {
  tokens: { type: 'ident' | 'punct' | 'str' | 'num' | 'tmpl' | 'regex'; value: string; line: number }[];
  comments: { text: string; line: number }[];
  escapes: number[];
};
export function lintCartSource(source: string, opts: { file: string; imports?: boolean }): Issue[];
export function findTsc(): { cmd: string; args: string[] } | null;
export function annotate(source: string, type: string): string;
export function typeCheckCart(cartDir: string, opts: { files: string[]; runtimeDir?: string; tsc?: { cmd: string; args: string[] } | null; timeoutMs?: number }): Promise<{ errors: Issue[]; skipped?: string }>;
