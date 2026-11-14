// `studio make`: one new cart from a request, end to end (phase-0 task 8, D43).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { runSession, listCostUsd } from "./driver.js";
import { downloadOutputs, extractCart, readJsonIfExists } from "./outputs.js";
import { commitNewCart, specTitle, slugify } from "./library.js";
import { appendLog, newSpecDiff } from "./log.js";
import { analyzeFreeze, isPlaytestRun, SNAPSHOT_NAMES } from "./freeze.js";
import { addYouCheckRules, questionsFor } from "./untested.js";
import { checkAppliedBrief, staleMessage } from "./brief.js";
import { readAgentDef } from "./config.js";
import { writeFileDurable } from "./durable.js";
import { cleanVersionName, nameChangelogLine, versionNameTaken } from "@game-studio-arcade/spec";

/**
 * @typedef {object} MakeOptions
 * @property {import("./api.js").StudioApi} api
 * @property {string} request
 * @property {string} maker
 * @property {string|null} [withPlayer]
 * @property {string} [model]
 * @property {number} budgetCents
 * @property {import("./answers.js").Answerer} answerer
 * @property {{progress: (s: string, stage?: number | null) => void, info: (s: string) => void, debug?: (s: string) => void, usage?: (u: any) => void, named?: (name: string | null) => void}} ui
 * @property {import("./checks.js").Checker} checker
 * @property {ReturnType<typeof import("./config.js").dataPaths>} paths
 * @property {{agentId: string, agentVersion?: number, environmentId: string}} lock
 * @property {() => Promise<{fileId: string, hash: string}>} kit
 * @property {"cabinet"|"desktop"} [origin]
 * @property {boolean} [commitAnyway]
 * @property {"tarball"|"no-templates"|"skill"} [contextPack]   how this run got the library (D45, D166)
 * @property {{type: string, skill_id: string, version?: string}[]} [skills]   session-level skills
 * @property {{system: string, tools: object[]}} [brief]   run this brief instead of the applied agent's
 * @property {{sessionId: string, kitHash?: string|null}} [resume]   collect a session a restart cut off, rather than start one (D191)
 * @property {boolean} [allowStaleBrief]   run the applied agent even if it differs from the repo (D173)
 * @property {{system: string, tools: any[]}} [repoBrief]   what the applied agent should match; default agents/studio.md
 * @property {Parent} [parent]   a change to this game, rather than a new one (§8.2, D206)
 * @property {string} [recordFile]     also write the answers here
 * @property {() => Date} [now]
 * @property {{tries?: number, waitMs?: number, sleep?: (ms: number) => Promise<void>}} [outputs]
 */

/**
 * The game a change starts from (§8.2, D206). The maker's own change is the next
 * version of the same game; anyone else's is their own version, a new branch.
 * `version_name` is what the parent version is called, and `names` every name its line has used (D471).
 * @typedef {{ id: string, dir: string, version: number, maker: string | null, family?: string | null, branch?: string | null, title: string, session_id?: string | null, version_name?: string | null, names?: string[] }} Parent
 */

/**
 * The names a new version of this game can't take (D473): the game's title, and every name its line has used.
 * Null when the version gets no name: a new game, or a maker's own version of someone else's (it takes its title).
 * @param {Parent | null | undefined} parent @param {ReturnType<typeof changeTarget> | null} target
 * @returns {{ taken: string[] } | null}
 */
export function namingFor(parent, target) {
  if (!parent || !target?.ownVersion) return null;
  return { taken: [parent.title, ...(parent.names ?? []), ...(parent.version_name ? [parent.version_name] : [])] };
}

/** Where the parent cart is mounted in the session (agents/studio.md, Forks). */
export const PARENT_MOUNT = "/mnt/session/uploads/parent.tgz";

/**
 * The version a change makes, and the line it's on.
 * @param {Parent} parent @param {string} maker
 * @returns {{ version: number, ownVersion: boolean, family: string, branch: string | null }}
 *   branch null: this change starts a new branch, whose id is the new cart's own.
 */
export function changeTarget(parent, maker) {
  const family = parent.family ?? parent.id;
  const own = parent.maker != null && parent.maker === maker;
  return own ? { version: parent.version + 1, ownVersion: true, family, branch: parent.branch ?? parent.id } : { version: 1, ownVersion: false, family, branch: null };
}

