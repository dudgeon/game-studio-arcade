#!/usr/bin/env node
// The cabinet service, first slice (D183). See ../README.md.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { dataDir, dataPaths, MANAGED_AGENT_DIR } from "@game-studio-arcade/studio-cli/src/config.js";
import { defaultChecker } from "@game-studio-arcade/studio-cli/src/checks.js";
import dns from "node:dns/promises";
import { readCart, listCarts } from "@game-studio-arcade/player/src/library.js";
import { potStore } from "../src/pot.js";
import { cabinetState } from "../src/cabinet-state.js";
import { makersStore } from "../src/makers.js";
import { stubSpeech } from "../src/speech.js";
import { cabinetSpeech } from "../src/speech-live.js";
import { createStudio, QUESTION_TIMEOUT_MS } from "../src/studio.js";
import { startService } from "../src/server.js";
import { createGuests, listGuests, startGuestServer } from "../src/guests.js";
import { createScreener, modelCheck } from "../src/screening.js";
import { createGate, gateSettings, cabinetProfile, gatedChecker, playTracker, guestGate, stopGateRuns } from "../src/gate.js";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "8330" },
    host: { type: "string", default: "127.0.0.1" },
    data: { type: "string" },
    config: { type: "string" },
    replay: { type: "string" },
    pace: { type: "string", default: "150" },
    "question-timeout": { type: "string" },
    // Replay only (D186, D208): the fixture a change replays, and states no recording has.
    "replay-change": { type: "string" },
    "replay-cost": { type: "string" },
    "replay-fail": { type: "boolean", default: false },
    "replay-limit": { type: "boolean", default: false },
    offline: { type: "boolean", default: false },
    "manager-token": { type: "string" },
    examples: { type: "boolean", default: false },
    // Guest games (D230-D232): their own port, and the folders they live in.
    "guest-port": { type: "string" }, // else the config's guest_port, else 8340 (D232)
    guests: { type: "string", multiple: true },
    // The publish gate (D310): the cabinet re-tests a game in its own Chromium before the shelf. Off only for development.
    "no-gate": { type: "boolean", default: false },
    profile: { type: "string" }, // else /etc/arcade/cabinet.conf: labels the gate's frame times (D128)
  },
});

const paths = dataPaths(values.data ?? dataDir());
const replaying = Boolean(values.replay);
// --offline alone is a cabinet with no key yet, such as the Picade before connect-cabinet.sh (D252): the shelf
// plays, and Make waits. It can't spend, because nothing reaches the API while offline.
if (!replaying && !values.config && !values.offline) {
  console.error("cabinet-service: --config FILE (the cabinet's config, 0600, D131), --replay DIR to spend nothing (D186), or --offline (D252)");
  process.exit(2);
}
/** @type {any} */
let config = {};
/** @type {import("@anthropic-ai/sdk").default | null} */
let client = null;
if (values.config) {
  // First, before anything else reads the file: this checks its mode, and its errors
  // never quote it. A cabinet that can't sign in says so at start, not at a kid's first make.
  const { createCabinetClient } = await import("@game-studio-arcade/auth");
  try {
    client = createCabinetClient({ configFile: values.config });
  } catch (/** @type {any} */ e) {
    console.error(`cabinet-service: ${e.message}`);
    process.exit(1);
  }
  config = JSON.parse(fs.readFileSync(values.config, "utf8"));
  // A workspace-scoped key can't reach the mini's claude-lock.json resources (D185).
  if (!replaying && (!config.agent_id || !config.environment_id)) {
    console.error("cabinet-service: the cabinet config needs agent_id and environment_id, from ant apply in the cabinet's workspace (D185)");
    process.exit(1);
  }
}

/** The Manager's pairing token from its file, if there is one: a function, so a new pairing works without a restart. @param {string} file */
function tokenFile(file) {
  return () => {
    try {
      const t = fs.readFileSync(file, "utf8").trim();
      return t.length >= 32 ? t : null;
    } catch {
      return null;
    }
  };
}

