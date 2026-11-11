// One cabinet as the Manager sees it (D280-D286): a held SSH connection, its screen, its keys, its logs,
// and its service's Manager endpoints through a forwarded port. Nothing here writes to the cabinet except
// keys Geoff presses, coin actions he asks for, and pairing.
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const HOME = os.homedir();
export const CONFIG_DIR = path.join(HOME, ".config", "game-studio-arcade");
export const DATA_DIR = path.join(HOME, "game-studio-data");
const CABINET_TOKEN = "/etc/arcade/manager-token";
const SERVICE_PORT = 8330;
const LOGS = "/var/lib/arcade/logs";

/**
 * @typedef {{ name: string, label: string, host: string, key: string, knownHosts: string, tokenFile: string, user?: string }} CabinetConfig
 */

/** The cabinets the Manager knows (D286). @returns {CabinetConfig[]} */
export function loadCabinets(dataDir = DATA_DIR, configDir = CONFIG_DIR) {
  const vm = path.join(dataDir, "vm");
  let vmHost = "arcade-virtual.local";
  try {
    vmHost = fs.readFileSync(path.join(vm, "host"), "utf8").trim() || vmHost;
  } catch {}
  const picade = path.join(dataDir, "picade");
  /** @type {Record<string, CabinetConfig>} */
  const all = {
    virtual: { name: "virtual", label: "Virtual cabinet", host: vmHost, key: path.join(vm, "ssh/arcade-virtual_ed25519"), knownHosts: path.join(vm, "ssh/known_hosts"), tokenFile: path.join(configDir, "manager-token") },
    real: { name: "real", label: "Real cabinet (Picade)", host: "arcade.local", key: path.join(picade, "ssh/arcade_ed25519"), knownHosts: path.join(picade, "ssh/known_hosts"), tokenFile: path.join(configDir, "manager-token-real") },
  };
  const file = path.join(dataDir, "manager", "cabinets.json");
  if (fs.existsSync(file)) {
    const extra = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const [name, c] of Object.entries(extra)) {
      if (!/^[a-z][a-z0-9-]{0,30}$/.test(name)) throw new Error(`${file}: bad cabinet name ${name}`);
      all[name] = { ...(all[name] ?? { label: name, knownHosts: path.join(dataDir, "manager", `${name}_known_hosts`), tokenFile: path.join(configDir, `manager-token-${name}`) }), ...c, name };
    }
  }
  return Object.values(all);
}

/** A free port on 127.0.0.1. @returns {Promise<number>} */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      s.close(() => resolve(typeof a === "object" && a ? a.port : 0));
    });
  });
}

export class Cabinet {
  /** @param {CabinetConfig} config */
  constructor(config) {
    this.config = config;
    this.control = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gsa-manager-")), "c");
    /** @type {import("node:child_process").ChildProcess | null} */
    this.master = null;
    /** @type {number | null} */
    this.servicePort = null;
    /** @type {Promise<void> | null} */
    this.opening = null;
    this.problem = "";
    /** @type {{ png: Buffer, hash: string, at: number, changedAt: number } | null} */
    this.frame = null;
    this.lastTryAt = 0;
    /** @type {Promise<any>} */
    this.keyChain = Promise.resolve();
    this.canDrive = /** @type {boolean | null} */ (null);
  }

  sshArgs() {
    const c = this.config;
    return ["-4", "-i", c.key, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "StrictHostKeyChecking=accept-new", "-o", `UserKnownHostsFile=${c.knownHosts}`, "-S", this.control];
  }

  get target() {
    return `${this.config.user ?? "cabinet"}@${this.config.host}`;
  }

