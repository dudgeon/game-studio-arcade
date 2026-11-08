#!/usr/bin/env node
// studio: the terminal stand-in for the cabinet's MAKE flow (phase-0 task 8).
import path from "node:path";
import readline from "node:readline/promises";
import { parseArgs } from "node:util";
import { createClient } from "../src/client.js";
import { sdkApi } from "../src/api.js";
import { MANAGED_AGENT_DIR, dataDir, dataPaths, readLock, readSkillLock } from "../src/config.js";
import { ensureKitUploaded } from "../src/kit.js";
import { liveAnswerer, loadAnswers, replayAnswerer } from "../src/answers.js";
import { defaultChecker } from "../src/checks.js";
import { makeCart } from "../src/make.js";
import { buildKit, SKILL_KIT } from "../../managed-agent/scripts/pack-kit.js";

const USAGE = `usage:
  studio make "<request>" --maker A [--with O] [--model ID] [--answers FILE] [--record FILE]
                          [--budget-cents 300] [--context-pack tarball|skill] [--commit-anyway] [--verbose]
  studio kit [--upload]            build the studio kit tarball (and upload it once)
  studio fork <cart> "<change>"    stretch goal (task 11), not built yet

Data goes to $GSA_DATA_DIR or ~/game-studio-data (D14).`;

async function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === "make") return make(rest);
  if (cmd === "kit") return kit(rest);
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
  const contextPack = /** @type {"tarball"|"skill"} */ (values["context-pack"]);
  if (contextPack !== "tarball" && contextPack !== "skill") {
    console.error("--context-pack must be tarball or skill");
    return 2;
  }
  const skills = contextPack === "skill" ? [readSkillLock()] : undefined;
  const paths = dataPaths(dataDir());
  const lock = readLock();
  const api = sdkApi(await createClient());
  const print = (s) => console.log(s);
  const rl = recorded ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
  const answerer = recorded ? replayAnswerer(recorded, { print }) : liveAnswerer({ prompt: (q) => /** @type {readline.Interface} */ (rl).question(q), print });
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
      kit: () =>
        ensureKitUploaded({
          api,
          cacheFile: paths.kitUploads,
          out: path.join(MANAGED_AGENT_DIR, contextPack === "skill" ? "dist/studio-kit-skill.tgz" : "dist/studio-kit.tgz"),
          build: contextPack === "skill" ? (o) => buildKit({ ...o, ...SKILL_KIT }) : undefined,
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

main(process.argv.slice(2)).then(
  (code) => process.exit(code ?? 0),
  (err) => {
    console.error(`studio: ${err?.message ?? err}`);
    process.exit(1);
  },
);
