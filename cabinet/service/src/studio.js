// The Studio side (D183): one session at a time, through the CLI's makeCart and
// driver. The tile relay is an Answerer that waits for the launcher. Everything a
// kid sees comes from `state()`, in kid language; the rest goes to the logs.
// A make nobody answers is released (D188); one a restart cut off is logged (D189)
// and picked back up to collect its cart (D191). How a make ended is a shelf entry (D192).
import fs from "node:fs";
import path from "node:path";
import { makeCart } from "@game-studio-arcade/studio-cli/src/make.js";
import { appendLog } from "@game-studio-arcade/studio-cli/src/log.js";

/** Progress lines kept for the screen. */
const KEEP_LINES = 12;

export const QUESTION_TIMEOUT_MS = 10 * 60 * 1000;
export const WARNING_MS = 60 * 1000;
/** After a failed attempt to pick a session back up, try again this much later. */
export const RECHECK_MS = 60 * 1000;
/** After a refused archive: how long to wait for an interrupted session to go idle. */
const ARCHIVE_RETRY_MS = 5000;

const MESSAGES = {
  checks_failed: "Your game didn't pass its tests, so it isn't on the shelf yet. Everything is saved, and a grown-up can look at it.",
  no_cart: "Claude couldn't finish this game. Everything is saved, and a grown-up can look at it.",
  budget_reached: "This game used up all its building time before it was done. Everything is saved, and a grown-up can look at it.",
  refusal: "Claude can't make that game. Try a different idea!",
  stale: "The Studio isn't ready to make games right now. A grown-up needs to update it.",
  error: "Something went wrong while making your game. Try again in a little while.",
  no_one_to_answer: "Claude had a question while the cabinet was restarting, and nobody could answer it. Tell me your idea again!",
};

const FINISHED_AFTER_RESTART = "It finished while the cabinet was restarting.";

const NOTICES = {
  timed_out: { message: "You were away for a while, so I stopped making this game. Tell me your idea again any time!", short: "Your last game was put away" },
  restarted: { message: "Sorry! The cabinet restarted, so your game didn't get finished. Tell me your idea again!", short: "Your last game didn't finish" },
  restarted_building: { message: "Sorry! The cabinet restarted. Your game may still finish: look for it on the shelf.", short: "Your last game may still finish" },
};

/** Why a make ended, in kid language. Only the log has the details. */
export function kidMessage(record) {
  if (record?.stop_reason === "budget_reached") return MESSAGES.budget_reached;
  if (record?.stop_reason === "refusal") return MESSAGES.refusal;
  return MESSAGES[record?.outcome] ?? MESSAGES.error;
}

/**
 * @typedef {{
 *   api: (resume?: {answered?: number}) => Promise<import("@game-studio-arcade/studio-cli/src/api.js").StudioApi> | import("@game-studio-arcade/studio-cli/src/api.js").StudioApi,
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
 *   recheckMs?: number,
 *   log?: (line: string) => void,
 *   now?: () => Date,
 * }} StudioOptions
 */

export class StudioBusy extends Error {}
export class StudioGone extends Error {}
/** Thrown into the driver to stop it when a make is released (D188). */
class Released extends Error {}
/** Thrown into the driver when a picked-up session asks something (D191). */
class NoOneToAnswer extends Error {}

