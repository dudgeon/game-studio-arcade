// The Studio side (D183): one session at a time, through the CLI's makeCart and
// driver. The tile relay is an Answerer that waits for the launcher. Everything a
// kid sees comes from `state()`, in kid language; the rest goes to the logs.
import { makeCart } from "@game-studio-arcade/studio-cli/src/make.js";
import { appendLog } from "@game-studio-arcade/studio-cli/src/log.js";

/** Progress lines kept for the screen. */
const KEEP_LINES = 12;

const MESSAGES = {
  checks_failed: "Your game didn't pass its tests, so it isn't on the shelf yet. Everything is saved, and a grown-up can look at it.",
  no_cart: "Claude couldn't finish this game. Everything is saved, and a grown-up can look at it.",
  budget_reached: "This game used up all its building time before it was done. Everything is saved, and a grown-up can look at it.",
  refusal: "Claude can't make that game. Try a different idea!",
  stale: "The Studio isn't ready to make games right now. A grown-up needs to update it.",
  error: "Something went wrong while making your game. Try again in a little while.",
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
 *   now?: () => Date,
 * }} StudioOptions
 */

export class StudioBusy extends Error {}
export class StudioGone extends Error {}

/** @param {StudioOptions} o */
export function createStudio(o) {
  const now = o.now ?? (() => new Date());
  /** @type {Set<(s: any) => void>} */
  const listeners = new Set();
  /** @type {any} */
  let run = null;
  let nextAsk = 1;

  const state = () => {
    if (!run) return { phase: "idle" };
    return {
      phase: run.result ? "done" : "running",
      maker: run.maker,
      maker_name: run.makerName,
      lines: run.lines.slice(-KEEP_LINES),
      pending: run.pending ? run.pending.shown : null,
      result: run.result,
    };
  };
  const changed = () => {
    const s = state();
    for (const f of listeners) f(s);
  };

  /** Wait for the launcher. @param {object} shown */
  const ask = (shown) =>
    new Promise((resolve) => {
      run.pending = { shown: { id: nextAsk++, ...shown }, resolve };
      changed();
    });

  /** @type {import("@game-studio-arcade/studio-cli/src/answers.js").Answerer} */
  const answerer = {
    question: (q) => /** @type {Promise<any>} */ (ask({ kind: "question", ...q })),
    plan: (p) => /** @type {Promise<any>} */ (ask({ kind: "plan", ...p })),
  };

  /** A failure before or outside makeCart's own record still leaves one (D183). */
  const logFailure = (current, e) => {
    appendLog(o.paths.logs, "studio_session", {
      id: null,
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
        result: null,
        turns: [],
        startedAt: now().toISOString(),
      };
      run = current;
      o.onStart?.(maker);
      const wrapped = {
        ...answerer,
        // Turns for the failure record; makeCart logs its own on success.
        question: async (/** @type {any} */ q) => {
          const a = await answerer.question(q);
          current.turns.push({ ...q, choice: a.choice, said: a.said ?? null });
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
        const api = await o.api();
        const { record, committed } = await makeCart({
          api,
          request,
          maker,
          model: o.model,
          budgetCents: o.budgetCents ?? 300,
          answerer: wrapped,
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
        .catch((e) => {
          logFailure(current, e);
          const stale = /doesn't match agents\/studio\.md/.test(String(e?.message));
          current.result = { ok: false, message: stale ? MESSAGES.stale : MESSAGES.error, session_id: null };
        })
        .finally(() => {
          current.pending = null;
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
      run.pending = null;
      p.resolve(wantsWords ? { choice, said: words } : { choice });
      changed();
    },
    /** The kid has seen how it ended; Make is free again. */
    acknowledge() {
      if (run?.result) run = null;
      changed();
    },
  };
}
