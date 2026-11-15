// The game-studio plugin's `arcade` MCP server on the mini (D341, D342): a bridge, not a server of its own.
// Claude Code starts it over stdio; it holds the Cabinet Manager's SSH connection to the chosen cabinet
// (manager/cabinet.mjs, the same key and port forward), and passes each tool call to the cabinet's own
// arcade server at POST /mcp with the Manager's pairing token. Everything the tools do happens on the cabinet.
//
// Conveniences live here, because only the mini has the folders and the connection: get_cart's `into` writes the
// files to a local folder, publish_cart's `dir` packs a local folder as the bundle, publish_cart waits for the
// cabinet's gate a little at a time (D513), and use_cabinet switches cabinets mid-session (D516).
//
// Which cabinet (D516), first that says: ARCADE_CABINET; a `.arcade-cabinet` file in the project folder or above it
// (one word: virtual, real, or a name in ~/game-studio-data/manager/cabinets.json); else virtual. A session started
// by Duo can't set an environment variable, so the file (or use_cabinet) is how such a session picks the Picade.
//   ARCADE_URL       a service's base URL to use directly, with no SSH: a local copy for development and tests
//   ARCADE_TOKEN_FILE  the token for ARCADE_URL (default: the cabinet's Manager token file)
import fs from "node:fs";
import path from "node:path";
import { createArcadeMcp, folderFiles, bundlePathProblem } from "../../cabinet/service/src/arcade-mcp.js";
import { mcpServer, serveStdio, ToolError } from "../../cabinet/service/src/mcp-rpc.js";

/** The marker get_cart leaves in a pulled folder, so a publish knows its parent (D342). */
export const PULLED = ".arcade-pulled.json";
/** The project's choice of cabinet (D516). */
export const CABINET_FILE = ".arcade-cabinet";
const MODERN = { "io.modelcontextprotocol/protocolVersion": "2026-07-28" };
/** How long one publish_cart or publish_status call through the bridge waits in all, a few short calls to the cabinet at a time (D513). */
export const BRIDGE_WAIT_MS = 4 * 60_000;

/** The arcade tools' definitions, without a cabinet: the bridge lists the same tools the cabinet serves. */
export function arcadeToolDefs() {
  const none = /** @type {any} */ ({});
  return createArcadeMcp({ paths: { root: "", carts: "", logs: "", sessions: "" }, makers: none, checker: none })
    .tools()
    .map(({ call, ...def }) => def);
}

const USE_CABINET = {
  name: "use_cabinet",
  description:
    "Say which cabinet the other arcade tools reach for the rest of this session: virtual (the twin on the mini), real (the Picade in the kitchen), or a name from the Cabinet Manager's cabinets.json. Without it, the session's cabinet is ARCADE_CABINET, else the project's .arcade-cabinet file, else virtual. Every arcade result says which cabinet it came from.",
  inputSchema: { type: "object", properties: { cabinet: { type: "string" } }, required: ["cabinet"], additionalProperties: false },
};

/** The definitions as the bridge offers them: get_cart takes `into`, publish_cart takes `dir` in place of `bundle`, plus use_cabinet. */
export function bridgeToolDefs() {
  return [
    ...arcadeToolDefs().map((d) => {
      const schema = /** @type {any} */ (structuredClone(d.inputSchema));
      if (d.name === "get_cart") schema.properties.into = { type: "string", description: "a local folder to write the cart into (made if missing, must be empty); the result lists the files instead of returning them" };
      if (d.name === "publish_cart") {
        schema.properties.dir = { type: "string", description: "the local cart folder to publish (in place of bundle). If it was pulled with get_cart's into, its parent is filled in from the folder unless you give one" };
        schema.required = schema.required.filter((/** @type {string} */ r) => r !== "bundle");
        delete schema.properties.wait_s; // the bridge waits for you (D513)
      }
      if (d.name === "publish_status") delete schema.properties.wait_s;
      return { ...d, inputSchema: schema };
    }),
    USE_CABINET,
  ];
}

/** Pack a local cart folder as a bundle: the cart's own files only (D343). @param {string} dir */
export function packFolder(dir) {
  const abs = path.resolve(dir);
  if (!fs.existsSync(path.join(abs, "spec.md"))) throw new ToolError(`${abs} has no spec.md: is it a cart folder?`);
  const all = folderFiles(abs).filter((f) => f.path !== "playtest.json");
  return { files: all.filter((f) => !bundlePathProblem(f.path)), skipped: all.filter((f) => bundlePathProblem(f.path)).map((f) => f.path) };
}

