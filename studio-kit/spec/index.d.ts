export interface Issue { file?: string; line: number | null; rule?: string; message: string }
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