/** @param {StudioOptions} o */
export function createStudio(o) {
  const now = o.now ?? (() => new Date());
  const timeoutMs = o.questionTimeoutMs ?? QUESTION_TIMEOUT_MS;
  const warningMs = Math.min(o.warningMs ?? WARNING_MS, timeoutMs / 2);
  const recheckMs = o.recheckMs ?? RECHECK_MS;
  const journalFile = path.join(o.paths.root, "studio-run.json");
  const leftFile = path.join(o.paths.root, "studio-left.json");
  /** One line in the service's journal (D199). */
  const log = o.log ?? ((/** @type {string} */ line) => console.log(`cabinet-service: ${line}`));
  /** Sessions a restart left, still to collect. While any are, Make is busy (D199). */
  let toCollect = 0;
  const resultsFile = path.join(o.paths.root, "studio-results.json");
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

  const readJson = (file, fallback) => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return fallback;
    }
  };
  const writeJson = (file, data) => {
    fs.mkdirSync(o.paths.root, { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2) + "\n");
    fs.renameSync(`${file}.tmp`, file);
  };

  // ---------- how makes ended (D192) ----------

  /** @type {any[]} */
  const results = readJson(resultsFile, []);
  const unviewed = () => results.filter((r) => !r.viewed_at);
  /** @param {object} r */
  const addResult = (r) => {
    const entry = { id: nextId++, created: now().toISOString(), ...r };
    results.push(entry);
    writeJson(resultsFile, results);
    return entry;
  };

  /** @returns {any} */
  const state = () => {
    const shelf = unviewed();
    const ended = shelf.length ? { results: shelf } : {};
    const busy = toCollect ? { collecting: true } : {};
    if (!run) return notice ? { phase: "idle", notice, ...ended, ...busy } : { phase: "idle", ...ended, ...busy };
    return {
      phase: "running",
      run_id: run.id,
      ...ended,
      maker: run.maker,
      maker_name: run.makerName,
      lines: run.lines.slice(-KEEP_LINES),
      pending: run.pending ? { ...run.pending.shown, warn: run.warn } : null,
    };
  };
  const changed = () => {
    const s = state();
    for (const f of listeners) f(s);
  };

  // ---------- the run's journal (D189) ----------

  /** @param {any} current */
  const writeJournal = (current) => {
    writeJson(journalFile, {
      session_id: current.sessionId ?? null,
      maker: current.maker,
      maker_name: current.makerName,
      request: current.request,
      turns: current.turns,
      answered: current.answered,
      waiting: Boolean(current.pending),
      kit_hash: current.kitHash ?? null,
      lock: current.lock ?? null,
      started_at: current.startedAt,
    });
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
    const stillGoing = Boolean(left.session_id) && !left.waiting;
    notice = { id: nextId++, kind: "restarted", ...(stillGoing ? NOTICES.restarted_building : NOTICES.restarted) };
    if (left.session_id) {
      writeJson(leftFile, [...readJson(leftFile, []), left]);
      log(`a restart cut off a make; session ${left.session_id} will be picked up (D191)`);
    } else log("a restart cut off a make before its session started; nothing to pick up (D189)");
  };
  recover();
  toCollect = readJson(leftFile, []).length;

  // ---------- picking up what a restart cut off (D191) ----------

  /** The record of what happened to a session goes with its first record. @param {string} id @param {string} why @param {any} archived */
  const logArchive = (id, why, archived) => appendLog(o.paths.logs, "studio_session_correction", { corrects: id, why, archive: archived, at: now().toISOString() });

  /** @param {any} item */
  const collectLeft = async (item) => {
    /** @type {any} */
    let api = null;
    const askNobody = async () => {
      throw new NoOneToAnswer();
    };
    const lock = item.lock ?? o.lock();
    const base = { maker: item.maker, makerName: item.maker_name ?? o.nameOf?.(item.maker) ?? item.maker };
    try {
      log(`re-attaching to session ${item.session_id} (D191)`);
      api = await o.api({ answered: item.answered ?? 0 });
      const { record, committed } = await makeCart({
        api,
        request: item.request ?? "",
        maker: item.maker,
        model: o.model,
        budgetCents: o.budgetCents ?? 300,
        answerer: { question: askNobody, plan: askNobody },
        checker: o.checker,
        paths: o.paths,
        lock,
        kit: async () => ({ fileId: "", hash: item.kit_hash ?? "" }),
        origin: "cabinet",
        resume: { sessionId: item.session_id, kitHash: item.kit_hash },
        ui: { progress: () => {}, info: () => {} },
      });
      addResult(
        committed
          ? { ...shelfEntry(base), ok: true, cart_id: committed.id, title: o.titleOf?.(committed.id) ?? committed.id, session_id: record.id, note: FINISHED_AFTER_RESTART }
          : { ...shelfEntry(base), ok: false, message: kidMessage(record), session_id: record.id },
      );
      const archived = await archive(api, item.session_id);
      logArchive(item.session_id, "collected after a service restart (D191)", archived);
      log(`collected session ${item.session_id}: ${record.outcome}${committed ? ` (${committed.id})` : ""}; archive ${archived.ok ? "ok" : `failed: ${archived.error}`}`);
    } catch (/** @type {any} */ e) {
      if (e instanceof NoOneToAnswer) {
        await finishRelease({ api, sessionId: item.session_id, maker: item.maker, request: item.request, turns: item.turns ?? [], released: "no_one_to_answer", startedAt: item.started_at });
        // Already told, if it was waiting at the restart.
        if (!item.waiting) addResult({ ...shelfEntry(base), ok: false, message: MESSAGES.no_one_to_answer, session_id: item.session_id });
        log(`collected session ${item.session_id}: it was waiting on a question nobody can answer, so it was released (D191)`);
      } else if (e?.status === 404) {
        appendLog(o.paths.logs, "studio_session_correction", { corrects: item.session_id, why: "the API no longer has this session, so nothing could be collected (D191)", at: now().toISOString() });
        log(`session ${item.session_id} is gone from the API; nothing to collect (D191)`);
      } else throw e;
    }
    const rest = readJson(leftFile, []).filter((/** @type {any} */ x) => x.session_id !== item.session_id);
    writeJson(leftFile, rest);
    toCollect = rest.length;
    changed();
  };

  let collecting = false;
  const collectAllLeft = async () => {
    if (collecting) return;
    collecting = true;
    let again = false;
    for (const item of readJson(leftFile, [])) {
      try {
        await collectLeft(item);
      } catch (/** @type {any} */ e) {
        again = true;
        console.error(`cabinet-service: session ${item.session_id} not collected yet: ${e?.message ?? e}`);
      }
    }
    collecting = false;
    if (again) setTimeout(collectAllLeft, recheckMs).unref?.();
  };

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

  /** Wait for the launcher. @param {any} current @param {object} shown */
  const ask = (current, shown) =>
    new Promise((resolve, reject) => {
      current.pending = { shown: { id: nextId++, ...shown }, resolve, reject };
      current.warn = false;
      writeJournal(current);
      armTimers();
      changed();
    });

  /** A result entry's shared fields. @param {{maker: string, makerName: string, id?: number}} current */
  const shelfEntry = (current) => ({ run_id: current.id ?? null, maker: current.maker, maker_name: current.makerName });

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
      if (run) throw new StudioBusy("a game is already being made");
      // One paid session at a time holds across a restart too (D183, D199).
      if (toCollect) throw new StudioBusy("the last game is still being finished");
      /** @type {any} */
      const current = {
        id: nextId++,
        maker,
        makerName: o.nameOf?.(maker) ?? maker,
        request,
        lines: [],
        pending: null,
        warn: false,
        turns: [],
        answered: 0,
        startedAt: now().toISOString(),
      };
      run = current;
      notice = null;
      writeJournal(current);
      o.onStart?.(maker);
      /** @type {import("@game-studio-arcade/studio-cli/src/answers.js").Answerer} */
      const answerer = {
        question: async (q) => {
          const a = /** @type {any} */ (await ask(current, { kind: "question", ...q }));
          // For the records of a make that doesn't reach makeCart's own (D188, D189).
          current.turns.push({ ...q, choice: a.choice, said: a.said ?? null });
          current.answered++;
          writeJournal(current);
          return a;
        },
        plan: async (p) => {
          const a = /** @type {any} */ (await ask(current, { kind: "plan", ...p }));
          current.answered++;
          writeJournal(current);
          return a;
        },
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
        current.lock = o.lock();
        const { record, committed } = await makeCart({
          api,
          request,
          maker,
          model: o.model,
          budgetCents: o.budgetCents ?? 300,
          answerer,
          checker: o.checker,
          paths: o.paths,
          lock: current.lock,
          kit: async () => {
            const kit = await o.kit(api);
            current.kitHash = kit.hash;
            return kit;
          },
          origin: "cabinet",
          repoBrief: o.repoBrief,
          ui,
        });
        addResult(
          committed
            ? { ...shelfEntry(current), ok: true, cart_id: committed.id, title: o.titleOf?.(committed.id) ?? committed.id, session_id: record.id }
            : { ...shelfEntry(current), ok: false, message: kidMessage(record), session_id: record.id },
        );
      })()
        .catch(async (e) => {
          if (e instanceof Released) return finishRelease(current);
          logFailure(current, e);
          const stale = /doesn't match agents\/studio\.md/.test(String(e?.message));
          addResult({ ...shelfEntry(current), ok: false, message: stale ? MESSAGES.stale : MESSAGES.error, session_id: current.sessionId ?? null });
        })
        .catch((e) => console.error(`cabinet-service: logging a make that ended: ${e?.message ?? e}`))
        .finally(() => {
          if (current.released) return;
          current.pending = null;
          if (run === current) run = null; // Make is free: how it ended is a shelf entry (D192).
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
    /** Someone has seen how a make ended. Stamped, not removed. @param {number} id */
    viewResult(id) {
      const r = results.find((x) => x.id === id);
      if (!r || r.viewed_at) return;
      r.viewed_at = now().toISOString();
      writeJson(resultsFile, results);
      changed();
    },
    /** Go after anything a restart left (D191). The service calls this once it's ready. */
    collectLeft: collectAllLeft,
    /** The kid has read the message. @param {number} id */
    dismissNotice(id) {
      if (notice?.id === id) {
        notice = null;
        changed();
      }
    },
  };
}
