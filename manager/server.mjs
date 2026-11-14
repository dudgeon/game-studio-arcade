#!/usr/bin/env node
// The Cabinet Manager v0 (D280-D286): watch and drive a cabinet, read its activity, look after the coin pot.
// Runs on the Mac mini; open it from a browser on the home network. Start it with scripts/manager.sh.
//
//   node manager/server.mjs [--port 8335]
//
//   GET  /                         the page (needs the Manager key once per browser, D285)
//   GET  /?key=KEY                 sets the browser's cookie, then shows the page
//   GET  /api/cabinets             the cabinets and how each is doing
//   GET  /api/c/NAME/screen        server-sent events: frames (PNG, base64) and freshness (D281)
//   POST /api/c/NAME/keys          {how: "down"|"up", codes: [KeyboardEvent.code], viewer} (D282)
//   GET  /api/c/NAME/activity      makes, plays, screened requests, coin entries (D283)
//   GET  /api/c/NAME/pot           the pot; POST …/pot/topup {coins, reason, confirm?}; POST …/pot/reset {reason}; POST …/pair (D284)
//   GET  /api/c/NAME/games         every game, on the shelf or off; POST …/games/remove {id, reason?} and …/games/restore {id} (D364)
//   GET  /api/c/NAME/makers        every maker; POST …/makers/hide {id, reason?} and …/makers/show {id}
//   GET  /api/c/NAME/health        temperature, throttling, Wi-Fi, disk, uptime, version, recent service errors, warnings (D365)
//   GET  /api/c/NAME/volume        the speaker; POST {percent} sets it, kept across restarts (D366)
//   POST /api/c/NAME/power         {action: restart-shelf|reboot|poweroff, confirm: true}; refused while busy (D367)
//   GET  /api/c/NAME/update        the cabinet's software version, this checkout's, and the last update's output (D338)
//   POST /api/c/NAME/update        {os}: update the cabinet from this checkout, as update-cabinet.mjs does (D330, D338)
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { activity } from "./activity.mjs";
import { warnings as healthWarnings } from "./health.mjs";
import { backupHealth, readBackupRecord } from "./backup.mjs";
import { Cabinet, CONFIG_DIR, loadCabinets } from "./cabinet.mjs";
import { CONTROLS, toLinux } from "./keys.mjs";
import { updater } from "./update.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PORT = 8335;
export const KEY_FILE = path.join(CONFIG_DIR, "manager-web-key");
const COOKIE = "gsa_manager";
const FRAME_MS = 250;
const STALE_MS = 3000;

/** Loopback, private and link-local addresses only (D285). @param {string | undefined} ip */
export function homeAddress(ip) {
  if (!ip) return false;
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
    const [a, b] = v4.split(".").map(Number);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  const l = ip.toLowerCase();
  return l === "::1" || l.startsWith("fe80:") || l.startsWith("fd") || l.startsWith("fc");
}

/** An IP address, localhost or a .local name, with an optional port (D285: no DNS rebinding). @param {string | undefined} host */
export function goodHost(host) {
  if (!host) return false;
  const h = host.replace(/:\d+$/, "").replace(/^\[(.*)\]$/, "$1").toLowerCase();
  return h === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":") || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.local$/.test(h);
}

/** The Manager key, made on first start (D285). */
export function managerKey(file = KEY_FILE) {
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, `${randomBytes(18).toString("base64url")}\n`, { mode: 0o600 });
  }
  fs.chmodSync(file, 0o600);
  return fs.readFileSync(file, "utf8").trim();
}

const cookieValue = (/** @type {string} */ key) => createHash("sha256").update(`gsa-manager-cookie:${key}`).digest("base64url");
const same = (/** @type {string} */ a, /** @type {string} */ b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** @param {http.ServerResponse} res @param {number} status @param {any} body */
function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

/** @param {http.IncomingMessage} req @returns {Promise<any>} */
function readJson(req) {
  return new Promise((resolve, reject) => {
    let s = "";
    req.on("data", (d) => {
      s += d;
      if (s.length > 8192) reject(new Error("too big"));
    });
    req.on("end", () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch {
        reject(new Error("not JSON"));
      }
    });
  });
}

