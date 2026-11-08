// The local player's server (D70): the player page, a small JSON API, and the
// runtime's own handler for /runtime/… and /carts/<id>/….
//
//   GET  /                 the player page
//   GET  /player/…         its files (web/)
//   GET  /api/carts        the cart list with you-check rules and status
//   POST /api/plays        append a `play` record (D72)
//   POST /api/you-check    append a `you_check` record (D71, D72)
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createHandler } from "@game-studio-arcade/runtime/dev-server";
import { listCarts, dataDir } from "./library.js";
import { appendLog, readLog } from "./log.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(HERE, "../web");
const EXAMPLES_DIR = path.join(path.dirname(fileURLToPath(import.meta.resolve("@game-studio-arcade/runtime/dev-server"))), "examples");

/** A play shorter than this counts as an early quit (D72). */
export const EARLY_QUIT_S = 30;
const MAX_BODY = 16 * 1024;
const ANSWERS = new Set(["yes", "no", "not_sure"]);
const ENDED = new Set(["star", "back", "left_page"]);
const SIDES = new Set(["p1", "p2"]);
const PLAY_ID = /^[A-Za-z0-9_-]{1,64}$/;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

/**
 * @typedef {{
 *   libraryDir?: string,
 *   logsDir?: string,
 *   examples?: boolean,
 *   checker?: string | null,
 *   now?: () => Date,
 * }} PlayerOptions
 *   libraryDir: the dev cart library (default <data>/carts).
 *   logsDir: where JSONL logs go (default <data>/logs).
 *   examples: also list runtime/examples/* (the library wins on a clash).
 *   checker: who answers you-check rules, as an initial (default "G").
 */

class HttpError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** @param {http.IncomingMessage} req @returns {Promise<any>} */
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    /** @type {Buffer[]} */
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size <= MAX_BODY) chunks.push(c);
    });
    req.on("end", () => {
      if (size > MAX_BODY) return reject(new HttpError(413, "body too large"));
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new HttpError(400, "body is not JSON"));
      }
    });
    req.on("error", reject);
  });
}

/** @param {unknown} v @param {number} max */
const str = (v, max) => (typeof v === "string" && v.length <= max ? v : null);

