// The real cabinet through the Manager (D369): every page, with the Picade's own key and host from picade-ssh.sh,
// against a stand-in ssh (fake-ssh.mjs) and a stand-in cabinet service. Also health warnings, the controls script,
// and the launchd agent's plist (D365-D368).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Cabinet, loadCabinets } from "../cabinet.mjs";
import { warnings } from "../health.mjs";
import { createManager } from "../server.mjs";
import { PICADE_HOST, PICADE_KEY_NAME } from "../../scripts/cabinet-card/picade.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

/** A Picade on this machine: its folders, shims and a stand-in service that wants the paired token. */
async function picade() {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), "gsa-real-"));
  const root = path.join(t, "cabinet");
  const bin = path.join(t, "bin");
  const shims = path.join(root, "shims");
  for (const d of [bin, shims, path.join(root, "var/lib/arcade/logs"), path.join(root, "etc/arcade"), path.join(root, "run/arcade")]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(bin, "ssh"), `#!/bin/bash\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(HERE, "fake-ssh.mjs"))} "$@"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(shims, "sudo"), '#!/bin/bash\n[ "$1" = -n ] && shift\nexec "$@"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(shims, "chown"), "#!/bin/bash\nexit 0\n", { mode: 0o755 });
  fs.writeFileSync(path.join(t, "shot.png"), PNG);
  fs.writeFileSync(path.join(shims, "arcade-screenshot"), `#!/bin/bash\ncat ${JSON.stringify(path.join(t, "shot.png"))}\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(shims, "arcade-keyd"), `#!/bin/bash\necho "$@" >> ${JSON.stringify(path.join(t, "keys.log"))}\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(root, "var/lib/arcade/logs/studio_session.jsonl"), JSON.stringify({ type: "studio_session", id: "s1", maker: "ivy", request: "a frog game", outcome: "committed", started_at: "2026-11-14T10:00:00Z" }) + "\n");
  // The cabinet's service: Manager endpoints only with the token pairing made.
  const service = http.createServer((req, res) => {
    const token = fs.existsSync(path.join(root, "etc/arcade/manager-token")) ? fs.readFileSync(path.join(root, "etc/arcade/manager-token"), "utf8").trim() : null;
    const ok = token && req.headers.authorization === `Bearer ${token}`;
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/studio") return res.end(JSON.stringify({ phase: "idle" }));
    if (!ok) return res.writeHead(401).end(JSON.stringify({ ok: false, error: "the Manager's token is needed" }));
    if (req.url === "/api/manager/pot") return res.end(JSON.stringify({ pot: { coins: 100 }, history: [] }));
    if (req.url === "/api/manager/games") return res.end(JSON.stringify({ games: [{ id: "frog", on_shelf: true }], history: [] }));
    res.writeHead(404).end(JSON.stringify({ ok: false, error: "no such endpoint" }));
  });
  await new Promise((r) => service.listen(0, "127.0.0.1", r));
  // The mini's side: the Picade's folder as picade-ssh.sh names it (GSA_CABINET_DIR moves it), with its key.
  const cabinetDir = path.join(t, "cabinets/arcade");
  fs.mkdirSync(path.join(cabinetDir, "ssh"), { recursive: true });
  fs.writeFileSync(path.join(cabinetDir, "ssh", PICADE_KEY_NAME), "not a real key\n", { mode: 0o600 });
  const env = { PATH: `${bin}:${process.env.PATH}`, FAKE_ROOT: root, FAKE_SERVICE_PORT: String(/** @type {any} */ (service.address()).port), FAKE_SSH_LOG: path.join(t, "ssh.log"), GSA_CABINET_DIR: cabinetDir };
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    service.close();
  };
  return { t, root, cabinetDir, configDir: path.join(t, "config"), restore, sshCalls: () => fs.readFileSync(env.FAKE_SSH_LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l)) };
}

