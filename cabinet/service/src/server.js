// The cabinet service's server (D183): the launcher page, the Studio and maker
// APIs, and the local player's handler for carts, plays, you-check and the runtime.
//
//   GET  /                       the launcher
//   GET  /launcher/…             its files
//   GET  /api/config             what the launcher needs to know
//   GET  /api/makers             makers, most recent first
//   POST /api/makers             {name}: the new-name slot
//   GET  /api/studio             Studio state
//   GET  /api/studio/events      the same, as server-sent events
//   POST /api/studio/start       {maker, request, parent?}: parent makes it a change (D206); refused by the pot's gate (D203)
//   POST /api/studio/answer      {id, choice, said?}
//   POST /api/studio/result-seen {id}: someone has seen how a make ended (D192)
//   POST /api/studio/still-here  a key was pressed: the walk-away clock starts again (D188)
//   POST /api/studio/stop        the kid chose to stop this make (D188)
//   POST /api/studio/notice-seen {id}: the kid has read a message (D188, D189)
//   POST /api/speech/start, stop hold-to-talk (D87, D184)
//   POST /api/speech/feed        {text} or {wav}: the stub only
//   GET  /api/pot                the family coin pot and its ledger, newest first (D202, A1, A2)
//   GET  /api/boot               first-ever boot and new-month screens still to show (B2-B4)
//   POST /api/boot/seen          {what: "intro" | "month"}
//   The Cabinet Manager's, with its token (D205; the Manager isn't built yet, D208):
//   GET  /api/manager/pot        the pot, the ledger, the rules
//   GET  /api/manager/pot/preview?coins=N   what a top-up would do, and whether it passes the workspace limit (D204)
//   POST /api/manager/pot/topup  {coins, reason, by?}
//   POST /api/manager/pot/reset  {reason, by?}
//   everything else              createPlayerHandler (/api/carts, /api/plays, /api/you-check, /runtime/…, /carts/…)
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPlayerHandler } from "@game-studio-arcade/player";
import { timingSafeEqual } from "node:crypto";
import { StudioBusy, StudioGone, StudioRefused } from "./studio.js";
import { PotError } from "./pot.js";

const LAUNCHER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../launcher");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const MAX_BODY = 16 * 1024;
const MAX_WORDS = 4000;

