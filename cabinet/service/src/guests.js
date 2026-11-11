// Guest games (D230–D232): downloaded web games on the shelf, beside the carts.
//
// On the service's own port (the launcher's origin):
//   GET  /api/guests        the guest list, with plays from the logs
//   POST /api/guest-plays   a finished play, logged to logs/guest_play.jsonl
// On the guest port (127.0.0.1:8331 on the cabinet; its own origin, D232):
//   GET  /<id>/<file>       the guest's play/ folder; its HTML pages get the escape script first
//   GET  /__cabinet/escape.js
//
// A guest is a folder with guest.json and play/ (D231). Folders are read on every
// list, so a guest added by an update shows without a restart.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const PLAY_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ENDED = new Set(["star", "back"]);

// Runs before anything else on a guest's page: Escape never reaches the game;
// it tells the launcher, which ends the play and goes back to the shelf (D88, D232).
export const ESCAPE_JS = `(() => {
  const stop = (e) => {
    if (e.key !== "Escape" && e.code !== "Escape") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === "keydown" && !e.repeat) parent.postMessage({ gsa: "star" }, "*");
  };
  addEventListener("keydown", stop, { capture: true });
  addEventListener("keyup", stop, { capture: true });
})();
`;

/**
 * @param {string} dir a folder of guest folders
 * @returns {{ id: string, dir: string, meta: any }[]}
 */
export function listGuests(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    const file = path.join(dir, name, "guest.json");
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      continue; // not a guest, or a broken one: it just isn't on the shelf
    }
    if (meta?.id !== name || !ID.test(name) || typeof meta.title !== "string" || typeof meta.entry !== "string") continue;
    if (!fs.existsSync(path.join(dir, name, "play"))) continue;
    out.push({ id: name, dir: path.join(dir, name), meta });
  }
  return out;
}

