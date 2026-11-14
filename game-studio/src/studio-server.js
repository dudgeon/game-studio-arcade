// The game-studio plugin's `studio` MCP server (HANDOFF §9.3, D346): the Studio's own tools, run on the mini
// against cart folders on its disk. The same studio kit as a cabinet make: the templates and context pack,
// validate_cart, the playtest harness, the house runtime. Nothing here talks to a cabinet; that's `arcade`.
//
//   read_kit       the context pack's catalog, or one guide from it
//   new_cart       a cart folder from a template or from another cart folder
//   validate_cart  cart.json, rule coverage, the house lint, types (D31)
//   playtest       every auto rule and the generic checks (D60-D65), as the cabinet's gate runs them
//   play           the cart in a browser on the mini, keyboard as joystick
//   import_asset   a picture into a house sprite
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mcpServer, serveStdio, ToolError } from "../../cabinet/service/src/mcp-rpc.js";
import { importAsset, MAX_SPRITE } from "./asset.js";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PACK = path.join(REPO, "studio-kit/context-pack");
export const TEMPLATES = ["blank", "catch", "dodge", "maze", "paddle"];
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PULLED = ".arcade-pulled.json";

/** A cart folder that exists. @param {string} p */
function cartDir(p) {
  if (typeof p !== "string" || !p) throw new ToolError("give the cart folder's path");
  const dir = path.resolve(p);
  if (!fs.existsSync(path.join(dir, "spec.md"))) throw new ToolError(`${dir} has no spec.md: is it a cart folder?`);
  return dir;
}

/** "Snow Penguin" -> "snow-penguin" @param {string} s */
const slug = (s) =>
  String(s)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");

/**
 * @param {{ open?: (url: string) => void, playtest?: (dir: string, o: any) => Promise<any> }} [o]
 */
