#!/usr/bin/env node
// studio: the terminal stand-in for the cabinet's MAKE flow (phase-0 task 8).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import readline from "node:readline/promises";
import { parseArgs } from "node:util";
import { createClient } from "../src/client.js";
import { sdkApi } from "../src/api.js";
import { MANAGED_AGENT_DIR, dataDir, dataPaths, readAgentDef, readLock, readSkillLock } from "../src/config.js";
import { ensureKitUploaded } from "../src/kit.js";
import { liveAnswerer, loadAnswers, replayAnswerer } from "../src/answers.js";
import { defaultChecker } from "../src/checks.js";
import { makeCart } from "../src/make.js";
import { reanalyzeSession } from "../src/reanalyze.js";
import { checkAppliedBrief, staleMessage } from "../src/brief.js";
import { buildKit, NO_TEMPLATES_KIT, SKILL_KIT, stageContextPackSkill } from "../../managed-agent/scripts/pack-kit.js";

const USAGE = `usage:
  studio make "<request>" --maker A [--with O] [--model ID] [--answers FILE] [--record FILE]
                          [--budget-cents 300] [--context-pack tarball|no-templates|skill] [--brief-from-file] [--applied-brief]
                          [--replay-unmatched D|A]
                          [--commit-anyway] [--verbose]
  studio kit [--upload]            build the studio kit tarball (and upload it once)
  studio skill --upload            create the context-pack skill through the API
  studio check-brief               does the applied agent match agents/studio.md?
  studio reanalyze <session> "<why>"   redo the D44 analysis; appends a correction record
  studio fork <cart> "<change>"    stretch goal (task 11), not built yet

Data goes to $GSA_DATA_DIR or ~/game-studio-data (D14).`;

async function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === "make") return make(rest);
  if (cmd === "kit") return kit(rest);
  if (cmd === "skill") return skill(rest);
  if (cmd === "reanalyze") return reanalyze(rest);
  if (cmd === "check-brief") return checkBrief();
  if (cmd === "fork") {
    console.error("studio fork isn't built yet (phase-0 task 11, stretch).");
    return 2;
  }
  console.error(USAGE);
  return cmd ? 2 : 0;
}

async function make(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      maker: { type: "string" },
      with: { type: "string" },
      model: { type: "string" },
      answers: { type: "string" },
      record: { type: "string" },
      "budget-cents": { type: "string", default: "300" },
      "context-pack": { type: "string", default: "tarball" },
      "brief-from-file": { type: "boolean", default: false },
      "applied-brief": { type: "boolean", default: false },
      "replay-unmatched": { type: "string", default: "D" },
      "commit-anyway": { type: "boolean", default: false },
      verbose: { type: "boolean", short: "v", default: false },
    },
  });
  const recorded = values.answers ? loadAnswers(values.answers) : null;
  const request = positionals.join(" ").trim() || recorded?.request;
  const maker = values.maker || recorded?.maker;
  if (!request || !maker) {
    console.error(USAGE);
    return 2;
  }
  const budgetCents = Number(values["budget-cents"]);
  const unmatched = values["replay-unmatched"];
  if (unmatched !== "A" && unmatched !== "D") {
    console.error("--replay-unmatched must be A or D");
    return 2;
  }
  const contextPack = /** @type {"tarball"|"no-templates"|"skill"} */ (values["context-pack"]);
  if (contextPack !== "tarball" && contextPack !== "no-templates" && contextPack !== "skill") {
    console.error("--context-pack must be tarball, no-templates or skill");
    return 2;
  }
  const kitVariant = contextPack === "skill" ? SKILL_KIT : contextPack === "no-templates" ? NO_TEMPLATES_KIT : null;
  const skills = contextPack === "skill" ? [readSkillLock()] : undefined;
  const paths = dataPaths(dataDir());
  const lock = readLock();
  const api = sdkApi(await createClient());
  const print = (s) => console.log(s);
  const rl = recorded ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
  const answerer = recorded ? replayAnswerer(recorded, { print, unmatched }) : liveAnswerer({ prompt: (q) => /** @type {readline.Interface} */ (rl).question(q), print });
  try {
    const { record } = await makeCart({
      api,
      request,
      maker,
      withPlayer: values.with ?? null,
      model: values.model,
      budgetCents,
      answerer,
      checker: defaultChecker(),
      paths,
      lock,
      contextPack,
      skills,
      // D173: the applied agent, checked against the repo. --brief-from-file overrides it for this
      // build; --applied-brief runs it even if it's stale.
      brief: values["brief-from-file"] ? readAgentDef() : undefined,
      allowStaleBrief: values["applied-brief"],
      kit: () =>
        ensureKitUploaded({
          api,
          cacheFile: paths.kitUploads,
          out: path.join(MANAGED_AGENT_DIR, contextPack === "tarball" ? "dist/studio-kit.tgz" : `dist/studio-kit-${contextPack}.tgz`),
          build: kitVariant ? (o) => buildKit({ ...o, ...kitVariant }) : undefined,
          log: values.verbose ? print : undefined,
        }),
      commitAnyway: values["commit-anyway"],
      recordFile: values.record,
      ui: {
        progress: (s) => console.log(`  … ${s}`),
        info: print,
        debug: values.verbose ? (s) => console.error(`[debug] ${s}`) : undefined,
      },
    });
    const cost = record.list_cost_usd == null ? "unknown" : `$${record.list_cost_usd.toFixed(2)}`;
    console.log(`\n${record.outcome}: ${record.questions} questions, ended by ${record.ended_by}, ${record.wall_seconds}s, list cost ${cost}`);
    return record.outcome === "committed" ? 0 : 1;
  } finally {
    rl?.close();
  }
}

