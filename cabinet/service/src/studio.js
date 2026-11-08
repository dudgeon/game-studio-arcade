// The Studio side (D183): one session at a time, through the CLI's makeCart and
// driver. The tile relay is an Answerer that waits for the launcher. Everything a
// kid sees comes from `state()`, in kid language; the rest goes to the logs.
// A make nobody answers is released (D188); one a restart cut off is logged (D189).
import fs from "node:fs";
import path from "node:path";
import { makeCart } from "@game-studio-arcade/studio-cli/src/make.js";
import { appendLog } from "@game-studio-arcade/studio-cli/src/log.js";

/** Progress lines kept for the screen. */
const KEEP_LINES = 12;

export const QUESTION_TIMEOUT_MS = 10 * 60 * 1000;
export const WARNING_MS = 60 * 1000;
/** After a refused archive: how long to wait for an interrupted session to go idle. */
const ARCHIVE_RETRY_MS = 5000;

const MESSAGES = {
  checks_failed: "Your game didn't pass its tests, so it isn't on the shelf yet. Everything is saved, and a grown-up can look at it.",
  no_cart: "Claude couldn't finish this game. Everything is saved, and a grown-up can look at it.",
  budget_reached: "This game used up all its building time before it was done. Everything is saved, and a grown-up can look at it.",
  refusal: "Claude can't make that game. Try a different idea!",
  stale: "The Studio isn't ready to make games right now. A grown-up needs to update it.",
  error: "Something went wrong while making your game. Try again in a little while.",
};

const NOTICES = {
  timed_out: { message: "You were away for a while, so I stopped making this game. Tell me your idea again any time!", short: "Your last game was put away" },
  restarted: { message: "Sorry! The cabinet restarted, so your game didn't get finished. Tell me your idea again!", short: "Your last game didn't finish" },
};

/** Why a make ended, in kid language. Only the log has the details. */
export function kidMessage(record) {
  if (record?.stop_reason === "budget_reached") return MESSAGES.budget_reached;
  if (record?.stop_reason === "refusal") return MESSAGES.refusal;
  return MESSAGES[record?.outcome] ?? MESSAGES.error;
}

/**
 * @typedef {{
 *   api: () => Promise<import("@game-studio-arcade/studio-cli/src/api.js").StudioApi> | import("@game-studio-arcade/studio-cli/src/api.js").StudioApi,
 *   paths: ReturnType<typeof import("@game-studio-arcade/studio-cli/src/config.js").dataPaths>,
 *   lock: () => {agentId: string, agentVersion?: number, environmentId: string},
 *   kit: (api: any) => Promise<{fileId: string, hash: string}>,
 *   checker: import("@game-studio-arcade/studio-cli/src/checks.js").Checker,
 *   budgetCents?: number,
 *   model?: string,
 *   repoBrief?: {system: string, tools: any[]},
 *   nameOf?: (makerId: string) => string,
 *   titleOf?: (cartId: string) => string | null,
 *   onStart?: (makerId: string) => void,
 *   questionTimeoutMs?: number,
 *   warningMs?: number,
 *   now?: () => Date,
 * }} StudioOptions
 */

export class StudioBusy extends Error {}
export class StudioGone extends Error {}
/** Thrown into the driver to stop it when a make is released (D188). */
class Released extends Error {}

