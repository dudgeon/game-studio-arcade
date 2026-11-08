// Checks frozen; fix the game (D44). Reads a session's event stream and its
// frozen snapshot, and reports what changed after the first playtest. It logs;
// it never blocks. The agent does most of its editing through bash (heredocs,
// python, sed), so edits are recognised from commands as well as file tools.
import { parseSpec } from "@game-studio-arcade/spec";
import { narrowingSignals } from "./narrowing.js";

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Does this bash command write to the file? `name` is a bare filename. Reading
 * it, or copying it somewhere else (the snapshot), doesn't count.
 * @param {string} cmd
 * @param {string} name
 */
export function bashWrites(cmd, name) {
  const f = escape(name);
  // The cart's file itself: not a sibling like checks.frozen.js, and not the copy in outputs.
  const file = `(?!/mnt/session/outputs/)[^\\s'"=;|&>]*(?<![\\w.-])${f}(?![\\w.-])`;
  const patterns = [
    new RegExp(`sed\\s+(-\\S+\\s+)*-i[^\\n]*\\s['"]?${file}`), // sed -i '...' checks.js
    new RegExp(`perl\\s+-\\S*i[^\\n]*\\s['"]?${file}`),
    new RegExp(`>>?\\s*['"]?${file}`), // cat > checks.js, >> checks.js
    new RegExp(`\\btee\\b[^\\n]*\\s['"]?${file}`),
    new RegExp(`\\b(cp|mv)\\s+[^\\n;&|]*\\s['"]?${file}['"]?\\s*($|[;&|\\n])`, "m"), // cp x checks.js
    new RegExp(`open\\(\\s*['"]${file}['"]\\s*,\\s*['"][wa]`), // python open('checks.js','w')
    new RegExp(`writeFile(Sync)?\\(\\s*['"\`]${file}['"\`]`), // node fs.writeFileSync('checks.js', …)
  ];
  if (patterns.some((re) => re.test(cmd))) return true;
  // p = '/workspace/cart/checks.js'; open(p, 'w')
  for (const m of cmd.matchAll(new RegExp(`(\\w+)\\s*=\\s*['"]${file}['"]`, "g"))) {
    const v = escape(m[1]);
    if (new RegExp(`open\\(\\s*${v}\\s*,\\s*['"][wa]|writeFile(Sync)?\\(\\s*${v}\\b`).test(cmd)) return true;
  }
  return false;
}

/** @param {any} ev an agent.tool_use event */
function writesFile(ev, name) {
  const i = ev.input ?? {};
  if (ev.name === "write" || ev.name === "edit") return String(i.file_path ?? i.path ?? "").split("/").pop() === name;
  return ev.name === "bash" && bashWrites(String(i.command ?? ""), name);
}

/** Is this bash command running the playtest (not reading about it)? */
export const SNAPSHOT_NAMES = ["checks.frozen.js", "spec.frozen.md"];

export function isPlaytestRun(cmd) {
  return /\bnode\b[^\n]*(gsa-playtest|playtest\.js)/.test(cmd) || /(^|[;&|\n]\s*)gsa-playtest\b/.test(cmd);
}

const resultText = (ev) => (Array.isArray(ev.content) ? ev.content.map((b) => b.text ?? "").join("") : String(ev.content ?? ""));

/**
 * Per-rule results in a command's output: the harness's "  FAIL      R1: reason",
 * or an agent's own summary of --json, such as "R1 pass" or "R1: fail".
 */
export function parsePlaytestLines(text) {
  const pass = [];
  const fail = [];
  for (const m of text.matchAll(/^\s*(PASS|FAIL)\s+(R\d+)\b/gm)) (m[1] === "PASS" ? pass : fail).push(m[2]);
  for (const m of text.matchAll(/^\s*(R\d+):?\s+(pass|fail|missing)\b/gm)) (m[2] === "pass" ? pass : fail).push(m[1]);
  return { pass, fail };
}

/**
 * Split checks.js into its rule checks, by top-level "R1:" keys.
 * @returns {{header: string, rules: Record<string, string>}}
 */
