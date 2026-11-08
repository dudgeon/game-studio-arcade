// `studio make`: one new cart from a request, end to end (phase-0 task 8, D43).
import fs from "node:fs";
import path from "node:path";
import { runSession, listCostUsd } from "./driver.js";
import { downloadOutputs, extractCart, readJsonIfExists } from "./outputs.js";
import { commitNewCart, specTitle } from "./library.js";
import { appendLog, newSpecDiff } from "./log.js";
import { analyzeFreeze, isPlaytestRun, SNAPSHOT_NAMES } from "./freeze.js";
import { addYouCheckRules, questionsFor } from "./untested.js";
import { checkAppliedBrief, staleMessage } from "./brief.js";
import { readAgentDef } from "./config.js";

/**
 * @typedef {object} MakeOptions
 * @property {import("./api.js").StudioApi} api
 * @property {string} request
 * @property {string} maker
 * @property {string|null} [withPlayer]
 * @property {string} [model]
 * @property {number} budgetCents
 * @property {import("./answers.js").Answerer} answerer
 * @property {{progress: (s: string) => void, info: (s: string) => void, debug?: (s: string) => void}} ui
 * @property {import("./checks.js").Checker} checker
 * @property {ReturnType<typeof import("./config.js").dataPaths>} paths
 * @property {{agentId: string, agentVersion?: number, environmentId: string}} lock
 * @property {() => Promise<{fileId: string, hash: string}>} kit
 * @property {"cabinet"|"desktop"} [origin]
 * @property {boolean} [commitAnyway]
 * @property {"tarball"|"no-templates"|"skill"} [contextPack]   how this run got the library (D45, D166)
 * @property {{type: string, skill_id: string, version?: string}[]} [skills]   session-level skills
 * @property {{system: string, tools: object[]}} [brief]   run this brief instead of the applied agent's
 * @property {boolean} [allowStaleBrief]   run the applied agent even if it differs from the repo (D173)
 * @property {{system: string, tools: any[]}} [repoBrief]   what the applied agent should match; default agents/studio.md
 * @property {string} [recordFile]     also write the answers here
 * @property {() => Date} [now]
 * @property {{tries?: number, waitMs?: number, sleep?: (ms: number) => Promise<void>}} [outputs]
 */

/** A turn as a replayable answer (D47): the question and the answer's words, not just a letter. */
function recordedAnswer(t) {
  const words = t.choice === "A" ? t.option_a : t.choice === "B" ? t.option_b : t.said;
  return { question: t.question, option_a: t.option_a, option_b: t.option_b, choice: t.choice, ...(t.said ? { said: t.said } : {}), ...(words ? { answer: words } : {}) };
}

