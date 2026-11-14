// The Manager's Update button (D338): runs the same command a grown-up would, update-cabinet.mjs, for one cabinet,
// and keeps its output for the page. One update per cabinet at a time; the cabinet itself refuses during a make,
// a game or a gate check (D332). The boot update (kernel, firmware) is never offered here (D336).
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "scripts/virtual-cabinet/update-cabinet.mjs");
/** Manager cabinet name -> update-cabinet.mjs target flags. Others can't be updated from here. */
export const UPDATE_FLAGS = { virtual: [], real: ["--picade"] };
const MAX_LINES = 400;

/**
 * @typedef {{ running: boolean, started_at: string | null, ended_at: string | null, os: boolean, lines: string[], ok: boolean | null, result: any }} UpdateState
 * @param {{ run?: (args: string[]) => import("node:child_process").ChildProcess, now?: () => Date, checkout?: () => string }} [o]
 */
export function updater(o = {}) {
  const run = o.run ?? ((args) => spawn(process.execPath, [SCRIPT, ...args], { cwd: REPO, stdio: ["ignore", "pipe", "pipe"], env: process.env }));
  const now = o.now ?? (() => new Date());
  const checkout = o.checkout ?? (() => spawnSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: REPO, encoding: "utf8" }).stdout.trim());
  /** @type {Map<string, UpdateState>} */
  const all = new Map();
  const blank = () => ({ running: false, started_at: null, ended_at: null, os: false, lines: [], ok: null, result: null });

  return {
    /** @param {string} name */
    can: (name) => name in UPDATE_FLAGS,
    /** @param {string} name */
    state(name) {
      return { ...(all.get(name) ?? blank()), checkout: checkout() };
    },
    /** @param {string} name @param {{ os?: boolean }} opts */
    start(name, opts = {}) {
      if (!(name in UPDATE_FLAGS)) throw Object.assign(new Error("this cabinet can't be updated from the Manager"), { status: 400 });
      const was = all.get(name);
      if (was?.running) throw Object.assign(new Error("an update is already running on this cabinet"), { status: 409 });
      /** @type {UpdateState} */
      const s = { running: true, started_at: now().toISOString(), ended_at: null, os: Boolean(opts.os), lines: [], ok: null, result: null };
      all.set(name, s);
      const child = run([...UPDATE_FLAGS[/** @type {"virtual" | "real"} */ (name)], ...(opts.os ? ["--os"] : [])]);
      let buf = "";
      let json = null;
      const take = (/** @type {Buffer | string} */ d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          // update-cabinet.mjs prints the cabinet's result.json as one indented block: keep it whole.
          if (line === "{") json = [line];
          else if (json) {
            json.push(line);
            if (line === "}") {
              try { s.result = JSON.parse(json.join("\n")); } catch {}
              json = null;
            }
          } else {
            s.lines.push(line);
            if (s.lines.length > MAX_LINES) s.lines.shift();
          }
        }
      };
      child.stdout?.on("data", take);
      child.stderr?.on("data", take);
      child.on("close", (code) => {
        if (buf) take("\n");
        s.running = false;
        s.ended_at = now().toISOString();
        s.ok = code === 0;
      });
      return s;
    },
  };
}
