// How questions and the plan look at the terminal, and how typed answers are read.
// The cabinet renders the same data as tiles; this is the terminal stand-in.

/** @param {{question: string, option_a: string, option_b: string}} q */
export function formatQuestion(q) {
  return [
    `Claude asks: ${q.question}`,
    `  A) ${q.option_a}`,
    `  B) ${q.option_b}`,
    "  C) Something else",
    "  D) Make it now",
  ].join("\n");
}

/**
 * Parse a typed tile choice. Accepts "a", "B", " c " and so on.
 * @param {string} input
 * @returns {"A"|"B"|"C"|"D"|null}
 */
export function parseChoice(input) {
  const c = String(input).trim().toUpperCase();
  return c === "A" || c === "B" || c === "C" || c === "D" ? c : null;
}

/** @param {{summary: string, rules: {id: string, kind: string, text: string}[], changes?: {id: string, text: string}[]}} plan */
export function formatPlan(plan) {
  const lines = ["Here's the plan:", `  ${plan.summary}`, ""];
  if (plan.changes?.length) {
    lines.push("  What changed:");
    for (const c of plan.changes) lines.push(`  ${c.id}. ${c.text}`);
    lines.push("");
  }
  for (const r of plan.rules ?? []) {
    lines.push(`  ${r.id}. ${r.text}${r.kind === "you-check" ? "  (you check)" : ""}`);
  }
  lines.push("", "  A) Build it!", "  B) Change something");
  return lines.join("\n");
}

/**
 * The tool result text for an ask_player answer (HANDOFF §9.1).
 * @param {{choice: string, said?: string}} a
 */
export function questionResult(a) {
  return JSON.stringify(a.choice === "C" ? { choice: "C", said: a.said ?? "" } : { choice: a.choice });
}

/** @param {{choice: string, said?: string}} a */
export function planResult(a) {
  return JSON.stringify(a.choice === "change" ? { choice: "change", said: a.said ?? "" } : { choice: "build" });
}

/** What the name question asks, on the cabinet and at the terminal (D471). */
export const NAME_QUESTION = "What should this version be called?";

/** The name question at the terminal. @param {{option_a: string, option_b: string}} q */
export function formatNameQuestion(q) {
  return [`Claude asks: ${NAME_QUESTION}`, `  A) ${q.option_a}`, `  B) ${q.option_b}`, "  C) Something else", "  D) You pick"].join("\n");
}

/**
 * The tool result text for a name_version answer: the choice, the player's words on C, and the name when the cabinet has one.
 * @param {{choice: string, said?: string | null}} a @param {string | null} name
 */
export function nameResult(a, name) {
  return JSON.stringify({ choice: a.choice, ...(a.choice === "C" ? { said: a.said ?? "" } : {}), ...(name ? { name } : {}) });
}