const makers = makersStore({ file: path.join(paths.root, "makers.json") });
// The family coin pot (D202-D205): its numbers are settings, config.pot overrides them.
const pot = potStore({ logsDir: paths.logs, settings: config.pot ?? {} });
const cabinet = cabinetState({ root: paths.root });
const EXAMPLES = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../runtime/examples");
const roots = [{ root: paths.carts, source: /** @type {const} */ ("library") }, ...(values.examples ? [{ root: EXAMPLES, source: /** @type {const} */ ("example") }] : [])];

// Can Claude be reached? Checked now and then, never in the play path (E1, E2).
let online = !values.offline;
// When it changes, the screens hear at once: on a cabinet that starts before its Wi-Fi, the first check fails and the
// shelf said "No Wi-Fi" until something else changed (the 2026-11-13 card rehearsal, D325).
/** @type {() => void} */
let onlineChanged = () => {};
if (!replaying && !values.offline) {
  const set = (/** @type {boolean} */ now) => {
    if (now === online) return;
    online = now;
    onlineChanged();
  };
  const check = () =>
    dns.lookup("api.anthropic.com").then(
      () => set(true),
      () => set(false),
    );
  check();
  setInterval(check, 20_000).unref();
}
// D260: real speech where provisioning installed it (Moonshine, and Groq first with a key); the stub elsewhere.
const speech = cabinetSpeech({ config, logsDir: paths.logs, online: () => online, log: (m) => console.log(m) }) ?? stubSpeech();

// The publish gate (D310): one test at a time, at low priority, never while a game is being played.
const plays = playTracker();
const gate = values["no-gate"] || config.gate?.off ? null : createGate({ settings: gateSettings({ profile: values.profile ?? cabinetProfile(), gate: config.gate ?? {} }), playing: plays.playing, logsDir: paths.logs, log: (m) => console.log(m) });

/** @type {any} */
let api = null;
const studio = createStudio({
  paths,
  budgetCents: config.budget_cents ?? 300,
  // Seconds a question or plan waits with no key pressed (D188).
  questionTimeoutMs: Number(values["question-timeout"] ?? config.question_timeout_s ?? QUESTION_TIMEOUT_MS / 1000) * 1000,
  model: config.model,
  checker: gate ? gatedChecker(defaultChecker(), gate) : defaultChecker(),
  nameOf: (id) => makers.get(id)?.name ?? id,
  titleOf: (id) => readCart(paths.carts, id)?.title ?? null,
  onStart: (id) => makers.touch(id),
  pot,
  cabinet,
  online: () => online,
  // No key and not replaying: the Picade before connect-picade.sh (D252). Its screens say so, not "No Wi-Fi".
  connected: replaying || Boolean(values.config),
  findCart: (id) => {
    const c = listCarts(roots).find((x) => x.id === id);
    return c ? { id: c.id, dir: c.dir, version: c.version, maker: c.maker, family: c.family, branch: c.branch, title: c.title, session_id: c.session_id } : null;
  },
  recheckMs: config.recheck_s ? config.recheck_s * 1000 : undefined,
  api: async (resume, what) => {
    if (replaying) {
      // A fresh replay for each make; one picked up after a restart starts part way through (D191).
      const { replayApi, usageOf } = await import("../test-support/replay-api.js");
      const base = path.resolve(/** @type {string} */ (values.replay));
      // A change replays its own fixture: <replay>-change if there is one, else the recorded live change (D215).
      const changeDir = values["replay-change"] ? path.resolve(values["replay-change"]) : fs.existsSync(`${base}-change`) ? `${base}-change` : path.join(path.dirname(base), "log-hopper-change");
      const dir = what?.kind === "change" && fs.existsSync(changeDir) ? changeDir : base;
      const usage = usageOf(dir, values["replay-cost"] != null ? Number(values["replay-cost"]) : null);
      // Each replayed make is its own session, as live, so each is charged once (D208). A pick-up keeps its id.
      const sessionId = resume ? undefined : `sesn_replay_${Date.now().toString(36)}`;
      const r = replayApi({ dir, paceMs: Number(values.pace), resume, usage, noCart: values["replay-fail"], sessionId }).api;
      if (values["replay-limit"]) r.createSession = async () => Promise.reject(new Error("400 invalid_request_error: this workspace has reached its spend limit"));
      return r;
    }
    if (!api) {
      const { sdkApi } = await import("@game-studio-arcade/studio-cli/src/api.js");
      api = sdkApi(client);
    }
    return api;
  },
  lock: () => {
    if (replaying) return { agentId: "agent_replay", agentVersion: 1, environmentId: "env_replay" };
    return { agentId: config.agent_id, agentVersion: config.agent_version, environmentId: config.environment_id };
  },
  kit: async (client) => {
    if (replaying) return { fileId: "file_replay_kit", hash: "replay" };
    const { ensureKitUploaded } = await import("@game-studio-arcade/studio-cli/src/kit.js");
    return ensureKitUploaded({ api: client, cacheFile: paths.kitUploads, out: path.join(paths.root, "kit", "studio-kit.tgz") });
  },
});
onlineChanged = () => studio.refresh();

