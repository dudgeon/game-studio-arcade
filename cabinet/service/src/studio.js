// The Studio side (D183): one session at a time, through the CLI's makeCart and
// driver. The tile relay is an Answerer that waits for the launcher. Everything a
// kid sees comes from `state()`, in kid language; the rest goes to the logs.
// A make nobody answers is released (D188); one a restart cut off is logged (D189)
// and picked back up to collect its cart (D191). How a make ended is a shelf entry (D192).
// Every make and change is gated on the family coin pot and charged its real cost
// at its end, however it ended (D202, D203); a change starts from its parent (D206).
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

/** A D198 stage as one of the track's steps: Plan, Build (or Change), Test, Done (D201). @param {number} stage */
const stepOf = (stage) => (stage <= 1 ? 0 : stage === 2 ? 1 : 2);

/** The workspace's real limit refusing a session (D204, L5). Unverified against the live API: no limit has been hit yet. */
export const SPEND_LIMIT = /spend(ing)?[ _-]?limit|usage[ _-]?limit|credit balance|billing/i;

/** Why a make cost more than usual, in kid words, from its record (L4). @param {any} record */
export function whyMore(record) {
  const fixes = Number(record?.playtest?.sandbox?.fix_rounds ?? 0);
  if (fixes >= 2) return `Claude had to fix it ${fixes} times before every rule worked.`;
  const asked = Number(record?.questions ?? 0);
  if (asked >= 5) return `Claude asked ${asked} questions and wrote lots of rules.`;
  return "Claude needed extra tries to make every rule work.";
}

/** How a charge's make ended, for the ledger. @param {any} record */
const outcomeOf = (record) => (record?.outcome === "committed" || record?.outcome === "committed_failing" ? "on the shelf" : "didn't finish");

/** Whole cents from a usage, or null. @param {any} usage */
const centsOf = (usage) => {
  const n = Number(usage?.list_cost?.amount);
  return usage?.list_cost?.amount != null && Number.isFinite(n) ? n : null;
};

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
 *   api: (resume?: {answered?: number}, what?: {kind: string}) => Promise<import("@game-studio-arcade/studio-cli/src/api.js").StudioApi> | import("@game-studio-arcade/studio-cli/src/api.js").StudioApi,
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
 *   pot?: ReturnType<typeof import("./pot.js").potStore>,
 *   cabinet?: ReturnType<typeof import("./cabinet-state.js").cabinetState>,
 *   findCart?: (cartId: string) => import("@game-studio-arcade/studio-cli/src/make.js").Parent | null,
 *   online?: () => boolean,
 *   questionTimeoutMs?: number,
 *   warningMs?: number,
 *   recheckMs?: number,
 *   log?: (line: string) => void,
 *   now?: () => Date,
 * }} StudioOptions
 */

