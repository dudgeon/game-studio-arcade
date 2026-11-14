// What the Picade's card carries so the cabinet is ready the moment it's switched on (D320-D323): its own
// Anthropic identity and the family's Groq key. Both are held in memory and on pipes only: never an argument,
// an environment variable, a file on the mini, or a log line. flash.mjs writes them straight onto the card.
import { spawn } from "node:child_process";
import { createReadStream, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const GUEST = "/opt/arcade/current/cabinet/vm/guest/service-config.mjs";
/** Drive's own settings, so the Picade's never leak into a call meant for the virtual cabinet. */
const DRIVE_ENV = ["ARCADE_HOST", "ARCADE_SSH_DIR", "ARCADE_SSH_KEY_NAME", "GSA_VM_DIR", "CABINET"];

export class SecretsError extends Error {}

/** A child's stdout, in memory. Its stderr is the reason if it fails; neither is ever logged here. */
function capture(cmd, args, env) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (err += d));
    c.on("close", (code) => resolve({ code, out, err }));
  });
}

/**
 * The Groq key Geoff already put on the virtual cabinet (groq-key.sh), read over its admin SSH (D321).
 * @param {{ drive: string, env?: NodeJS.ProcessEnv }} o
 */
export async function groqFromVirtual({ drive, env = process.env }) {
  const clean = { ...env };
  for (const k of DRIVE_ENV) delete clean[k];
  const r = await capture(drive, ["ssh", "sudo", "node", GUEST, "groq-key"], { ...clean, ARCADE_SSH_TIMEOUT_S: "60" });
  if (r.code === 255) throw new SecretsError("can't reach the virtual cabinet over SSH to copy its Groq key. Is it up? (scripts/virtual-cabinet/up.sh)");
  if (r.code === 2) throw new SecretsError("the virtual cabinet's software is older than this: update it first (node scripts/virtual-cabinet/update-cabinet.mjs)");
  if (r.code === 4) throw new SecretsError("the virtual cabinet has no Groq key to copy. Put it there first: scripts/virtual-cabinet/groq-key.sh. Or flash with --no-groq.");
  if (r.code !== 0) throw new SecretsError(`couldn't read the virtual cabinet's Groq key (exit ${r.code})`);
  const key = r.out.trim();
  if (!/^gsk_[A-Za-z0-9_]+$/.test(key)) throw new SecretsError("what the virtual cabinet holds doesn't look like a Groq key");
  return key;
}

/**
 * The Picade's own Anthropic identity (D320): connect-cabinet.sh --prepare asks Geoff for the key in the terminal,
 * checks its workspace, applies the Studio agent there with claude-lock.arcade.json, and hands the config back
 * through a FIFO in a private folder.
 * @param {{ script: string, env: NodeJS.ProcessEnv }} o
 */
export async function identityFromConnect({ script, env }) {
  const dir = mkdtempSync(join(tmpdir(), "card-identity-"));
  const fifo = join(dir, "config");
  try {
    execFileSync("mkfifo", ["-m", "600", fifo]);
    let got = "";
    const reading = new Promise((resolve, reject) => {
      const r = createReadStream(fifo, { encoding: "utf8" });
      r.on("data", (d) => (got += d));
      r.on("end", resolve);
      r.on("error", reject);
    });
    const code = await new Promise((resolve) => {
      const c = spawn(script, ["--prepare", fifo], { env, stdio: "inherit" });
      c.on("close", resolve);
    });
    if (code !== 0) {
      // Unblock the reader if the script stopped before writing.
      try {
        execFileSync("/bin/sh", ["-c", ': > "$1"', "sh", fifo], { timeout: 2000 });
      } catch {}
      await reading.catch(() => {});
      throw new SecretsError("connect-cabinet.sh stopped, so the card has no identity. Nothing was written to the card.");
    }
    await reading;
    return parseIdentity(got);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The identity JSON, checked; errors never quote it (it holds the key). @param {string} text */
export function parseIdentity(text) {
  let o;
  try {
    o = JSON.parse(text);
  } catch {
    throw new SecretsError("the identity from connect-cabinet.sh wasn't JSON");
  }
  for (const f of ["anthropic_api_key", "agent_id", "environment_id"]) if (typeof o[f] !== "string" || !o[f]) throw new SecretsError(`the identity has no ${f}`);
  if (!/^sk-ant-/.test(o.anthropic_api_key) || /^sk-ant-admin/.test(o.anthropic_api_key)) throw new SecretsError("the identity's key isn't a workspace API key");
  return o;
}

/**
 * The file the card carries: what service-config.mjs install takes on the cabinet, with the Groq key beside it.
 * @param {{ identity: any, groq?: string | null }} o
 */
export function cabinetConfigText({ identity, groq }) {
  const out = { anthropic_api_key: identity.anthropic_api_key, agent_id: identity.agent_id, agent_version: identity.agent_version ?? null, environment_id: identity.environment_id };
  if (groq) {
    if (!/^gsk_[A-Za-z0-9_]+$/.test(groq)) throw new SecretsError("that isn't a Groq key");
    out.groq_api_key = groq;
  }
  return `${JSON.stringify(out)}\n`;
}

/** Throwaway values from a file, for rehearsals and tests only (--cabinet-config-from, image files only). @param {string} file */
export function configFromFile(file) {
  const o = JSON.parse(readFileSync(file, "utf8"));
  const identity = parseIdentity(JSON.stringify(o));
  return cabinetConfigText({ identity, groq: o.groq_api_key ?? null });
}

/** Where the card carries it, beside the seed; first boot installs it and wipes it (D322). */
export const CARD_CONFIG = "seed/cabinet-config.json";
