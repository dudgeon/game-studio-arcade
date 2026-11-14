#!/usr/bin/env node
// The Picade's own Anthropic identity, set up once on the mini before the flash (D329). Geoff runs it in his own
// Terminal (not Claude Code's `!`), after making the cabinet-picade workspace and its key in the Console:
//
//   scripts/cabinet-card/picade-key.sh           asks for the key (no echo), sets the Studio up there, stores it, proves it
//   scripts/cabinet-card/picade-key.sh --check   proves the stored identity again, live; asks for nothing
//
// The key check and the apply are connect-cabinet.sh --prepare's own (D320): a workspace key only, never the mini's
// workspace or the virtual cabinet's, the Studio agent applied with claude-lock.arcade.json. The identity (key, agent,
// version, environment) goes into identity.json in the Picade's folder under ~/.config/game-studio-arcade, mode 0600, beside the
// mini's other identities: not the repo, not the Keychain (a dialog on Geoff's screen). flash.mjs reads it, so the
// flash asks nothing about keys. The proof is one session against the agent with a 5-cent cap and no message,
// archived at once. It prints only ok or fail, the workspace and the agent version: never the key.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PICADE_DIR_UNDER_DATA, PICADE_HOST, PICADE_KEY_NAME, picadeDir } from "./picade.mjs";
import { SecretsError, identityFromConnect, parseIdentity } from "./secrets.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
/** GSA_PICADE_IDENTITY_DIR is for the tests. */
// The Picade's folder (picade-ssh.sh's PICADE_DIR_UNDER_DATA), under ~/.config/game-studio-arcade.
export const IDENTITY_DIR = process.env.GSA_PICADE_IDENTITY_DIR || path.join(os.homedir(), ".config/game-studio-arcade", PICADE_DIR_UNDER_DATA);
export const IDENTITY_FILE = path.join(IDENTITY_DIR, "identity.json");
const LOCK = path.join(REPO, "studio-kit/managed-agent/claude-lock.arcade.json");

/** Write the identity in one step: a private folder, a 0600 file made before anything is in it, then renamed. @param {string} file @param {any} identity */
export function writeIdentity(file, identity) {
  const id = parseIdentity(JSON.stringify(identity));
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const temp = `${file}.new`;
  fs.rmSync(temp, { force: true });
  const fd = fs.openSync(temp, "wx", 0o600);
  try {
    fs.writeSync(fd, `${JSON.stringify({ anthropic_api_key: id.anthropic_api_key, agent_id: id.agent_id, agent_version: id.agent_version ?? null, environment_id: id.environment_id }, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, file);
}

/**
 * The stored identity, checked: a plain file owned by this user, 0600, a workspace key and the agent ids.
 * Errors never quote it. Used by flash.mjs too.
 * @param {string} file
 */
export function readIdentity(file) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    throw new SecretsError(`there's no Picade identity at ${file} yet: run scripts/cabinet-card/picade-key.sh first`);
  }
  if (!st.isFile()) throw new SecretsError(`${file} isn't a plain file`);
  if (process.getuid && st.uid !== process.getuid()) throw new SecretsError(`${file} belongs to someone else`);
  if (st.mode & 0o077) throw new SecretsError(`${file} can be read by others: chmod 600 ${file}`);
  return parseIdentity(fs.readFileSync(file, "utf8"));
}

/** The workspace the Picade's lock file names (its id; a workspace key can't read the workspace's name). */
export function lockWorkspace(lockFile = LOCK) {
  try {
    return JSON.parse(fs.readFileSync(lockFile, "utf8")).origin?.workspace_id ?? null;
  } catch {
    return null;
  }
}

/**
 * The live proof: the agent is there at the stored version, and a session starts against it in this workspace.
 * No message is sent, so the model never runs; the session is archived at once (kept, not deleted: D5).
 * @param {{ beta: any }} client an Anthropic client made from the identity file
 * @param {{ agent_id: string, agent_version?: number | null, environment_id: string }} id
 */
export async function liveCheck(client, id) {
  const agent = await client.beta.agents.retrieve(id.agent_id, id.agent_version ? { version: id.agent_version } : undefined);
  const version = agent?.version ?? id.agent_version ?? null;
  const session = await client.beta.sessions.create({
    agent: id.agent_version ? { type: "agent", id: id.agent_id, version: id.agent_version } : id.agent_id,
    environment_id: id.environment_id,
    budget: { type: "limit", max_list_cost: { amount: "5", currency: "USD" } },
    title: "picade-key.sh check (no message sent)",
    metadata: { purpose: "picade-key-check" },
  });
  await client.beta.sessions.archive(session.id);
  return { agentVersion: version, sessionId: session.id };
}

/** An error's words without anything key-shaped, for the one line printed on a failure. @param {unknown} e */
export function safeMessage(e) {
  const m = String(/** @type {any} */ (e)?.message ?? e);
  return m.replace(/sk-ant-[A-Za-z0-9_-]+/g, "[key]").replace(/gsk_[A-Za-z0-9_]+/g, "[key]").split("\n")[0].slice(0, 300);
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  if (process.argv.slice(2).some((a) => a !== "--check")) throw new SecretsError("the only option is --check. The key is never an argument.");
  if (!checkOnly) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new SecretsError("run this in a Terminal window on the mini, so the key can't land in a chat or a log.");
    const dir = picadeDir();
    const identity = await identityFromConnect({
      script: path.join(REPO, "scripts/virtual-cabinet/connect-cabinet.sh"),
      env: { ...process.env, CABINET: "arcade", ARCADE_HOST: PICADE_HOST, ARCADE_SSH_DIR: path.join(dir, "ssh"), ARCADE_SSH_KEY_NAME: PICADE_KEY_NAME, GSA_VM_DIR: dir },
    });
    writeIdentity(IDENTITY_FILE, identity);
    console.log(`Stored the Picade's identity in ${IDENTITY_FILE} (mode 0600).`);
  }
  const id = readIdentity(IDENTITY_FILE);
  const { createCabinetClient } = await import("@game-studio-arcade/auth");
  const client = createCabinetClient({ configFile: IDENTITY_FILE });
  const workspace = lockWorkspace() ?? "(no claude-lock.arcade.json here)";
  try {
    const r = await liveCheck(client, id);
    console.log(`ok   workspace ${workspace}, agent version ${r.agentVersion ?? "?"}: a session started against the Studio agent and was archived (no message, nothing spent)`);
  } catch (e) {
    console.log(`fail workspace ${workspace}: ${safeMessage(e)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`picade-key: ${e instanceof SecretsError ? "Stopped" : "FAILED"}: ${safeMessage(e)}`);
    process.exit(1);
  });
}
