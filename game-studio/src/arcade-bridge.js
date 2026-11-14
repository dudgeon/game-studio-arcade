// The game-studio plugin's `arcade` MCP server on the mini (D341, D342): a bridge, not a server of its own.
// Claude Code starts it over stdio; it holds the Cabinet Manager's SSH connection to the chosen cabinet
// (manager/cabinet.mjs, the same key and port forward), and passes each tool call to the cabinet's own
// arcade server at POST /mcp with the Manager's pairing token. Everything the tools do happens on the cabinet.
//
// Two conveniences live here, because only the mini has the folders: get_cart's `into` writes the files to a
// local folder instead of returning them, and publish_cart's `dir` packs a local folder as the bundle.
//
//   ARCADE_CABINET   which cabinet: virtual (default), real, or a name in ~/game-studio-data/manager/cabinets.json
//   ARCADE_URL       a service's base URL to use directly, with no SSH: a local copy for development and tests
//   ARCADE_TOKEN_FILE  the token for ARCADE_URL (default: the cabinet's Manager token file)
import fs from "node:fs";
import path from "node:path";
import { createArcadeMcp, folderFiles, bundlePathProblem } from "../../cabinet/service/src/arcade-mcp.js";
import { mcpServer, serveStdio, ToolError } from "../../cabinet/service/src/mcp-rpc.js";

/** The marker get_cart leaves in a pulled folder, so a publish knows its parent (D342). */
export const PULLED = ".arcade-pulled.json";
const MODERN = { "io.modelcontextprotocol/protocolVersion": "2026-07-28" };

/** The arcade tools' definitions, without a cabinet: the bridge lists the same tools the cabinet serves. */
export function arcadeToolDefs() {
  const none = /** @type {any} */ ({});
  return createArcadeMcp({ paths: { root: "", carts: "", logs: "", sessions: "" }, makers: none, checker: none })
    .tools()
    .map(({ call, ...def }) => def);
}

/** The definitions as the bridge offers them: get_cart takes `into`, publish_cart takes `dir` in place of `bundle`. */
export function bridgeToolDefs() {
  return arcadeToolDefs().map((d) => {
    const schema = /** @type {any} */ (structuredClone(d.inputSchema));
    if (d.name === "get_cart") schema.properties.into = { type: "string", description: "a local folder to write the cart into (made if missing, must be empty); the result lists the files instead of returning them" };
    if (d.name === "publish_cart") {
      schema.properties.dir = { type: "string", description: "the local cart folder to publish (in place of bundle). If it was pulled with get_cart's into, its parent is filled in from the folder unless you give one" };
      schema.required = schema.required.filter((/** @type {string} */ r) => r !== "bundle");
    }
    return { ...d, inputSchema: schema };
  });
}

/** Pack a local cart folder as a bundle: the cart's own files only (D343). @param {string} dir */
export function packFolder(dir) {
  const abs = path.resolve(dir);
  if (!fs.existsSync(path.join(abs, "spec.md"))) throw new ToolError(`${abs} has no spec.md: is it a cart folder?`);
  const all = folderFiles(abs).filter((f) => f.path !== "playtest.json");
  return { files: all.filter((f) => !bundlePathProblem(f.path)), skipped: all.filter((f) => bundlePathProblem(f.path)).map((f) => f.path) };
}

/**
 * How the bridge reaches a cabinet: post(body) → the parsed JSON-RPC response.
 * @typedef {{ post: (msg: any) => Promise<any>, describe: string, close: () => void }} Link
 */

/** A direct link to a service's /mcp. @param {string} base @param {string} token @returns {Link} */
export function directLink(base, token) {
  return {
    describe: base,
    async post(msg) {
      const r = await fetch(new URL("/mcp", base), { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(msg) });
      const text = await r.text();
      if (r.status === 401) throw new ToolError("the cabinet refused the Manager's token: pair again (node scripts/coin.mjs pair)");
      if (r.status === 404 && /no Cabinet Manager is paired/.test(text)) throw new ToolError("this cabinet isn't paired with the Manager yet: node scripts/coin.mjs pair");
      if (r.status === 404) throw new ToolError("this cabinet's service has no /mcp yet: it needs a release with the arcade MCP server (D340)");
      try {
        return JSON.parse(text);
      } catch {
        throw new ToolError(`the cabinet answered HTTP ${r.status}: ${text.slice(0, 200)}`);
      }
    },
    close() {},
  };
}

/** Through the Manager's held SSH connection to a named cabinet (D341). @param {string} name @returns {Promise<Link>} */
export async function sshLink(name) {
  const { loadCabinets, Cabinet } = await import("../../manager/cabinet.mjs");
  const config = loadCabinets().find((c) => c.name === name);
  if (!config) throw new Error(`no cabinet called ${name}: virtual, real, or one in ~/game-studio-data/manager/cabinets.json`);
  const cab = new Cabinet(config);
  return {
    describe: `${config.label} (${config.host})`,
    async post(msg) {
      try {
        await cab.open();
      } catch (e) {
        throw new ToolError(`can't reach the ${config.label.toLowerCase()}: ${/** @type {Error} */ (e).message}`);
      }
      let token;
      try {
        token = fs.readFileSync(config.tokenFile, "utf8").trim();
      } catch {
        throw new ToolError(`no Manager token for this cabinet at ${config.tokenFile}: pair it first (node scripts/coin.mjs pair)`);
      }
      return directLink(`http://127.0.0.1:${cab.servicePort}`, token).post(msg);
    },
    close: () => cab.close(),
  };
}