test("real: every Manager page through the Picade's own key and host, pairing first (D369)", async () => {
  const p = await picade();
  /** @type {Cabinet | null} */
  let cab = null;
  try {
    const real = loadCabinets(path.join(p.t, "data"), p.configDir).find((c) => c.name === "real");
    assert.ok(real);
    assert.equal(real.host, PICADE_HOST);
    assert.equal(real.key, path.join(p.cabinetDir, "ssh", PICADE_KEY_NAME));
    cab = new Cabinet(real);
    const server = createManager({ key: "k", cabinets: new Map([["real", cab]]) });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;
    const login = await fetch(`${base}/?key=k`, { redirect: "manual" });
    const cookie = String(login.headers.get("set-cookie")).split(";")[0];
    const get = async (/** @type {string} */ u) => fetch(`${base}${u}`, { headers: { Cookie: cookie } });
    const post = async (/** @type {string} */ u, /** @type {any} */ b) => fetch(`${base}${u}`, { method: "POST", headers: { Cookie: cookie, "X-Manager": "1", "Content-Type": "application/json" }, body: JSON.stringify(b) });
    try {
      // Coins before pairing: says so.
      const unpaired = await get("/api/c/real/pot");
      assert.equal(unpaired.status, 409);
      assert.equal((await unpaired.json()).unpaired, true);
      // Pair: the cabinet makes its token, the mini keeps a copy (0600).
      assert.equal((await post("/api/c/real/pair", {})).status, 200);
      const tokenHere = fs.readFileSync(real.tokenFile, "utf8").trim();
      assert.match(tokenHere, /^[0-9a-f]{64}$/);
      assert.equal(fs.statSync(real.tokenFile).mode & 0o777, 0o600);
      assert.equal(fs.readFileSync(path.join(p.root, "etc/arcade/manager-token"), "utf8").trim(), tokenHere);
      // Coins and Games, through the forwarded port with the token.
      assert.equal((await (await get("/api/c/real/pot")).json()).pot.coins, 100);
      assert.equal((await (await get("/api/c/real/games")).json()).games[0].id, "frog");
      // Activity: the cabinet's logs.
      const act = await (await get("/api/c/real/activity")).json();
      assert.equal(act.makes[0].said, "a frog game");
      // Screen: a frame from the compositor's screenshot.
      await cab.grab();
      assert.deepEqual(cab.frame?.png, PNG);
      // Health: the script runs (here, on this machine: most readings are null, never an error).
      const h = await (await get("/api/c/real/health")).json();
      assert.ok(h.health && Array.isArray(h.warnings));
      assert.ok(Array.isArray(h.health.journal));
      // Keys: off until the driver keyboard is switched on (D287), then they land.
      const off = await post("/api/c/real/keys", { how: "down", codes: ["KeyZ"] });
      assert.match((await off.json()).error, /driver keyboard is off/);
      // Every ssh call used the Picade's key, as the admin, at its host.
      const calls = p.sshCalls();
      assert.ok(calls.length > 4);
      for (const c of calls) {
        assert.equal(c[c.indexOf("-i") + 1], real.key);
        assert.ok(c.includes(`cabinet@${PICADE_HOST}`), JSON.stringify(c));
      }
    } finally {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  } finally {
    cab?.close();
    p.restore();
  }
});

test("real: a Picade that doesn't answer says why, and no page hangs (D369)", async () => {
  const p = await picade();
  process.env.FAKE_SSH_UNREACHABLE = "1";
  const real = loadCabinets(path.join(p.t, "data"), p.configDir).find((c) => c.name === "real");
  const cab = new Cabinet(/** @type {any} */ (real));
  try {
    await assert.rejects(() => cab.health(), /No route to host/);
    assert.match(cab.problem, /can't reach arcade.local: .*No route to host/);
  } finally {
    delete process.env.FAKE_SSH_UNREACHABLE;
    cab.close();
    p.restore();
  }
});

test("health warnings: hot, throttled, low disk, weak Wi-Fi, a service down; nothing when fine (D365)", () => {
  const fine = { cpu_temp_c: 55, throttled: { now: [], since_boot: [] }, wifi: { signal: 70, dbm: -55, band: "5 GHz" }, disk: { root: { free_mb: 20000, free_pct: 70 }, boot: { free_mb: 300 } }, services: { "arcade-launcher": "active", "arcade-kiosk": "active" } };
  assert.deepEqual(warnings(fine), []);
  assert.deepEqual(warnings({ cpu_temp_c: null, throttled: null, wifi: null, disk: {}, services: {} }), []);
  const w = warnings({ cpu_temp_c: 83.2, throttled: { now: ["under-voltage", "throttled"], since_boot: [] }, wifi: { signal: 30, dbm: -78, band: "2.4 GHz" }, disk: { root: { free_mb: 800, free_pct: 3 }, boot: { free_mb: 12 } }, services: { "arcade-launcher": "failed", "arcade-kiosk": "active" } });
  assert.deepEqual(w.map((x) => x.level), ["bad", "bad", "bad", "warn", "warn", "bad"]);
  assert.match(w[0].text, /83 °C/);
  assert.match(w[1].text, /under-voltage.*power supply/);
  assert.match(w[4].text, /Weak Wi-Fi: 30% \(-78 dBm\) on 2.4 GHz/);
  assert.equal(warnings({ ...fine, throttled: { now: [], since_boot: ["soft temperature limit"] } })[0].level, "warn");
  assert.equal(warnings({ ...fine, cpu_temp_c: 75 })[0].level, "note");
});

/** control.sh with stand-ins for amixer, aplay, alsactl, systemctl and the update's busy check. */
function control(/** @type {string[]} */ args, /** @type {{ busy?: string, card?: boolean, lib?: boolean }} */ o = {}) {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), "gsa-control-"));
  const bin = path.join(t, "bin");
  fs.mkdirSync(bin);
  const log = path.join(t, "calls");
  const vol = path.join(t, "vol");
  fs.writeFileSync(vol, "40");
  const sh = (/** @type {string} */ name, /** @type {string} */ body) => fs.writeFileSync(path.join(bin, name), `#!/bin/bash\necho "${name} $*" >> ${JSON.stringify(log)}\n${body}\n`, { mode: 0o755 });
  sh("aplay", o.card === false ? "exit 0" : 'echo "card 0: sndrpihifiberry [snd_rpi_hifiberry_dac], device 0"');
  sh("amixer", `case "$*" in *sset*) v="\${@: -1}"; echo "\${v%\\%}" > ${JSON.stringify(vol)} ;; esac; echo "  Front Left: 255 [$(cat ${JSON.stringify(vol)})%]"`);
  sh("systemctl", "exit 0");
  sh("systemd-run", "exit 0");
  const lib = path.join(t, "update-lib.sh");
  if (o.lib !== false) fs.writeFileSync(lib, `busy_reason() { echo ${JSON.stringify(o.busy ?? "")}; }\n`);
  const r = spawnSync("bash", [path.join(REPO, "manager/remote/control.sh"), ...args], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ARCADE_UPDATE_LIB: lib } });
  return { out: JSON.parse(r.stdout.trim().split("\n").at(-1) ?? "{}"), calls: fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "", code: r.status };
}

