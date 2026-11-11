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
//   POST /api/studio/start       {maker, request}
//   POST /api/studio/answer      {id, choice, said?}
//   POST /api/studio/result-seen {id}: someone has seen how a make ended (D192)
//   POST /api/studio/still-here  a key was pressed: the walk-away clock starts again (D188)
//   POST /api/studio/stop        the kid chose to stop this make (D188)
//   POST /api/studio/notice-seen {id}: the kid has read a message (D188, D189)
//   POST /api/speech/start, stop hold-to-talk (D87, D184)
//   POST /api/speech/feed        {text} or {wav}: the stub only
//   GET  /api/guests, POST /api/guest-plays  guest games (D230-D232, src/guests.js)
//   everything else              createPlayerHandler (/api/carts, /api/plays, /api/you-check, /runtime/…, /carts/…)
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPlayerHandler } from "@game-studio-arcade/player";
import { StudioBusy, StudioGone } from "./studio.js";

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
 *   guests?: ReturnType<typeof import("./guests.js").createGuests>,
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
      o.studio.start({ maker: maker.id, request });
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

  const OURS = new Set(["/api/config", "/api/makers", "/api/studio", "/api/studio/events", "/api/studio/start", "/api/studio/answer", "/api/studio/result-seen", "/api/studio/still-here", "/api/studio/stop", "/api/studio/notice-seen", "/api/speech/start", "/api/speech/stop", "/api/speech/feed"]);

  return (/** @type {http.IncomingMessage} */ req, /** @type {http.ServerResponse} */ res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    } catch {
      return void res.writeHead(400).end("bad url");
    }
    if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) return sendFile(res, path.join(LAUNCHER, "index.html"));
    const m = /^\/launcher\/([A-Za-z0-9_-]+\.(?:js|css|html))$/.exec(pathname);
    if (req.method === "GET" && m) return sendFile(res, path.join(LAUNCHER, m[1]));
    if (o.guests?.api(req, res, pathname)) return;
    if (!OURS.has(pathname)) return player(req, res);
    if (req.method === "GET") {
      if (pathname === "/api/config") return json(res, 200, { console: o.consoleName ?? "Quarter Deck", players: o.players ?? 1, speech: o.speech.kind });
      if (pathname === "/api/makers") return json(res, 200, { makers: o.makers.list() });
      if (pathname === "/api/studio") return json(res, 200, o.studio.state());
      if (pathname === "/api/studio/events") return events(res);
      return json(res, 405, { ok: false, error: "method not allowed" });
    }
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "method not allowed" });
    post(req, res, pathname).catch((e) => {
      const status = e instanceof HttpError ? e.status : e instanceof StudioBusy || e instanceof StudioGone ? 409 : 400;
      json(res, status, { ok: false, error: e.message });
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
