// Checks frozen; fix the game (D44). Reads a session's event stream and its
// frozen snapshot, and reports what changed after the first playtest. It logs;
// it never blocks. The agent does most of its editing through bash (heredocs,
// python, sed), so edits are recognised from commands as well as file tools.
import { parseSpec } from "@game-studio-arcade/spec";

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
export function isPlaytestRun(cmd) {
  return /\bnode\b[^\n]*(gsa-playtest|playtest\.js)/.test(cmd) || /(^|[;&|\n]\s*)gsa-playtest\b/.test(cmd);
}

const resultText = (ev) => (Array.isArray(ev.content) ? ev.content.map((b) => b.text ?? "").join("") : String(ev.content ?? ""));

/** The harness's per-rule lines: "  FAIL      R1: reason", "  PASS      R2". */
export function parsePlaytestLines(text) {
  const pass = [];
  const fail = [];
  for (const m of text.matchAll(/^\s*(PASS|FAIL)\s+(R\d+)\b/gm)) (m[1] === "PASS" ? pass : fail).push(m[2]);
  return { pass, fail };
}

/**
 * Split checks.js into its rule checks, by top-level "R1:" keys.
 * @returns {{header: string, rules: Record<string, string>}}
 */
export function splitChecks(source) {
  const keys = [...source.matchAll(/^[ \t]*["']?(R\d+)["']?\s*:/gm)];
  /** @type {Record<string, string>} */
  const rules = {};
  keys.forEach((k, i) => {
    rules[k[1]] = norm(source.slice(k.index, keys[i + 1]?.index ?? source.length));
  });
  return { header: norm(source.slice(0, keys[0]?.index ?? source.length)), rules };
}

const norm = (s) => s.replace(/\s+/g, " ").trim();

/**
 * @param {any[]} events the session's events, in order
 * @param {{frozenChecks: string|null, frozenSpec: string|null, finalChecks: string|null, finalSpec: string|null}} files
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

  const runs = uses.filter(isRun);
  const first = runs[0] ?? null;
  const firstAt = first ? uses.indexOf(first) : -1;
  // Edits in the same command as the first run came before it, so they don't count.
  const after = first ? uses.slice(firstAt + 1) : [];

  const count = (name) => after.filter((u) => writesFile(u, name)).length;
  const editsAfter = { game_js: count("game.js"), checks_js: count("checks.js"), spec_md: count("spec.md") };

  const firstOut = first ? parsePlaytestLines(resultText(results.get(first.id) ?? {})) : null;

  // The snapshot only counts if it was taken before the first playtest.
  const snapshotAt = uses.findIndex((u) => /checks\.frozen\.js/.test(String(u.input?.command ?? u.input?.file_path ?? "")));
  const snapshotOnTime = Boolean(files.frozenChecks) && snapshotAt >= 0 && (firstAt < 0 || snapshotAt <= firstAt);
  const baseline = snapshotOnTime && files.finalChecks != null ? "snapshot" : "none";

  /** Plans shown after the first playtest, with their changes. */
  const plans = after.length ? events.slice(events.indexOf(first)).filter((e) => e.type === "agent.custom_tool_use" && e.name === "show_plan") : [];
  const shownIds = new Set(plans.flatMap((p) => (Array.isArray(p.input?.changes) ? p.input.changes.map((c) => c.id) : [])));

  let rules = [];
  let helpersChanged = false;
  let assumptionsAdded = [];
  if (baseline === "snapshot") {
    const a = splitChecks(/** @type {string} */ (files.frozenChecks));
    const b = splitChecks(/** @type {string} */ (files.finalChecks));
    helpersChanged = a.header !== b.header;
    const ids = [...new Set([...Object.keys(a.rules), ...Object.keys(b.rules)])];
    const changed = ids.filter((id) => a.rules[id] !== b.rules[id]);
    const specA = files.frozenSpec ? parseSpec(files.frozenSpec) : null;
    const specB = files.finalSpec ? parseSpec(files.finalSpec) : null;
    const ruleText = (spec, id) => spec?.rules.find((r) => r.id === id)?.text ?? null;
    const before = new Map((specA?.assumptions ?? []).map((x) => [x.id, x.text]));
    const newOrChanged = (specB?.assumptions ?? []).filter((x) => before.get(x.id) !== x.text);
    assumptionsAdded = newOrChanged.map((x) => x.id);
    rules = changed.map((id) => {
      const haveSpecs = Boolean(specA && specB);
      const ruleTextChanged = haveSpecs && ruleText(specA, id) !== ruleText(specB, id);
      const named = haveSpecs && newOrChanged.some((x) => new RegExp(`\\b${id}\\b`).test(x.text));
      return {
        rule: id,
        spec_changed: ruleTextChanged || named,
        rule_text_changed: ruleTextChanged,
        assumption_names_rule: named,
        shown_in_plan: shownIds.has(id),
      };
    });
  }

  const known = baseline === "snapshot";
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
      assumptions_added: assumptionsAdded,
      unjustified: rules.filter((r) => !r.spec_changed).map((r) => r.rule),
      plans_after_first_playtest: plans.length,
    },
  };
}
