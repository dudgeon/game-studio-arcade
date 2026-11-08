// Kid-language progress for built-in tool calls, used between tell_player lines
// so the screen never sits silent. tell_player messages always win.

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
      if (/cart\.tgz|outputs/.test(cmd)) return "Packing up your game";
      return "Putting it together";
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
