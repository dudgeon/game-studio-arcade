// Redo the D44 analysis from a session's kept files. Logs are append-only, so a
// better analysis of an old session goes in as a correction, never as an edit.
import fs from "node:fs";
import path from "node:path";
import { analyzeFreeze } from "./freeze.js";
import { appendLog } from "./log.js";

const textOrNull = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);

/**
 * @param {{paths: ReturnType<typeof import("./config.js").dataPaths>, session: string, why: string}} o
 */
export function reanalyzeSession(o) {
  const dir = path.join(o.paths.sessions, o.session);
  if (!fs.existsSync(dir)) throw new Error(`no session folder for ${o.session}`);
  const events = fs.readFileSync(path.join(dir, "events.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const fixed = analyzeFreeze(events, {
    frozenChecks: textOrNull(path.join(dir, "outputs/checks.frozen.js")),
    frozenSpec: textOrNull(path.join(dir, "outputs/spec.frozen.md")),
    finalChecks: textOrNull(path.join(dir, "cart/checks.js")),
    finalSpec: textOrNull(path.join(dir, "cart/spec.md")),
    capturedChecks: textOrNull(path.join(dir, "frozen/checks.frozen.js")),
    capturedSpec: textOrNull(path.join(dir, "frozen/spec.frozen.md")),
  });
  appendLog(o.paths.logs, "studio_session_correction", { corrects: o.session, why: o.why, ...fixed });
  return fixed;
}