export class StudioBusy extends Error {}
export class StudioGone extends Error {}
/** The pot can't cover the usual cost (D203), the Studio is resting (L5), or there's no Wi-Fi (E2). */
export class StudioRefused extends Error {
  /** @param {string} why @param {string} message */
  constructor(why, message) {
    super(message);
    this.why = why;
  }
}
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
    const extra = {
      ...(o.pot ? { pot: o.pot.state() } : {}),
      ...(o.cabinet?.resting() ? { resting: true } : {}),
      ...(o.online && !o.online() ? { offline: true } : {}),
    };
    if (!run) return notice ? { phase: "idle", notice, ...ended, ...busy, ...extra } : { phase: "idle", ...ended, ...busy, ...extra };
    const waited = run.waitMs + (run.pendingSince ? Date.now() - run.pendingSince : 0);
    return {
      phase: "running",
      run_id: run.id,
      ...ended,
      ...extra,
      kind: run.kind,
      parent: run.parent ? { id: run.parent.id, title: run.parent.title, version: run.parent.version, maker: run.parent.maker } : null,
      maker: run.maker,
      maker_name: run.makerName,
      lines: run.lines.slice(-KEEP_LINES),
      step: run.step,
      used_cents: run.usedCents,
      // Working time so far: the clock stops while Claude waits on the kid (M10's time left).
      working_s: Math.max(0, Math.round((Date.now() - run.t0 - waited) / 1000)),
      pending: run.pending ? { ...run.pending.shown, warn: run.warn, ...(run.warn ? { warn_until: run.warnUntil } : {}) } : null,
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
      kind: current.kind ?? "new",
      parent: current.parent ?? null,
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
    // On a question, the idea goes with the notice so the kid can try again without re-telling it (E5, D300).
    const retry = !stillGoing && left.request && left.maker ? { retry: { maker: left.maker, request: left.request, kind: left.kind ?? "new", parent: left.parent?.id ?? null } } : {};
    notice = { id: nextId++, kind: "restarted", ...(stillGoing ? NOTICES.restarted_building : NOTICES.restarted), ...retry };
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
      api = await o.api({ answered: item.answered ?? 0 }, { kind: item.kind ?? "new" });
      const { record, committed } = await makeCart({
        api,
        request: item.request ?? "",
        maker: item.maker,
        ...(item.parent ? { parent: item.parent } : {}),
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
      const cost = charge({ ...base, kind: item.kind, sessionId: item.session_id }, centsOf(record.usage), committed ? "restart, on the shelf" : "restart, didn't finish", { cart_id: committed?.id ?? null, cart_version: record.cart_version ?? null });
      addResult(
        committed
          ? { ...shelfEntry({ ...base, kind: item.kind, parent: item.parent }), ...cost, ok: true, cart_id: committed.id, version: record.cart_version ?? 1, title: o.titleOf?.(committed.id) ?? committed.id, session_id: record.id, note: FINISHED_AFTER_RESTART }
          : { ...shelfEntry({ ...base, kind: item.kind, parent: item.parent }), ...cost, ok: false, message: kidMessage(record), session_id: record.id },
      );
      const archived = await archive(api, item.session_id);
      logArchive(item.session_id, "collected after a service restart (D191)", archived);
      log(`collected session ${item.session_id}: ${record.outcome}${committed ? ` (${committed.id})` : ""}; archive ${archived.ok ? "ok" : `failed: ${archived.error}`}`);
    } catch (/** @type {any} */ e) {
      if (e instanceof NoOneToAnswer) {
        const cost = await finishRelease({ api, sessionId: item.session_id, maker: item.maker, makerName: base.makerName, kind: item.kind, request: item.request, turns: item.turns ?? [], released: "no_one_to_answer", startedAt: item.started_at });
        // Already told, if it was waiting at the restart.
        if (!item.waiting) addResult({ ...shelfEntry({ ...base, kind: item.kind, parent: item.parent }), ...cost, ok: false, message: MESSAGES.no_one_to_answer, session_id: item.session_id });
        log(`collected session ${item.session_id}: it was waiting on a question nobody can answer, so it was released (D191)`);
      } else if (e?.status === 404) {
        appendLog(o.paths.logs, "studio_session_correction", { corrects: item.session_id, why: "the API no longer has this session, so nothing could be collected (D191)", at: now().toISOString() });
        // Its cost can't be read any more: the ledger says so rather than guess (D202).
        charge({ ...base, kind: item.kind, sessionId: item.session_id }, null, "restart, gone from the API");
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
          run.warnUntil = Date.now() + warningMs;
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
      current.pendingSince = Date.now();
      current.warn = false;
      writeJournal(current);
      armTimers();
      changed();
    });

  /** A result entry's shared fields. @param {{maker: string, makerName: string, id?: number, kind?: string, parent?: any}} current */
  const shelfEntry = (current) => ({
    run_id: current.id ?? null,
    maker: current.maker,
    maker_name: current.makerName,
    kind: current.kind ?? "new",
    // The parent's maker by name, for R8's "Tester's game stays the same." (D302).
    ...(current.parent ? { parent: { id: current.parent.id, title: current.parent.title, version: current.parent.version, maker: current.parent.maker, maker_name: current.parent.maker ? (o.nameOf?.(current.parent.maker) ?? current.parent.maker) : null } } : {}),
  });

  /**
   * The real cost, whatever happened (D202: no refunds), and what the result screen says about it.
   * @param {{ maker: string, kind?: string, sessionId?: string | null }} current @param {number | null} cents @param {string} outcome @param {{cart_id?: string|null, cart_version?: number|null}} [cart]
   */
  const charge = (current, cents, outcome, cart = {}) => {
    if (!o.pot || !current.sessionId) return {};
    const kind = current.kind === "change" ? "change" : "new";
    try {
      const e = o.pot.charge({ maker: current.maker, what: kind, session_id: current.sessionId, cost_cents: cents, outcome, ...cart });
      const entry = e ?? o.pot.history().find((x) => x.kind === "charge" && x.session_id === current.sessionId);
      if (!entry) return {};
      const cost = entry.cost_cents ?? 0;
      return {
        cost_cents: cost,
        cost_known: entry.cost_known !== false,
        coins: entry.coins,
        pot_before_cents: entry.pot_before_cents,
        pot_after_cents: entry.pot_after_cents,
        over_pot: entry.pot_after_cents < 0,
        over_usual: o.pot.overUsual(cost, kind),
      };
    } catch (/** @type {any} */ e) {
      log(`charging session ${current.sessionId} failed: ${e?.message ?? e}`);
      return {};
    }
  };

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
    const cents = centsOf(usage) ?? (current.usedCents || null);
    const cost = charge(current, cents, current.released === "stopped" ? "stopped" : current.released === "timed_out" ? "walked away" : "restart, nobody to answer");
    appendLog(o.paths.logs, "studio_session", {
      id: current.sessionId ?? null,
      origin: "cabinet",
      maker: current.maker,
      with: null,
      kind: current.kind ?? "new",
      parent: current.parent ? `${current.parent.id}@${current.parent.version}` : null,
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
    return cost;
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
    // The idea goes with the notice, so the kid can try again without saying it again (D300); the cost follows once charged.
    notice = reason === "timed_out" ? { id: nextId++, kind: reason, ...NOTICES.timed_out, used_cents: current.usedCents, run_id: current.id, retry: { maker: current.maker, request: current.request, kind: current.kind ?? "new", parent: current.parent?.id ?? null } } : null;
    p.reject(new Released(reason));
    changed();
  }

  /** The kid answered: the time-left clock runs again. @param {any} current */
  const stopWaiting = (current) => {
    if (current.pendingSince) current.waitMs += Date.now() - current.pendingSince;
    current.pendingSince = 0;
  };

  /** What a change changed, in a line (R8): the plan's own words when it gave them, else the kid's. @param {any} record @param {string} request */
  const changedLine = (record, request) => {
    const plan = (record?.plan_turns ?? []).at(-1);
    const ch = plan?.changes?.[0]?.text ?? plan?.rules?.find((/** @type {any} */ r) => r.was)?.text;
    return String(ch ?? request).slice(0, 200);
  };

  /** A failure before or outside makeCart's own record still leaves one (D183). */
  const logFailure = (current, e) => {
    appendLog(o.paths.logs, "studio_session", {
      id: current.sessionId ?? null,
      origin: "cabinet",
      maker: current.maker,
      with: null,
      request: current.request,
      turns: current.turns,
      kind: current.kind ?? "new",
      parent: current.parent ? `${current.parent.id}@${current.parent.version}` : null,
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
    /** @param {{ maker: string, request: string, parent?: string | null }} a */
    start({ maker, request, parent: parentId }) {
      if (run) throw new StudioBusy("a game is already being made");
      // One paid session at a time holds across a restart too (D183, D199).
      if (toCollect) throw new StudioBusy("the last game is still being finished");
      const parent = parentId ? (o.findCart?.(parentId) ?? null) : null;
      if (parentId && !parent) throw new StudioGone("that game isn't on the shelf");
      const kind = parent ? "change" : "new";
      if (o.online && !o.online()) throw new StudioRefused("offline", "Claude can't be reached right now");
      if (o.cabinet?.resting()) throw new StudioRefused("resting", "the Studio is resting until the 1st");
      // The start gate (D203): only what the pot can cover, in its usual cost.
      if (o.pot) {
        const g = o.pot.gate(kind);
        if (!g.ok) throw new StudioRefused(/** @type {string} */ (g.why), `the pot has ${g.coins} coins and ${kind === "change" ? "a change" : "a new game"} needs about ${g.need}`);
      }
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
        kind,
        parent,
        step: 0,
        usedCents: 0,
        t0: Date.now(),
        waitMs: 0,
        pendingSince: 0,
      };
      run = current;
      notice = null;
      writeJournal(current);
      o.onStart?.(maker);
      /** @type {import("@game-studio-arcade/studio-cli/src/answers.js").Answerer} */
      const answerer = {
        question: async (q) => {
          const a = /** @type {any} */ (await ask(current, { kind: "question", ...q }));
          stopWaiting(current);
          // For the records of a make that doesn't reach makeCart's own (D188, D189).
          current.turns.push({ ...q, choice: a.choice, said: a.said ?? null });
          current.answered++;
          writeJournal(current);
          return a;
        },
        plan: async (p) => {
          const a = /** @type {any} */ (await ask(current, { kind: "plan", ...p }));
          stopWaiting(current);
          current.answered++;
          writeJournal(current);
          return a;
        },
      };
      const ui = {
        progress: (/** @type {string} */ s, /** @type {number | null | undefined} */ stage) => {
          current.lines.push(s);
          // The track only moves forward (D198, D201). The cabinet's own lines after the session are testing.
          const step = typeof stage === "number" ? stepOf(stage) : current.sessionDone ? 2 : current.step;
          current.step = Math.max(current.step, step);
          changed();
        },
        usage: (/** @type {any} */ u) => {
          const c = centsOf(u);
          if (c != null && c !== current.usedCents) {
            current.usedCents = c;
            changed();
          }
        },
        info: () => {}, // Test changes and the library path are for the log, not a kid's screen (D183).
      };
      (async () => {
        const base = await o.api(undefined, { kind });
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
          api: {
            ...api,
            // The session is over once its usage is final: what's left is the cabinet's own checks.
            retrieveSession: async (/** @type {string} */ id) => {
              const r = await api.retrieveSession(id);
              current.sessionDone = true;
              current.step = Math.max(current.step, 2);
              const c = centsOf(r?.usage);
              if (c != null) current.usedCents = c;
              changed();
              return r;
            },
          },
          request,
          maker,
          ...(parent ? { parent } : {}),
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
        const cost = charge(current, centsOf(record.usage) ?? current.usedCents, outcomeOf(record), { cart_id: committed?.id ?? null, cart_version: record.cart_version ?? null });
        const more = cost.over_usual ? { why_more: whyMore(record) } : {};
        addResult(
          committed
            ? { ...shelfEntry(current), ...cost, ...more, ok: true, cart_id: committed.id, version: record.cart_version ?? 1, title: o.titleOf?.(committed.id) ?? committed.id, changed: changedLine(record, request), session_id: record.id }
            : { ...shelfEntry(current), ...cost, ok: false, failed: true, request, message: kidMessage(record), session_id: record.id },
        );
        // Every finished session is archived at Anthropic, a game on the shelf too: kept, never deleted (D5, D301).
        const archived = await archive(api, record.id);
        logArchive(record.id, "the make finished; archived (D301)", archived);
      })()
        .catch(async (e) => {
          if (e instanceof Released) {
            const cost = await finishRelease(current);
            // What the walk-away cost, on the screen that says it happened (D202, D300).
            if (notice?.run_id === current.id && cost?.cost_cents != null) {
              notice = { ...notice, cost_cents: cost.cost_cents, pot_after_cents: cost.pot_after_cents };
              changed();
            }
            return;
          }
          logFailure(current, e);
          const stale = /doesn't match agents\/studio\.md/.test(String(e?.message));
          // No session, nothing spent; the workspace limit means resting until the 1st (D204, L5).
          if (!current.sessionId && SPEND_LIMIT.test(String(e?.message ?? ""))) {
            o.cabinet?.rest();
            log("the workspace's spend limit refused a session: the Studio rests until the 1st (L5)");
            return void addResult({ ...shelfEntry(current), ok: false, resting: true, message: "The Studio is resting until the 1st. Playing games still works!", session_id: null });
          }
          let cents = current.usedCents || null;
          if (current.sessionId) {
            try {
              cents = centsOf((await current.api?.retrieveSession(current.sessionId))?.usage) ?? cents;
            } catch {}
          }
          const cost = charge(current, cents, "didn't finish");
          addResult({ ...shelfEntry(current), ...cost, ok: false, failed: !stale, request, message: stale ? MESSAGES.stale : MESSAGES.error, session_id: current.sessionId ?? null });
          // A session that failed here (the cabinet's side, D214) is archived like a released one, never deleted (D5, D188).
          if (current.sessionId && current.api) {
            const archived = await archive(current.api, current.sessionId);
            logArchive(current.sessionId, "the make failed outside makeCart's record; archived (D219)", archived);
          }
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
