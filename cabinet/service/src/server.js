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
//     Both are screened first (D270-D275, src/screening.js): an idea or a kid's own words that need
//     redirecting come back {ok: false, why: "redirect", redirect: {say, alternative}}, with no session
//     started, no coins used and the question still waiting. {offered: true} marks an offered alternative.
//   POST /api/studio/result-seen {id}: someone has seen how a make ended (D192)
//   POST /api/studio/still-here  a key was pressed: the walk-away clock starts again (D188)
//   POST /api/arcade/playing     {playing, what?}: a game started, is still going, or ended; the publish gate waits (D310)
//   GET  /api/arcade/playing     {playing, what, gate_busy}: whether a game or a gate check is on now; an update waits (D332)
//   POST /api/studio/stop        the kid chose to stop this make (D188)
//   POST /api/studio/notice-seen {id}: the kid has read a message (D188, D189)
//   POST /api/game-ai            {cart_id, play_id, kind, name, ask, …}: a game's g.ai ask (D480, src/game-ai.js)
//   POST /api/speech/start, stop hold-to-talk (D87, D184)
//   POST /api/speech/feed        {text} or {wav}: the stub only
//   GET  /api/guests, POST /api/guest-plays  guest games (D230-D232, src/guests.js)
//   GET  /api/pot                the family coin pot and its ledger, newest first (D202, A1, A2)
//   GET  /api/boot               first-ever boot and new-month screens still to show (B2-B4)
//   POST /api/boot/seen          {what: "intro" | "month"}
//   The Cabinet Manager's, with its token (D205; the Manager isn't built yet, D208):
//   GET  /api/manager/pot        the pot, the ledger, the rules
//   GET  /api/manager/pot/preview?coins=N   what a top-up would do, and whether it passes the workspace limit (D204)
//   POST /api/manager/pot/topup  {coins, reason, by?}
//   POST /api/manager/pot/reset  {reason, by?}
//   GET  /api/manager/game-ai    what AI in games has cost: this month, all time, per game, guard trips (D488)
//   GET  /api/manager/makers     every maker, grown-ups included (D236)
//   POST /api/manager/makers/grown-up  {name}: add a grown-up maker; one already there is left as is
//   GET  /api/manager/games      every game line, on the shelf or off, and the marks' history (D361)
//   POST /api/manager/games/remove   {id, reason?, by?}: off the shelf, kept in the records (D360)
//   POST /api/manager/games/restore  {id, by?}: back on the shelf
//   POST /api/manager/makers/hide    {id, reason?, by?}: off "Who's making?" (D363); /makers/show puts it back
//   The arcade MCP server, for desktop Claude Code through the game-studio plugin (D340-D346), with the Manager's token:
//   POST /mcp                    JSON-RPC (src/arcade-mcp.js)
//   GET  /api/arcade/launch      the launcher listens here for launch_on_cabinet (D344), as server-sent events
//   POST /api/arcade/launch/answer  {launch, ok, why?}: the launcher opened the game, or why not
//   everything else              createPlayerHandler (/api/carts, /api/plays, /api/you-check, /runtime/…, /carts/…)
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPlayerHandler } from "@game-studio-arcade/player";
import { timingSafeEqual } from "node:crypto";
import { StudioBusy, StudioGone, StudioRefused } from "./studio.js";
import { PotError } from "./pot.js";
import { serveMcpHttp } from "./arcade-mcp.js";
import { listCarts, readCart } from "@game-studio-arcade/player/src/library.js";
import { readLog } from "@game-studio-arcade/studio-cli/src/log.js";
import { gameLines } from "./shelf-marks.js";
import { readAsk, summarizeGameAi } from "./game-ai.js";

const LAUNCHER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../launcher");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
// No length cutoff on what a kid says (D470): an hour of talking is about 9,000 words, 55,000 characters.
// These only stop a runaway request: 2 million characters is days of talking.
const MAX_BODY = 8 * 1024 * 1024;
const MAX_WORDS = 2_000_000;

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
 *   keyboard?: boolean, // false on the Picade, which has no keyboard: typing there is the stick's (D430)
 *   guests?: ReturnType<typeof import("./guests.js").createGuests>,
 *   pot?: ReturnType<typeof import("./pot.js").potStore>,
 *   cabinet?: ReturnType<typeof import("./cabinet-state.js").cabinetState>,
 *   managerToken?: string | null | (() => string | null),
 *   screen?: ReturnType<typeof import("./screening.js").createScreener> | null,
 *   plays?: ReturnType<typeof import("./gate.js").playTracker>,
 *   gateBusy?: () => boolean,
 *   mcp?: ReturnType<typeof import("./arcade-mcp.js").createArcadeMcp> | null,
 *   launches?: ReturnType<typeof import("./arcade-mcp.js").launchRelay> | null,
 *   marks?: ReturnType<typeof import("./shelf-marks.js").shelfMarks> | null,
 *   wifi?: import("./wifi-client.js").WifiPort | null,
 *   volumeFile?: string,
 *   gameAi?: ReturnType<typeof import("./game-ai.js").createGameAi> | null,
 * }} o
 */