export function createStudioServer(o = {}) {
  /** The play server: one, started on the first play, serving whichever carts were asked for. */
  /** @type {{ url: string, carts: Record<string, string>, close: () => void } | null} */
  let player = null;
  const startPlayer = async () => {
    if (player) return player;
    const { createHandler } = await import("../../runtime/dev-server.js");
    /** @type {Record<string, string>} */
    const carts = {};
    let handler = createHandler({ carts });
    const server = http.createServer((req, res) => handler(req, res));
    await new Promise((r) => server.listen(Number(process.env.GSA_PLAY_PORT ?? 0), "127.0.0.1", () => r(null)));
    const port = /** @type {import("node:net").AddressInfo} */ (server.address()).port;
    player = {
      url: `http://127.0.0.1:${port}`,
      carts,
      close: () => server.close(),
    };
    // A new cart: a new handler over the same map (dev-server resolves its folders when it's made).
    /** @type {any} */ (player).refresh = () => (handler = createHandler({ carts }));
    return player;
  };

  /** @type {import("../../cabinet/service/src/mcp-rpc.js").Tool[]} */
  const tools = [
    {
      name: "read_kit",
      description: "Read the studio kit, the same lean context pack a cabinet make reads (D160): with no module, its catalog (templates, library modules, house rules); with module, one guide: cart-api, checks, spec, sprites, or a library module (collide, flow, fx, grid, score, timers, turns). Read the catalog first, then only what this game needs.",
      inputSchema: { type: "object", properties: { module: { type: "string" } }, additionalProperties: false },
      annotations: { readOnlyHint: true },
      async call(a) {
        if (!a.module) return { content: [{ type: "text", text: fs.readFileSync(path.join(PACK, "CATALOG.md"), "utf8").replaceAll("/workspace/kit/", `${REPO}/`) + `\n\nOn the mini, those paths are under ${REPO}/.` }] };
        const m = String(a.module).replace(/\.md$/, "");
        if (!/^[a-z-]+$/.test(m)) throw new ToolError("module is a name such as sprites or grid");
        for (const f of [path.join(PACK, "modules", `${m}.md`), path.join(REPO, "runtime/lib/ref", `${m}.md`)]) {
          if (fs.existsSync(f)) return { content: [{ type: "text", text: fs.readFileSync(f, "utf8") }] };
        }
        throw new ToolError(`no module ${m}: the catalog lists them`);
      },
    },
    {
      name: "new_cart",
      description: `Make a new cart folder to work in: from a template (${TEMPLATES.join(", ")}) or from another cart folder, such as one pulled from the cabinet with arcade get_cart. It copies spec.md, cart.json, game.js, checks.js and assets/, and sets cart.json's id and title. maker and with are the cabinet's maker ids (arcade list_carts). From a cabinet cart, parent records it, so publishing makes a change to that game.`,
      inputSchema: {
        type: "object",
        properties: {
          dir: { type: "string", description: "the new folder (must not exist or be empty)" },
          from: { type: "string", description: `a template name (${TEMPLATES.join(", ")}) or a cart folder; default blank` },
          id: { type: "string", description: "the cart id: lowercase, digits, dashes; default from title or the folder's name" },
          title: { type: "string" },
          maker: { type: "string" },
          with: { type: "string" },
        },
        required: ["dir"],
        additionalProperties: false,
      },
      async call(a) {
        const dir = path.resolve(String(a.dir));
        if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new ToolError(`${dir} isn't empty`);
        const from = a.from ?? "blank";
        const src = TEMPLATES.includes(from) ? path.join(PACK, "templates", from) : path.resolve(from);
        if (!fs.existsSync(path.join(src, "spec.md"))) throw new ToolError(`${from} is neither a template (${TEMPLATES.join(", ")}) nor a cart folder`);
        const id = a.id ?? slug(a.title ?? path.basename(dir));
        if (!ID.test(id) || id.length > 40) throw new ToolError(`id ${id}: lowercase letters, digits and single dashes, at most 40`);
        fs.mkdirSync(dir, { recursive: true });
        fs.cpSync(src, dir, { recursive: true, filter: (f) => !/(^|\/)(playtest-frames|playtest\.json|\.arcade-pulled\.json|\.keep|\.DS_Store)$/.test(path.relative(src, f)) });
        /** @type {any} */
        let given = {};
        try {
          given = JSON.parse(fs.readFileSync(path.join(src, "cart.json"), "utf8"));
        } catch {}
        /** @type {any} */
        let pulled = null;
        try {
          pulled = JSON.parse(fs.readFileSync(path.join(src, PULLED), "utf8"));
        } catch {}
        const title = a.title ?? (TEMPLATES.includes(from) ? null : given.title) ?? id;
        const cart = { id, title, players: given.players ?? 1, maker: a.maker ?? null, with: a.with ?? null, parent: pulled ? `${pulled.id}@${pulled.version}` : (given.parent ?? null) };
        fs.writeFileSync(path.join(dir, "cart.json"), JSON.stringify(cart, null, 2) + "\n");
        // The spec's title line says what the game is called; the byline is the cabinet's to fill at publish.
        const specFile = path.join(dir, "spec.md");
        fs.writeFileSync(specFile, fs.readFileSync(specFile, "utf8").replace(/^#\s+.*$/m, `# ${title}`));
        // A copy of a pulled cart is still a change to it: carry the marker so publish_cart's dir finds the parent.
        if (pulled) fs.writeFileSync(path.join(dir, PULLED), JSON.stringify(pulled, null, 2) + "\n");
        return {
          dir,
          from: TEMPLATES.includes(from) ? `template ${from}` : src,
          cart,
          files: fs.readdirSync(dir).filter((f) => !f.startsWith(".")),
          next: "Write the spec first (spec.md: Pitch, Rules R1..Rn each checkable, Controls, Look & sound, Assumptions, Changelog), then game.js and one check per (auto) rule in checks.js. Then validate_cart, playtest and play.",
        };
      },
    },
    {
      name: "validate_cart",
      description: "Check a cart folder as the cabinet will: cart.json's shape, that every (auto) rule has a check and every check a rule, the house lint (no imports, DOM, timers, Math.random…), and a type-check of game.js and checks.js.",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
      annotations: { readOnlyHint: true },
      async call(a) {
        const dir = cartDir(a.path);
        const { validateCart, formatIssues } = await import("@game-studio-arcade/spec");
        const r = await validateCart(dir);
        return { ok: r.ok, errors: r.errors, warnings: r.warnings, text: formatIssues ? formatIssues(r) : undefined };
      },
    },
    {
      name: "playtest",
      description: "Play-test a cart folder: every (auto) rule's check from checks.js, and the generic checks (loads, no errors, soak, palette, frame time, deterministic). It's the same harness the cabinet's publish gate runs before the shelf. rules narrows it to some rule ids while working. Writes playtest.json in the folder; key frames go to playtest-frames/ when frames is true.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          rules: { type: "array", items: { type: "string" }, description: "only these rule ids, e.g. [\"R1\", \"R3\"]" },
          driver: { type: "string", enum: ["node", "browser"], description: "node (default, fast) or browser (Playwright's Chromium, like the cabinet)" },
          frames: { type: "boolean", description: "save key frames as PNG; default false" },
        },
        required: ["path"],
        additionalProperties: false,
      },
      async call(a) {
        const dir = cartDir(a.path);
        const run = o.playtest ?? (await import("@game-studio-arcade/playtest")).playtest;
        const { judgeReport } = await import("@game-studio-arcade/studio-cli/src/checks.js");
        let report;
        try {
          report = await run(dir, { driver: a.driver ?? "node", frames: a.frames === true, out: dir, ...(a.rules?.length ? { rules: a.rules } : {}) });
        } catch (e) {
          throw new ToolError(`the playtest couldn't run: ${/** @type {Error} */ (e).message}`);
        }
        const judged = judgeReport(report);
        const ok = a.rules?.length ? judged.failing.filter((f) => !/^R\d+$/.test(f) || a.rules.includes(f)).length === 0 && report.rules.some((/** @type {any} */ r) => r.kind === "auto") : judged.ok;
        return {
          ok,
          failing: judged.failing,
          rules: report.rules.map((/** @type {any} */ r) => ({ id: r.id, kind: r.kind, status: r.status, ...(r.reason ? { reason: r.reason } : {}) })),
          generic: report.generic.map((/** @type {any} */ g) => ({ id: g.id, status: g.status, ...(g.reason ? { reason: g.reason } : {}) })),
          coverage: report.coverage,
          frame_time: report.frameTime,
          warnings: report.warnings,
          note: "On the cabinet the gate runs every rule in its own Chromium; a frame-time miss only advises until the cabinet is calibrated (D311).",
        };
      },
    },
    {
      name: "play",
      description: "Play a cart folder in a browser on the mini, with the keyboard as the joystick: arrows move, Z is A, X is B, C is X, V is Y, Enter is START, Escape is ★. Opens the browser unless open is false; the page reads the folder fresh on each load, so edit and reload.",
      inputSchema: { type: "object", properties: { path: { type: "string" }, open: { type: "boolean" }, seed: { type: "integer" } }, required: ["path"], additionalProperties: false },
      async call(a) {
        const dir = cartDir(a.path);
        const p = await startPlayer();
        const name = slug(path.basename(dir)) || "cart";
        p.carts[name] = dir;
        /** @type {any} */ (p).refresh();
        const url = `${p.url}/runtime/play.html?cart=/carts/${name}/game.js${a.seed != null ? `&seed=${Number(a.seed)}` : ""}&fps=1`;
        if (a.open !== false) (o.open ?? ((u) => execFile("open", [u], () => {})))(url);
        return { url, keys: { stick: "arrow keys", A: "Z", B: "X", X: "C", Y: "V", START: "Enter", "★ (back)": "Escape" }, opened: a.open !== false };
      },
    },
    {
      name: "import_asset",
      description: `Turn a found picture (PNG, JPEG, GIF, WebP…) into a house sprite for a cart: shrunk to fit size × size (1-${MAX_SPRITE}; the screen is 256 × 192), each pixel the nearest of the 32 house colors, transparent where the picture is. Saves assets/<name>.png and assets/<name>.sprite.json, adds a NOTICE.md line from source, and returns the rows to paste into game.js (carts import nothing).`,
      inputSchema: {
        type: "object",
        properties: {
          file: { type: "string" },
          cart: { type: "string", description: "the cart folder" },
          size: { type: "integer", minimum: 1, maximum: MAX_SPRITE },
          name: { type: "string", description: "the sprite's name; default from the file" },
          source: { type: "string", description: "where the picture came from and its licence, for NOTICE.md" },
        },
        required: ["file", "cart", "size"],
        additionalProperties: false,
      },
      async call(a) {
        try {
          return importAsset({ file: a.file, cart: a.cart, size: a.size, name: a.name, source: a.source });
        } catch (e) {
          throw new ToolError(/** @type {Error} */ (e).message);
        }
      },
    },
  ];

  const server = mcpServer({
    name: "studio",
    version: "0.1.0",
    instructions: "The Studio's tools on the mini: make a cart folder (new_cart), read the kit (read_kit), check it (validate_cart, playtest), play it (play), import pictures (import_asset). Spec first: spec.md is the source of truth.",
    tools,
  });
  return { ...server, close: () => player?.close() };
}

/** Claude Code's entry point (plugin/bin/run.mjs studio). */
export async function main() {
  const s = createStudioServer();
  process.stderr.write(`game-studio studio tools, kit at ${REPO}\n`);
  await serveStdio(s);
  s.close();
  process.exit(0);
}
