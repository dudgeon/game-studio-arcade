// Append-only JSONL logs (§9.5, D14). One file per record type.
import fs from "node:fs";
import path from "node:path";

import { appendLineDurable as appendLine } from "./durable.js";

/**
 * @param {string} logsDir
 * @param {"studio_session"|"studio_session_correction"|"cart_version"|"publish_gate"} type
 * @param {object} record
 */
export function appendLog(logsDir, type, record) {
  fs.mkdirSync(logsDir, { recursive: true });
  appendLine(path.join(logsDir, `${type}.jsonl`), JSON.stringify({ type, ...record }));
}

/** @param {string} file */
export function readLog(file) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // A torn line from a power cut: skipped, never rewritten (D5, D337a).
    }
  }
  return out;
}

/** Spec diff for a brand-new cart: every line added. Forks will diff against the parent. */
export function newSpecDiff(specText) {
  if (specText == null) return null;
  const lines = String(specText).replace(/\n$/, "").split("\n");
  return [`--- /dev/null`, `+++ spec.md`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n");
}