const VOLUME_FILE = "/run/arcade-volume/level.json";

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
    hideCart: (c) => Boolean(o.marks?.cartOff(c)), // D361
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
      // A game off the shelf can't be changed from the cabinet (D361); the launcher no longer offers it.
      const parentCart = parent && o.marks ? readCart(o.libraryDir, parent.replace(/@\d+$/, "")) : null;
      if (parentCart && o.marks?.cartOff(parentCart)) throw new HttpError(409, "that game is off the shelf");
      const screened = await o.screen?.check({ text: request, kind: parent ? "change" : "new", maker: maker.id, offered: body.offered === true });
      if (screened && !screened.ok) return json(res, 200, { ok: false, why: "redirect", redirect: screened });
      o.studio.start({ maker: maker.id, request, parent });
      return json(res, 200, { ok: true, state: o.studio.state() });
    }
    if (pathname === "/api/studio/answer") {
      if (typeof body.said === "string" && body.said.length > MAX_WORDS) throw new HttpError(400, "that's too many words");
      // The kid's own words for a question (C) or a plan (change). Only for the question that's waiting.
      const st = o.studio.state();
      if (typeof body.said === "string" && body.said.trim() && st.pending?.id === body.id) {
        // What they're answering goes too, so an alternative still answers it (D276).
        const p = st.pending;
        const question = p.kind === "question" ? (p.question ?? null) : `What should be different in this game's plan?${p.summary ? ` (The plan: ${p.summary})` : ""}`;
        const screened = await o.screen?.check({ text: body.said, kind: "answer", maker: st.maker ?? null, offered: body.offered === true, question });
        if (screened && !screened.ok) return json(res, 200, { ok: false, why: "redirect", redirect: screened });
      }
      o.studio.answer({ id: body.id, choice: body.choice, said: body.said });
      return json(res, 200, { ok: true, state: o.studio.state() });
    }
    if (pathname === "/api/studio/result-seen") {
      o.studio.viewResult(body.id);
      return json(res, 200, { ok: true });
    }
    if (pathname === "/api/arcade/playing") {
      // A game started, is still going (every few seconds), or ended: the publish gate waits for it (D310).
      o.plays?.set(body.playing === true, typeof body.what === "string" ? body.what.slice(0, 80) : null);
      return json(res, 200, { ok: true });
    }
    if (pathname === "/api/game-ai") {
      // D480: a game's g.ai ask, passed on by the launcher. Only for the game on screen now, and only a made game's.
      if (!o.gameAi) return json(res, 200, { ok: false, why: "off", stop: true });
      const cart = readCart(o.libraryDir, String(body.cart_id ?? ""));
      if (!cart) throw new HttpError(404, "no such game");
      if (o.plays && o.plays.what() !== cart.id) return json(res, 200, { ok: false, why: "not_playing" });
      return json(res, 200, await o.gameAi.ask({ cart, playId: typeof body.play_id === "string" ? body.play_id.slice(0, 80) : null, ask: readAsk(body) }));
    }
    if (pathname === "/api/arcade/launch/answer") {
      o.launches?.answer(String(body.launch ?? ""), body.ok === true, typeof body.why === "string" ? body.why : undefined);
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
    if (pathname === "/api/speech/cancel") {
      // D491: a hold thrown away (a cancelled talk screen, a game's too-short voice hold): nothing is transcribed.
      if (o.speech.cancel) o.speech.cancel();
      else await o.speech.stop();
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
    // D414: the launcher's Wi-Fi screens. Loopback only, like everything here; the password goes to the helper
    // and nowhere else: not a log, not the Studio's records.
    if (pathname === "/api/wifi/scan" || pathname === "/api/wifi/join") {
      if (!o.wifi) throw new HttpError(404, "no Wi-Fi settings on this cabinet");
      if (pathname === "/api/wifi/scan") return json(res, 200, { ...(await o.wifi.scan()), ok: true });
      if (typeof body.ssid !== "string" || (body.password != null && typeof body.password !== "string")) throw new HttpError(400, "ssid and password are text");
      const r = await o.wifi.join({ ssid: body.ssid, password: body.password ?? null, security: typeof body.security === "string" ? body.security : undefined });
      // A result is the answer either way: "joined" says whether it worked.
      return json(res, 200, { ...r, joined: !!r.ok, host: os.hostname(), ok: true });
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
    // A function reads the token file on each request, so pairing needs no restart (D215).
    const token = typeof o.managerToken === "function" ? o.managerToken() : o.managerToken;
    if (!token) throw new HttpError(404, "no Cabinet Manager is paired with this cabinet");
    const got = Buffer.from(String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
    const want = Buffer.from(token);
    if (got.length !== want.length || !timingSafeEqual(got, want)) throw new HttpError(401, "the Manager's token is needed");
  };

  /** @param {http.IncomingMessage} req @param {http.ServerResponse} res @param {string} pathname @param {URL} url */
  const manager = async (req, res, pathname, url) => {
    managerOk(req);
    // Makers, grown-ups included (D236): a grown-up is added only here, by a grown-up's command, never by the service itself.
    if (req.method === "GET" && pathname === "/api/manager/makers") {
      const off = o.marks?.off("maker") ?? new Map();
      return json(res, 200, { makers: o.makers.read().map((m) => ({ ...m, on_list: !off.has(m.id) && !m.hidden && !m.grown_up, off: off.get(m.id) ?? null })) });
    }
    if (pathname.startsWith("/api/manager/games") || pathname === "/api/manager/makers/hide" || pathname === "/api/manager/makers/show") return shelf(req, res, pathname);
    if (req.method === "POST" && pathname === "/api/manager/makers/grown-up") {
      const body = await readJson(req);
      const before = o.makers.read().length;
      const maker = o.makers.ensureGrownUp(String(body.name ?? ""));
      if (!maker) throw new HttpError(400, "a grown-up maker needs a first name");
      return json(res, 200, { ok: true, maker, added: o.makers.read().length > before });
    }
    // D488: what AI in games has cost, summed from the whole cost log (the Manager's own read is only each log's tail).
    if (req.method === "GET" && pathname === "/api/manager/game-ai") return json(res, 200, { on: o.gameAi?.on ?? false, ...summarizeGameAi(readLog(path.join(o.logsDir, "game_ai.jsonl")), new Date().toISOString().slice(0, 7)) });
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

  /** Off the shelf and back (D360-D363). @param {http.IncomingMessage} req @param {http.ServerResponse} res @param {string} pathname */
  const shelf = async (req, res, pathname) => {
    const marks = o.marks;
    if (!marks) throw new HttpError(404, "this cabinet keeps no shelf marks");
    const carts = () => listCarts([{ root: o.libraryDir, source: "library" }]);
    const games = () => gameLines(carts(), marks, { plays: readLog(path.join(o.logsDir, "play.jsonl")), makerName: (id) => o.makers.get(id)?.name ?? null });
    if (req.method === "GET" && pathname === "/api/manager/games") return json(res, 200, { games: games(), history: marks.all().slice(-200).reverse() });
    if (req.method !== "POST") throw new HttpError(405, "method not allowed");
    const body = await readJson(req);
    const id = String(body.id ?? "");
    const by = typeof body.by === "string" ? body.by.slice(0, 60) : null;
    const reason = typeof body.reason === "string" ? body.reason : "";
    if (pathname === "/api/manager/games/remove" || pathname === "/api/manager/games/restore") {
      if (!games().some((g) => g.id === id)) throw new HttpError(404, `no game "${id}" on this cabinet`);
      const r = marks.mark({ kind: "game", target: id, action: pathname.endsWith("remove") ? "remove" : "restore", by, via: "manager", reason });
      return json(res, 200, { ok: true, ...r, game: games().find((g) => g.id === id) });
    }
    if (pathname === "/api/manager/makers/hide" || pathname === "/api/manager/makers/show") {
      if (!o.makers.get(id)) throw new HttpError(404, `no maker "${id}" on this cabinet`);
      const r = marks.mark({ kind: "maker", target: id, action: pathname.endsWith("hide") ? "remove" : "restore", by, via: "manager", reason });
      return json(res, 200, { ok: true, ...r });
    }
    throw new HttpError(404, "no such endpoint");
  };

  const OURS = new Set(["/api/wifi", "/api/wifi/scan", "/api/wifi/join", "/api/config", "/api/makers", "/api/studio", "/api/studio/events", "/api/studio/start", "/api/studio/answer", "/api/studio/result-seen", "/api/studio/still-here", "/api/arcade/playing", "/api/studio/stop", "/api/studio/notice-seen", "/api/speech/start", "/api/speech/stop", "/api/speech/feed", "/api/pot", "/api/boot", "/api/boot/seen", "/api/arcade/launch", "/api/arcade/launch/answer", "/api/arcade/volume", "/api/game-ai", "/api/speech/cancel"]);

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
    if (pathname === "/mcp" && o.mcp) {
      // Desktop Claude Code, paired like the Manager (D341): its token, on the service's loopback port, through the mini's SSH.
      const mcp = o.mcp;
      return void Promise.resolve()
        .then(() => managerOk(req))
        .then(() => serveMcpHttp(mcp, req, res))
        .catch((e) => json(res, e instanceof HttpError ? e.status : 500, { jsonrpc: "2.0", id: null, error: { code: -32001, message: e.message } }));
    }
    if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) return sendFile(res, path.join(LAUNCHER, "index.html"));
    const m = /^\/launcher\/([A-Za-z0-9_-]+\.(?:js|css|html))$/.exec(pathname);
    if (req.method === "GET" && m) return sendFile(res, path.join(LAUNCHER, m[1]));
    if (o.guests?.api(req, res, pathname)) return;
    if (!OURS.has(pathname)) return player(req, res);
    if (req.method === "GET") {
      if (pathname === "/api/config") return json(res, 200, { console: o.consoleName ?? "Quarter Deck", players: o.players ?? 1, speech: o.speech.kind, keyboard: o.keyboard ?? true });
      // The list "Who's making?" offers, and every maker's name for the shelf's "by …", hidden ones too (D363).
      if (pathname === "/api/makers") return json(res, 200, { makers: o.makers.list().filter((m) => !o.marks?.makerOff(m.id)), names: Object.fromEntries(o.makers.read().map((m) => [m.id, m.name])) });
      if (pathname === "/api/pot") return json(res, 200, potView(60));
      if (pathname === "/api/boot") return json(res, 200, o.cabinet?.boot() ?? { intro: false, new_month: false });
      if (pathname === "/api/studio") return json(res, 200, o.studio.state());
      if (pathname === "/api/wifi") {
        if (!o.wifi) return json(res, 200, { available: false });
        return void o.wifi.status().then(
          (st) => json(res, 200, { ...st, available: true }),
          () => json(res, 200, { available: true, ok: false }),
        );
      }
      if (pathname === "/api/arcade/playing") return json(res, 200, { playing: o.plays?.playing() ?? false, what: o.plays?.what() ?? null, gate_busy: o.gateBusy?.() ?? false });
      if (pathname === "/api/studio/events") return events(res);
      if (pathname === "/api/arcade/launch") {
        if (!o.launches) return json(res, 404, { ok: false, error: "no launches here" });
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
        res.write(": listening\n\n");
        const stop = o.launches.subscribe((m) => res.write(`data: ${JSON.stringify(m)}\n\n`));
        return void res.on("close", () => stop());
      }
      if (pathname === "/api/arcade/volume") {
        // D421: arcade-volkey writes the level here after each press at the cabinet; the launcher shows its bar.
        // The file may not exist yet (or ever, on the virtual cabinet), so it's watched by its times, not opened.
        const file = o.volumeFile ?? VOLUME_FILE;
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
        res.write(": listening\n\n");
        const changed = (/** @type {fs.Stats} */ now) => {
          if (!now.mtimeMs) return;
          try {
            const l = JSON.parse(fs.readFileSync(file, "utf8"));
            if (Number.isFinite(l.percent)) res.write(`data: ${JSON.stringify({ percent: l.percent, cap: Number.isFinite(l.cap) ? l.cap : 100 })}\n\n`);
          } catch {
            // half-written or unreadable: the next press writes it again
          }
        };
        fs.watchFile(file, { interval: 200 }, changed);
        return void res.on("close", () => fs.unwatchFile(file, changed));
      }
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