/**
 * Which cabinet this session reaches (D516).
 * @param {Record<string, string | undefined>} env @param {string} start  the project folder
 * @returns {{ name: string, from: string }}
 */
export function chooseCabinet(env, start) {
  if (env.ARCADE_CABINET) return { name: env.ARCADE_CABINET.trim(), from: "ARCADE_CABINET" };
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    const f = path.join(dir, CABINET_FILE);
    try {
      const name = fs.readFileSync(f, "utf8").trim().split(/\s+/)[0];
      if (name) return { name, from: f };
    } catch {}
    if (path.dirname(dir) === dir) break;
  }
  return { name: "virtual", from: "the default" };
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
    describe: `${name}: ${config.label} (${config.host})`,
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

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The bridge as an MCP server over a link.
 * @param {Link | (() => Promise<Link>)} linkOrMaker  a link, or one made at the first call (so Claude Code's start isn't held up by SSH)
 * @param {{ choose?: (name: string) => Promise<Link>, waitBudgetMs?: number, pollWaitS?: number, retryMs?: number }} [o]
 *   choose: makes a link to a named cabinet, for use_cabinet; the waits are shortened by tests
 */
export function createBridge(linkOrMaker, o = {}) {
  let maker = linkOrMaker;
  /** @type {Promise<Link> | null} */
  let linking = null;
  const link = () => (linking ??= typeof maker === "function" ? maker() : Promise.resolve(maker));
  const budget = o.waitBudgetMs ?? BRIDGE_WAIT_MS;
  const pollWaitS = o.pollWaitS ?? 25;
  const retryMs = o.retryMs ?? 5000;
  let n = 0;
  /** Call a tool on the cabinet; its result comes back as it is, saying which cabinet answered (D516). @param {string} name @param {any} args */
  const remote = async (name, args) => {
    const l = await link().catch((e) => {
      linking = null;
      throw new ToolError(e.message);
    });
    let r;
    try {
      r = await l.post({ jsonrpc: "2.0", id: `b${++n}`, method: "tools/call", params: { name, arguments: args, _meta: MODERN } });
    } catch (e) {
      throw e instanceof ToolError ? new ToolError(`${e.message} (cabinet: ${l.describe})`) : Object.assign(new Error(`couldn't reach the cabinet (${l.describe}): ${/** @type {Error} */ (e).message}`), { transport: true });
    }
    if (r.error) throw new ToolError(`the cabinet (${l.describe}) said: ${r.error.message}`);
    const { resultType, ...result } = r.result;
    if (result.structuredContent && typeof result.structuredContent === "object") result.structuredContent.cabinet = l.describe;
    if (result.isError && result.content?.[0]?.type === "text") result.content[0] = { type: "text", text: `${result.content[0].text} (cabinet: ${l.describe})` };
    return result;
  };
  /** The text copy says what the structured content says (a refusal keeps its own words). @param {any} r */
  const retext = (r) => {
    if (r.structuredContent && !r.isError) r.content = [{ type: "text", text: JSON.stringify(r.structuredContent, null, 2) }];
    return r;
  };

  /**
   * Wait for a publish (D513): short calls to the cabinet, never one that waits on the gate, so no connection times out;
   * a dropped connection is tried again, since the publish carries on there. After the budget it says how to keep waiting.
   * @param {() => Promise<any>} first @param {any} ctx
   */
  async function waitForPublish(first, ctx) {
    const t0 = Date.now();
    let r = null;
    let lastError = null;
    // A publish that didn't answer (a dropped connection) is asked again: the same cart joins the same publish (D514).
    for (let tries = 0; tries < 3 && !r; tries++) {
      try {
        r = await first();
      } catch (e) {
        if (!(/** @type {any} */ (e).transport)) throw e;
        lastError = e;
        await sleep(retryMs);
      }
    }
    if (!r) throw new ToolError(`${/** @type {Error} */ (lastError).message}. The publish may still be running on the cabinet: publish_cart again with the same cart joins it rather than making a second one.`);
    let fails = 0;
    while (r.structuredContent?.status === "pending" && Date.now() - t0 < budget) {
      const s = r.structuredContent;
      ctx.progress?.(Math.round((Date.now() - t0) / 1000), `waiting for ${s.waiting_for ?? "the cabinet"}`);
      try {
        r = await remote("publish_status", { publish_id: s.publish_id, wait_s: pollWaitS });
        fails = 0;
      } catch (e) {
        if (!(/** @type {any} */ (e).transport) || ++fails >= 6) {
          return retext({ ...r, structuredContent: { ...s, note: `Lost touch with the cabinet while it checks the game (${/** @type {Error} */ (e).message}). It carries on there: call publish_status with publish_id ${s.publish_id}. Don't publish again.` } });
        }
        await sleep(retryMs);
      }
    }
    if (r.structuredContent?.status === "pending") {
      const s = r.structuredContent;
      return retext({ ...r, structuredContent: { ...s, note: `Still going on the cabinet after ${Math.round((Date.now() - t0) / 1000)} s, waiting for ${s.waiting_for}. Call publish_status with publish_id ${s.publish_id}: it waits again. Don't publish again.` } });
    }
    return r;
  }

  const tools = bridgeToolDefs().map((def) => ({
    ...def,
    /** @param {any} args @param {any} ctx */
    async call(args, ctx) {
      if (def.name === "use_cabinet") {
        if (!o.choose) throw new ToolError("this bridge is fixed to one cabinet (ARCADE_URL)");
        const name = String(args.cabinet ?? "").trim();
        const next = await o.choose(name).catch((e) => {
          throw new ToolError(e.message);
        });
        const was = linking ? await linking.catch(() => null) : null;
        was?.close();
        maker = next;
        linking = null;
        return { ok: true, cabinet: next.describe, note: "The other arcade tools now reach this cabinet, for the rest of this session." };
      }
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
        fs.writeFileSync(path.join(dir, PULLED), JSON.stringify({ id: got.cart.id, version: got.cart.version, commit: got.cart.commit, title: got.cart.title, cabinet: got.cabinet, pulled_at: new Date().toISOString() }, null, 2) + "\n");
        return { cart: got.cart, cabinet: got.cabinet, into: dir, files: got.files.map((/** @type {any} */ f) => f.path), note: `To change this game, edit ${dir} and publish it with dir; its parent (${got.cart.id}) comes from ${PULLED}.` };
      }
      if (def.name === "publish_cart") {
        const { dir, ...rest } = args;
        /** @type {any} */
        let extra = {};
        let send = rest;
        if (dir) {
          const abs = path.resolve(dir);
          /** @type {any} */
          let pulled = null;
          try {
            pulled = JSON.parse(fs.readFileSync(path.join(abs, PULLED), "utf8"));
          } catch {}
          const parent = rest.parent ?? pulled?.id ?? undefined;
          const { files, skipped } = packFolder(abs);
          send = { ...rest, ...(parent ? { parent } : {}), bundle: { files } };
          extra = { ...(parent && !rest.parent ? { parent_from_folder: true } : {}), ...(skipped.length ? { not_sent: skipped } : {}) };
        }
        const r = await waitForPublish(() => remote("publish_cart", { ...send, wait_s: pollWaitS }), ctx);
        if (r.structuredContent) Object.assign(r.structuredContent, extra);
        return retext(r);
      }
      if (def.name === "publish_status") return retext(await waitForPublish(() => remote("publish_status", { ...args, wait_s: pollWaitS }), ctx));
      return remote(def.name, args);
    },
  }));

  const server = mcpServer({
    name: "arcade",
    version: "0.1.0",
    instructions: "The game cabinet, through the Cabinet Manager's connection. use_cabinet picks virtual or real; every result says which cabinet answered. Pull a game with get_cart (into: a folder), publish with publish_cart (dir: the folder): it waits for the cabinet's checks, and if they're still going it answers pending with a publish_id for publish_status. Never publish the same cart twice to hurry it. The cabinet re-tests every publish before the shelf and never replaces a game: each publish is a new version.",
    tools,
  });
  return { ...server, close: async () => (linking ? (await linking.catch(() => null))?.close() : undefined) };
}

/** Claude Code's entry point (plugin/bin/run.mjs arcade). */
export async function main() {
  const url = process.env.ARCADE_URL;
  const chosen = chooseCabinet(process.env, process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const direct = async () => {
    const { loadCabinets } = await import("../../manager/cabinet.mjs");
    const tokenFile = process.env.ARCADE_TOKEN_FILE || loadCabinets().find((c) => c.name === chosen.name)?.tokenFile;
    if (!tokenFile) throw new Error("ARCADE_URL needs ARCADE_TOKEN_FILE");
    return directLink(/** @type {string} */ (url), fs.readFileSync(tokenFile, "utf8").trim());
  };
  const bridge = createBridge(url ? direct : () => sshLink(chosen.name), url ? {} : { choose: sshLink });
  process.stderr.write(`game-studio arcade bridge: ${url ?? `cabinet ${chosen.name} (from ${chosen.from})`}\n`);
  await serveStdio(bridge);
  await bridge.close();
  process.exit(0);
}
