// @ts-check
// The cabinet service's side of the Wi-Fi helper (D414). The service runs as the kiosk's user, with no sudo;
// the helper runs as root behind /run/arcade-wifi.sock. One request a connection: a line of JSON each way.
import fs from "node:fs";
import net from "node:net";
import { SOCKET, STATUS_FILE } from "./wifi.js";

/** @typedef {{ status: () => Promise<any>, scan: () => Promise<any>, join: (q: { ssid: string, password?: string | null, security?: string }) => Promise<any> }} WifiPort */

/** @param {string} socketPath @param {object} request @param {number} timeoutMs */
function ask(socketPath, request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const s = net.connect(socketPath);
    let text = "";
    const timer = setTimeout(() => s.destroy(new Error("the Wi-Fi helper took too long")), timeoutMs);
    s.setEncoding("utf8");
    s.on("connect", () => s.write(`${JSON.stringify(request)}\n`));
    s.on("data", (d) => (text += d));
    s.on("error", (e) => (clearTimeout(timer), reject(e)));
    s.on("close", () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(text.split("\n")[0]));
      } catch {
        reject(new Error("the Wi-Fi helper gave no answer"));
      }
    });
  });
}

/**
 * The real cabinet's Wi-Fi, or null where there's no helper (the mini, a test).
 * @param {{ socket?: string, statusFile?: string }} [o]
 * @returns {WifiPort | null}
 */
export function socketWifi(o = {}) {
  const socketPath = o.socket ?? SOCKET;
  if (!fs.existsSync(socketPath)) return null;
  return {
    // The watch leaves the status in a file every round, so the shelf can ask often and cheaply.
    status: async () => {
      try {
        const s = JSON.parse(fs.readFileSync(o.statusFile ?? STATUS_FILE, "utf8"));
        if (Date.now() / 1000 - s.at < 60) return { ok: true, ...s };
      } catch {
        // No fresh file: ask the helper.
      }
      return ask(socketPath, { op: "status" }, 20_000);
    },
    scan: () => ask(socketPath, { op: "scan" }, 60_000),
    join: (q) => ask(socketPath, { op: "join", ssid: q.ssid, password: q.password ?? null, security: q.security }, 150_000),
  };
}

/**
 * A pretend Wi-Fi for the mini and the virtual cabinet, which have none (--wifi-demo): the screens can be
 * driven end to end. The password "wrongwrong" fails; anything else joins.
 * @param {{ paceMs?: number }} [o]
 * @returns {WifiPort}
 */
export function demoWifi(o = {}) {
  const pace = () => new Promise((r) => setTimeout(r, o.paceMs ?? 1200));
  /** @type {string | null} */
  let current = "Home Wi-Fi";
  const saved = new Set(["Home Wi-Fi"]);
  const nets = [
    { ssid: "Home Wi-Fi", signal: 82, security: "WPA2" },
    { ssid: "Home Wi-Fi Guest", signal: 78, security: "WPA2" },
    { ssid: "Upstairs 5G", signal: 48, security: "WPA2 WPA3" },
    { ssid: "Cafe Open", signal: 37, security: "" },
    { ssid: "The Neighbors' Really Long Network Name", signal: 22, security: "WPA2" },
    { ssid: "Printer Setup 4A", signal: 12, security: "" },
  ];
  const status = async () => ({ ok: true, device: true, connected: !!current, ssid: current, signal: nets.find((n) => n.ssid === current)?.signal ?? null, address: current ? "192.168.1.23" : null, wired: false });
  return {
    status,
    scan: async () => {
      await pace();
      return { ok: true, current, networks: nets.map((n) => ({ ssid: n.ssid, signal: n.signal, secure: !!n.security, kind: n.security ? "psk" : "open", inUse: n.ssid === current, saved: saved.has(n.ssid) })).sort((a, b) => Number(b.inUse) - Number(a.inUse) || b.signal - a.signal) };
    },
    join: async (q) => {
      await pace();
      if (q.password === "wrongwrong") return { ok: false, ssid: q.ssid, why: "The password didn't work.", back: current };
      current = q.ssid;
      saved.add(q.ssid);
      return { ...(await status()), ssid: q.ssid };
    },
  };
}
