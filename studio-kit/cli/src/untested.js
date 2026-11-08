// D49: what a test can't prove, the kid checks. A rule whose check now tests less
// gets a new `(you check)` rule in the cart's spec. That's the whole hand-off: the
// local player and the cabinet ask a spec's you-check rules on first play, answers
// log by rule id, and forks inherit the spec.
import { parseSpec } from "@game-studio-arcade/spec";

const oneLine = (s) => String(s).replace(/\s+/g, " ").trim();

/**
 * The questions to add, from the analysed rules. A rule that lost words without
 * saying which gets asked whole.
 * @param {any[]} rules checks_changed_after_playtest.rules
 * @returns {{from: string, words: string|null, text: string}[]}
 */
export function questionsFor(rules) {
  const out = [];
  for (const r of rules) {
    if (!r.narrowed) continue;
    if (r.untested?.length) {
      for (const u of r.untested) {
        out.push({ from: r.rule, words: u.words, text: oneLine(u.question || `Play and check this, because the test can't: "${u.words}"`) });
      }
    } else {
      out.push({ from: r.rule, words: null, text: oneLine(`The test for this changed and may not prove all of it, so play and check: ${r.rule_text ?? r.rule}`) });
    }
  }
  return out;
}

/** Insert lines at the end of a `## heading` section, before its trailing blank lines. */
function appendToSection(lines, heading, added) {
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start < 0) return false;
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end < 0) end = lines.length;
  let at = end;
  while (at > start + 1 && lines[at - 1].trim() === "") at--;
  lines.splice(at, 0, ...added);
  return true;
}

/**
 * Add the questions to spec.md as new you-check rules, with a Changelog line. Rule
 * ids continue from the highest there is (D30: never reused).
 * @param {string} specText
 * @param {{from: string, words: string|null, text: string}[]} questions
 * @returns {{text: string, added: {rule: string, from: string, words: string|null, text: string}[]}}
 */
export function addYouCheckRules(specText, questions) {
  if (!questions.length) return { text: specText, added: [] };
  const spec = parseSpec(specText);
  let n = Math.max(0, ...spec.rules.map((r) => r.n));
  const added = questions.map((q) => ({ rule: `R${++n}`, ...q }));
  const lines = specText.split("\n");
  if (!appendToSection(lines, "Rules", added.map((a) => `- ${a.rule} (you check): ${a.text}`))) return { text: specText, added: [] };
  const v = Math.max(0, ...spec.changelog.map((c) => c.n)) + 1;
  const from = [...new Set(added.map((a) => a.from))].join(", ");
  appendToSection(lines, "Changelog", [`- v${v}: The tests for ${from} no longer prove all of the rule, so ${added.map((a) => a.rule).join(", ")} ask the player to check it on first play.`]);
  const text = lines.join("\n");
  // Never hand on a spec this made worse.
  if (parseSpec(text).errors.length > spec.errors.length) return { text: specText, added: [] };
  return { text, added };
}
