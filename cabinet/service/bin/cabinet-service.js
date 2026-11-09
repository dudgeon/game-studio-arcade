#!/usr/bin/env node
// The cabinet service, first slice (D183). See ../README.md.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { dataDir, dataPaths, MANAGED_AGENT_DIR } from "@game-studio-arcade/studio-cli/src/config.js";
import { defaultChecker } from "@game-studio-arcade/studio-cli/src/checks.js";
import { readCart } from "@game-studio-arcade/player/src/library.js";
import { makersStore } from "../src/makers.js";
import { stubSpeech } from "../src/speech.js";
import { createStudio, QUESTION_TIMEOUT_MS } from "../src/studio.js";
import { startService } from "../src/server.js";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "8330" },
    host: { type: "string", default: "127.0.0.1" },
    data: { type: "string" },
    config: { type: "string" },
    replay: { type: "string" },
    pace: { type: "string", default: "150" },
    "question-timeout": { type: "string" },
    examples: { type: "boolean", default: false },
  },
});

const paths = dataPaths(values.data ?? dataDir());
const replaying = Boolean(values.replay);
if (!replaying && !values.config) {
  console.error("cabinet-service: --config FILE (the cabinet's config, 0600, D131), or --replay DIR to spend nothing (D186)");
  process.exit(2);
}
/** @type {any} */
let config = {};
/** @type {import("@anthropic-ai/sdk").default | null} */
let client = null;
if (values.config) {
  // First, before anything else reads the file: this checks its mode, and its errors
  // never quote it. A cabinet that can't sign in says so at start, not at a kid's first make.
  const { createCabinetClient } = await import("@game-studio-arcade/auth");
  try {
    client = createCabinetClient({ configFile: values.config });
  } catch (/** @type {any} */ e) {
    console.error(`cabinet-service: ${e.message}`);
    process.exit(1);
  }
  config = JSON.parse(fs.readFileSync(values.config, "utf8"));
  // A workspace-scoped key can't reach the mini's claude-lock.json resources (D185).
  if (!replaying && (!config.agent_id || !config.environment_id)) {
    console.error("cabinet-service: the cabinet config needs agent_id and environment_id, from ant apply in the cabinet's workspace (D185)");
    process.exit(1);
  }
}

const makers = makersStore({ file: path.join(paths.root, "makers.json") });
const speech = stubSpeech(); // D184: real speech is Phase 3.

/** @type {any} */
let api = null;
const studio = createStudio({
  paths,
  budgetCents: config.budget_cents ?? 300,
  // Seconds a question or plan waits with no key pressed (D188).
  questionTimeoutMs: Number(values["question-timeout"] ?? config.question_timeout_s ?? QUESTION_TIMEOUT_MS / 1000) * 1000,
  model: config.model,
  checker: defaultChecker(),
  nameOf: (id) => makers.get(id)?.name ?? id,
  titleOf: (id) => readCart(paths.carts, id)?.title ?? null,
  onStart: (id) => makers.touch(id),
  recheckMs: config.recheck_s ? config.recheck_s * 1000 : undefined,
  api: async (resume) => {
    if (replaying) {
      // A fresh replay for each make; one picked up after a restart starts part way through (D191).
      const { replayApi } = await import("../test-support/replay-api.js");
      return replayApi({ dir: path.resolve(/** @type {string} */ (values.replay)), paceMs: Number(values.pace), resume }).api;
    }
    if (!api) {
      const { sdkApi } = await import("@game-studio-arcade/studio-cli/src/api.js");
      api = sdkApi(client);
    }
    return api;
  },
  lock: () => {
    if (replaying) return { agentId: "agent_replay", agentVersion: 1, environmentId: "env_replay" };
    return { agentId: config.agent_id, agentVersion: config.agent_version, environmentId: config.environment_id };
  },
  kit: async (client) => {
    if (replaying) return { fileId: "file_replay_kit", hash: "replay" };
    const { ensureKitUploaded } = await import("@game-studio-arcade/studio-cli/src/kit.js");
    return ensureKitUploaded({ api: client, cacheFile: paths.kitUploads, out: path.join(paths.root, "kit", "studio-kit.tgz") });
  },
});

const s = await startService({
  studio,
  makers,
  speech,
  libraryDir: paths.carts,
  logsDir: paths.logs,
  players: config.players,
  consoleName: config.console_name,
  examples: values.examples,
  port: Number(values.port),
  host: values.host,
});
console.log(`cabinet service on ${s.url}, data in ${paths.root}`);
console.log(replaying ? `REPLAYING ${values.replay}: no API calls, nothing spent (D186)` : `Managed Agents, with the key in ${values.config} (D131)`);
console.log(`speech: ${speech.kind} (D184). Kit source: ${MANAGED_AGENT_DIR}`);
studio.collectLeft();

for (const sig of /** @type {const} */ (["SIGINT", "SIGTERM"])) process.on(sig, () => s.close().then(() => process.exit(0)));
