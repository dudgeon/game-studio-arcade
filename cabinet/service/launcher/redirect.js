// E10 (D270-D275): when screening redirects an idea or a kid's own answer. No scolding,
// no "inappropriate": the closest safe version of their idea, theirs to take, say
// again, or leave. No coins are used. The board is generic; app.js gives each tile
// its job through `onTake`, `onAgain` and `onBack`.
import { COLORS as C } from "../../../runtime/src/palette.js";

export const REDIRECT_ACTIONS = ["redirect-take", "redirect-again", "redirect-back"];

/**
 * @param {{ say?: string, alternative: string, answer?: boolean }} o
 *   answer: it's the kid's words for a question, so the last tile goes back to the question.
 */
export function redirectBoard(o) {
  return {
    screen: "board",
    board: "E10",
    title: "How about this?",
    blocks: [
      { text: o.say || "Let's make it a little different. How about this?", rows: 2, after: 4, onCut: "never" },
      { text: o.alternative, color: C.yellow, rows: 4, after: 4, onCut: "ok" },
      ...(o.answer ? [] : [{ text: "No coins were used.", color: C.lime, rows: 1, onCut: "never" }]),
    ],
    tiles: [
      { text: o.answer ? "Use this one" : "Make this one", hue: C.green },
      { text: "Say it a new way" },
      { text: o.answer ? "Back to the question" : "Back to the shelf" },
    ],
    sel: 0,
  };
}
