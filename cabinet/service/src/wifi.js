// @ts-check
// The cabinet's own Wi-Fi (D410-D416): the networks it knows, kept where a power cut or an update can't lose
// them; looking for networks and joining one, for the launcher's Wi-Fi screens; and the watch that brings a
// lost Wi-Fi back. Everything here goes through NetworkManager's nmcli. It runs as root, in arcade-wifi.js;
// the cabinet service (user arcade, no sudo) reaches it over a socket only it may open.
//
// A network is one NetworkManager keyfile that we write ourselves, whole and flushed, in two places:
//   STORE  /var/lib/arcade-wifi/                     ours; nothing else writes here
//   LIVE   /etc/NetworkManager/system-connections/   where NetworkManager reads it
// The watch puts back any that go missing from LIVE. The card's first network arrives through cloud-init and
// netplan (D251), whose copy NetworkManager rewrites by itself; `adopt` makes it one of ours too.
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const STORE = "/var/lib/arcade-wifi";
export const LIVE = "/etc/NetworkManager/system-connections";
export const STATUS_FILE = "/run/arcade-wifi/status.json";
export const COUNTRY_FILE = "/etc/arcade/wifi-country";
export const SOCKET = "/run/arcade-wifi.sock";
const PREFIX = "arcade-wifi-";

/** @typedef {{ code: number, stdout: string, stderr: string }} Ran */
/** @typedef {(cmd: string, args: string[], opts?: { timeoutMs?: number }) => Promise<Ran>} Run */

/** @type {Run} */
export const realRun = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: opts.timeoutMs ?? 60_000, encoding: "utf8", maxBuffer: 4 << 20 }, (err, stdout, stderr) => {
      const code = err ? (typeof (/** @type {any} */ (err).code) === "number" ? /** @type {any} */ (err).code : 1) : 0;
      resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });

// ---------- pure: names, passwords, nmcli's output, the keyfile ----------

/** A network name is 1 to 32 bytes. @param {unknown} ssid */
export const validSsid = (ssid) => typeof ssid === "string" && Buffer.byteLength(ssid, "utf8") >= 1 && Buffer.byteLength(ssid, "utf8") <= 32 && !/[\0\n\r]/.test(ssid);
/** A WPA password: 8 to 63 printable ASCII characters, or the 64-hex key itself. @param {unknown} p */
export const validPassword = (p) => typeof p === "string" && (/^[\x20-\x7e]{8,63}$/.test(p) || /^[0-9a-fA-F]{64}$/.test(p));

/** One line of `nmcli -t`: fields split at ":", where "\:" is a colon and "\\" a backslash. @param {string} line */
export function splitTerse(line) {
  /** @type {string[]} */
  const out = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && i + 1 < line.length) cur += line[++i];
    else if (ch === ":") out.push(cur), (cur = "");
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * How a network is secured, from nmcli's SECURITY column ("WPA2", "WPA2 WPA3", "WPA2 802.1X", "WEP", "" or "--").
 * @param {string} security
 * @returns {"open" | "psk" | "sae" | "no"} "no": a kind this cabinet doesn't join (a username, or WEP)
 */
export function securityKind(security) {
  const s = security.trim();
  if (!s || s === "--") return "open";
  if (/802\.1X|WEP/i.test(s)) return "no";
  if (/WPA3/i.test(s) && !/WPA[12]\b/i.test(s)) return "sae";
  return "psk";
}

/**
 * `nmcli -t -f IN-USE,SSID,SIGNAL,SECURITY device wifi list`, as the screen's list: one row a name (its strongest
 * access point), strongest first, hidden names dropped.
 * @param {string} text
 * @returns {{ ssid: string, signal: number, secure: boolean, kind: ReturnType<typeof securityKind>, inUse: boolean }[]}
 */
