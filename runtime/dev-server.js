#!/usr/bin/env node
// A tiny static server for the runtime and carts (D21). No dependencies.
//
//   /runtime/...        this runtime folder (play.html, frame.html, src/...)
//   /carts/<name>/...   each cart folder passed in `carts`
//   /...                optional `root` folder
//
// Every response has Access-Control-Allow-Origin: * (the cart frame has an
// opaque origin, so its module loads are CORS fetches) and no caching.
//
// CLI: node runtime/dev-server.js [--port 8320] [--host 127.0.0.1] [--root DIR] [--cart name=dir ...]
//   With no --cart, serves runtime/examples/* as /carts/<name>/.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RUNTIME_DIR = path.dirname(fileURLToPath(import.meta.url));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".txt": "text/plain; charset=utf-8",
};

/** The cart frame's policy (D13, D21): code only from this server, nothing else at all. */
export const FRAME_CSP = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'";

/**
 * @typedef {{ carts?: Record<string, string>, root?: string, runtimeDir?: string }} ServeOptions
 */

/** Resolve `rel` inside `base`, or null if it escapes. */
function inside(base, rel) {
  const full = path.resolve(base, "." + path.posix.normalize("/" + rel));
  return full === base || full.startsWith(base + path.sep) ? full : null;
}

/**
 * @param {ServeOptions} [opts]
 * @returns {(req: http.IncomingMessage, res: http.ServerResponse) => void}
 */
export function createHandler(opts = {}) {
  const runtimeDir = path.resolve(opts.runtimeDir ?? RUNTIME_DIR);
  const carts = Object.fromEntries(Object.entries(opts.carts ?? {}).map(([k, v]) => [k, path.resolve(v)]));
  const root = opts.root ? path.resolve(opts.root) : null;

  /** @param {string} pathname */
  const locate = (pathname) => {
    if (pathname === "/" || pathname === "/runtime" || pathname === "/runtime/") return { redirect: "/runtime/play.html" };
    let m;
    if ((m = /^\/runtime\/(.*)$/.exec(pathname))) return { file: inside(runtimeDir, m[1]) };
    if ((m = /^\/carts\/([^/]+)\/(.*)$/.exec(pathname))) {
      const dir = carts[m[1]];
      return { file: dir ? inside(dir, m[2]) : null };
    }
    if (pathname === "/carts/" || pathname === "/carts") return { list: Object.keys(carts) };
    return { file: root ? inside(root, pathname.slice(1)) : null };
  };

  return (req, res) => {
    const headers = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, headers).end();
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    } catch {
      res.writeHead(400, headers).end("bad url");
      return;
    }
    const found = locate(pathname);
    if (found.redirect) {
      res.writeHead(302, { ...headers, Location: found.redirect }).end();
      return;
    }
    if (found.list) {
      res.writeHead(200, { ...headers, "Content-Type": TYPES[".json"] }).end(JSON.stringify(found.list));
      return;
    }
    let file = found.file;
    if (file && fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { ...headers, "Content-Type": TYPES[".txt"] }).end(`not found: ${pathname}`);
      return;
    }
    const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    /** @type {Record<string, string>} */
    const h = { ...headers, "Content-Type": type };
    if (path.basename(file) === "frame.html") h["Content-Security-Policy"] = FRAME_CSP;
    res.writeHead(200, h);
    if (req.method === "HEAD") res.end();
    else fs.createReadStream(file).pipe(res);
  };
}

/**
 * Start the server. Port 0 picks a free port.
 * @param {ServeOptions & { port?: number, host?: string }} [opts]
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 */
export function startServer(opts = {}) {
  const server = http.createServer(createHandler(opts));
  const host = opts.host ?? "127.0.0.1";
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 8320, host, () => {
      const addr = /** @type {import("node:net").AddressInfo} */ (server.address());
      resolve({
        url: `http://${host}:${addr.port}`,
        port: addr.port,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

/** Cart folders under a directory (each with a game.js), by folder name. */
export function cartsIn(dir) {
  if (!fs.existsSync(dir)) return {};
  return Object.fromEntries(
    fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, "game.js")))
      .map((d) => [d.name, path.join(dir, d.name)]),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  /** @type {Record<string, string>} */
  const carts = {};
  let port = Number(process.env.GSA_DEV_PORT) || 8320;
  let host = "127.0.0.1";
  let root;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--port") port = Number(args[++i]);
    else if (a === "--host") host = args[++i];
    else if (a === "--root") root = args[++i];
    else if (a === "--cart") {
      const [name, dir] = args[++i].split("=");
      carts[name] = dir;
    } else if (a === "--carts") Object.assign(carts, cartsIn(args[++i]));
    else {
      console.error(`unknown argument ${a}`);
      process.exit(2);
    }
  }
  if (Object.keys(carts).length === 0) Object.assign(carts, cartsIn(path.join(RUNTIME_DIR, "examples")));
  const s = await startServer({ port, host, carts, root });
  console.log(`runtime dev server at ${s.url}`);
  for (const name of Object.keys(carts)) console.log(`  ${s.url}/runtime/play.html?cart=/carts/${name}/game.js`);
}