/** @param {string} file */
const readLog = (file) => {
  try {
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
};

/**
 * @param {{ dirs: string[], logsDir: string, guestPort?: number, now?: () => Date }} o
 */
export function createGuests(o) {
  const now = o.now ?? (() => new Date());
  const all = () => {
    const seen = new Set();
    return o.dirs.flatMap(listGuests).filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)));
  };
  const find = (/** @type {string} */ id) => all().find((g) => g.id === id) ?? null;
  const logFile = () => path.join(o.logsDir, "guest_play.jsonl");

  /** What the launcher needs, per guest. `host` is how the launcher reached us. */
  const list = (/** @type {string} */ host) => {
    const plays = readLog(logFile());
    const hostname = (host || "127.0.0.1").replace(/:\d+$/, "");
    return all().map(({ id, meta }) => ({
      id,
      guest: true,
      title: meta.title,
      by: meta.by ?? null,
      version: meta.version ?? null,
      players: meta.players ?? 1,
      howToPlay: meta.howToPlay ?? null,
      url: self.port ? `http://${hostname}:${self.port}/${id}/${meta.entry}` : null,
      plays: plays.filter((p) => p.guest_id === id).length,
    }));
  };

  /** @param {any} b */
  const playRecord = (b) => {
    const g = find(typeof b?.guest_id === "string" ? b.guest_id : "");
    if (!g) throw Object.assign(new Error("no such guest"), { status: 404 });
    if (typeof b.play_id !== "string" || !PLAY_ID.test(b.play_id)) throw Object.assign(new Error("play_id must be 1-64 letters, digits, _ or -"), { status: 400 });
    if (typeof b.started_at !== "string" || Number.isNaN(Date.parse(b.started_at))) throw Object.assign(new Error("started_at must be an ISO time"), { status: 400 });
    const duration = Number(b.duration_s);
    if (!Number.isFinite(duration) || duration < 0) throw Object.assign(new Error("duration_s must be a number >= 0"), { status: 400 });
    return {
      id: b.play_id,
      guest_id: g.id,
      guest_version: g.meta.version ?? null,
      origin: "cabinet",
      started_at: new Date(b.started_at).toISOString(),
      duration_s: Math.round(duration * 10) / 10,
      ended: ENDED.has(b.ended) ? b.ended : "back",
      errors: Number.isInteger(b.errors) && b.errors >= 0 ? b.errors : 0,
      logged_at: now().toISOString(),
    };
  };

  /** @param {any} body */
  const logPlay = (body) => {
    const record = playRecord(body);
    fs.mkdirSync(o.logsDir, { recursive: true });
    fs.appendFileSync(logFile(), JSON.stringify(record) + "\n");
    return record;
  };

  /**
   * The guest port's handler: files only, nothing that writes.
   * @param {http.IncomingMessage} req @param {http.ServerResponse} res
   */
  const files = (req, res) => {
    const notFound = () => void res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
    if (req.method !== "GET" && req.method !== "HEAD") return void res.writeHead(405).end();
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    } catch {
      return void res.writeHead(400).end("bad url");
    }
    const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
    if (pathname === "/__cabinet/escape.js") return void res.writeHead(200, { ...headers, "Content-Type": TYPES[".js"] }).end(ESCAPE_JS);
    const m = /^\/([a-z0-9][a-z0-9-]{0,39})\/(.*)$/.exec(pathname);
    if (!m) return notFound();
    const g = find(m[1]);
    if (!g) return notFound();
    const root = path.join(g.dir, "play");
    const file = path.resolve(root, m[2] || "index.html");
    if (file !== root && !file.startsWith(root + path.sep)) return notFound();
    const type = TYPES[path.extname(file).toLowerCase()];
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      return notFound();
    }
    if (!type || !stat.isFile()) return notFound();
    if (path.extname(file).toLowerCase() === ".html") {
      const html = fs.readFileSync(file, "utf8");
      const tag = '<script src="/__cabinet/escape.js"></script>';
      const at = html.search(/<head[^>]*>/i);
      const out = at < 0 ? tag + html : html.replace(/<head[^>]*>/i, (h) => h + tag);
      return void res.writeHead(200, { ...headers, "Content-Type": type }).end(out);
    }
    // Byte ranges, so audio can seek and loop.
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
      if (start > end || start >= stat.size) return void res.writeHead(416, { "Content-Range": `bytes */${stat.size}` }).end();
      res.writeHead(206, { ...headers, "Content-Type": type, "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": end - start + 1 });
      if (req.method === "HEAD") return void res.end();
      return void fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": stat.size });
    if (req.method === "HEAD") return void res.end();
    fs.createReadStream(file).pipe(res);
  };

  /**
   * The launcher-side API. Returns false for paths that aren't guests', so the
   * service can hand them on.
   * @param {http.IncomingMessage} req @param {http.ServerResponse} res @param {string} pathname
   */
  const api = (req, res, pathname) => {
    if (pathname !== "/api/guests" && pathname !== "/api/guest-plays") return false;
    const json = (/** @type {number} */ status, /** @type {unknown} */ body) =>
      void res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify(body));
    if (pathname === "/api/guests") {
      if (req.method !== "GET") return json(405, { ok: false, error: "method not allowed" }), true;
      return json(200, { guests: list(String(req.headers.host ?? "")) }), true;
    }
    if (req.method !== "POST") return json(405, { ok: false, error: "method not allowed" }), true;
    // Only the launcher may log: a guest is on another origin (D232).
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== `http://${req.headers.host}`) return json(403, { ok: false, error: "cross-origin write refused" }), true;
    let size = 0;
    /** @type {Buffer[]} */
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size <= 16 * 1024) chunks.push(c);
    });
    req.on("end", () => {
      try {
        if (size > 16 * 1024) return json(413, { ok: false, error: "body too large" });
        const record = logPlay(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
        json(200, { ok: true, record });
      } catch (e) {
        json(/** @type {any} */ (e).status ?? 400, { ok: false, error: /** @type {Error} */ (e).message });
      }
    });
    return true;
  };

  /** `port` is the guest server's, set once it listens. */
  const self = { port: o.guestPort ?? 0, list, logPlay, files, api };
  return self;
}

/**
 * The guest port's server (D232).
 * @param {ReturnType<typeof createGuests>} guests @param {{ port: number, host?: string }} o
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 */
export function startGuestServer(guests, o) {
  const server = http.createServer(guests.files);
  const host = o.host ?? "127.0.0.1";
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(o.port, host, () => {
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
