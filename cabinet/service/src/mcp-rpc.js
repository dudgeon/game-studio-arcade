// A small MCP server core (D340): JSON-RPC 2.0 messages in, responses out, no transport and no packages.
// The cabinet's `arcade` server (src/arcade-mcp.js, over HTTP) and the plugin's `studio` server and bridge
// (game-studio/, over stdio) share it.
//
// Dual-era, as the spec allows (checked 2026-11-13, modelcontextprotocol.io/specification/2026-07-28):
// - modern (2026-07-28): every request carries _meta["io.modelcontextprotocol/protocolVersion"]; there is no
//   handshake; `server/discover` says what the server is; results carry resultType "complete".
// - legacy (2025-11-25 and earlier): `initialize`, then `notifications/initialized`, then requests without that _meta.
// Claude Code talks to stdio servers in the modern revision by default and falls back to legacy (its docs).

export const MODERN_VERSIONS = ["2026-07-28"];
export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const VERSION_KEY = "io.modelcontextprotocol/protocolVersion";

/**
 * @typedef {{ name: string, title?: string, description: string, inputSchema: object, annotations?: object }} ToolDef
 * @typedef {ToolDef & { call: (args: any, ctx: any) => Promise<any> }} Tool
 *   `call` returns a plain value (sent as JSON text and structuredContent), or { content, isError } as is.
 *   A thrown ToolError is a tool execution error the model can act on; any other throw is one too, with its message.
 */

export class ToolError extends Error {}

/** A tool result: a value as text plus structured content, or an error the model can read. @param {any} value @param {boolean} [isError] */
export function toolResult(value, isError = false) {
  if (value && typeof value === "object" && Array.isArray(value.content)) return { ...value, isError: Boolean(value.isError || isError) };
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }], ...(value && typeof value === "object" && !Array.isArray(value) ? { structuredContent: value } : {}), isError };
}

/**
 * @param {{ name: string, version: string, instructions?: string, tools: Tool[] | (() => Tool[]) }} o
 * @returns {{ handle: (msg: any, ctx?: any) => Promise<any | null>, tools: () => Tool[] }}
 *   handle returns the response to send, or null for a notification (nothing to send).
 */
export function mcpServer(o) {
  const tools = () => (typeof o.tools === "function" ? o.tools() : o.tools);
  const info = { name: o.name, version: o.version };
  const rpcError = (/** @type {any} */ id, /** @type {number} */ code, /** @type {string} */ message, /** @type {any} */ data = undefined) => ({ jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } });

  /** @param {any} msg @param {any} [ctx] */
  async function handle(msg, ctx = {}) {
    if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
      return msg && "id" in msg ? rpcError(msg.id ?? null, -32600, "Invalid Request") : rpcError(null, -32600, "Invalid Request");
    }
    const isNotification = !("id" in msg);
    if (isNotification) return null; // notifications/initialized, cancelled, …: nothing to answer
    const { id, method } = msg;
    const params = msg.params ?? {};
    const requested = params._meta?.[VERSION_KEY];
    const modern = typeof requested === "string";
    if (modern && !MODERN_VERSIONS.includes(requested)) {
      return rpcError(id, -32022, "Unsupported protocol version", { supported: [...MODERN_VERSIONS, ...LEGACY_VERSIONS], requested });
    }
    const done = (/** @type {object} */ result) => ({ jsonrpc: "2.0", id, result: modern ? { resultType: "complete", ...result } : result });

    if (method === "server/discover") {
      return done({ supportedVersions: [...MODERN_VERSIONS], capabilities: { tools: {} }, _meta: { "io.modelcontextprotocol/serverInfo": info }, ...(o.instructions ? { instructions: o.instructions } : {}) });
    }
    if (method === "initialize") {
      const want = params.protocolVersion;
      return done({ protocolVersion: LEGACY_VERSIONS.includes(want) ? want : LEGACY_VERSIONS[1], capabilities: { tools: {} }, serverInfo: info, ...(o.instructions ? { instructions: o.instructions } : {}) });
    }
    if (method === "ping") return done({});
    if (method === "tools/list") return done({ tools: tools().map(({ call, ...def }) => def) });
    if (method === "tools/call") {
      const tool = tools().find((t) => t.name === params.name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${params.name}`);
      const args = params.arguments ?? {};
      if (typeof args !== "object" || Array.isArray(args)) return rpcError(id, -32602, "arguments must be an object");
      // Progress for a long call (D513): sent only when the client asked for it with a progressToken, over a transport that can.
      const token = params._meta?.progressToken;
      const progress = (/** @type {number} */ p, /** @type {string} */ message) => {
        if (token !== undefined && ctx.notify) ctx.notify({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: token, progress: p, message } });
      };
      try {
        return done(toolResult(await tool.call(args, { ...ctx, progress })));
      } catch (/** @type {any} */ e) {
        return done(toolResult(e instanceof ToolError ? e.message : `${tool.name} failed: ${e?.message ?? e}`, true));
      }
    }
    return rpcError(id, -32601, `Method not found: ${method}`);
  }
  return { handle, tools };
}

/**
 * Serve an MCP server over stdio: newline-delimited JSON-RPC on stdin and stdout, logs on stderr only.
 * @param {{ handle: (msg: any, ctx?: any) => Promise<any | null> }} server
 * @param {{ input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream }} [io]
 */
export function serveStdio(server, io = {}) {
  const input = io.input ?? process.stdin;
  const output = io.output ?? process.stdout;
  let buf = "";
  const send = (/** @type {any} */ m) => m && output.write(JSON.stringify(m) + "\n");
  input.setEncoding?.("utf8");
  input.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
        continue;
      }
      // Requests run concurrently; each answer goes out when it's ready, matched by id.
      const batch = Array.isArray(msg) ? msg : [msg];
      for (const m of batch) server.handle(m, { notify: send }).then(send, (e) => send({ jsonrpc: "2.0", id: m?.id ?? null, error: { code: -32603, message: String(e?.message ?? e) } }));
    }
  });
  return new Promise((resolve) => input.on("end", resolve));
}