/** The message that starts a change: the brief's Forks section reads it. @param {{request: string, maker: string, withPlayer?: string|null, parent: Parent, target: ReturnType<typeof changeTarget>}} o */
export function changeMessage(o) {
  const used = [...new Set([...(o.parent.names ?? []), ...(o.parent.version_name ? [o.parent.version_name] : [])])];
  const lines = [
    "Change request from the cabinet: this is a fork.",
    `Parent cart: ${o.parent.id}, version ${o.parent.version}, "${o.parent.title}"${o.parent.maker ? ` by ${o.parent.maker}` : " (a starter game)"}.`,
    `The parent cart is mounted at ${PARENT_MOUNT}: extract it with \`mkdir -p /workspace/cart && tar -xzf ${PARENT_MOUNT} -C /workspace/cart\`. Its earlier questions and answers, if any, are in earlier-turns.json there; delete that file from /workspace/cart before packing.`,
    o.target.ownVersion
      ? `This makes version ${o.target.version} of the same game, by the same maker. Add a Changelog line under v${o.target.version}.`
      : `This makes the maker's own version: a new game that starts from the parent's spec. Keep the parent's rules unless the change says otherwise. Add a Changelog line under v1 saying it started from ${o.parent.id} v${o.parent.version}.`,
    ...(o.target.ownVersion
      ? [`This version gets a name: call name_version once the player says build.${used.length ? ` Names this game has already used: ${used.map((n) => `"${n}"`).join(", ")}.` : ""}`]
      : ["This version goes by the game's title: don't call name_version."]),
    `Maker: ${o.maker}${o.withPlayer ? ` (with ${o.withPlayer})` : ""}`,
    "What the player wants changed (speech-to-text transcript, their own words):",
    `"${o.request}"`,
  ];
  return { type: "user.message", content: [{ type: "text", text: lines.join("\n") }] };
}