/** The house's time zone: the mini's own, or MANAGER_TZ. Pages show times in it, whatever the viewer's device says. */
export function houseTimeZone() {
  const tz = process.env.MANAGER_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

const dollars = (/** @type {number} */ c) => `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toFixed(2)}`;

/**
 * @param {{ key: string, cabinets: Map<string, any>, page?: string, backupRecord?: string, updates?: ReturnType<typeof updater> }} o
 *   cabinets: name -> a Cabinet (or a stand-in with the same methods, for tests)
 *   backupRecord: the hourly backup's record, for the Picade's "last backup" (D353); default ~/game-studio-data/twin/backup.json
 *   updates: the Update button's runner (D338); a stand-in for tests
 */
export function createManager(o) {
  const page = o.page ?? path.join(HERE, "page");
  const updates = o.updates ?? updater();
  const cookie = cookieValue(o.key);
  /** @type {Map<string, { watchers: Set<http.ServerResponse>, timer: NodeJS.Timeout | null, busy: boolean }>} */
  const watch = new Map();
  /** viewer -> cabinet -> held codes, so a viewer that goes away lets go (D282) @type {Map<string, Map<string, Set<string>>>} */
  const held = new Map();

  const authed = (/** @type {http.IncomingMessage} */ req) => {
    const m = /(?:^|;\s*)gsa_manager=([^;]+)/.exec(req.headers.cookie ?? "");
    return Boolean(m && same(m[1], cookie));
  };

  /** @param {string} name */
  function status(name) {
    const c = o.cabinets.get(name);
    const f = c.frame;
    const now = Date.now();
    const stale = !f || now - f.at > STALE_MS;
    // The Picade's backup on the mini (D353); the virtual cabinet is a copy itself and has none.
    const backup = name === "real" ? backupHealth(readBackupRecord(o.backupRecord), { now, live: !c.problem && !stale }) : null;
    return { name, label: c.config.label, host: c.config.host, problem: c.problem || null, frame_age_ms: f ? now - f.at : null, changed_ago_ms: f ? now - f.changedAt : null, stale, can_drive: c.canDrive, watchers: watch.get(name)?.watchers.size ?? 0, backup };
  }

  /** @param {string} name */
  function startWatching(name) {
    const w = watch.get(name) ?? { watchers: new Set(), timer: null, busy: false, sentHash: "" };
    watch.set(name, w);
    if (w.timer) return w;
    const c = o.cabinets.get(name);
    c.driveable?.().catch(() => {});
    const send = (/** @type {string} */ ev, /** @type {any} */ data) => {
      for (const res of w.watchers) res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    let lastStatus = 0;
    w.timer = setInterval(async () => {
      if (w.busy) return;
      w.busy = true;
      try {
        await c.grab();
      } catch {}
      w.busy = false;
      if (c.frame && c.frame.hash !== /** @type {any} */ (w).sentHash) {
        /** @type {any} */ (w).sentHash = c.frame.hash;
        send("frame", { png: c.frame.png.toString("base64"), at: c.frame.at });
      }
      if (Date.now() - lastStatus > 900) {
        lastStatus = Date.now();
        send("status", status(name));
      }
    }, FRAME_MS);
    return w;
  }

  /** @param {string} name @param {http.ServerResponse} res */
  function stopWatching(name, res) {
    const w = watch.get(name);
    if (!w) return;
    w.watchers.delete(res);
    if (!w.watchers.size && w.timer) {
      clearInterval(w.timer);
      w.timer = null;
      /** @type {any} */ (w).sentHash = "";
    }
  }

  /** Let go of everything one viewer holds. @param {string} viewer */
  async function release(viewer) {
    const mine = held.get(viewer);
    if (!mine) return;
    held.delete(viewer);
    for (const [name, codes] of mine) if (codes.size) await o.cabinets.get(name)?.keys("up", toLinux([...codes])).catch(() => {});
  }

  /** @type {http.RequestListener} */
  async function handle(req, res) {
    if (!homeAddress(req.socket.remoteAddress) || !goodHost(req.headers.host)) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      return res.end("The Cabinet Manager only answers the home network.\n");
    }
    const url = new URL(req.url ?? "/", "http://manager");
    const p = url.pathname;
    if (req.method === "GET" && p === "/" && url.searchParams.has("key")) {
      if (!same(url.searchParams.get("key") ?? "", o.key)) {
        res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(locked("That key doesn't open this Manager."));
      }
      res.writeHead(303, { Location: "/", "Set-Cookie": `${COOKIE}=${cookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000` });
      return res.end();
    }
    if (!authed(req)) {
      if (p.startsWith("/api/")) return json(res, 401, { error: "this browser needs the Manager key: run scripts/manager.sh url on the mini" });
      res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(locked("This is the grown-ups' Cabinet Manager. Ask a grown-up."));
    }
    if (req.method === "POST") {
      // A custom header can't be sent cross-site without a preflight we never allow; and the origin must be us.
      const origin = req.headers.origin;
      if (req.headers["x-manager"] !== "1" || (origin && new URL(origin).host !== req.headers.host)) return json(res, 403, { error: "not from the Manager's page" });
    }
    try {
      if (req.method === "GET" && (p === "/" || p === "/app.js" || p === "/style.css")) {
        const file = p === "/" ? "index.html" : p.slice(1);
        const type = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html";
        res.writeHead(200, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'" });
        return res.end(fs.readFileSync(path.join(page, file)));
      }
      if (req.method === "GET" && p === "/api/cabinets") return json(res, 200, { cabinets: [...o.cabinets.keys()].map(status), controls: CONTROLS, time_zone: houseTimeZone() });
      const m = /^\/api\/c\/([a-z][a-z0-9-]*)(\/.*)$/.exec(p);
      if (!m || !o.cabinets.has(m[1])) return json(res, 404, { error: "no such page" });
      const [, name, rest] = m;
      const c = o.cabinets.get(name);

      if (req.method === "GET" && rest === "/screen") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
        const w = startWatching(name);
        w.watchers.add(res);
        if (c.frame) res.write(`event: frame\ndata: ${JSON.stringify({ png: c.frame.png.toString("base64"), at: c.frame.at })}\n\n`);
        res.write(`event: status\ndata: ${JSON.stringify(status(name))}\n\n`);
        const viewer = url.searchParams.get("viewer") ?? "";
        req.on("close", () => {
          stopWatching(name, res);
          if (viewer) release(viewer);
        });
        return;
      }
      if (req.method === "POST" && rest === "/keys") {
        const b = await readJson(req);
        if (b.how !== "down" && b.how !== "up") return json(res, 400, { error: "how is down or up" });
        const codes = toLinux(b.codes);
        const viewer = String(b.viewer ?? "");
        if (viewer) {
          const mine = held.get(viewer) ?? new Map();
          held.set(viewer, mine);
          const set = mine.get(name) ?? new Set();
          mine.set(name, set);
          for (const k of b.codes) b.how === "down" ? set.add(k) : set.delete(k);
        }
        await c.keys(b.how, codes);
        return json(res, 200, { ok: true });
      }
      if (req.method === "GET" && rest === "/activity") {
        const [logs, now] = await Promise.all([c.logs(), c.studioNow?.().catch(() => null)]);
        return json(res, 200, { ...activity(logs), now: now ?? null });
      }
      if (req.method === "POST" && rest === "/pair") {
        await c.pair();
        return json(res, 200, { ok: true });
      }
      if (rest === "/update") {
        if (!updates.can(name)) return json(res, 404, { error: "this cabinet can't be updated from the Manager" });
        if (req.method === "POST") {
          const b = await readJson(req);
          updates.start(name, { os: b.os === true });
          return json(res, 200, updates.state(name));
        }
        // What the cabinet runs now: read on each look, so it's right after an update or a rollback.
        const on = await c.exec("cat /etc/arcade/provisioned-version /etc/arcade/provisioned-commit 2>/dev/null; true", { timeout: 15000 }).catch(() => null);
        const [version = null, commit = null] = typeof on === "string" ? on.trim().split("\n") : [];
        return json(res, 200, { ...updates.state(name), cabinet: { version, commit, reachable: on !== null } });
      }
      if (rest === "/pot" || rest.startsWith("/pot/")) {
        const check = (/** @type {{status: number, body: any}} */ r) => {
          if (r.status === 200) return r.body;
          throw Object.assign(new Error(typeof r.body === "object" ? r.body.error : String(r.body)), { status: r.status === 401 ? 409 : r.status });
        };
        if (req.method === "GET" && rest === "/pot") return json(res, 200, check(await c.service("GET", "/api/manager/pot")));
        const b = await readJson(req);
        const by = `${os.userInfo().username}, in the Manager`;
        if (req.method === "POST" && rest === "/pot/topup") {
          const n = Number(b.coins);
          const reason = String(b.reason ?? "").trim();
          if (!Number.isInteger(n) || n < 1 || n > 1000) return json(res, 400, { error: "add a whole number of coins, 1 to 1000" });
          if (!reason) return json(res, 400, { error: "a top-up needs a reason, which the kids see" });
          const preview = check(await c.service("GET", `/api/manager/pot/preview?coins=${n}`));
          if (preview.over_limit && b.confirm !== true) {
            return json(res, 200, { needs_confirm: true, warning: `With ${n} more coins this month could spend ${dollars(preview.month_total_cents)}, past the workspace's real limit of ${dollars(preview.workspace_limit_cents)} (D204, D211). A make that hits it stops, and the Studio rests until the 1st.` });
          }
          return json(res, 200, check(await c.service("POST", "/api/manager/pot/topup", { coins: n, reason, by })));
        }
        if (req.method === "POST" && rest === "/pot/reset") {
          const reason = String(b.reason ?? "").trim();
          if (!reason) return json(res, 400, { error: "a reset needs a reason, which the kids see" });
          return json(res, 200, check(await c.service("POST", "/api/manager/pot/reset", { reason, by })));
        }
      }
      // Health and controls (D365-D367).
      if (req.method === "GET" && rest === "/health") {
        const h = await c.health();
        return json(res, 200, { health: h, warnings: healthWarnings(h), checked_at: new Date().toISOString() });
      }
      if (rest === "/volume") {
        if (req.method === "GET") return json(res, 200, await c.act("volume"));
        const b = await readJson(req);
        const n = Number(b.percent);
        if (!Number.isInteger(n) || n < 0 || n > 100) return json(res, 400, { error: "volume is a whole number, 0 to 100" });
        return json(res, 200, await c.act("volume", n));
      }
      if (req.method === "POST" && rest === "/power") {
        const b = await readJson(req);
        if (!["restart-shelf", "reboot", "poweroff"].includes(b.action)) return json(res, 400, { error: "action is restart-shelf, reboot or poweroff" });
        // One confirm, on the page: the request has to say it was confirmed.
        if (b.confirm !== true) return json(res, 400, { error: "not confirmed" });
        const r = await c.act(b.action);
        if (r.ok && (b.action === "reboot" || b.action === "poweroff")) c.close();
        return json(res, r.ok ? 200 : 409, r.ok ? r : { error: r.why ?? "refused" });
      }
      // Games and makers, off the shelf and back (D360-D364). The cabinet keeps the marks; the Manager only asks.
      if (rest === "/games" || rest.startsWith("/games/") || rest === "/makers" || rest.startsWith("/makers/")) {
        const check = (/** @type {{status: number, body: any}} */ r) => {
          if (r.status === 200) return r.body;
          throw Object.assign(new Error(typeof r.body === "object" ? r.body.error : String(r.body)), { status: r.status === 401 ? 409 : r.status === 404 && /no such endpoint|keeps no shelf marks/.test(String(r.body?.error)) ? 501 : r.status === 405 && /method not allowed/.test(String(r.body?.error)) ? 501 : r.status });
        };
        if (req.method === "GET" && rest === "/games") return json(res, 200, check(await c.service("GET", "/api/manager/games")));
        if (req.method === "GET" && rest === "/makers") return json(res, 200, check(await c.service("GET", "/api/manager/makers")));
        const SHELF = new Set(["/games/remove", "/games/restore", "/makers/hide", "/makers/show"]);
        if (req.method === "POST" && SHELF.has(rest)) {
          const b = await readJson(req);
          const id = String(b.id ?? "");
          if (!/^[a-z0-9][a-z0-9_-]{0,99}$/.test(id)) return json(res, 400, { error: "which one? give its id" });
          const reason = String(b.reason ?? "").trim().slice(0, 300);
          return json(res, 200, check(await c.service("POST", `/api/manager${rest}`, { id, reason, by: `${os.userInfo().username}, in the Manager` })));
        }
      }
      return json(res, 404, { error: "no such page" });
    } catch (e) {
      const err = /** @type {any} */ (e);
      return json(res, err.unpaired ? 409 : err.status && err.status >= 400 ? err.status : 502, { error: err.message, unpaired: Boolean(err.unpaired) || undefined, problem: c_problem(o, req) });
    }
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      if (!res.headersSent) json(res, 500, { error: String(e?.message ?? e) });
    });
  });
  server.on("close", () => {
    for (const w of watch.values()) if (w.timer) clearInterval(w.timer);
  });
  return server;
}

/** @param {any} o @param {http.IncomingMessage} req */
function c_problem(o, req) {
  const m = /^\/api\/c\/([a-z][a-z0-9-]*)/.exec(req.url ?? "");
  return (m && o.cabinets.get(m[1])?.problem) || undefined;
}

/** @param {string} msg */
function locked(msg) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cabinet Manager</title><body style="font:18px system-ui;background:#111827;color:#e5e7eb;display:grid;place-items:center;height:90vh;margin:0;padding:16px"><p>${msg}</p></body>`;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { port: { type: "string", default: String(PORT) } } });
  const cabinets = new Map(loadCabinets().map((c) => [c.name, new Cabinet(c)]));
  const server = createManager({ key: managerKey(), cabinets });
  server.listen(Number(values.port), () => console.log(`cabinet-manager: listening on port ${values.port}; cabinets ${[...cabinets.keys()].join(", ")}`));
  const bye = () => {
    for (const c of cabinets.values()) c.close();
    process.exit(0);
  };
  process.on("SIGTERM", bye);
  process.on("SIGINT", bye);
}
