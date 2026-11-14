// Append-only JSONL logs, in the same shape as the CLI's (§9.5, D14, D72):
// one file per record type, each line `{ "type": …, … }`.
import fs from "node:fs";
import path from "node:path";

/**
 * Append one line and flush it, starting a fresh line if a power cut left the file ending mid-line, so the new
 * line is never glued to a torn one (D371; the cabinet service's durable.js does the same).
 * @param {string} file @param {string} line
 */
function appendLine(file, line) {
  const fd = fs.openSync(file, "a+");
  try {
    const size = fs.fstatSync(fd).size;
    let lead = "";
    if (size > 0) {
      const last = Buffer.alloc(1);
      fs.readSync(fd, last, 0, 1, size - 1);
      if (last[0] !== 0x0a) lead = "\n";
    }
    fs.writeSync(fd, `${lead}${line}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * @param {string} logsDir
 * @param {"play" | "you_check"} type
 * @param {object} record
 */
export function appendLog(logsDir, type, record) {
  fs.mkdirSync(logsDir, { recursive: true });
  appendLine(path.join(logsDir, `${type}.jsonl`), JSON.stringify({ type, ...record }));
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
