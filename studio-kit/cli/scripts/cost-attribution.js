#!/usr/bin/env node
// Per-request token and cost attribution of a recorded Studio session, from its
// event stream. Makes no API calls. See docs/cost-penguin-catch.md.
//
//   node studio-kit/cli/scripts/cost-attribution.js <events.jsonl>
//     [--model sonnet|haiku|opus] [--no-expiry] [--drop 16,17,18] [--json]
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * @typedef {{ input: number, write: number, read: number, output: number }} Rate
 * @typedef {{ n: number, start: string, input: number, cacheWrite: number, cacheRead: number,
 *   output: number, tools: string[], thinking: boolean, chars: number }} Request
 * @typedef {Request & { prefix: number, added: number, rewritten: number, returned: number,
 *   readCents: number, writeCents: number, outputCents: number, cents: number,
 *   carryCents: number, ownCents: number }} Row
 * @typedef {{ output: number, returned: number, n?: number }} Step
 */

/**
 * List prices, $ per million tokens, 5-minute cache writes. Checked 2026-11-08 at
 * https://platform.claude.com/docs/en/about-claude/pricing. Check again before relying on them.
 * @type {Record<string, { base: Rate, over100k?: Rate }>}
 */
export const PRICES = {
  sonnet: { base: { input: 2, write: 2.5, read: 0.1, output: 10 } },
  opus: { base: { input: 4, write: 5, read: 0.2, output: 20 } },
  haiku: {
    base: { input: 0.1, write: 0.125, read: 0.01, output: 0.5 },
    over100k: { input: 0.5, write: 0.625, read: 0.05, output: 2.5 },
  },
};
export const RUNTIME_DOLLARS_PER_HOUR = 0.08;

/** @param {number} tokens @param {number} dollarsPerMillion */
const cents = (tokens, dollarsPerMillion) => (tokens * dollarsPerMillion) / 1e4;

/** @param {string} model @param {number} prompt @returns {Rate} */
function rateFor(model, prompt) {
  const p = PRICES[model];
  if (!p) throw new Error(`unknown model ${model}; use ${Object.keys(PRICES).join(", ")}`);
  return p.over100k && prompt > 100_000 ? p.over100k : p.base;
}

/** @param {string} text @returns {any[]} */
export function parseEvents(text) {
  return text.trim().split("\n").map((l) => JSON.parse(l));
}

/** One entry per model request, from its span events. @param {any[]} events @returns {Request[]} */
export function requestsOf(events) {
  /** @type {Request[]} */
  const out = [];
  /** @type {Request | undefined} */
  let cur;
  for (const e of events) {
    if (e.type === "span.model_request_start") {
      cur = { n: out.length + 1, start: e.processed_at ?? "", input: 0, cacheWrite: 0, cacheRead: 0, output: 0, tools: [], thinking: false, chars: 0 };
      out.push(cur);
    } else if (!cur) {
      continue;
    } else if (e.type === "span.model_request_end") {
      const u = e.model_usage;
      cur.input = u.input_tokens;
      cur.cacheWrite = u.cache_creation_input_tokens;
      cur.cacheRead = u.cache_read_input_tokens;
      cur.output = u.output_tokens;
    } else if (e.type === "agent.thinking") {
      cur.thinking = true;
    } else if (e.type === "agent.tool_use" || e.type === "agent.custom_tool_use") {
      cur.tools.push(e.name);
      cur.chars += JSON.stringify(e.input).length;
    } else if (e.type === "agent.message") {
      for (const c of e.content) cur.chars += (c.text ?? "").length;
    }
  }
  return out;
}

/**
 * Split each request's cache write into what's new and what was rewritten after
 * an expiry, and charge every token its own output, write and later re-reads.
 * `carryCents` is priced as if the cache never expired, so the bill is
 * sum(ownCents) + expiryCents + inputCents.
 * Attribution uses one rate per session, so `ownCents` isn't meaningful for a
 * session that crosses Haiku's 100k tier; `cents` and `tokenCents` still are.
 * @param {Request[]} reqs @param {string} [model]
 */
