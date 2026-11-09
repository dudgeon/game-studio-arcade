// The Managed Agents API as a replay of a recorded session (D186), through the CLI's
// mock. Spends nothing. Also takes a hand-written stream, for strings no session
// has sent yet. The real makeCart, library commit, logs and checks run on top.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mockApi } from "@game-studio-arcade/studio-cli/test-support/mock-api.js";
import { readAgentDef } from "@game-studio-arcade/studio-cli/src/config.js";

/** Our own events in a recording become waits. */
export function stepsFrom(recorded) {
  const steps = [];
  for (const e of recorded) {
    if (e.type === "user.message") steps.push({ await_message: true });
    else if (e.type === "user.custom_tool_result") steps.push({ await_result: e.custom_tool_use_id });
    else if (e.type.startsWith("user.")) continue;
    else steps.push({ emit: e });
  }
  return { steps };
}

/** Where a recording stands with `answered` questions and plans answered. */
function resumePoint(recorded, answered) {
  const asks = new Set(recorded.filter((e) => e.type === "agent.custom_tool_use" && (e.name === "ask_player" || e.name === "show_plan")).map((e) => e.id));
  let at = recorded.findIndex((e) => e.type === "user.message") + 1;
  let n = 0;
  for (let i = at; i < recorded.length && n < answered; i++) {
    if (recorded[i].type === "user.custom_tool_result" && asks.has(recorded[i].custom_tool_use_id)) {
      n++;
      at = i + 1;
    }
  }
  return at;
}

/** Outputs as an agent leaves them: the cart, its spec, the report and DONE.json (D19). @param {string} dir */
export function outputsFrom(dir) {
  const cart = path.join(dir, "cart");
  const tgz = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gsa-replay-")), "cart.tgz");
  execFileSync("tar", ["-czf", tgz, "-C", cart, "."], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  /** @type {Record<string, Buffer>} */
  const files = { "spec.md": fs.readFileSync(path.join(cart, "spec.md")), "report.json": fs.readFileSync(path.join(dir, "report.json")), "cart.tgz": fs.readFileSync(tgz) };
  const manifest = { files: Object.entries(files).map(([name, b]) => ({ name, size: b.length })) };
  return { ...files, "DONE.json": Buffer.from(JSON.stringify(manifest)) };
}

/**
 * @param {{ dir?: string, script?: {steps: any[]}, outputs?: Record<string, Buffer>, paceMs?: number, usage?: any, appliedAgent?: any, archiveRefusals?: number, resume?: {answered?: number} }} o
 *   dir: a fixture folder with events.jsonl, report.json and cart/.
 *   paceMs: wait this long before each tool event or message, so a person or a
 *     screenshot can see each progress line. Thinking and spans don't count.
 *   resume: as a session picked up after a restart (D191): everything up to the
 *     last answered question or plan is history, and the stream carries the rest.
 */
export function replayApi(o) {
  const recorded = o.script ? [] : fs.readFileSync(path.join(/** @type {string} */ (o.dir), "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const cut = o.resume ? resumePoint(recorded, o.resume.answered ?? 0) : 0;
  const script = o.script ?? stepsFrom(recorded.slice(cut));
  const def = readAgentDef();
  const m = mockApi(script, {
    outputs: o.outputs ?? (o.dir ? outputsFrom(o.dir) : {}),
    sessionId: "sesn_replay",
    usage: o.usage ?? { list_cost: { amount: "0", currency: "USD" }, active_seconds: 0 },
    timeoutMs: 24 * 3600 * 1000, // a kid can think as long as they like
    appliedAgent: o.appliedAgent ?? { version: 1, system: def.system, tools: def.tools },
    archiveRefusals: o.archiveRefusals,
    history: recorded.slice(0, cut),
  });
  const pace = o.paceMs ?? 0;
  const api = {
    ...m.api,
    async openStream(/** @type {string} */ id) {
      const stream = await m.api.openStream(id);
      if (!pace) return stream;
      return (async function* () {
        for await (const ev of stream) {
          if (ev.type === "agent.tool_use" || ev.type === "agent.custom_tool_use") await new Promise((r) => setTimeout(r, pace));
          yield ev;
        }
      })();
    },
  };
  return { api, mock: m };
}

export const REPLAY_LOCK = { agentId: "agent_replay", agentVersion: 1, environmentId: "env_replay" };
