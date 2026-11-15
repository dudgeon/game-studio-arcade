// The Arcade MCP server on the cabinet (HANDOFF §9.2, D340-D346): what desktop Claude Code on the mini
// reaches through the game-studio plugin's bridge. It lives inside the cabinet service, at POST /mcp on the
// service's own loopback port, behind the Cabinet Manager's pairing token (D341). Nothing here is in the
// play path: every tool reads the library and logs, or appends to them, or asks the launcher nicely.
//
//   list_carts         every cart version in the library
//   get_cart           one cart's files, now or at a library commit
//   publish_cart       a desktop cart through the publish gate onto the shelf, as a new version (D343)
//   launch_on_cabinet  open a game's how-to-play screen on the cabinet, only from the shelf (D344)
//   get_activity       the cabinet's logs, newest first (§9.5)
//   cabinet_status     online, release, what's running, the gate's settings
//   remove_from_shelf  take a game (every version of it) off the kids' shelf; kept in the records (D360-D362)
//   restore_to_shelf   put it back
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { changeTarget, specChange } from "@game-studio-arcade/studio-cli/src/make.js";
import { appendLog, readLog, newSpecDiff } from "@game-studio-arcade/studio-cli/src/log.js";
import { syncTree } from "@game-studio-arcade/studio-cli/src/durable.js";
import { ensureLibrary, slugify, freeId, specTitle } from "@game-studio-arcade/studio-cli/src/library.js";
import { readCart, listCarts } from "@game-studio-arcade/player/src/library.js";
import { cleanVersionName, nameChangelogLine, versionNameTaken, VERSION_NAME_MAX } from "@game-studio-arcade/spec";
import { mcpServer, ToolError } from "./mcp-rpc.js";

/** The largest bundle, in bytes once decoded, and the most files in one (D343). */
export const MAX_BUNDLE_BYTES = 4 * 1024 * 1024;
export const MAX_BUNDLE_FILES = 300;
/** The largest /mcp request body: a full bundle as base64, with room for JSON. */
export const MAX_MCP_BODY = Math.ceil(MAX_BUNDLE_BYTES * 1.4) + 256 * 1024;
/** What a cart folder may hold (HANDOFF §7). playtest.json is the cabinet's own and is written by the gate. */
const TOP_FILES = new Set(["spec.md", "cart.json", "game.js", "checks.js", "NOTICE.md"]);
const PART = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;
const TEXT_EXT = new Set([".md", ".js", ".json", ".txt", ".ts", ".csv", ".svg"]);
/** How long launch_on_cabinet waits for the launcher to say yes or no. */
export const LAUNCH_WAIT_MS = 8000;

// core.fsync: a commit is on disk before it returns, as in the Studio's library (D371).
const GIT_ENV = { GIT_AUTHOR_NAME: "Studio", GIT_AUTHOR_EMAIL: "studio@game-studio-arcade.invalid", GIT_COMMITTER_NAME: "Studio", GIT_COMMITTER_EMAIL: "studio@game-studio-arcade.invalid", GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "core.fsync", GIT_CONFIG_VALUE_0: "added", GIT_CONFIG_KEY_1: "core.fsyncMethod", GIT_CONFIG_VALUE_1: "fsync" };
const git = (/** @type {string} */ cwd, /** @type {string[]} */ args, /** @type {any} */ o = {}) => execFileSync("git", args, { cwd, env: { ...process.env, ...GIT_ENV }, maxBuffer: 2 ** 26, ...o });

/** A bundle path is safe and belongs in a cart folder. @param {string} p */
export function bundlePathProblem(p) {
  if (typeof p !== "string" || !p) return "a file needs a path";
  const parts = p.split("/");
  if (parts.some((x) => !PART.test(x) || x === "." || x === "..")) return `${p}: use letters, digits, . _ - and / only, with no empty, . or .. parts`;
  if (parts.length === 1) return TOP_FILES.has(p) ? null : `${p}: a cart holds spec.md, cart.json, game.js, checks.js, NOTICE.md and assets/; this file doesn't belong (playtest.json is written by the cabinet)`;
  if (parts[0] !== "assets") return `${p}: only assets/ may have folders`;
  if (parts.length > 4) return `${p}: too deep`;
  return null;
}