async function kit(args) {
  const { values } = parseArgs({ args, options: { upload: { type: "boolean", default: false } } });
  const out = path.join(MANAGED_AGENT_DIR, "dist/studio-kit.tgz");
  if (!values.upload) {
    const r = buildKit({ out });
    console.log(`kit ${r.hash.slice(0, 12)}: ${r.fileCount} files, ${r.bytes} bytes -> ${r.out}`);
    if (r.missing.length) console.log(`not in the kit yet: ${r.missing.join(", ")}`);
    return 0;
  }
  const api = sdkApi(await createClient());
  const r = await ensureKitUploaded({ api, cacheFile: dataPaths(dataDir()).kitUploads, out, log: console.log });
  console.log(r.fileId);
  return 0;
}

async function checkBrief() {
  const check = await checkAppliedBrief({ api: sdkApi(await createClient()), lock: readLock(), def: readAgentDef() });
  console.log(check.match ? `The applied Studio agent (v${check.agent_version}) matches agents/studio.md.` : staleMessage(check));
  return check.match ? 0 : 1;
}

async function reanalyze(args) {
  const [session, why] = args;
  if (!session || !why) {
    console.error(USAGE);
    return 2;
  }
  console.log(JSON.stringify(reanalyzeSession({ paths: dataPaths(dataDir()), session, why }), null, 2));
  return 0;
}

/** The experiment's skill, made through the API (D45). Never replaces an existing one. */
async function skill(args) {
  const { values } = parseArgs({ args, options: { upload: { type: "boolean", default: false } } });
  const lockFile = path.join(MANAGED_AGENT_DIR, "claude-lock.skill.json");
  if (!values.upload) {
    console.error(USAGE);
    return 2;
  }
  if (fs.existsSync(lockFile)) {
    console.log(`already created: ${JSON.stringify(readSkillLock(lockFile))}`);
    return 0;
  }
  // Outside this folder, or a later `ant apply .` would find it and create a second skill (D173).
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-skill-"));
  const staged = stageContextPackSkill({ outDir: stageDir });
  const zip = path.join(MANAGED_AGENT_DIR, "dist/studio-context-pack.zip");
  fs.mkdirSync(path.dirname(zip), { recursive: true });
  fs.rmSync(zip, { force: true });
  execFileSync("zip", ["-q", "-r", zip, "studio-context-pack", "-x", "*/.*"], { cwd: stageDir });
  const api = sdkApi(await createClient());
  const created = await /** @type {NonNullable<typeof api.createSkill>} */ (api.createSkill)(zip, "studio-context-pack.zip");
  const entry = { kind: "skill", id: created.id, version: created.latest_version_id, via: "skills.create (ant was unavailable)", files: staged.files };
  fs.writeFileSync(lockFile, JSON.stringify({ version: 1, resources: { "./skills-staged/studio-context-pack": entry } }, null, 2) + "\n");
  console.log(JSON.stringify(entry));
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code ?? 0),
  (err) => {
    console.error(`studio: ${err?.message ?? err}`);
    process.exit(1);
  },
);