export function attribute(reqs, model = "sonnet") {
  const last = reqs.length - 1;
  /** @type {Row[]} */
  const rows = reqs.map((r, i) => {
    const prev = reqs[i - 1];
    const expected = prev ? prev.cacheRead + prev.cacheWrite : 0;
    const rewritten = Math.max(0, expected - r.cacheRead);
    const prefix = r.cacheRead + r.cacheWrite;
    const rate = rateFor(model, prefix + r.input);
    const readCents = cents(r.cacheRead, rate.read);
    const writeCents = cents(r.cacheWrite, rate.write);
    const outputCents = cents(r.output, rate.output);
    return {
      ...r, prefix, rewritten, added: r.cacheWrite - rewritten, returned: 0, readCents, writeCents, outputCents,
      cents: cents(r.input, rate.input) + readCents + writeCents + outputCents, carryCents: 0, ownCents: 0,
    };
  });
  // Tokens added at request k were written there and re-read by every later request.
  const rate = rateFor(model, 0);
  const carry = (/** @type {number} */ k) => rate.write + rate.read * (last - k);
  rows.forEach((r, i) => {
    const next = rows[i + 1];
    r.returned = next ? next.added - r.output : 0;
    r.carryCents = (next ? cents(r.output, carry(i + 1)) + cents(r.returned, carry(i + 1)) : 0);
    r.ownCents = r.outputCents + r.carryCents;
  });
  const startTokens = rows[0]?.added ?? 0;
  return {
    rows,
    start: { tokens: startTokens, cents: cents(startTokens, carry(0)) },
    expiryCents: rows.reduce((s, r) => s + cents(r.rewritten, rate.write - rate.read), 0),
    inputCents: rows.reduce((s, r) => s + cents(r.input, rate.input), 0),
    tokenCents: rows.reduce((s, r) => s + r.cents, 0),
    finalPrefix: rows.length ? rows[last].prefix : 0,
  };
}

/** Billing lines for the whole session. @param {Request[]} reqs @param {string} [model] */
export function bill(reqs, model = "sonnet") {
  const a = attribute(reqs, model);
  const sum = (/** @type {(r: Row) => number} */ f) => a.rows.reduce((s, r) => s + f(r), 0);
  return {
    tokens: { input: sum((r) => r.input), output: sum((r) => r.output), write: sum((r) => r.cacheWrite), read: sum((r) => r.cacheRead) },
    cents: { input: a.inputCents, output: sum((r) => r.outputCents), write: sum((r) => r.writeCents), read: sum((r) => r.readCents) },
    tokenCents: a.tokenCents,
  };
}

/** The last active_seconds the stream reported. @param {any[]} events */
export function activeSeconds(events) {
  let s = 0;
  for (const e of events) if (e.type === "session.usage") s = e.usage.active_seconds;
  return s;
}

/** @param {number} seconds */
export const runtimeCents = (seconds) => (seconds / 3600) * RUNTIME_DOLLARS_PER_HOUR * 100;

/** @param {Row[]} rows @returns {Step[]} */
export const stepsOf = (rows) => rows.map((r) => ({ n: r.n, output: r.output, returned: r.returned }));

/**
 * What a session of these steps would cost in tokens: for what-ifs. Each step is one
 * request; `expiryAt` is the index of a step whose request misses the whole cache.
 * @param {Step[]} steps @param {{ start: number, model?: string, expiryAt?: number | null }} o
 */
export function simulate(steps, o) {
  const model = o.model ?? "sonnet";
  let prefix = o.start;
  let added = o.start;
  let total = 0;
  let peak = 0;
  steps.forEach((s, i) => {
    const rate = rateFor(model, prefix);
    total += i === o.expiryAt ? cents(prefix, rate.write) : cents(added, rate.write) + cents(prefix - added, rate.read);
    total += cents(s.output, rate.output) + cents(2, rate.input); // about 2 uncached tokens a request
    peak = Math.max(peak, prefix);
    added = s.output + s.returned;
    prefix += added;
  });
  return { cents: total, peak };
}