/**
 * Decode and check a bundle: [{path, text} | {path, base64}]. Throws a ToolError naming every problem.
 * @param {any} bundle
 * @returns {Map<string, Buffer>}
 */
export function readBundle(bundle) {
  const files = Array.isArray(bundle) ? bundle : bundle?.files;
  if (!Array.isArray(files) || !files.length) throw new ToolError("bundle.files must be a list of {path, text} or {path, base64}");
  if (files.length > MAX_BUNDLE_FILES) throw new ToolError(`a bundle holds at most ${MAX_BUNDLE_FILES} files`);
  /** @type {Map<string, Buffer>} */
  const out = new Map();
  const problems = [];
  let total = 0;
  for (const f of files) {
    const p = f?.path;
    if (p === "playtest.json") continue; // the cabinet's own report replaces it
    const why = bundlePathProblem(p);
    if (why) {
      problems.push(why);
      continue;
    }
    if (out.has(p)) problems.push(`${p}: twice`);
    const data = typeof f.text === "string" ? Buffer.from(f.text, "utf8") : typeof f.base64 === "string" ? Buffer.from(f.base64, "base64") : null;
    if (!data) {
      problems.push(`${p}: give text or base64`);
      continue;
    }
    total += data.length;
    out.set(p, data);
  }
  if (total > MAX_BUNDLE_BYTES) problems.push(`the bundle is ${total} bytes; the most is ${MAX_BUNDLE_BYTES}`);
  for (const need of ["spec.md", "cart.json", "game.js"]) if (!out.has(need) && !problems.length) problems.push(`the bundle has no ${need}`);
  if (problems.length) throw new ToolError(`The bundle can't be published:\n- ${problems.join("\n- ")}`);
  return out;
}

