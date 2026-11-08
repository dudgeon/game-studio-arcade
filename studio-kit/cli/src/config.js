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

/** The toolset entry in agents/studio.md's frontmatter; a test keeps the two in step. */
export const STUDIO_TOOLSET = {
  type: "agent_toolset_20260401",
  default_config: { enabled: true, permission_policy: { type: "always_allow" } },
  configs: [
    { name: "web_fetch", enabled: false },
    { name: "web_search", enabled: false },
  ],
};

/**
 * The Studio brief as it stands in the repo, for a session-level override when
 * the applied agent is behind the file (`--brief-from-file`).
 * @param {string} [dir]
 * @returns {{system: string, tools: object[]}}
 */
export function readAgentDef(dir = MANAGED_AGENT_DIR) {
  const md = fs.readFileSync(path.join(dir, "agents/studio.md"), "utf8");
  const m = md.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  if (!m) throw new Error("agents/studio.md has no frontmatter");
  const toolsDir = path.join(dir, "agents/tools");
  const custom = fs.readdirSync(toolsDir).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(fs.readFileSync(path.join(toolsDir, f), "utf8")));
  return { system: m[1].trim(), tools: [STUDIO_TOOLSET, ...custom] };
}

/**
 * The context-pack skill's id and version from its lockfile (D45).
 * @param {string} [lockFile]
 * @returns {{type: "custom", skill_id: string, version?: string}}
 */
export function readSkillLock(lockFile = path.join(MANAGED_AGENT_DIR, "claude-lock.skill.json")) {
  if (!fs.existsSync(lockFile)) throw new Error(`no ${path.relative(REPO_ROOT, lockFile)} yet: stage and apply the context-pack skill first (see studio-kit/managed-agent/README.md)`);
  const lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
  const entry = Object.values(lock.resources ?? {}).find((r) => /** @type {any} */ (r).kind === "skill");
  if (!entry) throw new Error("the skill lockfile has no skill in it");
  const { id, version } = /** @type {any} */ (entry);
  return { type: "custom", skill_id: id, ...(version ? { version: String(version) } : {}) };
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
