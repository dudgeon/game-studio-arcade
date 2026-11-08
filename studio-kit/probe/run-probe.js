#!/usr/bin/env node
// Phase 0 task 1: run one probe session in a Managed Agents cloud sandbox and
// collect what it found. Agent and environment come from agents/gsa-probe.md
// and environments/gsa-probe-offline.yaml (synced with `ant apply`).
//
//   node studio-kit/probe/run-probe.js [--cap-cents 50]
//
// Writes results/<session id>/ (sandbox outputs + summary.json). Never deletes
// the session (D5).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createClient, checkAuth } from "@game-studio-arcade/auth";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const CAP_CENTS = String(Number(args[args.indexOf("--cap-cents") + 1] ?? NaN) || 50);
const BETA = "managed-agents-2026-04-01";
const TIMEOUT_MS = 15 * 60 * 1000;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const client = createClient();
await checkAuth(client);

// 1. Find the applied agent and environment by name.
const findByName = async (list, name) => {
  for await (const item of list) if (item.name === name && !item.archived_at) return item;
  throw new Error(`"${name}" not found: run ant apply on the probe files first`);
};
const agent = await findByName(client.beta.agents.list(), "gsa-probe");
const env = await findByName(client.beta.environments.list(), "gsa-probe-offline");
log(`agent ${agent.id} v${agent.version} (${agent.model?.id ?? agent.model}), environment ${env.id}`);

// 2. Pack and upload the kit (exercises Files API + tarball mounts).
const tmp = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "gsa-probe-"));
const tarball = path.join(tmp, "gsa-probe-kit.tgz");
// macOS bsdtar adds xattr headers GNU tar warns about; strip them (D19).
const tarFlags = process.platform === "darwin" ? ["--no-xattrs", "--no-mac-metadata"] : [];
execFileSync("tar", [...tarFlags, "-czf", tarball, "-C", path.join(here, "kit"), "."], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
const uploaded = await client.files.upload({ file: fs.createReadStream(tarball) });
log(`uploaded kit ${uploaded.id} (${fs.statSync(tarball).size} bytes)`);

// 3. Session with a hard budget cap.
const MOUNT = "/mnt/session/uploads/gsa-probe-kit.tgz";
const session = await client.beta.sessions.create({
  agent: { type: "agent", id: agent.id, version: agent.version },
  environment_id: env.id,
  title: "Phase 0 task 1 sandbox probe",
  resources: [{ type: "file", file_id: uploaded.id, mount_path: MOUNT }],
  budget: { type: "limit", max_list_cost: { amount: CAP_CENTS, currency: "USD" } },
  metadata: { project: "game-studio-arcade", purpose: "phase-0-probe" },
});
log(`session ${session.id} (cap ${CAP_CENTS}¢)`);

const COMMANDS = [
  `K=$(find /mnt/session -name gsa-probe-kit.tgz 2>/dev/null | head -1); echo "kit tarball at: $K"`,
  `mkdir -p /tmp/kit && tar xzf "$K" -C /tmp/kit && ls -la /tmp/kit`,
  `GSA_KIT_TARBALL="$K" bash /tmp/kit/probe.sh; tail -5 /mnt/session/outputs/probe-report.txt`,
].join("\n");
const message = `Run these commands with bash, as one script, exactly as written:\n\n${COMMANDS}\n\nThen reply DONE.`;

// 4. Stream first, then send; follow until idle (not requires_action) or terminated.
const usageEvents = [];
let stopReason = null;
const started = Date.now();
const stream = await client.beta.sessions.events.stream(session.id);
await client.beta.sessions.events.send(session.id, {
  events: [{ type: "user.message", content: [{ type: "text", text: message }] }],
});
const timer = setTimeout(async () => {
  log("timeout: interrupting");
  await client.beta.sessions.events.send(session.id, { events: [{ type: "user.interrupt" }] }).catch(() => {});
}, TIMEOUT_MS);

loop: for await (const event of stream) {
  switch (event.type) {
    case "agent.tool_use":
      log(`tool ${event.name}: ${JSON.stringify(event.input).slice(0, 140)}`);
      break;
    case "agent.message":
      for (const b of event.content) if (b.type === "text") log(`agent: ${b.text.slice(0, 200)}`);
      break;
    case "session.usage":
      usageEvents.push(event);
      log(`usage event: list_cost ${JSON.stringify(event.usage?.list_cost)}`);
      break;
    case "session.error":
      log(`session.error: ${JSON.stringify(event.error)}`);
      break;
    case "session.status_idle":
      stopReason = event.stop_reason;
      log(`idle: ${JSON.stringify(event.stop_reason)}`);
      if (event.stop_reason?.type !== "requires_action") break loop;
      break;
    case "session.status_terminated":
      stopReason = { type: "terminated" };
      break loop;
  }
}
clearTimeout(timer);
const wallSeconds = Math.round((Date.now() - started) / 1000);

// 5. Outputs (they can lag the idle event by a few seconds).
const outDir = path.join(here, "results", session.id);
fs.mkdirSync(outDir, { recursive: true });
let outputs = [];
for (let attempt = 0; attempt < 6 && outputs.length === 0; attempt++) {
  if (attempt) await new Promise((r) => setTimeout(r, 3000));
  outputs = [];
  for await (const f of client.beta.files.list({ scope_id: session.id, betas: [BETA] })) outputs.push(f);
}
for (const f of outputs) {
  const resp = await client.beta.files.download(f.id, { betas: [BETA] });
  fs.writeFileSync(path.join(outDir, path.basename(f.filename)), Buffer.from(await resp.arrayBuffer()));
  log(`downloaded ${f.filename} (${f.size_bytes} bytes)`);
}

// 6. Final cost, from the session object (authoritative).
await new Promise((r) => setTimeout(r, 2000));
const final = await client.beta.sessions.retrieve(session.id);
const summary = {
  session_id: session.id,
  agent: { id: agent.id, version: agent.version, model: agent.model },
  environment_id: env.id,
  kit_file_id: uploaded.id,
  budget_cents: CAP_CENTS,
  stop_reason: stopReason,
  wall_seconds: wallSeconds,
  status: final.status,
  usage: final.usage ?? null,
  stats: final.stats ?? null,
  session_usage_events: usageEvents,
  outputs: outputs.map((f) => ({ filename: f.filename, size_bytes: f.size_bytes })),
};
fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
log(`list cost: ${JSON.stringify(final.usage?.list_cost)}; wall ${wallSeconds}s; results in ${path.relative(process.cwd(), outDir)}`);
