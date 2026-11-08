// `studio make`: one new cart from a request, end to end (phase-0 task 8, D43).
import fs from "node:fs";
import path from "node:path";
import { runSession, listCostUsd } from "./driver.js";
import { downloadOutputs, extractCart, readJsonIfExists } from "./outputs.js";
import { commitNewCart, specTitle } from "./library.js";
import { appendLog, newSpecDiff } from "./log.js";
import { analyzeFreeze } from "./freeze.js";

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
 * @property {"tarball"|"skill"} [contextPack]   how this run got the context pack (D45)
 * @property {{type: string, skill_id: string, version?: string}[]} [skills]   session-level skills
 * @property {{system: string, tools: object[]}} [brief]   run this brief instead of the applied agent's
 * @property {string} [recordFile]     also write the answers here
 * @property {() => Date} [now]
 * @property {{tries?: number, waitMs?: number, sleep?: (ms: number) => Promise<void>}} [outputs]
 */

/** @param {MakeOptions} o */
export async function makeCart(o) {
  const now = o.now ?? (() => new Date());
  const ui = o.ui;
  const kit = await o.kit();

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
  });

  // Keep everything first (D43): answers and the raw session result.
  const sessionDir = path.join(o.paths.sessions, result.sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });
  const answers = {
    request: o.request,
    maker: o.maker,
    questions: result.turns.filter((t) => !t.auto).map((t) => (t.choice === "C" ? { choice: "C", said: t.said } : { choice: t.choice })),
    plan: result.planTurns.map((p) => (p.choice === "change" ? { choice: "change", said: p.said } : { choice: "build" })),
  };
  writeJson(path.join(sessionDir, "answers.json"), answers);
  if (o.recordFile) writeJson(o.recordFile, answers);
  const { events, ...rest } = result;
  writeJson(path.join(sessionDir, "session.json"), rest);
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

  const freeze = analyzeFreeze(events, {
    frozenChecks: readTextIfExists(path.join(dl.dir, "checks.frozen.js")),
    frozenSpec: readTextIfExists(path.join(dl.dir, "spec.frozen.md")),
    finalChecks: cartDir ? readTextIfExists(path.join(cartDir, "checks.js")) : null,
    finalSpec: spec,
  });
  if (freeze.checks_changed_after_playtest.unjustified.length) {
    ui.info(`Checks changed with no spec change: ${freeze.checks_changed_after_playtest.unjustified.join(", ")} (D44)`);
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
    brief: o.brief ? "file-override" : "applied-agent",
    first_playtest: freeze.first_playtest,
    playtest_runs: freeze.playtest_runs,
    edits_after_first_playtest: freeze.edits_after_first_playtest,
    checks_changed_after_playtest: freeze.checks_changed_after_playtest,
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
  };
  appendLog(o.paths.logs, "studio_session", record);

  if (committed) ui.info(`Your game is ready: ${committed.id} (${committed.dir})`);
  else if (cartDir) ui.info(`The game didn't pass its checks, so it wasn't added. Everything is kept in ${sessionDir}`);
  else ui.info(`No game came back (${result.stopReason || "unknown"}). Everything is kept in ${sessionDir}`);
  return { record, sessionDir, committed };
}

function readTextIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}
