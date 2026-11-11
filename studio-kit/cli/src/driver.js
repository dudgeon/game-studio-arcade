// Runs one Studio session: open the stream, send the request, relay the custom
// tools (D41) until the session goes idle for good. Plays the cabinet's
// Studio-side role (tile relay); the CLI and later the cabinet service share it.
import { planResult, questionResult } from "./tiles.js";
import { LINE_STAGE, progressFor, progressGate, tellStage } from "./progress.js";

/**
 * @typedef {import("./api.js").StudioApi} StudioApi
 * @typedef {import("./api.js").SessionEvent} SessionEvent
 * @typedef {import("./answers.js").Answerer} Answerer
 *
 * @typedef {object} Ui
 * @property {(text: string) => void} progress   one kid-language line
 * @property {(text: string) => void} [debug]
 *
 * @typedef {object} Turn                         a §9.5 turn
 * @property {string} question
 * @property {string} option_a
 * @property {string} option_b
 * @property {"A"|"B"|"C"|"D"} choice
 * @property {string|null} said
 * @property {boolean} [auto]                      answered D by the relay after make-it-now
 *
 * @typedef {object} SessionResult
 * @property {string} sessionId
 * @property {Turn[]} turns
 * @property {{summary: string, rules: any[], changes?: any[], choice: string, said: string|null}[]} planTurns
 * @property {"answers"|"make_it_now"} endedBy
 * @property {string} stopReason   end_turn | budget_reached | retries_exhausted | refusal | terminated | stream_lost
 * @property {any} usage           session usage (list_cost, tokens, active_seconds)
 * @property {string} startedAt
 * @property {string} endedAt
 * @property {string} idleAt
 * @property {number} wallSeconds
 * @property {string} lastMessage   the agent's final text
 * @property {any[]} errors
 * @property {string[]} notes
 * @property {SessionEvent[]} events   every event received, in order, once each (for fixtures)
 */

/**
 * User message that starts a build.
 * @param {{request: string, maker: string, withPlayer?: string|null}} o
 */
export function requestMessage({ request, maker, withPlayer }) {
  const lines = [
    "New game request from the cabinet.",
    `Maker: ${maker}${withPlayer ? ` (with ${withPlayer})` : ""}`,
    "What the player said (speech-to-text transcript, their own words):",
    `"${request}"`,
  ];
  return { type: "user.message", content: [{ type: "text", text: lines.join("\n") }] };
}

const TERMINAL_STOPS = new Set(["end_turn", "budget_reached", "retries_exhausted", "refusal"]);

/**
 * @param {{
 *   api: StudioApi,
 *   session: import("./api.js").CreateSessionParams,
 *   request: string, maker: string, withPlayer?: string|null,
 *   answerer: Answerer, ui: Ui,
 *   message?: object,
 *   onEvent?: (ev: SessionEvent, sessionId: string) => Promise<void>,
 *   resume?: {sessionId: string},
 *   now?: () => Date, maxReconnects?: number,
 * }} o
 * @returns {Promise<SessionResult>}
 */