/** Pack the parent for the session: its folder, plus its earlier turns. @param {Parent} parent @param {string} sessionsDir */
function packParent(parent, sessionsDir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gsa-parent-"));
  const stage = path.join(tmp, "cart");
  fs.cpSync(parent.dir, stage, { recursive: true, filter: (src) => path.basename(src) !== "playtest-frames" });
  const answers = parent.session_id ? path.join(sessionsDir, parent.session_id, "answers.json") : null;
  if (answers && fs.existsSync(answers)) fs.copyFileSync(answers, path.join(stage, "earlier-turns.json"));
  const tgz = path.join(tmp, "parent.tgz");
  execFileSync("tar", ["-czf", tgz, "-C", stage, "."], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  return tgz;
}

/** The spec lines a change removed and added, for the record. @param {string|null} before @param {string|null} after */
export function specChange(before, after) {
  if (after == null) return null;
  const a = String(before ?? "").replace(/\n$/, "").split("\n");
  const b = String(after).replace(/\n$/, "").split("\n");
  const inA = new Set(a);
  const inB = new Set(b);
  return [`--- parent/spec.md`, `+++ spec.md`, ...a.filter((l) => !inB.has(l)).map((l) => `-${l}`), ...b.filter((l) => !inA.has(l)).map((l) => `+${l}`)].join("\n");
}

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
  if (!o.brief && !o.resume) {
    briefCheck = await checkAppliedBrief({ api: o.api, lock: o.lock, def: o.repoBrief ?? readAgentDef() });
    if (!briefCheck.match) {
      if (!o.allowStaleBrief) throw new Error(staleMessage(briefCheck));
      ui.info(`Running an applied brief that differs from the repo, as asked: ${briefCheck.diffs.join(", ")}.`);
    }
  }
  const kit = o.resume ? { fileId: "", hash: o.resume.kitHash ?? null } : await o.kit();
  const target = o.parent ? changeTarget(o.parent, o.maker) : null;
  const naming = namingFor(o.parent, target);
  /** @type {{fileId: string, mountPath: string}[]} */
  const extraFiles = [];
  if (o.parent && !o.resume) {
    const up = await o.api.uploadFile(packParent(o.parent, o.paths.sessions), "parent.tgz");
    extraFiles.push({ fileId: up.id, mountPath: PARENT_MOUNT });
  }

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
      ...(extraFiles.length ? { extraFiles } : {}),
      skills: o.skills,
      ...(o.brief ? { system: o.brief.system, tools: o.brief.tools } : {}),
      budgetCents: o.budgetCents,
      title: `${o.parent ? `change ${o.parent.id}` : "make"}: ${o.request.slice(0, 60)}`,
      metadata: { maker: o.maker, origin: o.origin ?? "cabinet", via: "studio-cli", ...(o.parent ? { parent: `${o.parent.id}@${o.parent.version}` } : {}) },
    },
    ...(o.parent && target ? { message: changeMessage({ request: o.request, maker: o.maker, withPlayer: o.withPlayer, parent: o.parent, target }) } : {}),
    request: o.request,
    maker: o.maker,
    withPlayer: o.withPlayer ?? null,
    answerer: o.answerer,
    ui,
    now,
    onEvent: captureSnapshot,
    resume: o.resume,
    naming,
  });
  // Nothing here says the session has ended, so there's nothing to collect yet: try again later.
  if (o.resume && result.stopReason === "stream_lost") throw new Error("the stream was lost while picking the session back up");

  // Keep everything first (D43): answers and the raw session result.
  const sessionDir = path.join(o.paths.sessions, result.sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });
  const answers = {
    request: o.request,
    maker: o.maker,
    questions: result.turns.filter((t) => !t.auto).map(recordedAnswer),
    plan: result.planTurns.map((p) => (p.choice === "change" ? { choice: "change", said: p.said } : { choice: "build" })),
    ...(result.nameTurn ? { name: { choice: result.nameTurn.choice, ...(result.nameTurn.said ? { said: result.nameTurn.said } : {}) } } : {}),
  };
  writeJson(path.join(sessionDir, "answers.json"), answers);
  if (o.recordFile) writeJson(o.recordFile, answers);
  const { events, ...rest } = result;
  writeJson(path.join(sessionDir, "session.json"), rest);
  for (const [name, body] of Object.entries(captured)) {
    fs.mkdirSync(path.join(sessionDir, "frozen"), { recursive: true });
    writeFileDurable(path.join(sessionDir, "frozen", name), body);
  }
  writeFileDurable(path.join(sessionDir, "events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + (events.length ? "\n" : ""));

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
    fs.rmSync(path.join(cartDir, "earlier-turns.json"), { force: true });
  } else if (dl.files.includes("spec.md")) {
    spec = fs.readFileSync(path.join(dl.dir, "spec.md"), "utf8");
  }

  // The version's name (D471-D473): the answer on the name question, or, when the player's own words needed
  // shortening, what the agent wrote in cart.json. Cleaned here, so a bad name never fails a kid's game: the
  // version just shows by its number. It goes in cart.json and on the spec's Changelog line.
  const version = target?.version ?? 1;
  /** @type {string | null} */
  let versionName = null;
  if (naming) {
    const written = cleanVersionName(cartJson?.version_name, { cut: true });
    versionName = result.nameTurn?.name ?? (written && !versionNameTaken(written, naming.taken) ? written : null);
  }
  if (cartDir && cartJson && (cartJson.version_name ?? null) !== versionName) {
    const { version_name: _, ...rest } = cartJson;
    cartJson = versionName ? { ...rest, version_name: versionName } : rest;
    writeFileDurable(path.join(cartDir, "cart.json"), JSON.stringify(cartJson, null, 2) + "\n");
  }
  if (cartDir && spec != null && versionName) {
    const named = nameChangelogLine(spec, version, versionName);
    if (named !== spec) {
      spec = named;
      writeFileDurable(path.join(cartDir, "spec.md"), spec);
    }
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
      writeFileDurable(path.join(cartDir, "spec.md"), spec);
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
  const parentRef = o.parent ? `${o.parent.id}@${o.parent.version}` : null;
  if (commit && cartDir) {
    const title = cartJson?.title || specTitle(spec) || o.parent?.title || "cart";
    // A version is a new folder; the parent is never touched (D5, D206).
    const wantedId = o.parent && target?.ownVersion ? `${slugify(target.branch ?? o.parent.id).replace(/-v\d+$/, "")}-v${version}` : o.parent ? title : cartJson?.id || title;
    committed = commitNewCart({
      root: o.paths.carts,
      cartDir,
      cartJson: {
        ...(cartJson ?? {}),
        id: wantedId,
        title,
        version,
        ...(versionName ? { version_name: versionName } : {}),
        maker: o.maker,
        with: o.withPlayer ?? null,
        parent: parentRef,
        // A new branch is its own line: whatever the parent's cart.json said goes (undefined is left out).
        family: target?.family, branch: target?.branch ?? undefined,
        session_id: result.sessionId,
        origin: o.origin ?? "cabinet",
        created,
      },
      message: `${o.parent ? `change ${parentRef} ->` : "make"} {id} v${version} (${result.sessionId}${passed ? "" : ", checks not passing"})`,
    });
    appendLog(o.paths.logs, "cart_version", {
      cart_id: committed.id,
      version,
      // The name and who picked it (D472): a tile, the maker's own words, or Claude on "You pick".
      ...(versionName ? { version_name: versionName, named_by: o.maker, name_picked: result.nameTurn?.picked ?? "claude" } : {}),
      parent: parentRef,
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
    // The name question as asked and answered, and the name the version got (D471).
    version_name: versionName,
    name_turn: result.nameTurn,
    questions: result.turns.filter((t) => !t.auto).length,
    ended_by: result.endedBy,
    kind: o.parent ? "change" : "new",
    parent: parentRef,
    spec_diff: o.parent ? specChange(readTextIfExists(path.join(o.parent.dir, "spec.md")), spec) : newSpecDiff(spec),
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
      // On a cabinet, `gate` is the publish gate's run: where, how long, and each failure's reason (D310).
      local: local ? { ok: local.ok, unavailable: local.unavailable ?? false, failing: local.failing ?? [], ...(local.gate ? { gate: local.gate } : {}) } : null,
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
    cart_version: committed ? version : null,
    commit: committed?.commit ?? null,
    outputs_complete: dl.complete,
    missing_outputs: dl.missing,
    errors: result.errors,
    notes: result.notes,
    replay_log: o.answerer.replayLog?.() ?? null,
    ...(o.resume ? { resumed_after_restart: true } : {}),
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

// A session's record survives a power cut whole, or not at all (D371).
function writeJson(file, data) {
  writeFileDurable(file, JSON.stringify(data, null, 2) + "\n");
}