export function parseScan(text) {
  /** @type {Map<string, { ssid: string, signal: number, secure: boolean, kind: ReturnType<typeof securityKind>, inUse: boolean }>} */
  const by = new Map();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const [inUse, ssid, signal, security = ""] = splitTerse(line);
    if (!ssid || !validSsid(ssid)) continue;
    const kind = securityKind(security);
    const row = { ssid, signal: Number(signal) || 0, secure: kind !== "open", kind, inUse: inUse.trim() === "*" };
    const had = by.get(ssid);
    if (!had) by.set(ssid, row);
    else by.set(ssid, { ...(row.signal > had.signal ? row : had), inUse: had.inUse || row.inUse });
  }
  return [...by.values()].sort((a, b) => Number(b.inUse) - Number(a.inUse) || b.signal - a.signal || a.ssid.localeCompare(b.ssid));
}

/** The keyfile's name for a network: stable for a name, and safe as a file name whatever the name holds. @param {string} ssid */
export const idFor = (ssid) => `${PREFIX}${createHash("sha256").update(ssid, "utf8").digest("hex").slice(0, 12)}`;

/**
 * A keyfile string value, with every space written out so none is trimmed. Only the escapes GLib's key files
 * know for a plain value: backslash-s, backslash-t and a doubled backslash. A semicolon is itself; escaping it
 * makes NetworkManager refuse the file (found against a real NetworkManager in the rehearsal, D418).
 * @param {string} s
 */
const keyfileValue = (s) => s.replace(/\\/g, "\\\\").replace(/ /g, "\\s").replace(/\t/g, "\\t");

/**
 * The NetworkManager keyfile for one network. It asks, itself, for what D411 wants of every network: join by
 * itself, keep trying for ever, and no power saving.
 * @param {{ ssid: string, password?: string | null, kind: "open" | "psk" | "sae", priority: number, uuid: string }} o
 */
export function keyfile(o) {
  if (!validSsid(o.ssid)) throw new Error("a Wi-Fi network name is 1 to 32 bytes");
  if (o.kind !== "open" && !validPassword(o.password)) throw new Error("a Wi-Fi password is 8 to 63 characters");
  if (!/^[0-9a-f-]{36}$/.test(o.uuid)) throw new Error("bad uuid");
  const lines = [
    "# Written by the arcade's Wi-Fi helper (D410). Its twin is in /var/lib/arcade-wifi; the watch puts this one back.",
    "[connection]",
    `id=${idFor(o.ssid)}`,
    `uuid=${o.uuid}`,
    "type=wifi",
    "autoconnect=true",
    `autoconnect-priority=${Math.max(0, Math.min(999, Math.round(o.priority)))}`,
    "autoconnect-retries=0",
    "",
    "[wifi]",
    "mode=infrastructure",
    // As bytes, so no name needs escaping.
    `ssid=${[...Buffer.from(o.ssid, "utf8")].join(";")};`,
    "powersave=2",
    "",
  ];
  if (o.kind !== "open") lines.push("[wifi-security]", `key-mgmt=${o.kind === "sae" ? "sae" : "wpa-psk"}`, `psk=${keyfileValue(String(o.password))}`, "");
  // eui64: the link-local address follows the hardware address, so the mini finds the cabinet on a bare cable or a quiet network.
  lines.push("[ipv4]", "method=auto", "", "[ipv6]", "method=auto", "addr-gen-mode=eui64", "");
  return lines.join("\n");
}

/** What a keyfile of ours says. @param {string} text @returns {{ ssid: string, priority: number, uuid: string } | null} */
export function readKeyfile(text) {
  const ssid = /^ssid=((?:\d+;)+)$/m.exec(text);
  const uuid = /^uuid=([0-9a-f-]{36})$/m.exec(text);
  if (!ssid || !uuid) return null;
  return { ssid: Buffer.from(ssid[1].split(";").filter(Boolean).map(Number)).toString("utf8"), priority: Number(/^autoconnect-priority=(\d+)$/m.exec(text)?.[1] ?? 0), uuid: uuid[1] };
}

