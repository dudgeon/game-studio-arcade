// The slice of the Claude API the Studio CLI uses, behind one small interface,
// so the driver runs the same against the real SDK and a recorded event stream.

/**
 * @typedef {{type: string, id?: string, [key: string]: any}} SessionEvent
 *
 * @typedef {object} CreateSessionParams
 * @property {string} agentId
 * @property {number} [agentVersion]   pin the version from claude-lock.json
 * @property {string} environmentId
 * @property {string} [model]          per-run model override (D40)
 * @property {string} kitFileId        Files API id of the studio kit tarball
 * @property {{fileId: string, mountPath: string}[]} [extraFiles]
 * @property {number} budgetCents      hard list-cost cap for the session
 * @property {string} [title]
 * @property {Record<string, string>} [metadata]
 *
 * @typedef {object} OutputFile
 * @property {string} id
 * @property {string} filename
 * @property {number} [size_bytes]
 *
 * @typedef {object} StudioApi
 * @property {(p: CreateSessionParams) => Promise<{id: string}>} createSession
 * @property {(sessionId: string) => Promise<AsyncIterable<SessionEvent>>} openStream
 * @property {(sessionId: string, events: object[]) => Promise<void>} send
 * @property {(sessionId: string) => Promise<SessionEvent[]>} listEvents
 * @property {(sessionId: string) => Promise<{id: string, status?: string, usage?: any}>} retrieveSession
 * @property {(sessionId: string) => Promise<OutputFile[]>} listOutputs
 * @property {(fileId: string) => Promise<Buffer>} download
 * @property {(path: string, filename: string) => Promise<{id: string}>} uploadFile
 */

export const BETA = "managed-agents-2026-04-01";
export const KIT_MOUNT = "/studio-kit.tgz"; // lands at /mnt/session/uploads/studio-kit.tgz

/**
 * Build the sessions.create body. Kept separate so tests can check it.
 * @param {CreateSessionParams} p
 */
export function sessionCreateBody(p) {
  /** @type {any} */
  let agent = p.agentVersion ? { type: "agent", id: p.agentId, version: p.agentVersion } : p.agentId;
  if (p.model) {
    agent = { type: "agent_with_overrides", id: p.agentId, model: { id: p.model } };
    if (p.agentVersion) agent.version = p.agentVersion;
  }
  if (!Number.isInteger(p.budgetCents) || p.budgetCents <= 0) throw new Error("budgetCents must be a positive whole number");
  return {
    agent,
    environment_id: p.environmentId,
    resources: [
      { type: "file", file_id: p.kitFileId, mount_path: KIT_MOUNT },
      ...(p.extraFiles ?? []).map((f) => ({ type: "file", file_id: f.fileId, mount_path: f.mountPath })),
    ],
    budget: { type: "limit", max_list_cost: { amount: String(p.budgetCents), currency: "USD" } },
    ...(p.title ? { title: p.title } : {}),
    ...(p.metadata ? { metadata: p.metadata } : {}),
  };
}

/**
 * Wrap an `@anthropic-ai/sdk` client. Method names follow the SDK 1.6.0 types
 * and the Managed Agents docs (checked 2026-11-07); not yet run live.
 * @param {any} client
 * @returns {StudioApi}
 */
export function sdkApi(client) {
  return {
    async createSession(p) {
      return client.beta.sessions.create(sessionCreateBody(p));
    },
    async openStream(sessionId) {
      return client.beta.sessions.events.stream(sessionId);
    },
    async send(sessionId, events) {
      await client.beta.sessions.events.send(sessionId, { events });
    },
    async listEvents(sessionId) {
      const out = [];
      for await (const ev of client.beta.sessions.events.list(sessionId)) out.push(ev);
      return out;
    },
    async retrieveSession(sessionId) {
      return client.beta.sessions.retrieve(sessionId);
    },
    async listOutputs(sessionId) {
      const out = [];
      for await (const f of client.beta.files.list({ scope_id: sessionId, betas: [BETA] })) out.push(f);
      return out;
    },
    async download(fileId) {
      const res = await client.files.download(fileId);
      return Buffer.from(await res.arrayBuffer());
    },
    async uploadFile(filePath, filename) {
      const { toFile } = await import("@anthropic-ai/sdk");
      const fs = await import("node:fs");
      return client.files.upload({ file: await toFile(fs.createReadStream(filePath), filename, { type: "application/gzip" }) });
    },
  };
}