/**
 * Thinking tokens, estimated: events hide its content, so subtract the visible
 * output at 2.3-2.6 characters a token plus 50 for the call itself.
 * @param {Request[]} reqs
 */
export function thinkingRange(reqs) {
  const at = (/** @type {number} */ d) => reqs.reduce((s, r) => (r.thinking ? s + Math.max(0, r.output - (r.chars / d + 50)) : s), 0);
  return { low: Math.round(at(2.3)), high: Math.round(at(2.6)) };
}

/** @param {number} n */
const fmt = (n) => n.toFixed(2);

/** @param {string[]} argv */
function main(argv) {
  const file = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--model" && argv[i - 1] !== "--drop");
  if (!file) {
    console.error("usage: cost-attribution.js <events.jsonl> [--model sonnet|haiku|opus] [--no-expiry] [--drop 16,17,18] [--json]");
    return 2;
  }
  const flag = (/** @type {string} */ name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const model = flag("--model") ?? "sonnet";
  const events = parseEvents(fs.readFileSync(file, "utf8"));
  const reqs = requestsOf(events);
  const a = attribute(reqs, model);
  const b = bill(reqs, model);
  const runtime = runtimeCents(activeSeconds(events));

  const dropped = (flag("--drop") ?? "").split(",").filter(Boolean).map(Number);
  const noExpiry = argv.includes("--no-expiry");
  if (dropped.length || noExpiry || model !== "sonnet") {
    const steps = stepsOf(a.rows).filter((s) => !dropped.includes(s.n ?? 0));
    const missed = a.rows.find((r) => r.rewritten > 0)?.n;
    const expiryAt = noExpiry ? null : steps.findIndex((s) => s.n === missed);
    const what = simulate(steps, { start: a.start.tokens, model, expiryAt: expiryAt === -1 ? null : expiryAt });
    if (argv.includes("--json")) console.log(JSON.stringify({ model, cents: what.cents + runtime, peak: what.peak }));
    else console.log(`what-if (${model}, dropped [${dropped}], ${noExpiry ? "no expiry" : "expiry as recorded"}): ${fmt(what.cents + runtime)}c including ${fmt(runtime)}c runtime; peak prefix ${what.peak}`);
    return 0;
  }

  if (argv.includes("--json")) {
    console.log(JSON.stringify({ ...a, bill: b, runtimeCents: runtime, totalCents: b.tokenCents + runtime, thinking: thinkingRange(reqs) }));
    return 0;
  }
  console.log("  # prefix written re-read output returned rewrit    c own+carry tools");
  for (const r of a.rows) {
    console.log(
      [String(r.n).padStart(3), String(r.prefix).padStart(6), String(r.cacheWrite).padStart(7), String(r.cacheRead).padStart(7), String(r.output).padStart(6), String(r.returned).padStart(8),
        String(r.rewritten).padStart(6), fmt(r.cents).padStart(5), fmt(r.ownCents).padStart(9), `${r.thinking ? "[thinks] " : ""}${r.tools.join(",")}`].join(" "),
    );
  }
  console.log(`\nfixed start ${a.start.tokens} tokens, ${fmt(a.start.cents)}c; final prefix ${a.finalPrefix}`);
  console.log(`cache expiry premium ${fmt(a.expiryCents)}c`);
  console.log(`thinking (estimated) ${thinkingRange(reqs).low}-${thinkingRange(reqs).high} of ${b.tokens.output} output tokens`);
  console.log(`output ${fmt(b.cents.output)}c, writes ${fmt(b.cents.write)}c, reads ${fmt(b.cents.read)}c, input ${fmt(b.cents.input)}c, runtime ${fmt(runtime)}c`);
  console.log(`TOTAL ${fmt(b.tokenCents + runtime)}c`);
  return 0;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