/** @param {MakeOptions} o */
export async function makeCart(o) {
  const now = o.now ?? (() => new Date());
  const ui = o.ui;
  // D173: a stale applied brief can't run silently. Checked before anything is uploaded or started.
  /** @type {{match: boolean, agent_version: number|null, diffs: string[]}|null} */
  let briefCheck = null;
  if (!o.brief) {
    briefCheck = await checkAppliedBrief({ api: o.api, lock: o.lock, def: o.repoBrief ?? readAgentDef() });
    if (!briefCheck.match) {
      if (!o.allowStaleBrief) throw new Error(staleMessage(briefCheck));
      ui.info(`Running an applied brief that differs from the repo, as asked: ${briefCheck.diffs.join(", ")}.`);
    }
  }
  const kit = await o.kit();

  // D44: fetch the frozen snapshot as the first playtest starts, so nothing the
  // agent writes later can change the baseline. It's written well before then.
  /** @type {Record<string, Buffer>} */
  const captured = {};
  let captureTries = 0;
  const captureSnapshot = async (ev, sessionId) => {
    if (ev.type !== "agent.tool_use" || ev.name !== "bash" || !isPlaytestRun(String(ev.input?.command ?? ""))) return;
    if (SNAPSHOT_NAMES.every((n) => captured[n]) || captureTries >= 3) return;
    captureTries++;
    try {
      const files = await o.api.listOutputs(sessionId);
      for (const name of SNAPSHOT_NAMES) {
        const f = files.filter((x) => x.filename === name).at(-1);
        if (f && !captured[name]) captured[name] = await o.api.download(f.id);
      }
    } catch {
      // The stream matters more than the capture; analyzeFreeze falls back without it.
    }
  };

  const result = await runSession({
    api: o.api,
    session: {
      agentId: o.lock.agentId,
      agentVersion: o.lock.agentVersion,
      environmentId: o.lock.environmentId,
      model: o.model,
      kitFileId: kit.fileId,
      skills: o.skills,
      ...(o.brief ? { system: o.brief.system, tools: o.brief.tools } : {}),
      budgetCents: o.budgetCents,
      title: `make: ${o.request.slice(0, 60)}`,
      metadata: { maker: o.maker, origin: o.origin ?? "cabinet", via: "studio-cli" },
    },
    request: o.request,
    maker: o.maker,
    withPlayer: o.withPlayer ?? null,
    answerer: o.answerer,
    ui,
    now,
    onEvent: captureSnapshot,
  });

  // Keep everything first (D43): answers and the raw session result.
  const sessionDir = path.join(o.paths.sessions, result.sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });
  const answers = {
    request: o.request,
    maker: o.maker,
    questions: result.turns.filter((t) => !t.auto).map(recordedAnswer),
    plan: result.planTurns.map((p) => (p.choice === "change" ? { choice: "change", said: p.said } : { choice: "build" })),
  };
  writeJson(path.join(sessionDir, "answers.json"), answers);
  if (o.recordFile) writeJson(o.recordFile, answers);
  const { events, ...rest } = result;
  writeJson(path.join(sessionDir, "session.json"), rest);
  for (const [name, body] of Object.entries(captured)) {
    fs.mkdirSync(path.join(sessionDir, "frozen"), { recursive: true });
    fs.writeFileSync(path.join(sessionDir, "frozen", name), body);
  }
  fs.writeFileSync(path.join(sessionDir, "events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + (events.length ? "\n" : ""));

  ui.progress("Bringing your game home");
  const dl = await downloadOutputs({ api: o.api, sessionId: result.sessionId, dir: path.join(sessionDir, "outputs"), ...o.outputs });
  const report = readJsonIfExists(path.join(dl.dir, "report.json"));

  let cartDir = null;
  let spec = null;
  let cartJson = null;
  if (dl.files.includes("cart.tgz")) {
    cartDir = extractCart(path.join(dl.dir, "cart.tgz"), path.join(sessionDir, "cart"));
    spec = fs.existsSync(path.join(cartDir, "spec.md")) ? fs.readFileSync(path.join(cartDir, "spec.md"), "utf8") : null;
    cartJson = readJsonIfExists(path.join(cartDir, "cart.json"));
  } else if (dl.files.includes("spec.md")) {
    spec = fs.readFileSync(path.join(dl.dir, "spec.md"), "utf8");
  }

  const freeze = analyzeFreeze(events, {
    frozenChecks: readTextIfExists(path.join(dl.dir, "checks.frozen.js")),
    frozenSpec: readTextIfExists(path.join(dl.dir, "spec.frozen.md")),
    finalChecks: cartDir ? readTextIfExists(path.join(cartDir, "checks.js")) : null,
    finalSpec: spec,
    capturedChecks: captured["checks.frozen.js"]?.toString("utf8") ?? null,
    capturedSpec: captured["spec.frozen.md"]?.toString("utf8") ?? null,
    declared: Array.isArray(report?.check_changes) ? report.check_changes : null,
  });
  // D49: what the test can't prove, the kid checks. This goes in the cart's spec,
  // so it's validated and committed like any other rule. outputs/spec.md stays as sent.
  /** @type {{rule: string, from: string, words: string|null, text: string}[]} */
  let youCheckAdded = [];
  if (cartDir && spec != null) {
    const amended = addYouCheckRules(spec, questionsFor(freeze.checks_changed_after_playtest.rules));
    youCheckAdded = amended.added;
    if (youCheckAdded.length) {
      spec = amended.text;
      fs.writeFileSync(path.join(cartDir, "spec.md"), spec);
    }
  }
  for (const line of buildSummary(freeze.checks_changed_after_playtest, youCheckAdded)) ui.info(line);

  /** @type {any} */
  let validation = null;
  /** @type {any} */
  let local = null;
  if (cartDir) {
    ui.progress("Checking your game here at home");
    validation = await o.checker.validate(cartDir);
    local = await o.checker.playtest(cartDir);
    if (local.report) writeJson(path.join(cartDir, "playtest.json"), local.report);
    writeJson(path.join(sessionDir, "local-checks.json"), { validation, playtest: local });
  }


  const passed = Boolean(cartDir && validation?.ok && local?.ok);
  const commit = Boolean(cartDir && (passed || o.commitAnyway));
  /** @type {{id: string, dir: string, commit: string}|null} */
  let committed = null;
  const created = now().toISOString();
  if (commit && cartDir) {
    const title = cartJson?.title || specTitle(spec) || "cart";
    committed = commitNewCart({
      root: o.paths.carts,
      cartDir,
      cartJson: {
        ...(cartJson ?? {}),
        title,
        version: 1,
        maker: o.maker,
        with: o.withPlayer ?? null,
        parent: null,
        session_id: result.sessionId,
        origin: o.origin ?? "cabinet",
        created,
      },
      message: `make {id} v1 (${result.sessionId}${passed ? "" : ", checks not passing"})`,
    });
    appendLog(o.paths.logs, "cart_version", {
      cart_id: committed.id,
      version: 1,
      parent: null,
      session_id: result.sessionId,
      commit: committed.commit,
      created,
    });
  }

  const outcome = committed ? (passed ? "committed" : "committed_failing") : cartDir ? "checks_failed" : "no_cart";
  const record = {
    id: result.sessionId,
    origin: o.origin ?? "cabinet",
    maker: o.maker,
    with: o.withPlayer ?? null,
    request: o.request,
    model: o.model ?? "agent-default",
    agent: { id: o.lock.agentId, version: o.lock.agentVersion ?? null },
    kit: kit.hash,
    turns: result.turns.map(({ question, option_a, option_b, choice, said }) => ({ question, option_a, option_b, choice, said })),
    plan_turns: result.planTurns,
    questions: result.turns.filter((t) => !t.auto).length,
    ended_by: result.endedBy,
    spec_diff: newSpecDiff(spec),
    context_pack: o.contextPack ?? "tarball",
    started_from: typeof report?.started_from === "string" ? report.started_from : null,
    brief: o.brief ? "file-override" : "applied-agent",
    brief_check: briefCheck,
    first_playtest: freeze.first_playtest,
    playtest_runs: freeze.playtest_runs,
    edits_after_first_playtest: freeze.edits_after_first_playtest,
    checks_changed_after_playtest: freeze.checks_changed_after_playtest,
    you_check_added: youCheckAdded,
    playtest: {
      sandbox: report ? { status: report.status ?? null, rules: report.rules ?? [], fix_rounds: report.fix_rounds ?? null } : null,
      local: local ? { ok: local.ok, unavailable: local.unavailable ?? false, failing: local.failing ?? [] } : null,
      validate: validation,
    },
    // list_cost is rounded to whole cents, so a cheap session reads "0" (D19):
    // the raw token counts and active seconds are logged so cost can be recomputed.
    list_cost: result.usage?.list_cost ?? null,
    list_cost_usd: listCostUsd(result.usage),
    active_seconds: result.usage?.active_seconds ?? null,
    tokens: result.usage
      ? {
          input: result.usage.input_tokens ?? null,
          output: result.usage.output_tokens ?? null,
          cache_read: result.usage.cache_read_input_tokens ?? null,
          cache_creation: result.usage.cache_creation ?? null,
        }
      : null,
    usage: result.usage,
    wall_seconds: result.wallSeconds,
    started_at: result.startedAt,
    ended_at: result.endedAt,
    stop_reason: result.stopReason,
    outcome,
    cart_id: committed?.id ?? null,
    cart_version: committed ? 1 : null,
    commit: committed?.commit ?? null,
    outputs_complete: dl.complete,
    missing_outputs: dl.missing,
    errors: result.errors,
    notes: result.notes,
    replay_log: o.answerer.replayLog?.() ?? null,
  };
  appendLog(o.paths.logs, "studio_session", record);

  if (committed) ui.info(`Your game is ready: ${committed.id} (${committed.dir})`);
  else if (cartDir) ui.info(`The game didn't pass its checks, so it wasn't added. Everything is kept in ${sessionDir}`);
  else ui.info(`No game came back (${result.stopReason || "unknown"}). Everything is kept in ${sessionDir}`);
  return { record, sessionDir, committed };
}

/**
 * The test changes a person should see at the end of a build (D46).
 * @param {{rules: any[], helpers_unjustified: boolean, changed: boolean, rules_known: boolean, edit_events: number, helpers_narrowed?: boolean}} c
 * @param {{rule: string, from: string, words: string|null}[]} [added] the you-check rules added for it (D49)
 */
export function buildSummary(c, added = []) {
  const lines = [];
  for (const r of c.rules) {
    if (r.classification === "check_bug") lines.push(`Test fixed, rule unchanged: ${r.rule} "${r.quote}". ${r.what ?? ""}`.trim());
    if (r.classification === "rule_change") lines.push(`Rule changed: ${r.rule}${r.shown_in_plan ? "" : " (not shown in the plan)"}. ${r.what ?? ""}`.trim());
    if (r.classification === "unexplained") lines.push(`Test changed with no explanation: ${r.rule}. ${r.what ?? ""}`.trim());
    if (r.narrowed) {
      const said = (r.untested ?? []).map((u) => `"${u.words}"`).join(", ");
      const asked = added.filter((a) => a.from === r.rule).map((a) => a.rule).join(", ");
      const then = asked ? ` You check it on first play: ${asked}.` : "";
      lines.push(said ? `Test proves less: ${r.rule} no longer tests ${said}.${then}` : `Test may prove less: ${r.rule}, and it doesn't say what.${then}`);
    }
  }
  if (c.helpers_narrowed) lines.push("Shared test code may prove less. Worth reading.");
  if (c.helpers_unjustified) lines.push("Shared test code changed with no explanation.");
  if (c.changed && !c.rules_known) lines.push(`Tests were changed (${c.edit_events} edits), but it can't be said which: the starting copy wasn't kept.`);
  return lines;
}

function readTextIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}