/** Why a join failed, for a grown-up, from what nmcli said. @param {string} said */
export function whyFailed(said) {
  if (/Secrets were required|802-1x|supplicant|password|psk|4-way|auth/i.test(said)) return "The password didn't work.";
  if (/No network with SSID|could not be found|not found|ssid-not-found/i.test(said)) return "The network went out of range.";
  if (/IP configuration|ip-config|dhcp/i.test(said)) return "It joined, but the network gave the cabinet no address.";
  if (/Timeout|timed out|took too long/i.test(said)) return "The network didn't answer in time. The signal may be too weak here.";
  return "The password may be wrong, or the signal is too weak here.";
}

// ---------- files that survive a power cut ----------

/** Write a file whole: beside itself, flushed, renamed, and the folder flushed (D371's rule). @param {string} file @param {string} text @param {number} mode */
export function writeDurable(file, text, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.new`;
  const fd = fs.openSync(tmp, "w", mode);
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, file);
  const dir = fs.openSync(path.dirname(file), "r");
  try {
    fs.fsyncSync(dir);
  } catch {
    // Some filesystems can't flush a folder; the rename is still whole.
  } finally {
    fs.closeSync(dir);
  }
}

// ---------- the helper ----------

/**
 * @param {{ run?: Run, store?: string, live?: string, statusFile?: string, countryFile?: string, log?: (m: string) => void, now?: () => number }} [o]
 */
export function createWifi(o = {}) {
  const run = o.run ?? realRun;
  const store = o.store ?? STORE;
  const live = o.live ?? LIVE;
  const log = o.log ?? (() => {});
  const nm = (/** @type {string[]} */ args, timeoutMs = 30_000) => run("nmcli", args, { timeoutMs });

  /** Ours, from the store. @returns {{ file: string, text: string, ssid: string, priority: number, uuid: string }[]} */
  const known = () => {
    /** @type {{ file: string, text: string, ssid: string, priority: number, uuid: string }[]} */
    const out = [];
    let names = /** @type {string[]} */ ([]);
    try {
      names = fs.readdirSync(store);
    } catch {
      return out;
    }
    for (const name of names.sort()) {
      if (!name.startsWith(PREFIX) || !name.endsWith(".nmconnection")) continue;
      const text = fs.readFileSync(path.join(store, name), "utf8");
      const k = readKeyfile(text);
      if (k) out.push({ file: name, text, ...k });
    }
    return out;
  };

  /** Put back any of ours that LIVE lacks or holds differently. Returns how many it put back. */
  const restore = async () => {
    let n = 0;
    for (const k of known()) {
      const to = path.join(live, k.file);
      let have = null;
      try {
        have = fs.readFileSync(to, "utf8");
      } catch {
        // Missing: put it back.
      }
      if (have === k.text) continue;
      writeDurable(to, k.text, 0o600);
      n++;
    }
    if (n) {
      log(`put back ${n} saved network${n === 1 ? "" : "s"}`);
      await nm(["connection", "reload"]);
    }
    return n;
  };

  /** The Wi-Fi device's name, or null. */
  const device = async () => {
    const r = await nm(["-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device", "status"]);
    const rows = r.stdout.split("\n").filter(Boolean).map(splitTerse);
    const wifi = rows.find((f) => f[1] === "wifi");
    // A cable counts only when it carries the cabinet's traffic: the default route. The Picade's eth0 and its USB
    // service port both say "connected" with nothing plugged in (the card worker's finding, 2026-11-14).
    const route = await run("ip", ["-4", "route", "show", "default"]);
    const via = /\bdev (\S+)/.exec(route.stdout.split("\n")[0] ?? "")?.[1] ?? null;
    const wired = rows.some((f) => f[1] === "ethernet" && f[0] === via && /^connected/.test(f[2] ?? ""));
    return { ok: r.code === 0, name: wifi?.[0] ?? null, state: wifi?.[2] ?? null, connection: wifi && /^connected/.test(wifi[2] ?? "") ? wifi[3] || null : null, wired };
  };

  /** Where the Wi-Fi stands now. */
  const status = async () => {
    const d = await device();
    /** @type {{ device: string | null, connected: boolean, ssid: string | null, signal: number | null, address: string | null, wired: boolean, nm: boolean }} */
    const s = { device: d.name, connected: false, ssid: null, signal: null, address: null, wired: d.wired, nm: d.ok };
    if (!d.name || !d.connection) return s;
    s.connected = true;
    const list = await nm(["-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "device", "wifi", "list", "ifname", d.name, "--rescan", "no"]);
    const here = parseScan(list.stdout).find((n) => n.inUse);
    s.ssid = here?.ssid ?? null;
    s.signal = here?.signal ?? null;
    // The lease's own address first: just after a change of network the device can still list the old network's
    // address beside the new one for a moment (seen in the rehearsal, D418).
    const ip = await nm(["-g", "DHCP4.OPTION,IP4.ADDRESS", "device", "show", d.name]);
    s.address = /\bip_address = (\d+(?:\.\d+){3})/.exec(ip.stdout)?.[1] ?? /(\d+(?:\.\d+){3})\/\d+/.exec(ip.stdout)?.[1] ?? null;
    return s;
  };

  /** Look for networks. `saved` marks the ones the cabinet can join without a password. */
  const scan = async () => {
    const d = await device();
    if (!d.name) return { ok: false, why: "This cabinet's Wi-Fi isn't answering.", networks: [], current: null };
    const r = await nm(["-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "device", "wifi", "list", "ifname", d.name, "--rescan", "yes"], 45_000);
    const savedNames = new Set(known().map((k) => k.ssid));
    const networks = parseScan(r.stdout).map((n) => ({ ...n, saved: savedNames.has(n.ssid) }));
    return { ok: r.code === 0, networks, current: networks.find((n) => n.inUse)?.ssid ?? null };
  };

  /**
   * Join a network and keep it. With no password, a network already saved (or an open one).
   * A failure leaves everything as it was: the new network isn't kept, and the old Wi-Fi comes back.
   * @param {{ ssid: string, password?: string | null, security?: string }} q
   */
  const join = async (q) => {
    if (!validSsid(q.ssid)) return { ok: false, ssid: String(q.ssid), why: "That network name can't be used." };
    const d = await device();
    if (!d.name) return { ok: false, ssid: q.ssid, why: "This cabinet's Wi-Fi isn't answering." };
    const before = d.connection;
    const all = known();
    const had = all.find((k) => k.ssid === q.ssid) ?? null;
    const file = `${idFor(q.ssid)}.nmconnection`;
    const kind = securityKind(q.security ?? "WPA2");
    let text = had?.text ?? null;
    if (q.password != null || !had) {
      if (kind === "no") return { ok: false, ssid: q.ssid, why: "This cabinet can't join that kind of network." };
      if (kind !== "open" && !validPassword(q.password)) return { ok: false, ssid: q.ssid, why: "A Wi-Fi password is 8 to 63 characters." };
      // The newest network that works is tried first from now on.
      const priority = Math.max(10, ...all.filter((k) => k.ssid !== q.ssid).map((k) => k.priority + 1));
      text = keyfile({ ssid: q.ssid, password: q.password, kind, priority, uuid: had?.uuid ?? randomUUID() });
    }
    const livePath = path.join(live, file);
    writeDurable(livePath, /** @type {string} */ (text), 0o600);
    const loaded = await nm(["connection", "load", livePath]);
    // A file NetworkManager won't read is our mistake, not the password's: say so in the journal, and fail as a join does.
    if (loaded.code !== 0 || /fail|error/i.test(`${loaded.stdout}${loaded.stderr}`)) log(`NetworkManager wouldn't load ${file}: ${`${loaded.stderr}${loaded.stdout}`.trim().split("\n")[0]}`);
    const up = await nm(["-w", "45", "connection", "up", "id", idFor(q.ssid), "ifname", d.name], 60_000);
    if (up.code === 0) {
      writeDurable(path.join(store, file), /** @type {string} */ (text), 0o600);
      log(`joined and saved a network (${idFor(q.ssid)})`);
      return { ok: true, ...(await status()), ssid: q.ssid };
    }
    // Back to how it was. The password is never logged; nmcli's words about the failure are.
    log(`join failed (${idFor(q.ssid)}): ${up.stderr.trim().split("\n")[0] ?? ""}`);
    if (had) writeDurable(livePath, had.text, 0o600);
    else fs.rmSync(livePath, { force: true });
    await nm(["connection", "reload"]);
    if (before) await nm(["-w", "30", "connection", "up", "id", before, "ifname", d.name], 45_000);
    else await nm(["device", "connect", d.name], 45_000);
    const after = await status();
    return { ok: false, ssid: q.ssid, why: whyFailed(`${up.stderr} ${up.stdout}`), back: after.connected ? after.ssid : null };
  };

  /**
   * Make the Wi-Fi the cabinet is on one of ours, when it isn't yet: the card's network, which came through
   * netplan (D251). Its own copy stays, as a second chance at a lower priority.
   */
  const adopt = async () => {
    const r = await nm(["-t", "-f", "NAME,TYPE", "connection", "show"]);
    const mine = new Set(known().map((k) => k.ssid));
    let n = 0;
    for (const [name, type] of r.stdout.split("\n").filter(Boolean).map(splitTerse)) {
      if (type !== "802-11-wireless" || name.startsWith(PREFIX)) continue;
      const g = await nm(["-s", "-g", "802-11-wireless.ssid,802-11-wireless-security.key-mgmt,802-11-wireless-security.psk", "connection", "show", "id", name]);
      const [ssid = "", keyMgmt = "", psk = ""] = g.stdout.split("\n").map((l) => splitTerse(l).join(":"));
      if (g.code !== 0 || !validSsid(ssid) || mine.has(ssid)) continue;
      const kind = keyMgmt === "sae" ? "sae" : keyMgmt ? "psk" : "open";
      if (kind !== "open" && !validPassword(psk)) continue;
      const text = keyfile({ ssid, password: psk, kind, priority: 10 + n, uuid: randomUUID() });
      const file = `${idFor(ssid)}.nmconnection`;
      writeDurable(path.join(store, file), text, 0o600);
      writeDurable(path.join(live, file), text, 0o600);
      mine.add(ssid);
      n++;
      log(`kept the card's network as ${idFor(ssid)}`);
    }
    if (n) await nm(["connection", "reload"]);
    return n;
  };

  return { known, restore, device, status, scan, join, adopt, run, log };
}