/** @param {PlayerOptions} [opts] */
export function createPlayerHandler(opts = {}) {
  const data = dataDir();
  const libraryDir = path.resolve(opts.libraryDir ?? path.join(data, "carts"));
  const logsDir = path.resolve(opts.logsDir ?? path.join(data, "logs"));
  const checker = opts.checker === undefined ? "G" : opts.checker;
  const now = opts.now ?? (() => new Date());

  /** @type {{ root: string, source: "library" | "example" }[]} */
  const roots = [{ root: libraryDir, source: "library" }];
  if (opts.examples) roots.push({ root: EXAMPLES_DIR, source: "example" });

  const carts = () => listCarts(roots);
  const findCart = (id) => carts().find((c) => c.id === id) ?? null;

  /** The cart list as the page sees it: no paths, plus answers and plays from the logs. */
  const cartList = () => {
    const checks = readLog(path.join(logsDir, "you_check.jsonl"));
    const plays = readLog(path.join(logsDir, "play.jsonl"));
    return carts().map(({ dir, ...c }) => {
      const mine = checks.filter((r) => r.cart_id === c.id && r.cart_version === c.version);
      const last = mine[mine.length - 1];
      return {
        ...c,
        url: `/carts/${encodeURIComponent(c.id)}/game.js`,
        answered: last ? { at: last.answered_at, by: last.checker ?? null, answers: last.answers } : null,
        plays: plays.filter((p) => p.cart_id === c.id).length,
      };
    });
  };

  /** @param {any} b */
  const playRecord = (b) => {
    const cart = findCart(str(b?.cart_id, 200));
    if (!cart) throw new HttpError(404, "no such cart");
    const id = str(b.play_id, 64);
    if (!id || !PLAY_ID.test(id)) throw new HttpError(400, "play_id must be 1-64 letters, digits, _ or -");
    const started = str(b.started_at, 40);
    if (!started || Number.isNaN(Date.parse(started))) throw new HttpError(400, "started_at must be an ISO time");
    const duration = Number(b.duration_s);
    if (!Number.isFinite(duration) || duration < 0) throw new HttpError(400, "duration_s must be a number >= 0");
    const sides = Array.isArray(b.sides) ? [...new Set(b.sides)].filter((s) => SIDES.has(s)).sort() : [];
    const ended = ENDED.has(b.ended) ? b.ended : "back";
    return {
      id,
      cart_id: cart.id,
      cart_version: cart.version,
      commit: cart.commit,
      session_id: cart.session_id,
      origin: "desktop",
      sides,
      started_at: new Date(started).toISOString(),
      duration_s: Math.round(duration * 10) / 10,
      ticks: Number.isInteger(b.ticks) && b.ticks >= 0 ? b.ticks : null,
      early_quit: duration < EARLY_QUIT_S,
      ended,
      errors: Number.isInteger(b.errors) && b.errors >= 0 ? b.errors : 0,
    };
  };

  /** @param {any} b */
  const youCheckRecord = (b) => {
    const cart = findCart(str(b?.cart_id, 200));
    if (!cart) throw new HttpError(404, "no such cart");
    if (!Array.isArray(b.answers) || b.answers.length === 0) throw new HttpError(400, "answers must be a non-empty list");
    const rules = new Map(cart.youCheck.map((r) => [r.id, r.text]));
    const seen = new Set();
    const answers = b.answers.map((a) => {
      const rule = str(a?.rule, 20);
      if (!rule || !rules.has(rule)) throw new HttpError(400, `${rule ?? "?"} is not a you-check rule of ${cart.id}`);
      if (seen.has(rule)) throw new HttpError(400, `${rule} answered twice`);
      seen.add(rule);
      if (!ANSWERS.has(a.answer)) throw new HttpError(400, `answer must be yes, no or not_sure`);
      const said = typeof a.said === "string" ? a.said.trim().slice(0, 1000) : "";
      return { rule, text: rules.get(rule), answer: a.answer, said: said || null };
    });
    const playId = str(b.play_id, 64);
    return {
      id: `yc_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
      cart_id: cart.id,
      cart_version: cart.version,
      commit: cart.commit,
      session_id: cart.session_id,
      checker,
      play_id: playId && PLAY_ID.test(playId) ? playId : null,
      answered_at: now().toISOString(),
      answers,
    };
  };

  /** @param {http.ServerResponse} res @param {number} status @param {unknown} body */
  const json = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify(body));
  };

  /** @param {http.ServerResponse} res @param {string} file */
  const sendFile = (res, file) => {
    const type = TYPES[path.extname(file)];
    if (!type || !fs.existsSync(file)) return void res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    fs.createReadStream(file).pipe(res);
  };

  /** @param {http.IncomingMessage} req @param {http.ServerResponse} res */
  const api = async (req, res, pathname) => {
    if (req.method === "GET" && pathname === "/api/carts") return json(res, 200, { carts: cartList(), checker });
    if (req.method !== "POST") throw new HttpError(405, "method not allowed");
    // Only this page may write logs: a browser always sends Origin on a
    // cross-site POST (and "null" from the sandboxed cart frame).
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== `http://${req.headers.host}`) throw new HttpError(403, "cross-origin write refused");
    const body = await readJson(req);
    if (pathname === "/api/plays") {
      const record = playRecord(body);
      appendLog(logsDir, "play", record);
      return json(res, 200, { ok: true, record });
    }
    if (pathname === "/api/you-check") {
      const record = youCheckRecord(body);
      appendLog(logsDir, "you_check", record);
      return json(res, 200, { ok: true, record });
    }
    throw new HttpError(404, "no such endpoint");
  };

  return (/** @type {http.IncomingMessage} */ req, /** @type {http.ServerResponse} */ res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    } catch {
      return void res.writeHead(400).end("bad url");
    }
    if (pathname.startsWith("/api/")) {
      api(req, res, pathname).catch((e) => json(res, e instanceof HttpError ? e.status : 500, { ok: false, error: e.message }));
      return;
    }
    if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) return sendFile(res, path.join(WEB_DIR, "index.html"));
    const m = /^\/player\/([A-Za-z0-9_-]+\.(?:js|css|html))$/.exec(pathname);
    if (req.method === "GET" && m) return sendFile(res, path.join(WEB_DIR, m[1]));
    // Everything else is the runtime's: /runtime/… and /carts/<id>/…
    const map = Object.fromEntries(carts().map((c) => [c.id, c.dir]));
    createHandler({ carts: map })(req, res);
  };
}

/**
 * Start the player. Port 0 picks a free port.
 * @param {PlayerOptions & { port?: number, host?: string }} [opts]
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 */
export function startPlayer(opts = {}) {
  const server = http.createServer(createPlayerHandler(opts));
  const host = opts.host ?? "127.0.0.1";
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 8330, host, () => {
      const addr = /** @type {import("node:net").AddressInfo} */ (server.address());
      resolve({
        url: `http://${host}:${addr.port}`,
        port: addr.port,
        close: () =>
          new Promise((r) => {
            server.closeAllConnections();
            server.close(() => r());
          }),
      });
    });
  });
}