// The guests that ship in the repo (D231), then any in the data folder.
const guestDirs = values.guests ?? [path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../guests"), path.join(paths.root, "guests")];
// A downloaded game is on the shelf once its version passes the gate's smoke check (D310).
const guestChecks = guestGate({ file: path.join(paths.root, "gate", "guests.json"), gate, urlOf: (id, meta) => (guests.port ? `http://127.0.0.1:${guests.port}/${id}/${meta.entry}` : null) });
const guests = createGuests({ dirs: guestDirs, logsDir: paths.logs, admit: (id, meta) => guestChecks.admitted(id, meta), checking: () => guestChecks.pending() });
const guestServer = await startGuestServer(guests, { port: Number(values["guest-port"] ?? config.guest_port ?? 8340), host: values.host });
guests.port = guestServer.port;

// Request screening (D270-D275): the word list always; the model with the cabinet's own key, unless replaying.
// config.screening: false turns the model off (the list stays).
const screen = createScreener({ logsDir: paths.logs, model: client && config.screening !== false ? (text, o) => modelCheck(client, text, o) : null });

const s = await startService({
  screen,
  guests,
  plays,
  studio,
  makers,
  speech,
  libraryDir: paths.carts,
  logsDir: paths.logs,
  pot,
  cabinet,
  // The Cabinet Manager's pairing token (D205, D208). None: the Manager endpoints are off.
  // D215: or the pairing file beside the config, made on the cabinet by scripts/coin.mjs pair, read on each request.
  managerToken: values["manager-token"] ?? config.manager_token ?? (values.config ? tokenFile(path.join(path.dirname(values.config), "manager-token")) : null),
  players: config.players,
  consoleName: config.console_name,
  examples: values.examples,
  port: Number(values.port),
  host: values.host,
});
console.log(`cabinet service on ${s.url}, data in ${paths.root}`);
// Listing them also starts the publish gate's smoke check of any not checked yet (D312).
const onShelf = guests.list("").map((g) => g.id);
console.log(`guest games on ${guestServer.url}: ${guestDirs.flatMap(listGuests).map((g) => (onShelf.includes(g.id) ? g.id : `${g.id} (checking)`)).join(", ") || "none"}`);
console.log(replaying ? `REPLAYING ${values.replay}: no API calls, nothing spent (D186)` : values.config ? `Managed Agents, with the key in ${values.config} (D131)` : "OFFLINE with no key: the shelf plays, and Make waits until the cabinet is connected (D252)");
console.log(`speech: ${speech.kind} (D184). Kit source: ${MANAGED_AGENT_DIR}`);
console.log(gate ? `publish gate: on, ${gate.settings.host}, frame budget ${gate.settings.budgetMs} ms (cpu factor ${gate.settings.cpuFactor}, D128), nice ${gate.settings.nice} (D310)` : "publish gate: OFF");
studio.collectLeft();

for (const sig of /** @type {const} */ (["SIGINT", "SIGTERM"])) process.on(sig, () => (stopGateRuns(), Promise.all([s.close(), guestServer.close()]).then(() => process.exit(0))));