  /** Open the held connection, with the service's port forwarded, if it isn't open. */
  async open() {
    if (this.master && this.master.exitCode === null && this.servicePort) return;
    if (this.opening) return this.opening;
    this.opening = (async () => {
      if (!fs.existsSync(this.config.key)) {
        this.problem = `no SSH key for this cabinet at ${this.config.key}`;
        throw new Error(this.problem);
      }
      fs.mkdirSync(path.dirname(this.config.knownHosts), { recursive: true });
      const port = await freePort();
      const child = spawn("ssh", [...this.sshArgs(), "-M", "-N", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4", "-o", "ExitOnForwardFailure=yes", "-L", `127.0.0.1:${port}:127.0.0.1:${SERVICE_PORT}`, this.target], { stdio: ["ignore", "ignore", "pipe"] });
      let err = "";
      child.stderr?.on("data", (d) => (err += d));
      child.on("exit", () => {
        if (this.master === child) {
          this.master = null;
          this.servicePort = null;
        }
      });
      this.master = child;
      const until = Date.now() + 12000;
      for (;;) {
        if (child.exitCode !== null) {
          this.problem = `can't reach ${this.config.host}: ${err.trim().split("\n").filter((l) => !/rptl|SSH may not|^$/.test(l)).at(-1) ?? "SSH failed"}`;
          throw new Error(this.problem);
        }
        const ok = await run("ssh", [...this.sshArgs(), "-O", "check", this.target], { timeout: 5000 }).then(() => true, () => false);
        if (ok) break;
        if (Date.now() > until) {
          child.kill();
          this.problem = `no answer from ${this.config.host}`;
          throw new Error(this.problem);
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      this.servicePort = port;
      this.problem = "";
    })().finally(() => (this.opening = null));
    return this.opening;
  }

  close() {
    this.master?.kill();
    this.master = null;
  }

  /** Run a command on the cabinet through the held connection. @param {string} command @param {{ input?: string, timeout?: number, binary?: boolean }} [o] */
  async exec(command, o = {}) {
    await this.open();
    return new Promise((resolve, reject) => {
      const child = execFile("ssh", [...this.sshArgs(), this.target, command], { encoding: o.binary ? "buffer" : "utf8", maxBuffer: 2 ** 26, timeout: o.timeout ?? 20000 }, (e, stdout, stderr) => {
        if (e) reject(Object.assign(new Error(`${command.split(" ")[0]}: ${String(stderr).trim().split("\n").at(-1) || e.message}`), { code: e.code }));
        else resolve(stdout);
      });
      if (o.input !== undefined) child.stdin?.end(o.input);
    });
  }

  /** Take one screenshot (D281). Keeps the last good one. */
  async grab() {
    this.lastTryAt = Date.now();
    try {
      const png = /** @type {Buffer} */ (await this.exec("sudo -n arcade-screenshot", { binary: true, timeout: 8000 }));
      if (png.subarray(1, 4).toString() !== "PNG") throw new Error("not a PNG");
      const hash = createHash("sha1").update(png).digest("hex");
      const now = Date.now();
      const changed = !this.frame || this.frame.hash !== hash;
      this.frame = { png, hash, at: now, changedAt: changed ? now : (this.frame?.changedAt ?? now) };
      this.problem = "";
      return changed;
    } catch (e) {
      this.problem = this.problem || /** @type {Error} */ (e).message;
      if (!this.master || this.master.exitCode !== null) this.problem = /** @type {Error} */ (e).message;
      throw e;
    }
  }

  /** Whether this cabinet has the driver keyboard (D282). */
  async driveable() {
    if (this.canDrive !== null) return this.canDrive;
    try {
      await this.exec("test -S /run/arcade/keys.sock && command -v arcade-keyd", { timeout: 8000 });
      this.canDrive = true;
    } catch (e) {
      if (/** @type {any} */ (e).code === 255) throw e;
      this.canDrive = false;
    }
    return this.canDrive;
  }

  /** Key down or up, in order (D282). @param {"down" | "up"} how @param {number[]} codes */
  keys(how, codes) {
    const go = async () => {
      if (!(await this.driveable())) throw new Error("this cabinet has no driver keyboard (D282): use its own controls");
      await this.exec(`sudo -n arcade-keyd id=${randomUUID().replaceAll("-", "")} ${how} ${codes.join(" ")}`, { timeout: 15000 });
    };
    const p = this.keyChain.then(go, go);
    this.keyChain = p.catch(() => {});
    return p;
  }

  /** The tail of each log file (D283). @returns {Promise<Record<string, any[]>>} */
  async logs(lines = 400) {
    const out = await this.exec(`for f in ${LOGS}/*.jsonl; do [ -f "$f" ] || continue; echo "#FILE $(basename "$f" .jsonl)"; tail -n ${Number(lines)} "$f"; done`, { timeout: 20000 });
    /** @type {Record<string, any[]>} */
    const files = {};
    let cur = null;
    for (const line of String(out).split("\n")) {
      if (line.startsWith("#FILE ")) {
        cur = line.slice(6).trim();
        files[cur] = [];
      } else if (cur && line.trim()) {
        try {
          files[cur].push(JSON.parse(line));
        } catch {}
      }
    }
    return files;
  }

  /** One request to the service's Manager endpoints (D284). @param {"GET"|"POST"} method @param {string} p @param {object} [body] */
  async service(method, p, body) {
    await this.open();
    const token = this.token();
    const r = await fetch(`http://127.0.0.1:${this.servicePort}${p}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    const text = await r.text();
    let parsed = text;
    try {
      parsed = JSON.parse(text);
    } catch {}
    return { status: r.status, body: parsed };
  }

  /** What the cabinet's Studio is doing now (its public /api/studio, D183). */
  async studioNow() {
    await this.open();
    const r = await fetch(`http://127.0.0.1:${this.servicePort}/api/studio`, { signal: AbortSignal.timeout(10000) });
    return r.ok ? r.json() : null;
  }

  token() {
    const f = this.config.tokenFile;
    if (!fs.existsSync(f)) throw Object.assign(new Error("not paired: this Manager has no token for this cabinet yet"), { unpaired: true });
    const st = fs.statSync(f);
    if (st.mode & 0o077) throw new Error(`${f} can be read by others; chmod 600 it`);
    return fs.readFileSync(f, "utf8").trim();
  }

  /** Make the cabinet's token if it has none, and keep a copy here (as coin.mjs pair, D208). */
  async pair() {
    const make = `sudo -n sh -c 'if [ ! -s ${CABINET_TOKEN} ]; then umask 077; head -c 32 /dev/urandom | od -An -tx1 | tr -d " \\n" > ${CABINET_TOKEN}; chown arcade:arcade ${CABINET_TOKEN}; chmod 600 ${CABINET_TOKEN}; fi; cat ${CABINET_TOKEN}'`;
    const out = String(await this.exec(make));
    const token = out.trim().split("\n").at(-1) ?? "";
    if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("the cabinet didn't make a token");
    fs.mkdirSync(path.dirname(this.config.tokenFile), { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.config.tokenFile, `${token}\n`, { mode: 0o600 });
    fs.chmodSync(this.config.tokenFile, 0o600);
  }
}
