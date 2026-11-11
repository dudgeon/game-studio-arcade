// Runs on the cabinet, as root, for scripts/virtual-cabinet/connect-cabinet.sh (D131, D185, D155).
// The key arrives on stdin and is never an argument, a log line or an error message.
//
//   node service-config.mjs check     exit 3 if replay data is on this cabinet, so it can't go live yet
//   node service-config.mjs key       print the installed key to stdout (for --reapply, over SSH)
//   node service-config.mjs install   read {anthropic_api_key, agent_id, agent_version, environment_id}
//                                     from stdin, write service.json owned by arcade, mode 0600, go live
//   node service-config.mjs groq      read {groq_api_key} from stdin into service.json: Groq first (D263).
//                                     An empty key turns Groq off; Moonshine carries on alone.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// The ARCADE_ variables are for its test. sudo drops them, so a cabinet always uses the real paths.
const ETC = process.env.ARCADE_ETC ?? "/etc/arcade";
const CONFIG = path.join(ETC, "service.json");
const ENV_FILE = path.join(ETC, "service.env");
const DATA = process.env.ARCADE_DATA ?? "/var/lib/arcade";
const DEFAULTS = { budget_cents: 300, question_timeout_s: 600, recheck_s: 60, players: 1, console_name: "Quarter Deck", model: null };

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

/** D150: games made here move to the Picade's shelf, so a replay's cart mustn't be here when it goes live. */
function replayData() {
  const found = [];
  const carts = path.join(DATA, "carts");
  for (const id of fs.existsSync(carts) ? fs.readdirSync(carts) : []) {
    const file = path.join(carts, id, "cart.json");
    if (!fs.existsSync(file)) continue;
    try {
      if (String(JSON.parse(fs.readFileSync(file, "utf8")).session_id ?? "").includes("replay")) found.push(`cart ${id}`);
    } catch {
      found.push(`cart ${id} (unreadable cart.json)`);
    }
  }
  const sessions = path.join(DATA, "logs/studio_session.jsonl");
  if (fs.existsSync(sessions) && fs.readFileSync(sessions, "utf8").includes('"sesn_replay"')) found.push("a replay session in the logs");
  if (fs.existsSync(path.join(DATA, "sessions/sesn_replay"))) found.push("a replay session folder");
  return found;
}

const cmd = process.argv[2];
if (cmd === "check") {
  const found = replayData();
  if (found.length) fail(`This cabinet has replay data: ${found.join(", ")}.`, 3);
  console.log(fs.existsSync(CONFIG) ? "live" : "replay");
} else if (cmd === "key") {
  if (!fs.existsSync(CONFIG)) fail("This cabinet has no key yet. Run connect-cabinet.sh without --reapply.");
  const key = JSON.parse(fs.readFileSync(CONFIG, "utf8")).anthropic_api_key;
  if (!key) fail("The cabinet's config has no key.");
  process.stdout.write(key);
} else if (cmd === "install") {
  const found = replayData();
  if (found.length) fail(`This cabinet has replay data: ${found.join(", ")}.`, 3);
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    fail("The config on stdin wasn't JSON."); // never quote it: it holds the key
  }
  for (const field of ["anthropic_api_key", "agent_id", "environment_id"]) {
    if (typeof input[field] !== "string" || !input[field]) fail(`The config on stdin has no ${field}.`);
  }
  const before = fs.existsSync(CONFIG) ? JSON.parse(fs.readFileSync(CONFIG, "utf8")) : {};
  const config = { ...DEFAULTS, ...before, ...input };
  writeConfig(config);
  fs.writeFileSync(ENV_FILE, `ARCADE_SERVICE_ARGS=--config ${CONFIG}\n`);
  if (!process.env.ARCADE_NO_RESTART) execFileSync("systemctl", ["restart", "arcade-launcher"], { stdio: "ignore" });
  const mode = (fs.statSync(CONFIG).mode & 0o777).toString(8);
  console.log(`service.json written, mode ${mode}; agent ${config.agent_id} version ${config.agent_version ?? "?"}; budget ${config.budget_cents} cents a make`);
} else if (cmd === "groq") {
  if (!fs.existsSync(CONFIG)) fail("This cabinet has no config yet. Connect it first: scripts/virtual-cabinet/connect-cabinet.sh");
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    fail("The input on stdin wasn't JSON."); // never quote it: it holds the key
  }
  if (typeof input.groq_api_key !== "string") fail("The input on stdin has no groq_api_key.");
  const config = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  if (input.groq_api_key) config.groq_api_key = input.groq_api_key;
  else delete config.groq_api_key;
  writeConfig(config);
  if (!process.env.ARCADE_NO_RESTART) execFileSync("systemctl", ["restart", "arcade-launcher"], { stdio: "ignore" });
  console.log(input.groq_api_key ? "Groq is on: it transcribes first, and Moonshine answers when it can't." : "Groq is off: Moonshine transcribes on the cabinet.");
} else {
  fail("usage: service-config.mjs check | key | install | groq", 2);
}

/** service.json, owned by arcade, mode 0600, replaced in one step. @param {any} config */
function writeConfig(config) {
  const { uid, gid } = fs.statSync(path.join(DATA, "carts"));
  const temp = `${CONFIG}.new`;
  fs.rmSync(temp, { force: true });
  const fd = fs.openSync(temp, "wx", 0o600);
  fs.fchownSync(fd, uid, gid);
  fs.writeSync(fd, `${JSON.stringify(config, null, 2)}\n`);
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  fs.renameSync(temp, CONFIG);
}
