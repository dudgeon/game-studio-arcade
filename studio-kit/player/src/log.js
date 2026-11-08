// Append-only JSONL logs, in the same shape as the CLI's (§9.5, D14, D72):
// one file per record type, each line `{ "type": …, … }`.
import fs from "node:fs";
import path from "node:path";

/**
 * @param {string} logsDir
 * @param {"play" | "you_check"} type
 * @param {object} record
 */
export function appendLog(logsDir, type, record) {
  fs.mkdirSync(logsDir, { recursive: true });
  fs.appendFileSync(path.join(logsDir, `${type}.jsonl`), JSON.stringify({ type, ...record }) + "\n");
}

/** @param {string} file @returns {any[]} */
export function readLog(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch {}
  }
  return out;
}
