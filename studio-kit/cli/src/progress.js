// Kid-language progress for built-in tool calls, used between tell_player lines
// so the screen never sits silent. tell_player messages always win.
// Progress only moves forward (D198): every line has a stage, and the gate drops
// a line from an earlier stage or one already shown.

/** Where a build is, in order. Fixing is part of testing. */
export const STAGES = { setup: 0, questions: 0, spec: 1, building: 2, testing: 3, fixing: 3, packing: 4 };

/** The stage of each line progressFor gives, and the driver's first line. */
export const LINE_STAGE = {
  "Reading your idea": 0,
  "Getting my tools out": 0,
  "Reading up": 0,
  "Writing down the rules": 1,
  "Writing the tests": 1,
  "Writing the game": 2,
  "Fixing the game": 2,
  "Drawing pictures": 2,
  Writing: 2,
  "Checking your game": 3,
  "Playing your game to test it": 3,
  "Packing up your game": 4,
};

/**
 * A line's stage from a tell_player stage. "done" isn't shown: it says "ready"
 * before the cabinet has checked the game (D198). Unknown: shown without moving on.
 * @param {unknown} stage
 * @returns {number | null | "hide"}
 */
export function tellStage(stage) {
  if (stage === "done") return "hide";
  return typeof stage === "string" && stage in STAGES ? STAGES[/** @type {keyof typeof STAGES} */ (stage)] : null;
}

/**
 * Lets a line through only if its stage is the latest or later, and its words
 * haven't been shown before. A line with no stage doesn't move the stage.
 */
export function progressGate() {
  let at = -1;
  const shown = new Set();
  /** @param {string | null | undefined} text @param {number | null | "hide" | undefined} stage @returns {string | null} */
  return (text, stage) => {
    if (!text || stage === "hide" || shown.has(text)) return null;
    if (typeof stage === "number") {
      if (stage < at) return null;
      at = stage;
    }
    shown.add(text);
    return text;
  };
}

/**
 * @param {{name?: string, input?: any}} ev  an agent.tool_use event
 * @returns {string|null}
 */
export function progressFor(ev) {
  const input = ev.input ?? {};
  const file = String(input.file_path ?? input.path ?? "");
  const cmd = String(input.command ?? "");
  switch (ev.name) {
    case "bash":
      if (/studio-kit\.tgz/.test(cmd)) return "Getting my tools out";
      // Match the commands, not a README that mentions them.
      if (/gsa-playtest|playtest\.js/.test(cmd)) return "Playing your game to test it";
      if (/validate-cart/.test(cmd)) return "Checking your game";
      if (/^\s*(cd [^;&]+[;&]+\s*)?(cat|ls|head|less)\b/.test(cmd)) return "Reading up";
      // Packing is making the outputs at the end, not copying the spec there before the build.
      if (/cart\.tgz|DONE\.json/.test(cmd)) return "Packing up your game";
      return null; // a command that says nothing a kid would follow (D198)
    case "write":
    case "edit":
      if (file.endsWith("spec.md")) return "Writing down the rules";
      if (file.endsWith("checks.js")) return "Writing the tests";
      if (file.endsWith("game.js")) return ev.name === "edit" ? "Fixing the game" : "Writing the game";
      if (/assets\//.test(file)) return "Drawing pictures";
      return "Writing";
    case "read":
    case "glob":
    case "grep":
      return "Reading up";
    default:
      return null;
  }
}