// ---------- the watch ----------

/** Seconds the Wi-Fi may be down before each step, and how long before the heavier ones repeat. */
export const WATCH = Object.freeze({ nudgeAfter: 30, nudgeEvery: 60, restartAfter: 180, driverAfter: 300, heavyEvery: 600 });

/**
 * What the watch does this round. Pure: what it saw goes in, what to do comes out.
 *   unblock   the radio is switched off or blocked (rfkill)
 *   nudge     look for networks and connect
 *   restart   restart NetworkManager; not while a cable carries the cabinet, which would cut a grown-up's session
 *   driver    reload the Wi-Fi chip's driver: only when the chip has gone from the system altogether. Never while
 *             a Wi-Fi device is there: on the Pi an unload and reload can leave the chip dead until a restart,
 *             turning a short outage into a lasting one (D412).
 * @param {{ downSince: number | null, lastNudge: number, lastHeavy: number, heavy: number }} st
 * @param {{ now: number, device: boolean, connected: boolean, radioOn: boolean, wired: boolean, saved: number }} obs times in seconds
 */
export function watchStep(st, obs) {
  /** @type {("unblock" | "nudge" | "restart" | "driver")[]} */
  const actions = [];
  const next = { ...st };
  if (!obs.radioOn) actions.push("unblock");
  if (obs.connected) return { actions, state: { downSince: null, lastNudge: 0, lastHeavy: 0, heavy: 0 } };
  // Nothing to join: a cabinet that has never been on Wi-Fi isn't broken.
  if (!obs.saved) return { actions, state: { ...next, downSince: null } };
  next.downSince ??= obs.now;
  const down = obs.now - next.downSince;
  if (obs.device && down >= WATCH.nudgeAfter && obs.now - next.lastNudge >= WATCH.nudgeEvery) {
    actions.push("nudge");
    next.lastNudge = obs.now;
  }
  const due = next.heavy === 0 ? down >= (obs.device ? WATCH.restartAfter : 60) : obs.now - next.lastHeavy >= (next.heavy === 1 ? WATCH.driverAfter - WATCH.restartAfter : WATCH.heavyEvery);
  if (due) {
    // With a Wi-Fi device there: NetworkManager again, every ten minutes (not under a cable's session). With the
    // device gone: NetworkManager first, then the driver, alternating.
    const which = !obs.device && next.heavy % 2 === 1 ? "driver" : obs.wired ? null : "restart";
    if (which) actions.push(which);
    next.heavy += 1;
    next.lastHeavy = obs.now;
  }
  return { actions, state: next };
}