/** @param {string} dir */
function emptyOrNew(dir) {
  if (!fs.existsSync(dir)) return true;
  return fs.statSync(dir).isDirectory() && fs.readdirSync(dir).length === 0;
}

/**
 * The bridge as an MCP server over a link.
 * @param {Link | (() => Promise<Link>)} linkOrMaker  a link, or one made at the first call (so Claude Code's start isn't held up by SSH)
 */
export function createBridge(linkOrMaker) {
  /** @type {Promise<Link> | null} */
  let linking = null;
  const link = () => (linking ??= typeof linkOrMaker === "function" ? linkOrMaker() : Promise.resolve(linkOrMaker));
  let n = 0;
  /** Call a tool on the cabinet; its result comes back as it is. @param {string} name @param {any} args */
  const remote = async (name, args) => {
    const l = await link().catch((e) => {
      linking = null;
      throw new ToolError(e.message);
    });
    const r = await l.post({ jsonrpc: "2.0", id: `b${++n}`, method: "tools/call", params: { name, arguments: args, _meta: MODERN } });
    if (r.error) throw new ToolError(`the cabinet said: ${r.error.message}`);
    const { resultType, ...result } = r.result;
    return result;
  };

  const tools = bridgeToolDefs().map((def) => ({
    ...def,
    /** @param {any} args */
    async call(args) {
      if (def.name === "get_cart" && args.into) {
        const { into, ...rest } = args;
        const dir = path.resolve(into);
        if (!emptyOrNew(dir)) throw new ToolError(`${dir} isn't empty: pull into a new folder`);
        const r = await remote("get_cart", rest);
        if (r.isError) return r;
        const got = r.structuredContent;
        fs.mkdirSync(dir, { recursive: true });
        for (const f of got.files) {
          const dest = path.join(dir, f.path);
          if (!dest.startsWith(dir + path.sep)) continue;
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, typeof f.text === "string" ? f.text : Buffer.from(f.base64, "base64"));
        }
        fs.writeFileSync(path.join(dir, PULLED), JSON.stringify({ id: got.cart.id, version: got.cart.version, commit: got.cart.commit, title: got.cart.title, pulled_at: new Date().toISOString() }, null, 2) + "\n");
        return { cart: got.cart, into: dir, files: got.files.map((/** @type {any} */ f) => f.path), note: `To change this game, edit ${dir} and publish it with dir; its parent (${got.cart.id}) comes from ${PULLED}.` };
      }
      if (def.name === "publish_cart" && args.dir) {
        const { dir, ...rest } = args;
        const abs = path.resolve(dir);
        /** @type {any} */
        let pulled = null;
        try {
          pulled = JSON.parse(fs.readFileSync(path.join(abs, PULLED), "utf8"));
        } catch {}
        const parent = rest.parent ?? pulled?.id ?? undefined;
        const { files, skipped } = packFolder(abs);
        const r = await remote("publish_cart", { ...rest, ...(parent ? { parent } : {}), bundle: { files } });
        if (r.structuredContent) {
          Object.assign(r.structuredContent, parent && !rest.parent ? { parent_from_folder: true } : {}, skipped.length ? { not_sent: skipped } : {});
          // The text copy says the same (the spec's backward-compatible copy); a refusal keeps its own words.
          if (!r.isError) r.content = [{ type: "text", text: JSON.stringify(r.structuredContent, null, 2) }];
        }
        return r;
      }
      return remote(def.name, args);
    },
  }));

  const server = mcpServer({
    name: "arcade",
    version: "0.1.0",
    instructions: "The game cabinet, through the Cabinet Manager's connection. Pull a game with get_cart (into: a folder), publish with publish_cart (dir: the folder). The cabinet re-tests every publish before the shelf, and never replaces a game: each publish is a new version.",
    tools,
  });
  return { ...server, close: async () => (linking ? (await linking.catch(() => null))?.close() : undefined) };
}

/** Claude Code's entry point (plugin/bin/run.mjs arcade). */
export async function main() {
  const url = process.env.ARCADE_URL;
  const name = process.env.ARCADE_CABINET || "virtual";
  const make = async () => {
    if (!url) return sshLink(name);
    const { loadCabinets } = await import("../../manager/cabinet.mjs");
    const tokenFile = process.env.ARCADE_TOKEN_FILE || loadCabinets().find((c) => c.name === name)?.tokenFile;
    if (!tokenFile) throw new Error("ARCADE_URL needs ARCADE_TOKEN_FILE");
    return directLink(url, fs.readFileSync(tokenFile, "utf8").trim());
  };
  const bridge = createBridge(make);
  process.stderr.write(`game-studio arcade bridge: ${url ?? `cabinet ${name}`}\n`);
  await serveStdio(bridge);
  await bridge.close();
  process.exit(0);
}
