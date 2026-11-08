// A scripted stand-in for the Managed Agents API. A script is a list of steps:
//   {"await_message": true}                       wait for the user.message
//   {"emit": <event>}                             deliver an event on the stream (and record it in history)
//   {"drop": <event>}                             record it in history only (a missed stream event)
//   {"await_result": "<tool use id>", "expect": {...}}  wait for that custom tool result; check its JSON
//   {"disconnect": true}                          end the current stream (the driver must reconnect)
// Outputs are {filename: Buffer|string}; `outputLag` empty listings come first.
import fs from "node:fs";
import { readAgentDef } from "../src/config.js";

/**
 * @param {{steps: any[]}} script
 * @param {{sessionId?: string, outputs?: Record<string, Buffer|string>, outputLag?: number,
 *          usage?: any, timeoutMs?: number, appliedAgent?: any, archiveRefusals?: number}} [opts]
 */
export function mockApi(script, opts = {}) {
  const sessionId = opts.sessionId ?? "sesn_mock_01";
  const steps = script.steps;
  const timeoutMs = opts.timeoutMs ?? 2000;
  let pos = 0;
  let lag = opts.outputLag ?? 0;
  let archiveTries = 0;
  /** @type {any[]} */
  const history = [];
  /** @type {string[]} */
  const calls = [];
  /** @type {any[]} */
  const sent = [];
  const results = new Map();
  const problems = [];
  /** @type {{created: any}} */
  const state = { created: null };
  /** @type {(v?: unknown) => void} */
  let wake = () => {};
  /** @type {Promise<unknown>} */
  let changed = new Promise((r) => (wake = r));
  const bump = () => {
    const w = wake;
    changed = new Promise((r) => (wake = r));
    w();
  };

  async function until(pred, what) {
    const deadline = Date.now() + timeoutMs;
    while (!pred()) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`mock: timed out waiting for ${what} at step ${pos}`);
      await Promise.race([changed, new Promise((r) => setTimeout(r, left))]);
    }
  }

  async function* stream() {
    while (pos < steps.length) {
      const s = steps[pos];
      if (s.await_message) {
        await until(() => sent.some((e) => e.type === "user.message"), "user.message");
        pos++;
      } else if (s.await_result) {
        await until(() => results.has(s.await_result), `result for ${s.await_result}`);
        if (s.expect) {
          const got = JSON.parse(results.get(s.await_result));
          if (JSON.stringify(got) !== JSON.stringify(s.expect)) {
            problems.push(`${s.await_result}: expected ${JSON.stringify(s.expect)}, got ${JSON.stringify(got)}`);
          }
        }
        pos++;
      } else if (s.disconnect) {
        pos++;
        return;
      } else if (s.drop) {
        history.push(s.drop);
        pos++;
      } else if (s.emit) {
        history.push(s.emit);
        pos++;
        yield s.emit;
      } else {
        throw new Error(`mock: bad step ${JSON.stringify(s)}`);
      }
    }
  }

  return {
    calls,
    sent,
    results,
    problems,
    get position() {
      return pos;
    },
    get created() {
      return state.created;
    },
    /** @type {import("../src/api.js").StudioApi} */
    api: {
      async createSession(p) {
        calls.push("createSession");
        state.created = p;
        return { id: sessionId };
      },
      async openStream() {
        calls.push("openStream");
        return stream();
      },
      async send(_id, events) {
        for (const e of events) {
          calls.push(`send:${e.type}`);
          sent.push(e);
          if (e.type === "user.custom_tool_result") results.set(e.custom_tool_use_id, e.content[0].text);
        }
        bump();
      },
      async listEvents() {
        calls.push("listEvents");
        return [...history];
      },
      async retrieveSession() {
        calls.push("retrieveSession");
        return { id: sessionId, status: "idle", usage: opts.usage ?? null };
      },
      // Like the real thing (D19): the session's input kit is listed too, and
      // during the lag files are still short and DONE.json isn't there yet.
      async listOutputs() {
        calls.push("listOutputs");
        const names = Object.keys(opts.outputs ?? {});
        const syncing = lag > 0;
        if (lag > 0) lag--;
        const size = (n) => {
          const v = (opts.outputs ?? {})[n];
          return (Buffer.isBuffer(v) ? v : Buffer.from(String(v))).length;
        };
        const listed = names
          .map((filename, i) => ({ id: `file_out_${i}`, filename, size_bytes: syncing ? Math.max(0, size(filename) - 1) : size(filename), created_at: `2026-11-07T21:00:0${i % 10}Z` }))
          .filter((f) => !(syncing && f.filename === "DONE.json"));
        return [{ id: "file_input_kit", filename: "studio-kit.tgz", size_bytes: 1234, created_at: "2026-11-07T20:59:00Z" }, ...listed];
      },
      async download(fileId) {
        calls.push(`download:${fileId}`);
        if (fileId === "file_input_kit") throw new Error("mock: the input kit must never be downloaded");
        const name = Object.keys(opts.outputs ?? {})[Number(fileId.split("_").pop())];
        const v = (opts.outputs ?? {})[name];
        return Buffer.isBuffer(v) ? v : Buffer.from(String(v));
      },
      async archiveSession() {
        calls.push("archiveSession");
        if ((opts.archiveRefusals ?? 0) > archiveTries++) throw new Error("mock: a running session can't be archived");
        return { id: sessionId, archived_at: "2026-11-08T21:00:00Z" };
      },
      async retrieveAgent(agentId, version) {
        calls.push(`retrieveAgent:${agentId}@${version}`);
        if (opts.appliedAgent instanceof Error) throw opts.appliedAgent;
        const def = readAgentDef();
        return opts.appliedAgent ?? { id: agentId, version, system: def.system, tools: def.tools };
      },
      async uploadFile(path, filename) {
        calls.push(`upload:${filename}`);
        if (!fs.existsSync(path)) throw new Error(`mock: no file ${path}`);
        return { id: "file_kit_01" };
      },
    },
  };
}