/** A cart folder as bundle files. @param {string} dir */
export function folderFiles(dir) {
  /** @type {{ path: string, text?: string, base64?: string }[]} */
  const files = [];
  const walk = (/** @type {string} */ rel) => {
    for (const d of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${d.name}` : d.name;
      if (d.name === "playtest-frames" || d.name.startsWith(".")) continue;
      if (d.isDirectory()) walk(p);
      else if (d.isFile()) files.push(fileEntry(p, fs.readFileSync(path.join(dir, p))));
    }
  };
  walk("");
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** @param {string} p @param {Buffer} data */
const fileEntry = (p, data) => (TEXT_EXT.has(path.extname(p)) ? { path: p, text: data.toString("utf8") } : { path: p, base64: data.toString("base64") });

/** The fields a cart list shows. @param {import("@game-studio-arcade/player/src/library.js").CartInfo} c */
const cartSummary = (c) => {
  /** @type {any} */
  let meta = {};
  try {
    meta = JSON.parse(fs.readFileSync(path.join(c.dir, "cart.json"), "utf8"));
  } catch {}
  return { id: c.id, title: c.title, version: c.version, version_name: c.version_name ?? null, maker: c.maker, with: c.with, parent: c.parent, family: c.family ?? c.id, branch: c.branch, origin: meta.origin ?? (c.source === "example" ? "starter" : null), created: c.created, players: c.players, pitch: c.pitch, auto_rules: c.autoRules, you_check_rules: c.youCheck.length, commit: c.commit, source: c.source };
};

/** The latest version of each line (the shelf's rule, HANDOFF §2): a line is its branch, or the cart itself. @param {any[]} carts */
function latestPerLine(carts) {
  /** @type {Map<string, any>} */
  const best = new Map();
  for (const c of carts) {
    const line = c.branch ?? c.id;
    const was = best.get(line);
    if (!was || c.version > was.version) best.set(line, c);
  }
  return new Set([...best.values()].map((c) => c.id));
}

/**
 * The launcher's side of launch_on_cabinet (D344): a stream it listens to, and its answer.
 * @param {{ now?: () => number }} [o]
 */
export function launchRelay(o = {}) {
  /** @type {Set<(m: any) => void>} */
  const listeners = new Set();
  /** @type {Map<string, (a: { ok: boolean, why?: string }) => void>} */
  const waiting = new Map();
  return {
    /** @param {(m: any) => void} f */
    subscribe(f) {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    listening: () => listeners.size,
    /** Ask the launcher; resolves with its answer, or a refusal after waitMs. @param {{ id: string, title: string }} cart */
    ask(cart, waitMs = LAUNCH_WAIT_MS) {
      if (!listeners.size) return Promise.resolve({ ok: false, why: "the cabinet's screen isn't listening: the launcher isn't open" });
      const id = `ln_${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
      return new Promise((resolve) => {
        const t = setTimeout(() => {
          waiting.delete(id);
          resolve({ ok: false, why: "the launcher didn't answer in time" });
        }, waitMs);
        waiting.set(id, (a) => {
          clearTimeout(t);
          waiting.delete(id);
          resolve(a);
        });
        for (const f of listeners) f({ launch: id, cart: cart.id, title: cart.title });
      });
    },
    /** @param {string} id @param {boolean} ok @param {string} [why] */
    answer(id, ok, why) {
      waiting.get(id)?.({ ok, ...(why ? { why: String(why).slice(0, 200) } : {}) });
    },
  };
}

/** Which log a record type lives in (§9.5), and what get_activity keeps of a studio_session. */
const ACTIVITY_TYPES = ["studio_session", "cart_version", "play", "you_check", "publish_gate", "guest_play", "coin_ledger", "screening", "shelf_mark"];
/** @param {any} r */
const slim = (r) => {
  if (r.type !== "studio_session") return r;
  const { usage, tokens, spec_diff, replay_log, notes, errors, brief_check, ...rest } = r;
  const local = r.playtest?.local;
  return { ...rest, playtest: local ? { local } : null, spec_diff_lines: typeof spec_diff === "string" ? spec_diff.split("\n").length : null };
};

/** Where a kid's own words are in the logs: what they said and typed, and what screening offered back (D348). */
const WORD_KEYS = new Set(["said", "alternative", "hits"]);
/**
 * A record without the kids' own words (D348). A desktop session's summary is Geoff's, so it stays.
 * @param {any} r
 * @returns {any}
 */
export function withoutWords(r) {
  const strip = (/** @type {any} */ v) => {
    if (Array.isArray(v)) return v.map(strip);
    if (!v || typeof v !== "object") return v;
    return Object.fromEntries(
      Object.entries(v)
        .filter(([k]) => !WORD_KEYS.has(k))
        .map(([k, x]) => [k, strip(x)]),
    );
  };
  const out = strip(r);
  if (r.type === "studio_session" && r.origin !== "desktop") delete out.request;
  if (r.type === "screening") delete out.why;
  return out;
}

/**
 * @param {{
 *   paths: { root: string, carts: string, logs: string, sessions: string },
 *   makers: ReturnType<typeof import("./makers.js").makersStore>,
 *   marks?: ReturnType<typeof import("./shelf-marks.js").shelfMarks> | null,
 *   checker: import("@game-studio-arcade/studio-cli/src/checks.js").Checker,
 *   roots?: { root: string, source: "library" | "example" }[],
 *   studio?: { state: () => any },
 *   plays?: { playing: () => boolean },
 *   launches?: ReturnType<typeof launchRelay>,
 *   online?: () => boolean,
 *   status?: () => object,
 *   now?: () => Date,
 *   version?: string,
 * }} o
 */
export function createArcadeMcp(o) {
  const now = o.now ?? (() => new Date());
  const roots = o.roots ?? [{ root: o.paths.carts, source: /** @type {const} */ ("library") }];
  const all = () => listCarts(roots);
  /** @param {string} id */
  const find = (id) => {
    if (typeof id !== "string" || !id) throw new ToolError("give a cart id (list_carts lists them)");
    const c = all().find((x) => x.id === id);
    if (!c) throw new ToolError(`no cart "${id}" on this cabinet (list_carts lists them)`);
    return c;
  };
  /** remove_from_shelf and restore_to_shelf (D360-D362). @param {any} a @param {"remove" | "restore"} action */
  function shelfMark(a, action) {
    if (!o.marks) throw new ToolError("this cabinet keeps no shelf marks");
    const c = find(a.id);
    const line = c.branch ?? c.id;
    const r = o.marks.mark({ kind: "game", target: line, action, by: typeof a.by === "string" ? a.by : "desktop", via: "mcp", reason: typeof a.reason === "string" ? a.reason : "" });
    const versions = all().filter((x) => (x.branch ?? x.id) === line).map((x) => x.id);
    const kids = all().filter((x) => x.parent && versions.includes(String(x.parent).replace(/@\d+$/, "")) && (x.branch ?? x.id) !== line).map((x) => x.branch ?? x.id);
    return {
      ok: true,
      changed: r.changed,
      game: line,
      title: c.title,
      versions,
      on_shelf: action === "restore",
      ...(kids.length ? { other_versions_stay: [...new Set(kids)] } : {}),
      note: r.changed ? (action === "remove" ? "Off the shelf; kept in the records. restore_to_shelf puts it back." : "Back on the shelf.") : action === "remove" ? "It was already off the shelf." : "It was already on the shelf.",
    };
  }

  /** One publish at a time: each goes through the gate's queue anyway, and the library commit is ordered. */
  let publishing = Promise.resolve();

  /** @type {import("./mcp-rpc.js").Tool[]} */
  const tools = [
    {
      name: "list_carts",
      description:
        "List the games in the cabinet's library. Every version is its own cart; on_shelf marks the latest version of each line (what the kids see), unless a grown-up took the game off the shelf: then off_shelf says when, by whom and why (remove_from_shelf, restore_to_shelf). Fields: id, title, version, version_name (what the maker called this version, or null: it then goes by its number), maker, with, parent (cart@version), family, branch, line, origin (cabinet, desktop or starter), created, players, pitch, rule counts, commit.",
      inputSchema: { type: "object", properties: { maker: { type: "string", description: "only this maker's carts (a maker id)" }, family: { type: "string", description: "only this game family (the first cart's id)" } }, additionalProperties: false },
      annotations: { readOnlyHint: true },
      async call(a) {
        let carts = all().map(cartSummary);
        const shelf = latestPerLine(carts);
        const off = o.marks?.off("game") ?? new Map();
        carts = carts.map((c) => {
          const mark = off.get(c.branch ?? c.id);
          return { ...c, line: c.branch ?? c.id, on_shelf: shelf.has(c.id) && !mark, ...(mark ? { off_shelf: { at: mark.at, by: mark.by, via: mark.via, reason: mark.reason } } : {}) };
        });
        if (a.maker) carts = carts.filter((c) => c.maker === a.maker);
        if (a.family) carts = carts.filter((c) => c.family === a.family);
        return { carts, makers: o.makers.read().filter((m) => !m.hidden).map((m) => ({ id: m.id, name: m.name, ...(m.grown_up ? { grown_up: true } : {}), ...(o.marks?.makerOff(m.id) ? { off_list: true } : {}) })) };
      },
    },
    {
      name: "get_cart",
      description:
        "Get one cart's files (spec.md, cart.json, game.js, checks.js, assets/…, playtest.json) to build on. Text files come as text, others as base64. ref is a library commit (from list_carts or get_activity) to read the cart as it was then; leave it out for now. Through the game-studio plugin, pass into: a local folder, and the files are written there instead of returned.",
      inputSchema: { type: "object", properties: { id: { type: "string" }, ref: { type: "string", description: "a library commit sha; default: the cart as it is now" } }, required: ["id"], additionalProperties: false },
      annotations: { readOnlyHint: true },
      async call(a) {
        const c = find(a.id);
        const summary = cartSummary(c);
        if (!a.ref) return { cart: summary, files: folderFiles(c.dir) };
        if (c.source !== "library" || !/^[0-9a-f]{7,40}$/.test(String(a.ref))) throw new ToolError("ref must be a library commit sha, for a library cart");
        const lib = o.paths.carts;
        let names;
        try {
          names = git(lib, ["ls-tree", "-r", "--name-only", String(a.ref), "--", `${c.id}/`], { encoding: "utf8" }).split("\n").filter(Boolean);
        } catch {
          throw new ToolError(`no commit ${a.ref} in the library`);
        }
        if (!names.length) throw new ToolError(`${c.id} isn't in commit ${a.ref}`);
        const files = names.filter((n) => !n.includes("/playtest-frames/") && !n.split("/").some((x) => x.startsWith("."))).map((n) => fileEntry(n.slice(c.id.length + 1), Buffer.from(git(lib, ["show", `${a.ref}:${n}`]))));
        return { cart: { ...summary, commit: a.ref }, files };
      },
    },
    {
      name: "publish_cart",
      description:
        "Publish a cart made on the desktop to the cabinet. It never replaces anything: it becomes a new cart folder and library commit. With parent (a cart id), it's a change to that game: the parent's maker gets the next version of the same line, anyone else their own version, as on the cabinet. A maker's own next version can have a name (version_name), which shows on the shelf in place of v3; ask the maker for one. The cabinet first validates it and re-runs its playtest in its own Chromium (the publish gate); only a pass reaches the shelf, and a failure says why. maker and with are maker ids from list_carts (a grown-up is a maker too). summary says what was made and how, for the activity log. Through the game-studio plugin, pass dir: the local cart folder, instead of bundle.",
      inputSchema: {
        type: "object",
        properties: {
          bundle: {
            type: "object",
            properties: { files: { type: "array", items: { type: "object", properties: { path: { type: "string" }, text: { type: "string" }, base64: { type: "string" } }, required: ["path"] } } },
            required: ["files"],
          },
          parent: { type: "string", description: "the cart id this changes, or leave out for a new game" },
          maker: { type: "string", description: "the maker id: whose game it is" },
          with: { type: "string", description: "a second maker id, such as the grown-up who helped" },
          version_name: { type: "string", description: `what this version is called, such as "Faster logs": at most ${VERSION_NAME_MAX} characters, plain letters, digits and spaces, not a name another version of the game has. Only for a change by the parent's own maker; a new game and someone's own version go by their title.` },
          summary: { type: "string", description: "one or two sentences: what was made or changed, and with whom" },
        },
        required: ["bundle", "maker", "summary"],
        additionalProperties: false,
      },
      async call(a) {
        const run = publishing.then(() => publish(a));
        publishing = run.then(
          () => {},
          () => {},
        );
        return run;
      },
    },
    {
      name: "launch_on_cabinet",
      description:
        "Show a game on the cabinet's screen: its how-to-play screen opens, and whoever is at the cabinet presses a button to play. Only from the shelf: it's refused, with the reason, while someone is playing, making a game, or on any other screen.",
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
      async call(a) {
        const c = find(a.id);
        if (!o.launches) throw new ToolError("this cabinet can't launch games from the desktop");
        const st = o.studio?.state();
        if (st?.phase === "running") throw new ToolError(`not now: ${st.maker_name ?? "someone"} is making a game on the cabinet`);
        if (o.plays?.playing()) throw new ToolError("not now: someone is playing a game on the cabinet");
        const r = await o.launches.ask({ id: c.id, title: c.title });
        if (!r.ok) throw new ToolError(`the cabinet didn't open it: ${r.why ?? "no reason given"}`);
        return { ok: true, launched: c.id, title: c.title, shown: "how to play (G0)" };
      },
    },
    {
      name: "get_activity",
      description: `Read the cabinet's logs, newest first: ${ACTIVITY_TYPES.join(", ")}. Filter by type, cart_id (also matches a session's cart and a play's cart), maker, or since (an ISO time). The kids' own words (what they asked for, said and typed at the cabinet) are left out unless include_words is true: ask Geoff before including them, and never copy them into the repo.`,
      inputSchema: {
        type: "object",
        properties: {
          type: { type: "string", enum: ACTIVITY_TYPES },
          cart_id: { type: "string" },
          maker: { type: "string" },
          since: { type: "string", description: "ISO 8601 time" },
          limit: { type: "integer", minimum: 1, maximum: 200, description: "default 40" },
          include_words: { type: "boolean", description: "include the kids' own words: requests, answers, typed text; default false" },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async call(a) {
        const types = a.type ? [a.type] : ACTIVITY_TYPES;
        const since = a.since ? Date.parse(a.since) : null;
        if (a.since && Number.isNaN(since)) throw new ToolError("since must be an ISO time");
        const limit = Math.min(200, Math.max(1, Number(a.limit ?? 40)));
        const when = (/** @type {any} */ r) => r.ended_at ?? r.started_at ?? r.at ?? r.created ?? r.answered_at ?? r.time ?? null;
        let rows = types.flatMap((t) => readLog(path.join(o.paths.logs, `${t}.jsonl`)).map((r) => ({ type: t, ...r })));
        if (a.cart_id) rows = rows.filter((r) => r.cart_id === a.cart_id || r.cart === a.cart_id || r.guest_id === a.cart_id || (typeof r.parent === "string" && r.parent.startsWith(`${a.cart_id}@`)));
        if (a.maker) rows = rows.filter((r) => r.maker === a.maker || r.with === a.maker || r.who === a.maker);
        if (since != null) rows = rows.filter((r) => Date.parse(when(r) ?? "") >= since);
        rows.sort((x, y) => String(when(y) ?? "").localeCompare(String(when(x) ?? "")));
        const records = rows.slice(0, limit).map(slim);
        const words = a.include_words === true;
        return { count: rows.length, words: words ? "included" : "left out", records: words ? records : records.map(withoutWords) };
      },
    },
    {
      name: "remove_from_shelf",
      description:
        "Take a game off the cabinet's shelf: the kids no longer see it, play it or change it, with every version of it. Nothing is erased: its files, library history, plays and makes stay in the records and the backup, and restore_to_shelf puts it back. Give any cart id of the game; the whole line (the cart's branch) goes. A kid's own version of the game is its own line and stays unless removed too; on the shelf it then shows as its own game. Grown-ups only: use it when a grown-up asks.",
      inputSchema: { type: "object", properties: { id: { type: "string", description: "a cart id (list_carts lists them)" }, reason: { type: "string", description: "why, for the records" }, by: { type: "string", description: "the grown-up who asked" } }, required: ["id"], additionalProperties: false },
      async call(a) {
        return shelfMark(a, "remove");
      },
    },
    {
      name: "restore_to_shelf",
      description: "Put a game a grown-up took off the shelf back on it, with every version of it, as it was. Give any cart id of the game.",
      inputSchema: { type: "object", properties: { id: { type: "string", description: "a cart id (list_carts lists them)" }, reason: { type: "string" }, by: { type: "string" } }, required: ["id"], additionalProperties: false },
      async call(a) {
        return shelfMark(a, "restore");
      },
    },
    {
      name: "cabinet_status",
      description: "The cabinet now: whether Claude can be reached, its release and profile, whether a make or a game is under way, the publish gate's settings, and how many carts it holds.",
      inputSchema: { type: "object", additionalProperties: false },
      annotations: { readOnlyHint: true },
      async call() {
        const st = o.studio?.state();
        const carts = all();
        return {
          online: o.online ? o.online() : null,
          studio: st ? (st.phase === "running" ? { phase: "running", kind: st.kind, maker: st.maker, step: st.step } : { phase: st.phase }) : null,
          playing: o.plays ? o.plays.playing() : null,
          launcher_listening: o.launches ? o.launches.listening() > 0 : null,
          carts: carts.length,
          on_shelf: latestPerLine(carts.map(cartSummary)).size,
          ...(o.status ? o.status() : {}),
        };
      },
    },
  ];

  /** @param {any} a */
  async function publish(a) {
    const files = readBundle(a.bundle);
    const maker = o.makers.get(String(a.maker ?? ""));
    if (!maker) throw new ToolError(`no maker "${a.maker}" on this cabinet (list_carts lists makers; a grown-up is added with scripts/maker.mjs add-grown-up)`);
    const withMaker = a.with ? o.makers.get(String(a.with)) : null;
    if (a.with && !withMaker) throw new ToolError(`no maker "${a.with}" on this cabinet`);
    const summary = typeof a.summary === "string" ? a.summary.trim().slice(0, 2000) : "";
    if (!summary) throw new ToolError("summary: say in a sentence or two what was made");
    const parent = a.parent ? find(a.parent) : null;

    /** @type {any} */
    let given;
    try {
      given = JSON.parse(/** @type {Buffer} */ (files.get("cart.json")).toString("utf8"));
    } catch (e) {
      throw new ToolError(`cart.json isn't JSON: ${/** @type {Error} */ (e).message}`);
    }
    if (!given || typeof given !== "object" || Array.isArray(given)) throw new ToolError("cart.json must be a JSON object");

    const started = now();
    const sessionId = `desk_${started.getTime().toString(36)}${randomBytes(3).toString("hex")}`;
    const sessionDir = path.join(o.paths.sessions, sessionId);
    const cartDir = path.join(sessionDir, "cart");
    fs.mkdirSync(cartDir, { recursive: true });
    for (const [p, data] of files) {
      fs.mkdirSync(path.dirname(path.join(cartDir, p)), { recursive: true });
      fs.writeFileSync(path.join(cartDir, p), data);
    }
    const spec = files.get("spec.md")?.toString("utf8") ?? "";
    const target = parent ? changeTarget({ id: parent.id, dir: parent.dir, version: parent.version, maker: parent.maker, family: parent.family, branch: parent.branch, title: parent.title }, maker.id) : null;
    const version = target?.version ?? 1;
    const parentRef = parent ? `${parent.id}@${parent.version}` : null;
    // The version's name (D472, D473): asked for here, or already in the cart's cart.json. A grown-up is at the desk, so a bad one is refused with the reason.
    const askedName = a.version_name ?? given.version_name ?? null;
    /** @type {string | null} */
    let versionName = null;
    if (askedName != null && askedName !== "") {
      if (!parent || !target?.ownVersion) throw new ToolError("version_name: only a maker's own next version of their game has a name. A new game, and someone's own version of another maker's game, go by their title.");
      versionName = cleanVersionName(askedName);
      if (!versionName) throw new ToolError(`version_name: "${askedName}" won't do. A name is at most ${VERSION_NAME_MAX} characters of plain letters, digits and spaces.`);
      const line = parent.branch ?? parent.id;
      const taken = [parent.title, ...all().filter((x) => (x.branch ?? x.id) === line && x.version_name).map((x) => x.version_name)];
      if (versionNameTaken(versionName, taken)) throw new ToolError(`version_name: "${versionName}" is already used by this game (${taken.map((t) => `"${t}"`).join(", ")}). Pick another.`);
      const specFile = path.join(cartDir, "spec.md");
      if (spec) fs.writeFileSync(specFile, nameChangelogLine(spec, version, versionName));
    }
    const title = String(given.title || specTitle(spec) || parent?.title || "cart").slice(0, 60);
    // What the cart is: its provenance is the cabinet's to write, as for a cabinet make (HANDOFF §7).
    const cartJson = {
      ...given,
      title,
      version,
      maker: maker.id,
      with: withMaker?.id ?? null,
      parent: parentRef,
      ...(target ? { family: target.family } : {}),
      ...(target?.branch ? { branch: target.branch } : {}),
      session_id: sessionId,
      origin: "desktop",
      created: started.toISOString(),
    };
    if (!target) {
      delete cartJson.family;
      delete cartJson.branch;
    }
    delete cartJson.version_name;
    if (versionName) cartJson.version_name = versionName;
    // A provisional id the validator accepts; the library's own id is chosen at commit.
    cartJson.id = slugify(given.id || title);
    fs.writeFileSync(path.join(cartDir, "cart.json"), JSON.stringify(cartJson, null, 2) + "\n");
    fs.writeFileSync(path.join(sessionDir, "request.json"), JSON.stringify({ maker: maker.id, with: withMaker?.id ?? null, parent: parentRef, summary, files: [...files.keys()] }, null, 2) + "\n");

    const validation = await o.checker.validate(cartDir);
    const local = validation.ok ? await o.checker.playtest(cartDir) : null;
    if (local?.report) fs.writeFileSync(path.join(cartDir, "playtest.json"), JSON.stringify(local.report, null, 2) + "\n");
    fs.writeFileSync(path.join(sessionDir, "local-checks.json"), JSON.stringify({ validation, playtest: local }, null, 2) + "\n");
    const passed = Boolean(validation.ok && local?.ok);

    /** @type {{ id: string, commit: string } | null} */
    let committed = null;
    if (passed) {
      ensureLibrary(o.paths.carts);
      // The same ids as a cabinet change (make.js): the maker's own next version is <line>-v<n>.
      const wanted = parent && target?.ownVersion ? `${slugify(target.branch ?? parent.id).replace(/-v\d+$/, "")}-v${version}` : parent ? title : given.id || title;
      const id = freeId(o.paths.carts, wanted);
      const dest = path.join(o.paths.carts, id);
      fs.cpSync(cartDir, dest, { recursive: true });
      fs.writeFileSync(path.join(dest, "cart.json"), JSON.stringify({ ...cartJson, id }, null, 2) + "\n");
      syncTree(dest); // on disk before it's committed and on the shelf (D371)
      git(o.paths.carts, ["add", "--", id]);
      git(o.paths.carts, ["commit", "-q", "-m", `desktop ${parentRef ? `change ${parentRef} -> ` : ""}${id} v${version} (${sessionId})`]);
      committed = { id, commit: git(o.paths.carts, ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() };
      appendLog(o.paths.logs, "cart_version", { cart_id: id, version, ...(versionName ? { version_name: versionName, named_by: maker.id, name_picked: "desktop" } : {}), parent: parentRef, session_id: sessionId, commit: committed.commit, created: cartJson.created, origin: "desktop" });
    }
    const outcome = committed ? "committed" : "checks_failed";
    const gate = local?.gate ?? null;
    const failing = [...(validation.ok ? [] : (validation.problems ?? []).map((p) => ({ id: "validate", reason: p }))), ...(gate?.failing ?? (local?.failing ?? []).map((/** @type {string} */ id) => ({ id, reason: null })))];
    // §9.5: a desktop session is a studio_session with origin desktop. It costs the family's pot nothing (D345).
    appendLog(o.paths.logs, "studio_session", {
      id: sessionId,
      origin: "desktop",
      maker: maker.id,
      with: withMaker?.id ?? null,
      request: summary,
      summary,
      kind: parent ? "change" : "new",
      parent: parentRef,
      turns: [],
      questions: 0,
      ended_by: "published",
      spec_diff: parent ? specChange(fs.existsSync(path.join(parent.dir, "spec.md")) ? fs.readFileSync(path.join(parent.dir, "spec.md"), "utf8") : null, spec) : newSpecDiff(spec),
      playtest: { local: local ? { ok: local.ok, unavailable: local.unavailable ?? false, failing: local.failing ?? [], ...(gate ? { gate } : {}) } : null, validate: validation },
      list_cost: null,
      started_at: started.toISOString(),
      ended_at: now().toISOString(),
      outcome,
      cart_id: committed?.id ?? null,
      cart_version: committed ? version : null,
      commit: committed?.commit ?? null,
    });
    if (!committed) {
      return {
        content: [{ type: "text", text: `Kept off the shelf (${sessionId}): ${failing.map((f) => `${f.id}${f.reason ? `: ${f.reason}` : ""}`).join("; ") || "the checks didn't pass"}. Nothing on the cabinet changed except the logs; fix the cart and publish again.` }],
        structuredContent: { ok: false, session_id: sessionId, outcome, failing, advisory: gate?.advisory ?? [], gate: gate ? { seconds: gate.seconds, host: gate.host, driver: gate.driver } : null },
        isError: true,
      };
    }
    return { ok: true, session_id: sessionId, outcome, cart_id: committed.id, version, version_name: versionName, parent: parentRef, commit: committed.commit, on_shelf: true, advisory: gate?.advisory ?? [], gate: gate ? { seconds: gate.seconds, host: gate.host, driver: gate.driver, waited_s: gate.waited_s } : null };
  }

  return mcpServer({
    name: "arcade",
    version: o.version ?? "0.1.0",
    instructions: "The game cabinet's library and screen. Read with list_carts, get_cart, get_activity and cabinet_status. publish_cart adds a new version through the cabinet's publish gate (nothing is ever replaced); launch_on_cabinet opens a game's how-to-play screen when the cabinet is on its shelf.",
    tools,
  });
}

/**
 * POST /mcp: one JSON-RPC message or a batch, answered as JSON (Streamable HTTP's JSON response; no SSE stream).
 * Auth is the caller's: the service checks the Manager's token before this runs (D341).
 * @param {ReturnType<typeof createArcadeMcp>} server
 * @param {import("node:http").IncomingMessage} req @param {import("node:http").ServerResponse} res
 */
export async function serveMcpHttp(server, req, res) {
  const send = (/** @type {number} */ status, /** @type {any} */ body) => res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(body === null ? "" : JSON.stringify(body));
  if (req.method !== "POST") return void res.writeHead(405, { Allow: "POST" }).end();
  // No browser may call it (DNS rebinding): the bridge sends no Origin.
  if (req.headers.origin !== undefined) return send(403, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "browsers may not call the arcade MCP server" } });
  /** @type {Buffer[]} */
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_MCP_BODY) return send(413, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "request too large" } });
    chunks.push(c);
  }
  let msg;
  try {
    msg = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return send(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }
  if (Array.isArray(msg)) {
    const out = (await Promise.all(msg.map((m) => server.handle(m)))).filter(Boolean);
    return out.length ? send(200, out) : void res.writeHead(202).end();
  }
  const out = await server.handle(msg);
  return out ? send(200, out) : void res.writeHead(202).end();
}
