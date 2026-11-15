/// <reference path="../../runtime/cart.d.ts" />
/// <reference path="../../runtime/test-hook.d.ts" />

export type Status = "pass" | "fail" | "missing" | "you-check" | "skipped";

export interface RuleResult {
  id: string;
  kind: "auto" | "you-check";
  text: string;
  status: Status;
  /** true on pass, false on fail or missing, null for you-check and skipped. */
  passed: boolean | null;
  /** Why it failed (the check's error message), or a note; null on pass. */
  reason: string | null;
  /** Frames the check stepped, or null if it didn't run. */
  frames: number | null;
}

export interface GenericResult {
  id: "loads" | "no-errors" | "soak" | "palette" | "frame-time" | "deterministic" | string;
  /** Same as id (the studio-kit/cli shape). */
  name: string;
  status: "pass" | "fail";
  passed: boolean;
  reason: string | null;
  /** `deterministic` only, on a fail: the first frame where two runs differed. Random on a random cart, so `comparable()` drops it (D65). */
  frame?: number;
}

export interface FrameTime {
  frames: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  budgetMs: number;
}

/** playtest.json (D62). */
export interface Report {
  schema: 1;
  cart: string;
  driver: "node" | "browser";
  seed: number;
  ok: boolean;
  only?: string[];
  rules: RuleResult[];
  coverage: { rule: string | null; message: string }[];
  generic: GenericResult[];
  frameTime: FrameTime;
  /**
   * What glide costs on this machine (D519), for a cart that glides, from the browser driver: null otherwise.
   * `fine` is display pixels per game pixel; `path` how the picture reached the screen; the frame times are
   * the random-input and no-input runs with glide on, and the same two with it off (`plain`); `costMs` is the
   * difference of the medians. `warning` is "over" when glide is what takes the slowest frames past the budget,
   * "heavy" when it's inside the budget but takes more than a third of it, else null.
   */
  glide: { fine: number; path: "gpu" | "2d" | null; p50Ms: number; p95Ms: number; plainP50Ms: number; plainP95Ms: number; costMs: number; warning: "over" | "heavy" | null } | null;
  errors: { where: string; frame: number | null; message: string }[];
  /** Runtime dev warnings (t.warnings()), each message once. Color warnings fail the palette check. */
  warnings: { where: string; frame: number | null; message: string }[];
  frames: { name: string; file: string; frame: number; hash: string }[];
  env: { node: string; platform: string; playwright: string | null; browser: string | null; at: string };
}

export interface HostAdapter {
  /** The host page URL for a fresh cart with this seed, in test mode. */
  url(seed: number): string;
  close(): Promise<void>;
}

export interface PlaytestOptions {
  /** "node" (default): runtime headless(). "browser": Playwright on the host page. */
  driver?: "node" | "browser";
  /** Seed for every run. Default 1. */
  seed?: number;
  /** Run only these auto rules (the rest are "skipped"). Generic checks always run. */
  rules?: string[];
  /** Where playtest.json and playtest-frames/ go. Default: the cart folder. null writes nothing. */
  out?: string | null;
  /** Write key frames as PNG. Default true. */
  frames?: boolean;
  /** Frames of random input in the soak. Default 600. */
  soakFrames?: number;
  /** p95 frame-time budget in ms. Default 4 for node, 16.7 for browser (D61, D64). */
  budgetMs?: number;
  /** Wall-time limit per check in ms (x3 for the browser). Default 10000. */
  timeoutMs?: number;
  /** Frames a single check may step. Default 18000. */
  maxFrames?: number;
  /** Jobs at once. Default min(4, cores) for node, 2 for browser. */
  concurrency?: number;
  /** Module URL of the house runtime. Default @game-studio-arcade/runtime. */
  runtime?: string;
  /** Module URL of the runtime's dev server (browser driver). Default @game-studio-arcade/runtime/dev-server. */
  runtimeDevServer?: string;
  /** Replace the default host (the runtime dev server + play.html). */
  host?: (cartDir: string) => Promise<HostAdapter>;
  /** Browser driver on a system Chromium over its DevTools pipe instead of Playwright (D310): its path, or true to find one. */
  chromium?: string | true;
  /** With `chromium`: start it under `nice -n N`, so it runs at low priority (D8). */
  nice?: number;
}

export const GENERIC: readonly string[];
export class HarnessError extends Error {}
export function playtest(cartDir: string, opts?: PlaytestOptions): Promise<Report>;
/** The machine-independent part of a report (D62). */
export function comparable(report: Report): Omit<Report, "env" | "frameTime" | "generic" | "glide"> & { generic: Omit<GenericResult, "frame">[]; frameTime: { frames: number; budgetMs: number } };
export function encodePng(frame: { width: number; height: number; pixels: ArrayLike<number> }, palette: readonly string[]): Buffer;
export function soakScript(frames: number, seed: number): Arcade.InputStep[];
export function frameStats(times: number[], budgetMs: number): FrameTime;
export function findPlaywright(): { playwright: any; version: string; from: string };
export function runtimeHost(o: { cartDir: string; runtimeDevServer: string }): Promise<HostAdapter>;
export interface Chromium {
  product: string;
  executable: string;
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<any>;
  on(fn: (m: any) => void): () => boolean;
  close(): Promise<void>;
}
export interface ChromiumPage {
  evaluate(expression: string): Promise<any>;
  goto(url: string, timeoutMs?: number): Promise<void>;
  waitFor(expression: string, timeoutMs?: number): Promise<void>;
  /** The page as it looks now: a PNG, base64 (D383). */
  screenshot(): Promise<string>;
  close(): Promise<void>;
}
/** A system Chromium: GSA_CHROMIUM, then the usual places, or null (D310). */
export function findChromium(): string | null;
export function launchChromium(o?: { executable?: string | null; nice?: number; args?: string[]; startMs?: number }): Promise<Chromium>;
export function openPage(chrome: Chromium, o?: { onException?: (message: string) => void; onRequest?: (url: string) => void }): Promise<ChromiumPage>;