export function splitChecks(source) {
  // R1: async (t) => {}, "R1": …, or the method form async R1(t) {}.
  const keys = [...source.matchAll(/^[ \t]*(?:async[ \t]+)?["']?(R\d+)["']?\s*(?::|\()/gm)];
  /** @type {Record<string, string>} */
  const rules = {};
  keys.forEach((k, i) => {
    rules[k[1]] = norm(source.slice(k.index, keys[i + 1]?.index ?? source.length));
  });
  return { header: norm(source.slice(0, keys[0]?.index ?? source.length)), rules };
}

/** Compare code, not comments: a type annotation or a note isn't a changed check. */
/** Compare quotes ignoring case and spacing. */
const squash = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();

const norm = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ").replace(/\s+/g, " ").trim();

/**
 * @param {any[]} events the session's events, in order
 * @param {{frozenChecks: string|null, frozenSpec: string|null, finalChecks: string|null, finalSpec: string|null, capturedChecks?: string|null, capturedSpec?: string|null, declared?: any[]|null}} files
 */
export function analyzeFreeze(events, files) {
  const uses = events.filter((e) => e.type === "agent.tool_use");
  const results = new Map(events.filter((e) => e.type === "agent.tool_result").map((e) => [e.tool_use_id, e]));
  const isRun = (u) => {
    if (u.name !== "bash") return false;
    if (isPlaytestRun(String(u.input?.command ?? ""))) return true;
    const out = parsePlaytestLines(resultText(results.get(u.id) ?? {}));
    return out.pass.length + out.fail.length > 0;
  };

  const linesOf = (u) => parsePlaytestLines(resultText(results.get(u.id) ?? {}));
  const reported = (u) => {
    const l = linesOf(u);
    return l.pass.length + l.fail.length > 0;
  };
  const started = uses.filter(isRun);
  // A chain like `validate-cart && gsa-playtest` that stopped at validate never played
  // anything, so the first run is the first with results; failing that, the first attempt.
  const runs = started.some(reported) ? started.filter(reported) : started;
  const first = runs[0] ?? null;
  const firstAt = first ? uses.indexOf(first) : -1;
  // Edits in the same command as the first run came before it, so they don't count.
  const after = first ? uses.slice(firstAt + 1) : [];

  const count = (name) => after.filter((u) => writesFile(u, name)).length;
  const editsAfter = { game_js: count("game.js"), checks_js: count("checks.js"), spec_md: count("spec.md") };

  const firstOut = first ? parsePlaytestLines(resultText(results.get(first.id) ?? {})) : null;

  // Best baseline: what the CLI fetched itself when the first playtest began, which
  // later writes can't touch. Failing that, the snapshot in outputs, if it was taken
  // before the first playtest and never written again.
  const snapshotAt = uses.findIndex((u) => /checks\.frozen\.js/.test(String(u.input?.command ?? u.input?.file_path ?? "")));
  const snapshotOnTime = Boolean(files.frozenChecks) && snapshotAt >= 0 && (firstAt < 0 || snapshotAt <= firstAt);
  const snapshotOverwritten = after.some((u) => writesFile(u, "checks.frozen.js"));
  const captured = Boolean(files.capturedChecks);
  const baseline = files.finalChecks == null ? "none" : captured ? "captured" : snapshotOnTime && !snapshotOverwritten ? "snapshot" : "none";
  const baseChecks = captured ? files.capturedChecks : files.frozenChecks;
  const baseSpec = captured ? (files.capturedSpec ?? files.frozenSpec) : files.frozenSpec;

  /** Plans shown after the first playtest, with their changes. */
  const plans = after.length ? events.slice(events.indexOf(first)).filter((e) => e.type === "agent.custom_tool_use" && e.name === "show_plan") : [];
  const shownIds = new Set(plans.flatMap((p) => (Array.isArray(p.input?.changes) ? p.input.changes.map((c) => c.id) : [])));

  let rules = [];
  let helpersChanged = false;
  let helpersNarrowed = false;
  let assumptionsAdded = [];
  const known = baseline !== "none";
  if (known) {
    const a = splitChecks(/** @type {string} */ (baseChecks));
    const b = splitChecks(/** @type {string} */ (files.finalChecks));
    helpersChanged = a.header !== b.header;
    helpersNarrowed = narrowingSignals(a.header, b.header).narrowed;
    const ids = [...new Set([...Object.keys(a.rules), ...Object.keys(b.rules)])];
    const changed = ids.filter((id) => a.rules[id] !== b.rules[id]);
    const specA = baseSpec ? parseSpec(baseSpec) : null;
    const specB = files.finalSpec ? parseSpec(files.finalSpec) : null;
    const ruleText = (spec, id) => spec?.rules.find((r) => r.id === id)?.text ?? null;
    const before = new Map((specA?.assumptions ?? []).map((x) => [x.id, x.text]));
    const newOrChanged = (specB?.assumptions ?? []).filter((x) => before.get(x.id) !== x.text);
    assumptionsAdded = newOrChanged.map((x) => x.id);
    rules = changed.map((id) => {
      const haveSpecs = Boolean(specA && specB);
      const ruleTextChanged = haveSpecs && ruleText(specA, id) !== ruleText(specB, id);
      const named = haveSpecs && newOrChanged.some((x) => new RegExp(`\\b${id}\\b`).test(x.text));
      const specChanged = ruleTextChanged || named;
      // D46: the quote must really be in the rule's text, not a paraphrase.
      const said = (files.declared ?? []).find((c) => c?.rule === id) ?? null;
      const quote = typeof said?.quote === "string" ? said.quote : null;
      const inSpec = (text) => Boolean(quote && text && squash(text).includes(squash(quote)));
      const quoteMatches = inSpec(ruleText(specB ?? specA, id));
      // D49: a check that tests less must say which of the rule's words it lost.
      const sig = narrowingSignals(a.rules[id] ?? "", b.rules[id] ?? "");
      const listed = Array.isArray(said?.untested) ? said.untested.filter((u) => typeof u?.words === "string") : [];
      const inRule = (u) => {
        const text = ruleText(specB ?? specA, id);
        return Boolean(text && squash(text).includes(squash(u.words)));
      };
      const untested = listed.filter(inRule);
      const narrowed = !specChanged && (sig.narrowed || listed.length > 0);
      const untestedMissing = narrowed && untested.length === 0;
      const classification = specChanged ? "rule_change" : said?.kind === "check_bug" && quoteMatches && !untestedMissing ? "check_bug" : "unexplained";
      return {
        rule: id,
        classification,
        spec_changed: specChanged,
        rule_text_changed: ruleTextChanged,
        assumption_names_rule: named,
        shown_in_plan: shownIds.has(id),
        declared: said?.kind ?? null,
        quote,
        quote_matches_rule: quoteMatches,
        what: typeof said?.what === "string" ? said.what : null,
        rule_text: ruleText(specB ?? specA, id),
        narrowed,
        signals: { dropped_points: sig.dropped_points, assertions: sig.assertions, any_seed: sig.any_seed },
        untested,
        untested_invalid: listed.filter((u) => !inRule(u)).map((u) => u.words),
        untested_missing: untestedMissing,
      };
    });
  }

  return {
    first_playtest: first ? { tool_use: first.id, pass: firstOut?.pass ?? [], fail: firstOut?.fail ?? [] } : null,
    playtest_runs: runs.length,
    edits_after_first_playtest: editsAfter,
    checks_changed_after_playtest: {
      changed: known ? rules.length > 0 || helpersChanged : editsAfter.checks_js > 0,
      edit_events: editsAfter.checks_js,
      baseline,
      rules_known: known,
      rules,
      helpers_changed: helpersChanged,
      // Shared helpers belong to no one rule, so any spec change or declared change covers them.
      helpers_unjustified: helpersChanged && assumptionsAdded.length === 0 && !rules.some((r) => r.rule_text_changed) && !(files.declared ?? []).length,
      plan_changes: [...shownIds],
      snapshot_overwritten: snapshotOverwritten,
      assumptions_added: assumptionsAdded,
      helpers_narrowed: helpersNarrowed,
      narrowed: rules.filter((r) => r.narrowed).map((r) => r.rule),
      check_bugs: rules.filter((r) => r.classification === "check_bug").map((r) => r.rule),
      rule_changes: rules.filter((r) => r.classification === "rule_change").map((r) => r.rule),
      unjustified: rules.filter((r) => r.classification === "unexplained").map((r) => r.rule),
      plans_after_first_playtest: plans.length,
    },
  };
}
