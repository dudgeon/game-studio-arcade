// The Picade's admin SSH for Node, read from picade-ssh.sh so the shell scripts and Node can't disagree (D259).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PICADE_SSH_FILE = join(dirname(fileURLToPath(import.meta.url)), "picade-ssh.sh");
const text = readFileSync(PICADE_SSH_FILE, "utf8");
/** @param {string} name */
const value = (name) => {
  const m = text.match(new RegExp(`^${name}=([^\\s$"]+)$`, "m"));
  if (!m) throw new Error(`picade-ssh.sh has no ${name}`);
  return m[1];
};

export const PICADE_HOST = value("PICADE_HOST");
export const PICADE_DATA_ROOT = value("PICADE_DATA_ROOT");
export const PICADE_DIR_UNDER_DATA = value("PICADE_DIR_UNDER_DATA");
export const PICADE_KEY_NAME = value("PICADE_KEY_NAME");

/**
 * The Picade's folder on the mini; its ssh/ holds the key and known_hosts. GSA_CABINET_DIR moves it.
 * @param {Record<string, string | undefined>} [env] @param {string} [dataDir] the mini's game-studio-data folder
 */
export function picadeDir(env = process.env, dataDir = join(homedir(), PICADE_DATA_ROOT)) {
  return env.GSA_CABINET_DIR || join(dataDir, PICADE_DIR_UNDER_DATA);
}
