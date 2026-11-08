import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "../../..");
export const MANAGED_AGENT_DIR = path.join(REPO_ROOT, "studio-kit/managed-agent");

/** Data lives outside the repo (D14). */
export function dataDir(env = process.env) {
  return env.GSA_DATA_DIR || path.join(os.homedir(), "game-studio-data");
}

export function dataPaths(root) {
  return {
    root,
    carts: path.join(root, "carts"),
    logs: path.join(root, "logs"),
    sessions: path.join(root, "sessions"),
    kitUploads: path.join(root, "kit-uploads.json"),
  };
}

/**
 * Read the Studio agent and environment ids from the committed claude-lock.json.
 * @param {string} [lockFile]
 * @returns {{agentId: string, agentVersion?: number, environmentId: string}}
 */
export function readLock(lockFile = path.join(MANAGED_AGENT_DIR, "claude-lock.json")) {
  if (!fs.existsSync(lockFile)) {
    throw new Error(`no ${path.relative(REPO_ROOT, lockFile)} yet: run \`ant apply .\` in studio-kit/managed-agent first`);
  }
  const lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
  const res = lock.resources ?? {};
  const agent = res["./agents/studio.md"];
  const env = res["./environments/studio.yaml"];
  if (!agent?.id || !env?.id) throw new Error("claude-lock.json has no entry for agents/studio.md or environments/studio.yaml");
  const v = Number(agent.version);
  return { agentId: agent.id, agentVersion: Number.isInteger(v) && v > 0 ? v : undefined, environmentId: env.id };
}