test("controls: volume read and set (kept with alsactl), no speaker on the VM (D366)", () => {
  assert.deepEqual(control(["volume"]).out, { speaker: true, percent: 40 });
  const set = control(["volume", "65"]);
  assert.deepEqual(set.out, { speaker: true, percent: 65 });
  assert.match(set.calls, /amixer -q -c sndrpihifiberry sset PCM 65%/);
  assert.deepEqual(control(["volume"], { card: false }).out, { speaker: false });
  assert.match(control(["volume", "101"]).out.error, /0 to 100/);
  assert.match(control(["volume", "loud"]).out.error, /whole number/);
});

test("controls: restart and switch off are refused while busy, and say why (D367, D332)", () => {
  const busy = control(["reboot"], { busy: "a game is being played (teti)" });
  assert.deepEqual(busy.out, { ok: false, why: "a game is being played (teti): nothing was changed" });
  assert.doesNotMatch(busy.calls, /systemd-run|systemctl/);
  assert.match(control(["restart-shelf"]).calls, /systemctl restart arcade-launcher arcade-kiosk/);
  assert.match(control(["reboot"]).calls, /systemd-run --quiet --on-active=2 \/bin\/systemctl reboot/);
  assert.deepEqual(control(["poweroff"]).out, { ok: true, done: "poweroff" });
  assert.match(control(["poweroff"], { lib: false }).out.why, /too old/);
});

test("the Manager's power and volume routes: one confirm, a refusal shown, the range checked (D366, D367)", async () => {
  const calls = [];
  const cab = { config: { label: "x", host: "h" }, problem: "", frame: null, close() {}, async act(/** @type {string} */ a, /** @type {number} */ v) {
    calls.push([a, v]);
    if (a === "volume") return { speaker: true, percent: v ?? 50 };
    return a === "reboot" ? { ok: false, why: "a make is running: nothing was changed" } : { ok: true, done: a };
  } };
  const server = createManager({ key: "k", cabinets: new Map([["real", cab]]) });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;
  try {
    const cookie = String((await fetch(`${base}/?key=k`, { redirect: "manual" })).headers.get("set-cookie")).split(";")[0];
    const post = (/** @type {string} */ u, /** @type {any} */ b) => fetch(`${base}${u}`, { method: "POST", headers: { Cookie: cookie, "X-Manager": "1" }, body: JSON.stringify(b) });
    assert.equal((await post("/api/c/real/power", { action: "poweroff" })).status, 400);
    assert.equal((await post("/api/c/real/power", { action: "format-disk", confirm: true })).status, 400);
    const refused = await post("/api/c/real/power", { action: "reboot", confirm: true });
    assert.equal(refused.status, 409);
    assert.match((await refused.json()).error, /a make is running/);
    assert.equal((await post("/api/c/real/power", { action: "restart-shelf", confirm: true })).status, 200);
    assert.equal((await post("/api/c/real/volume", { percent: 140 })).status, 400);
    assert.equal((await (await post("/api/c/real/volume", { percent: 70 })).json()).percent, 70);
    assert.deepEqual(calls, [["reboot", undefined], ["restart-shelf", undefined], ["volume", 70]]);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});

test("launchd: the agent starts the Manager at login and keeps it on, with no window; never from a worktree (D368)", () => {
  const plist = execFileSync("bash", [path.join(REPO, "scripts/manager-launchd/install.sh"), "--print"], { encoding: "utf8", env: { ...process.env, MANAGER_NODE: process.execPath } });
  assert.match(plist, /<key>Label<\/key><string>com\.game-studio-arcade\.manager<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(plist, /<key>KeepAlive<\/key><true\/>/);
  assert.match(plist, /manager\/server\.mjs<\/string>\s*<string>--port<\/string>\s*<string>8335<\/string>/);
  if (process.platform === "darwin") assert.equal(spawnSync("plutil", ["-lint", "-"], { input: plist }).status, 0);
  if (REPO.includes("/.claude/worktrees/")) {
    const r = spawnSync("bash", [path.join(REPO, "scripts/manager-launchd/install.sh")], { encoding: "utf8", env: { ...process.env, MANAGER_NODE: process.execPath, LAUNCH_AGENTS_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "agents-")) } });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /worktree/);
  }
});
