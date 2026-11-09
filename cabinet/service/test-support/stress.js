// Strings meant to break the screens (D181), and a whole session made of them.
import fs from "node:fs";
import path from "node:path";

const SENTENCE = "What should happen when the penguin slides all the way across the ice into the big pile of slippery fish while a boot is falling right on top of its head and the timer is nearly out";

export const LONG = {
  empty: "",
  one: "Y",
  sentence: SENTENCE,
  paragraph: Array.from({ length: 6 }, () => SENTENCE).join(". "),
  word: "Supercalifragilisticexpialidocious".repeat(8),
  wide: "W".repeat(600),
  typographic: "“It’s the penguin’s turn” — café naïve Zoë… ¿qué? × → straße",
  emoji: "🐧🐟👢 Penguin 🐧 time 🎉",
  onlyEmoji: "🐧🐟👢",
  lines: "line one\nline two\n\n\n\nline three\ttabbed\r\nline four",
  spaces: `   lots    of     spaces   ${" ".repeat(100)} end   `,
  control: "bell\u0007 null\u0000 escape\u001b[31m red",
  markup: "<b>bold</b> **stars** `code` {json: 1} \\n not a newline",
};

/** A session where Claude sends every long string it might, as a recording has it, so replayApi reads this like any fixture. */
export function stressEvents() {
  const rules = [];
  for (let i = 1; i <= 24; i++) rules.push({ id: `R${i}`, kind: i % 5 === 0 ? "you-check" : "auto", text: i % 3 ? `${SENTENCE} (${i})` : LONG.word });
  const steps = [
    { type: "user.message" },
    { id: "t1", type: "agent.custom_tool_use", name: "tell_player", input: { message: LONG.paragraph, stage: "setup" } },
    { type: "user.custom_tool_result", custom_tool_use_id: "t1" },
    { id: "q1", type: "agent.custom_tool_use", name: "ask_player", input: { question: LONG.paragraph, option_a: LONG.paragraph, option_b: LONG.word } },
    { type: "user.custom_tool_result", custom_tool_use_id: "q1" },
    { id: "q2", type: "agent.custom_tool_use", name: "ask_player", input: { question: LONG.typographic, option_a: LONG.emoji, option_b: LONG.onlyEmoji } },
    { type: "user.custom_tool_result", custom_tool_use_id: "q2" },
    { id: "q3", type: "agent.custom_tool_use", name: "ask_player", input: { question: LONG.word, option_a: LONG.wide, option_b: LONG.lines } },
    { type: "user.custom_tool_result", custom_tool_use_id: "q3" },
    { id: "p1", type: "agent.custom_tool_use", name: "show_plan", input: { summary: LONG.paragraph, rules, changes: [{ id: "R1", text: LONG.paragraph }] } },
    { type: "user.custom_tool_result", custom_tool_use_id: "p1" },
    { id: "t2", type: "agent.custom_tool_use", name: "tell_player", input: { message: LONG.wide, stage: "build" } },
    { type: "user.custom_tool_result", custom_tool_use_id: "t2" },
    { id: "t3", type: "agent.custom_tool_use", name: "tell_player", input: { message: LONG.emoji, stage: "build" } },
    { type: "user.custom_tool_result", custom_tool_use_id: "t3" },
    { id: "u1", type: "session.usage", usage: { list_cost: { amount: "0", currency: "USD" } } },
    { id: "i1", type: "session.status_idle", stop_reason: { type: "end_turn" } },
  ];
  return steps;
}

/**
 * A fixture folder for --replay: stress events, and a cart with a very long title
 * at the 60 characters validate_cart allows, and a very long you-check rule.
 * @param {string} from a fixture with a cart/ @param {string} to
 */
export function writeStressFixture(from, to) {
  fs.mkdirSync(to, { recursive: true });
  fs.writeFileSync(path.join(to, "events.jsonl"), stressEvents().map((e) => JSON.stringify(e)).join("\n") + "\n");
  fs.cpSync(path.join(from, "report.json"), path.join(to, "report.json"));
  fs.cpSync(path.join(from, "cart"), path.join(to, "cart"), { recursive: true });
  const specFile = path.join(to, "cart", "spec.md");
  const spec = fs.readFileSync(specFile, "utf8");
  fs.writeFileSync(specFile, spec.replace(/^(- R\d+ \(you check\): )(.*)$/m, `$1$2 ${LONG.paragraph}`));
  const cartFile = path.join(to, "cart", "cart.json");
  const cart = JSON.parse(fs.readFileSync(cartFile, "utf8"));
  fs.writeFileSync(cartFile, JSON.stringify({ ...cart, id: "stress", title: "Wide ".repeat(12).trim() }, null, 2) + "\n");
  return to;
}