export async function runSession(o) {
  const now = o.now ?? (() => new Date());
  const ui = o.ui;
  const debug = ui.debug ?? (() => {});
  const started = now();

  // resume: pick a session back up after the process running it died (D191).
  const created = o.resume ? { id: o.resume.sessionId } : await o.api.createSession(o.session);
  const sessionId = created.id;
  debug(`session ${sessionId}`);

  /** @type {Turn[]} */
  const turns = [];
  const planTurns = [];
  const errors = [];
  const notes = new Set();
  const seen = new Set(); // event ids already handled (dedupe across reconnects)
  /** @type {SessionEvent[]} */
  const events = [];
  const answered = new Set(); // custom_tool_use ids we've replied to
  const pendingTools = new Map(); // id -> event, for requires_action recovery
  let madeItNow = false;
  let usage = null;
  let lastMessage = "";
  let lastProgress = "";
  let stopReason = "";

  // Only forward, and never the same words twice (D198).
  const gate = progressGate();
  /** @param {string} text @param {number | null | "hide"} [stage] */
  const say = (text, stage) => {
    const shown = gate(text, stage ?? LINE_STAGE[text] ?? null);
    if (shown) {
      lastProgress = shown;
      ui.progress(shown);
    }
  };


  async function reply(ev, text) {
    answered.add(ev.id);
    pendingTools.delete(ev.id);
    await o.api.send(sessionId, [
      { type: "user.custom_tool_result", custom_tool_use_id: ev.id, content: [{ type: "text", text }] },
    ]);
  }

  async function onCustomTool(ev) {
    if (answered.has(ev.id)) return;
    const input = ev.input ?? {};
    if (ev.name === "ask_player") {
      const q = { question: String(input.question ?? ""), option_a: String(input.option_a ?? ""), option_b: String(input.option_b ?? "") };
      if (madeItNow) {
        notes.add("asked_after_make_it_now");
        turns.push({ ...q, choice: "D", said: null, auto: true });
        return reply(ev, questionResult({ choice: "D" }));
      }
      const a = await o.answerer.question(q);
      if (a.choice === "D") madeItNow = true;
      turns.push({ ...q, choice: a.choice, said: a.choice === "C" ? (a.said ?? "") : null });
      return reply(ev, questionResult(a));
    }
    if (ev.name === "show_plan") {
      const p = { summary: String(input.summary ?? ""), rules: Array.isArray(input.rules) ? input.rules : [], ...(Array.isArray(input.changes) && input.changes.length ? { changes: input.changes } : {}) };
      const a = await o.answerer.plan(p);
      planTurns.push({ ...p, choice: a.choice, said: a.choice === "change" ? (a.said ?? "") : null });
      return reply(ev, planResult(a));
    }
    if (ev.name === "tell_player") {
      say(String(input.message ?? ""), tellStage(input.stage));
      return reply(ev, JSON.stringify({ ok: true }));
    }
    notes.add(`unknown_tool:${ev.name}`);
    return reply(ev, JSON.stringify({ error: `unknown tool ${ev.name}` }));
  }

  /** @returns {Promise<boolean>} true when the session is finished */
  async function handle(ev) {
    if (ev.id) {
      if (seen.has(ev.id)) return false;
      seen.add(ev.id);
    }
    events.push(ev);
    if (o.onEvent) await o.onEvent(ev, sessionId);
    switch (ev.type) {
      case "agent.custom_tool_use":
        pendingTools.set(ev.id, ev);
        await onCustomTool(ev);
        return false;
      case "agent.tool_use":
        say(progressFor(ev) ?? "");
        return false;
      case "agent.message": {
        const text = (ev.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
        if (text) {
          lastMessage = text;
          debug(`agent: ${text}`);
        }
        return false;
      }
      case "session.usage":
        usage = ev.usage ?? usage;
        return false;
      case "session.error":
        errors.push(ev.error ?? ev);
        debug(`error: ${JSON.stringify(ev.error ?? ev)}`);
        return false;
      case "session.status_terminated":
        stopReason = "terminated";
        return true;
      case "session.deleted":
        stopReason = "deleted";
        return true;
      case "session.status_idle": {
        const type = ev.stop_reason?.type ?? "";
        if (type === "requires_action") {
          await settlePending(ev.stop_reason.event_ids ?? []);
          return false;
        }
        if (TERMINAL_STOPS.has(type)) {
          stopReason = type;
          return true;
        }
        return false;
      }
      default:
        return false;
    }
  }

  // A requires_action idle names the calls it waits on. Normally we've already
  // answered them; if one slipped past the stream, find it in the history.
  async function settlePending(ids) {
    const missing = ids.filter((id) => !answered.has(id));
    if (!missing.length) return;
    let history = [];
    for (const id of missing) {
      let ev = pendingTools.get(id);
      if (!ev) {
        if (!history.length) history = await o.api.listEvents(sessionId);
        ev = history.find((h) => h.id === id && h.type === "agent.custom_tool_use");
      }
      if (ev) {
        notes.add("recovered_tool_call");
        seen.add(id);
        await onCustomTool(ev);
      } else {
        errors.push({ type: "unanswerable_tool_call", id });
      }
    }
  }

  // What was already asked and answered, from a session's history (D191).
  function restoreTurns(history) {
    const uses = new Map();
    for (const ev of history) {
      if (ev.type === "agent.custom_tool_use") uses.set(ev.id, ev);
      if (ev.type !== "user.custom_tool_result") continue;
      answered.add(ev.custom_tool_use_id);
      const use = uses.get(ev.custom_tool_use_id);
      /** @type {any} */
      let a = {};
      try {
        a = JSON.parse(ev.content?.[0]?.text ?? "{}");
      } catch {}
      const input = use?.input ?? {};
      if (use?.name === "ask_player") {
        if (a.choice === "D") madeItNow = true;
        turns.push({ question: String(input.question ?? ""), option_a: String(input.option_a ?? ""), option_b: String(input.option_b ?? ""), choice: a.choice, said: a.choice === "C" ? (a.said ?? "") : null });
      } else if (use?.name === "show_plan") {
        planTurns.push({ summary: String(input.summary ?? ""), rules: Array.isArray(input.rules) ? input.rules : [], choice: a.choice, said: a.choice === "change" ? (a.said ?? "") : null });
      }
    }
  }

  // Open the stream before sending anything: it only carries later events.
  let stream = await o.api.openStream(sessionId);
  let done = false;
  if (o.resume) {
    notes.add("resumed_after_restart");
    const history = await o.api.listEvents(sessionId);
    restoreTurns(history);
    for (const ev of history) {
      if (await handle(ev)) {
        done = true;
        break;
      }
    }
  } else {
    await o.api.send(sessionId, [o.message ?? requestMessage(o)]);
    say("Reading your idea");
  }

  const maxReconnects = o.maxReconnects ?? 5;
  let reconnects = 0;
  while (!done) {
    for await (const ev of stream) {
      if (await handle(ev)) {
        done = true;
        break;
      }
    }
    if (done) break;
    // The stream ended without a final idle: reconnect, replay missed history.
    if (reconnects++ >= maxReconnects) {
      stopReason = "stream_lost";
      break;
    }
    notes.add("reconnected");
    stream = await o.api.openStream(sessionId);
    for (const ev of await o.api.listEvents(sessionId)) {
      if (await handle(ev)) {
        done = true;
        break;
      }
    }
  }

  // The session object's usage is authoritative (D43); the stream's is a fallback.
  try {
    const s = await o.api.retrieveSession(sessionId);
    if (s?.usage) usage = s.usage;
  } catch (/** @type {any} */ e) {
    errors.push({ type: "retrieve_failed", message: String(e?.message ?? e) });
  }
  for (const n of o.answerer.notes?.() ?? []) notes.add(n);

  const ended = now();
  return {
    idleAt: ended.toISOString(),
    sessionId,
    turns,
    planTurns,
    endedBy: madeItNow ? "make_it_now" : "answers",
    stopReason,
    usage,
    startedAt: started.toISOString(),
    endedAt: ended.toISOString(),
    wallSeconds: Math.round((ended.getTime() - started.getTime()) / 100) / 10,
    lastMessage,
    errors,
    notes: [...notes],
    events,
  };
}

/** "187" cents → 1.87 */
export function listCostUsd(usage) {
  const amount = usage?.list_cost?.amount;
  return amount == null ? null : Number(amount) / 100;
}
