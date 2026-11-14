// Which cabinet an update goes to, and what goes with it (D330). Used by update-cabinet.mjs and the Manager.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { PICADE_HOST, PICADE_KEY_NAME, picadeDir } from "../cabinet-card/picade.mjs";

export const AGENT_PATHS = ["studio-kit/managed-agent"];

/**
 * The cabinet named on the command line, as the environment cabinet/vm/drive reads.
 *   (none)            the virtual cabinet, as before
 *   --picade          the Picade, by picade-ssh.sh (D259)
 *   --rehearsal DIR   a QEMU rehearsal of the card (rehearse.mjs), on 127.0.0.1:REHEARSE_SSH_PORT (D337)
 * @param {string[]} argv @param {Record<string, string | undefined>} env
 * @returns {{ name: "virtual" | "picade" | "rehearsal", env: Record<string, string>, connect: string | null }}
 */
export function updateTarget(argv, env = process.env) {
  const at = argv.indexOf("--rehearsal");
  if (at >= 0) {
    const dir = argv[at + 1];
    if (!dir || dir.startsWith("--")) throw new Error("--rehearsal needs the rehearsal's folder");
    return { name: "rehearsal", env: { ARCADE_HOST: "127.0.0.1", ARCADE_SSH_PORT: env.REHEARSE_SSH_PORT || "2299", ARCADE_SSH_DIR: join(dir, "cabinet/ssh"), ARCADE_SSH_KEY_NAME: PICADE_KEY_NAME }, connect: null };
  }
  if (argv.includes("--picade")) {
    const dir = picadeDir(env);
    return { name: "picade", env: { ARCADE_HOST: env.ARCADE_HOST || PICADE_HOST, ARCADE_SSH_DIR: join(dir, "ssh"), ARCADE_SSH_KEY_NAME: PICADE_KEY_NAME, GSA_VM_DIR: dir }, connect: "scripts/cabinet-card/connect-picade.sh" };
  }
  return { name: "virtual", env: {}, connect: "scripts/virtual-cabinet/connect-cabinet.sh" };
}

/**
 * Whether the Studio agent's definition changed between what the cabinet runs and this checkout (D330), so its
 * brief needs reapplying. An unknown or uncommitted commit counts as changed: reapplying is safe and changes
 * nothing when the definition is the same.
 * @param {string} repo @param {string} cabinetCommit e.g. "3ac0e28abcde" or "3ac0e28abcde+dirty"
 */
export function agentChanged(repo, cabinetCommit) {
  const c = (cabinetCommit || "").trim();
  if (!/^[0-9a-f]{7,40}$/.test(c)) return true;
  const r = spawnSync("git", ["diff", "--quiet", c, "--", ...AGENT_PATHS], { cwd: repo });
  return r.status !== 0;
}
