#!/usr/bin/env node
// Re-list and re-download a probe session's outputs (they can keep syncing
// after the session goes idle), and print the agent's tool results.
//   node studio-kit/probe/refetch-outputs.js <session id>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@game-studio-arcade/auth";

const BETA = "managed-agents-2026-04-01";
const id = process.argv[2];
if (!id) throw new Error("usage: refetch-outputs.js <session id>");
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "results", id);
fs.mkdirSync(dir, { recursive: true });
const client = createClient();

for await (const f of client.beta.files.list({ scope_id: id, betas: [BETA] })) {
  console.log(`${f.filename}\t${f.size_bytes}\t${f.created_at}`);
  const resp = await client.beta.files.download(f.id, { betas: [BETA] });
  fs.writeFileSync(path.join(dir, path.basename(f.filename)), Buffer.from(await resp.arrayBuffer()));
}
for await (const e of client.beta.sessions.events.list(id)) {
  if (e.type === "agent.tool_result") console.log("TOOL RESULT:", JSON.stringify(e).slice(0, 2000));
}