class HttpError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** @param {http.IncomingMessage} req */
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
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new HttpError(400, "body is not JSON"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * @param {{
 *   studio: ReturnType<typeof import("./studio.js").createStudio>,
 *   makers: ReturnType<typeof import("./makers.js").makersStore>,
 *   speech: import("./speech.js").Speech,
 *   libraryDir: string, logsDir: string,
 *   players?: number, consoleName?: string, examples?: boolean,
 *   pot?: ReturnType<typeof import("./pot.js").potStore>,
 *   cabinet?: ReturnType<typeof import("./cabinet-state.js").cabinetState>,
 *   managerToken?: string | null,
 * }} o
 */
export function createServiceHandler(o) {
  const player = createPlayerHandler({
    libraryDir: o.libraryDir,
    logsDir: o.logsDir,
    players: o.players,
    examples: o.examples,
    origin: "cabinet",
    checker: null,
    checkerFromBody: true,
    checksForMadeOnly: true, // D193
  });

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

  /** @param {http.ServerResponse} res */
  const events = (res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    const send = (/** @type {any} */ s) => res.write(`data: ${JSON.stringify(s)}\n\n`);
    send(o.studio.state());
    const stop = o.studio.subscribe(send);
    res.on("close", () => stop());
  };

  /** @param {http.IncomingMessage} req @param {http.ServerResponse} res @param {string} pathname */
  const post = async (req, res, pathname) => {
    // Only the launcher may write: a browser always sends Origin on a cross-site
    // POST, and "null" from the sandboxed cart frame.
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== `http://${req.headers.host}`) throw new HttpError(403, "cross-origin write refused");
    const body = await readJson(req);
    if (pathname === "/api/makers") {
      const maker = o.makers.add(body.name);
      if (!maker) throw new HttpError(400, "that isn't a name");
      return json(res, 200, { ok: true, maker });
    }
    if (pathname === "/api/studio/start") {
      const maker = o.makers.get(String(body.maker ?? ""));
      if (!maker) throw new HttpError(400, "no such maker");
      const request = typeof body.request === "string" ? body.request.trim() : "";
      if (!request || request.length > MAX_WORDS) throw new HttpError(400, "the request must be some words");
      const parent = typeof body.parent === "string" && body.parent ? body.parent : null;
      o.studio.start({ maker: maker.id, request, parent });
      return json(res, 200, { ok: true, state: o.studio.state() });
    }
    if (pathname === "/api/studio/answer") {
      if (typeof body.said === "string" && body.said.length > MAX_WORDS) throw new HttpError(400, "that's too many words");
      o.studio.answer({ id: body.id, choice: body.choice, said: body.said });
      return json(res, 200, { ok: true, state: o.studio.state() });
    }
    if (pathname === "/api/studio/result-seen") {
      o.studio.viewResult(body.id);
      return json(res, 200, { ok: true });
    }
    if (pathname === "/api/studio/still-here") {
      o.studio.stillHere();
      return json(res, 200, { ok: true });
    }
    if (pathname === "/api/studio/stop") {
      o.studio.stop();
      return json(res, 200, { ok: true });
    }
    if (pathname === "/api/studio/notice-seen") {
      o.studio.dismissNotice(body.id);
      return json(res, 200, { ok: true });
    }
    if (pathname === "/api/boot/seen") {
      if (body.what === "intro") o.cabinet?.introSeen();
      else if (body.what === "month") o.cabinet?.monthSeen();
      else throw new HttpError(400, "seen what?");
      return json(res, 200, { ok: true });
    }
    if (pathname === "/api/speech/start") {
      o.speech.start();
      return json(res, 200, { ok: true });
    }
    if (pathname === "/api/speech/stop") {
      const { text } = await o.speech.stop();
      return json(res, 200, { ok: true, text });
    }
    if (pathname === "/api/speech/feed") {
      if (!o.speech.feed) throw new HttpError(404, "this speech can't be fed");
      o.speech.feed({ text: body.text, wav: body.wav });
      return json(res, 200, { ok: true });
    }
    throw new HttpError(404, "no such endpoint");
  };

  /** The pot as the screens show it, with names for maker ids. */
  const potView = (/** @type {number} */ limit) => {
    if (!o.pot) return { pot: null, history: [] };
    const name = (/** @type {string} */ id) => o.makers.get(id)?.name ?? id;
    const pot = o.pot.state();
    const named = (/** @type {any[]} */ list) => list.map((m) => ({ ...m, name: name(m.maker) }));
    return {
      pot: { ...pot, makers: named(pot.makers), last_month: pot.last_month ? { ...pot.last_month, makers: named(pot.last_month.makers) } : null },
      history: o.pot.history({ limit }).map((e) => ({ ...e, name: e.who === "cabinet" || e.who === "grown-up" ? null : name(e.who) })),
    };
  };

  /** Only the Manager, with its pairing token. No token configured: there's no Manager yet. @param {http.IncomingMessage} req */
  const managerOk = (req) => {
    if (!o.managerToken) throw new HttpError(404, "no Cabinet Manager is paired with this cabinet");
    const got = Buffer.from(String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
    const want = Buffer.from(o.managerToken);
    if (got.length !== want.length || !timingSafeEqual(got, want)) throw new HttpError(401, "the Manager's token is needed");
  };

  /** @param {http.IncomingMessage} req @param {http.ServerResponse} res @param {string} pathname @param {URL} url */
  const manager = async (req, res, pathname, url) => {
    managerOk(req);
    if (!o.pot) throw new HttpError(404, "this cabinet has no coin pot");
    if (req.method === "GET" && pathname === "/api/manager/pot") return json(res, 200, { ...potView(0), rules: o.pot.settings });
    if (req.method === "GET" && pathname === "/api/manager/pot/preview") return json(res, 200, o.pot.preview(Number(url.searchParams.get("coins") ?? 0)));
    if (req.method !== "POST") throw new HttpError(405, "method not allowed");
    const body = await readJson(req);
    const by = typeof body.by === "string" ? body.by.slice(0, 40) : null;
    if (pathname === "/api/manager/pot/topup") {
      const preview = o.pot.preview(Number(body.coins));
      const entry = o.pot.topUp({ coins: body.coins, reason: body.reason, by });
      return json(res, 200, { ok: true, entry, warning: preview.over_limit ? `This month could now spend $${(preview.month_total_cents / 100).toFixed(2)}, past the workspace's $${(preview.workspace_limit_cents / 100).toFixed(2)} limit.` : null });
    }
    if (pathname === "/api/manager/pot/reset") return json(res, 200, { ok: true, entry: o.pot.reset({ reason: body.reason, by }) });
    throw new HttpError(404, "no such endpoint");
  };

  const OURS = new Set(["/api/config", "/api/makers", "/api/studio", "/api/studio/events", "/api/studio/start", "/api/studio/answer", "/api/studio/result-seen", "/api/studio/still-here", "/api/studio/stop", "/api/studio/notice-seen", "/api/speech/start", "/api/speech/stop", "/api/speech/feed", "/api/pot", "/api/boot", "/api/boot/seen"]);

  return (/** @type {http.IncomingMessage} */ req, /** @type {http.ServerResponse} */ res) => {
    let pathname;
    let url;
    try {
      url = new URL(req.url ?? "/", "http://x");
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return void res.writeHead(400).end("bad url");
    }
    if (pathname.startsWith("/api/manager/")) {
      return void manager(req, res, pathname, url).catch((e) => json(res, e instanceof HttpError ? e.status : e instanceof PotError ? 400 : 500, { ok: false, error: e.message }));
    }
    if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) return sendFile(res, path.join(LAUNCHER, "index.html"));
    const m = /^\/launcher\/([A-Za-z0-9_-]+\.(?:js|css|html))$/.exec(pathname);
    if (req.method === "GET" && m) return sendFile(res, path.join(LAUNCHER, m[1]));
    if (!OURS.has(pathname)) return player(req, res);
    if (req.method === "GET") {
      if (pathname === "/api/config") return json(res, 200, { console: o.consoleName ?? "Quarter Deck", players: o.players ?? 1, speech: o.speech.kind });
      if (pathname === "/api/makers") return json(res, 200, { makers: o.makers.list() });
      if (pathname === "/api/pot") return json(res, 200, potView(60));
      if (pathname === "/api/boot") return json(res, 200, o.cabinet?.boot() ?? { intro: false, new_month: false });
      if (pathname === "/api/studio") return json(res, 200, o.studio.state());
      if (pathname === "/api/studio/events") return events(res);
      return json(res, 405, { ok: false, error: "method not allowed" });
    }
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "method not allowed" });
    post(req, res, pathname).catch((e) => {
      const status = e instanceof HttpError ? e.status : e instanceof StudioBusy || e instanceof StudioGone || e instanceof StudioRefused ? 409 : 400;
      json(res, status, { ok: false, error: e.message, ...(e instanceof StudioRefused ? { why: e.why } : {}) });
    });
  };
}

/**
 * @param {Parameters<typeof createServiceHandler>[0] & { port?: number, host?: string }} o
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 */
export function startService(o) {
  const server = http.createServer(createServiceHandler(o));
  const host = o.host ?? "127.0.0.1";
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(o.port ?? 8330, host, () => {
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
