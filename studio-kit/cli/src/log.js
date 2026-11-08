// Append-only JSONL logs (§9.5, D14). One file per record type.
import fs from "node:fs";
import path from "node:path";

/**
 * @param {string} logsDir
 * @param {"studio_session"|"cart_version"} type
 * @param {object} record
 */
export function appendLog(logsDir, type, record) {
  fs.mkdirSync(logsDir, { recursive: true });
  fs.appendFileSync(path.join(logsDir, `${type}.jsonl`), JSON.stringify({ type, ...record }) + "\n");
}

/** @param {string} file */
export function readLog(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/** Spec diff for a brand-new cart: every line added. Forks will diff against the parent. */
export function newSpecDiff(specText) {
  if (specText == null) return null;
  const lines = String(specText).replace(/\n$/, "").split("\n");
  return [`--- /dev/null`, `+++ spec.md`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n");
}