/** @param {StudioOptions} o */
export function createStudio(o) {
  const now = o.now ?? (() => new Date());
  const timeoutMs = o.questionTimeoutMs ?? QUESTION_TIMEOUT_MS;
  const warningMs = Math.min(o.warningMs ?? WARNING_MS, timeoutMs / 2);
  const journalFile = path.join(o.paths.root, "studio-run.json");
  /** @type {Set<(s: any) => void>} */
  const listeners = new Set();
  /** @type {any} */
  let run = null;
  /** @type {any} */
  let notice = null;
  // Not from 1: a page open across a service restart remembers ids it has answered.
  let nextId = Date.now();
  /** @type {NodeJS.Timeout[]} */
  let timers = [];

  const state = () => {
    if (!run) return notice ? { phase: "idle", notice } : { phase: "idle" };
    return {
      phase: run.result ? "done" : "running",
      maker: run.maker,
      maker_name: run.makerName,
      lines: run.lines.slice(-KEEP_LINES),
      pending: run.pending ? { ...run.pending.shown, warn: run.warn } : null,
      result: run.result,
    };
  };
  const changed = () => {
    const s = state();
    for (const f of listeners) f(s);
  };

  // ---------- the run's journal (D189) ----------

  /** @param {any} current */
  const writeJournal = (current) => {
    fs.mkdirSync(o.paths.root, { recursive: true });
    const tmp = `${journalFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ session_id: current.sessionId ?? null, maker: current.maker, request: current.request, turns: current.turns, started_at: current.startedAt }, null, 2) + "\n");
    fs.renameSync(tmp, journalFile);
  };
  const clearJournal = () => fs.rmSync(journalFile, { force: true });

  /** A journal left from before this process: the last run never ended. */
  const recover = () => {
    /** @type {any} */
    let left;
    try {
      left = JSON.parse(fs.readFileSync(journalFile, "utf8"));
    } catch (/** @type {any} */ e) {
      if (e.code === "ENOENT") return;
      left = { unreadable: true };
    }
    appendLog(o.paths.logs, "studio_session", {
      id: left.session_id ?? null,
      origin: "cabinet",
      maker: left.maker ?? null,
      with: null,
      request: left.request ?? null,
      turns: left.turns ?? [],
      outcome: "service_restarted",
      // It carries on at Anthropic, under its budget. Nothing here resumes or stops it.
      session_left_running: Boolean(left.session_id),
      started_at: left.started_at ?? null,
      ended_at: now().toISOString(),
    });
    clearJournal();
    notice = { id: nextId++, kind: "restarted", ...NOTICES.restarted };
  };
  recover();

  // ---------- waiting on the kid ----------

  const clearTimers = () => {
    for (const t of timers) clearTimeout(t);
    timers = [];
  };
  const armTimers = () => {
    clearTimers();
    timers = [
      setTimeout(() => {
        if (run?.pending) {
          run.warn = true;
          changed();
        }
      }, timeoutMs - warningMs),
      setTimeout(() => {
        if (run?.pending) release("timed_out");
      }, timeoutMs),
    ];
    for (const t of timers) t.unref?.();
  };

  /** Wait for the launcher. @param {object} shown */
  const ask = (shown) =>
    new Promise((resolve, reject) => {
      run.pending = { shown: { id: nextId++, ...shown }, resolve, reject };
      run.warn = false;
      armTimers();
      changed();
    });

  // ---------- letting go of a make (D188) ----------

  /** Archive, never delete (D5). Waiting on a tool, a session is idle and can go at once. */
  const archive = async (api, sessionId) => {
    if (!api.archiveSession) return { ok: false, error: "this client can't archive" };
    try {
      await api.archiveSession(sessionId);
      return { ok: true };
    } catch {
      // It was still running, so stop it, give it a moment, and try once more.
    }
    try {
      await api.send(sessionId, [{ type: "user.interrupt" }]);
      const deadline = Date.now() + ARCHIVE_RETRY_MS;
      while (Date.now() < deadline) {
        const s = await api.retrieveSession(sessionId);
        if (s?.status !== "running") break;
        await new Promise((r) => setTimeout(r, 250));
      }
      await api.archiveSession(sessionId);
      return { ok: true };
    } catch (/** @type {any} */ e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  };

  /** Everything worth keeping, then the record. Make is already free by now. @param {any} current */
  const finishRelease = async (current) => {
    const api = current.api;
    let usage = null;
    /** @type {any} */
    let archived = { ok: false, error: "no session had started" };
    /** @type {string[]} */
    const errors = [];
    if (api && current.sessionId) {
      const dir = path.join(o.paths.sessions, current.sessionId);
      try {
        const events = await api.listEvents(current.sessionId);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "events.jsonl"), events.map((/** @type {any} */ e) => JSON.stringify(e)).join("\n") + (events.length ? "\n" : ""));
      } catch (/** @type {any} */ e) {
        errors.push(`events: ${e?.message ?? e}`);
      }
      try {
        usage = (await api.retrieveSession(current.sessionId))?.usage ?? null;
      } catch (/** @type {any} */ e) {
        errors.push(`usage: ${e?.message ?? e}`);
      }
      archived = await archive(api, current.sessionId);
    }
    appendLog(o.paths.logs, "studio_session", {
      id: current.sessionId ?? null,
      origin: "cabinet",
      maker: current.maker,
      with: null,
      request: current.request,
      turns: current.turns,
      outcome: "abandoned",
      ended_by: current.released,
      archive: archived,
      list_cost: usage?.list_cost ?? null,
      usage,
      errors,
      started_at: current.startedAt,
      ended_at: now().toISOString(),
    });
  };

  /** @param {"timed_out" | "stopped"} reason */
  function release(reason) {
    const current = run;
    const p = current?.pending;
    if (!p) throw new StudioGone("nothing is waiting");
    clearTimers();
    clearJournal();
    current.released = reason;
    current.pending = null;
    run = null; // Make is free now, whatever the API does next.
    notice = reason === "timed_out" ? { id: nextId++, kind: reason, ...NOTICES.timed_out } : null;
    p.reject(new Released(reason));
    changed();
  }

  /** A failure before or outside makeCart's own record still leaves one (D183). */
  const logFailure = (current, e) => {
    appendLog(o.paths.logs, "studio_session", {
      id: current.sessionId ?? null,
      origin: "cabinet",
      maker: current.maker,
      with: null,
      request: current.request,
      turns: current.turns,
      outcome: "error",
      error: String(e?.message ?? e),
      started_at: current.startedAt,
      ended_at: now().toISOString(),
    });
  };

  return {
    state,
    /** @param {(s: any) => void} f */
    subscribe(f) {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    /** @param {{ maker: string, request: string }} a */
    start({ maker, request }) {
      if (run && !run.result) throw new StudioBusy("a game is already being made");
      /** @type {any} */
      const current = {
        maker,
        makerName: o.nameOf?.(maker) ?? maker,
        request,
        lines: [],
        pending: null,
        warn: false,
        result: null,
        turns: [],
        startedAt: now().toISOString(),
      };
      run = current;
      notice = null;
      writeJournal(current);
      o.onStart?.(maker);
      /** @type {import("@game-studio-arcade/studio-cli/src/answers.js").Answerer} */
      const answerer = {
        question: async (q) => {
          const a = /** @type {any} */ (await ask({ kind: "question", ...q }));
          // For the records of a make that doesn't reach makeCart's own (D188, D189).
          current.turns.push({ ...q, choice: a.choice, said: a.said ?? null });
          writeJournal(current);
          return a;
        },
        plan: (p) => /** @type {Promise<any>} */ (ask({ kind: "plan", ...p })),
      };
      const ui = {
        progress: (/** @type {string} */ s) => {
          current.lines.push(s);
          changed();
        },
        info: () => {}, // Test changes and the library path are for the log, not a kid's screen (D183).
      };
      (async () => {
        const base = await o.api();
        current.api = base;
        const api = {
          ...base,
          // The session's id, as soon as it exists: a release or a restart needs it.
          createSession: async (/** @type {any} */ p) => {
            const created = await base.createSession(p);
            current.sessionId = created.id;
            writeJournal(current);
            return created;
          },
        };
        const { record, committed } = await makeCart({
          api,
          request,
          maker,
          model: o.model,
          budgetCents: o.budgetCents ?? 300,
          answerer,
          checker: o.checker,
          paths: o.paths,
          lock: o.lock(),
          kit: () => o.kit(api),
          origin: "cabinet",
          repoBrief: o.repoBrief,
          ui,
        });
        current.result = committed
          ? { ok: true, cart_id: committed.id, title: o.titleOf?.(committed.id) ?? committed.id, session_id: record.id }
          : { ok: false, message: kidMessage(record), session_id: record.id };
      })()
        .catch(async (e) => {
          if (e instanceof Released) return finishRelease(current);
          logFailure(current, e);
          const stale = /doesn't match agents\/studio\.md/.test(String(e?.message));
          current.result = { ok: false, message: stale ? MESSAGES.stale : MESSAGES.error, session_id: current.sessionId ?? null };
        })
        .catch((e) => console.error(`cabinet-service: logging a make that ended: ${e?.message ?? e}`))
        .finally(() => {
          if (current.released) return;
          current.pending = null;
          clearTimers();
          clearJournal();
          changed();
        });
      changed();
    },
    /** @param {{ id: number, choice: string, said?: string }} a */
    answer({ id, choice, said }) {
      const p = run?.pending;
      if (!p || p.shown.id !== id) throw new StudioGone("that question has gone");
      const kind = p.shown.kind;
      const ok = kind === "question" ? ["A", "B", "C", "D"].includes(choice) : ["build", "change"].includes(choice);
      if (!ok) throw new Error(`${choice} isn't an answer to a ${kind}`);
      const wantsWords = choice === "C" || choice === "change";
      const words = typeof said === "string" ? said.trim() : "";
      if (wantsWords && !words) throw new Error(`${choice} needs words`);
      clearTimers();
      run.pending = null;
      run.warn = false;
      p.resolve(wantsWords ? { choice, said: words } : { choice });
      changed();
    },
    /** A key was pressed on the cabinet: someone's there, so the clock starts again. */
    stillHere() {
      if (!run?.pending) return;
      const warned = run.warn;
      run.warn = false;
      armTimers();
      if (warned) changed();
    },
    /** The kid chose to stop (D188). Only while it's waiting on them. */
    stop() {
      release("stopped");
    },
    /** The kid has seen how it ended; Make is free again. */
    acknowledge() {
      if (run?.result) run = null;
      changed();
    },
    /** The kid has read the message. @param {number} id */
    dismissNotice(id) {
      if (notice?.id === id) {
        notice = null;
        changed();
      }
    },
  };
}