/**
 * One round of the watch: put back lost networks, see where the Wi-Fi stands, do what watchStep says, and
 * leave the status where the cabinet service can read it.
 * @param {ReturnType<typeof createWifi>} wifi
 * @param {Parameters<typeof watchStep>[0]} st
 * @param {{ statusFile?: string, countryFile?: string, now?: () => number }} [o]
 */
export async function watchRound(wifi, st, o = {}) {
  const now = Math.floor((o.now ?? Date.now)() / 1000);
  const { run, log } = wifi;
  await wifi.restore();
  const radio = await run("nmcli", ["-t", "-f", "WIFI", "radio"]);
  const blocked = await run("rfkill", ["list", "wifi"]);
  const radioOn = radio.code !== 0 || (/^enabled/m.test(radio.stdout) && !/blocked: yes/.test(blocked.stdout));
  const s = await wifi.status();
  const { actions, state } = watchStep(st, { now, device: !!s.device, connected: s.connected, radioOn, wired: s.wired, saved: wifi.known().length });
  for (const a of actions) {
    log(`Wi-Fi ${s.connected ? "up" : `down ${st.downSince ? now - st.downSince : 0} s`}: ${a}`);
    if (a === "unblock") {
      await run("rfkill", ["unblock", "wifi"]);
      await run("nmcli", ["radio", "wifi", "on"]);
      let country = "";
      try {
        country = fs.readFileSync(o.countryFile ?? COUNTRY_FILE, "utf8").trim();
      } catch {
        // No country on file: the kernel's own setting stands.
      }
      if (/^[A-Z]{2}$/.test(country)) await run("iw", ["reg", "set", country]);
    } else if (a === "nudge" && s.device) {
      await run("nmcli", ["device", "wifi", "rescan", "ifname", s.device], { timeoutMs: 20_000 });
      await run("nmcli", ["-w", "30", "device", "connect", s.device], { timeoutMs: 45_000 });
    } else if (a === "restart") {
      await run("systemctl", ["restart", "wpa_supplicant.service", "NetworkManager.service"], { timeoutMs: 60_000 });
    } else if (a === "driver") {
      await run("modprobe", ["-r", "brcmfmac_wcc", "brcmfmac"], { timeoutMs: 30_000 });
      await run("modprobe", ["brcmfmac"], { timeoutMs: 30_000 });
    }
  }
  const wasDown = st.downSince != null;
  if (s.connected && wasDown) log(`Wi-Fi back after ${now - /** @type {number} */ (st.downSince)} s (${s.address ?? "no address yet"})`);
  if (!s.connected && !wasDown && state.downSince != null) log("Wi-Fi down");
  try {
    writeDurable(o.statusFile ?? STATUS_FILE, `${JSON.stringify({ at: now, connected: s.connected, ssid: s.ssid, signal: s.signal, address: s.address, wired: s.wired, device: !!s.device, down_s: state.downSince ? now - state.downSince : 0 })}\n`, 0o644);
  } catch {
    // The status is a convenience; the watch carries on without it.
  }
  return state;
}
