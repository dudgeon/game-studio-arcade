// Measures speech on test clips through the cabinet's own engine code (D265): word error rate and latency.
//
//   node bench.mjs CLIPS_DIR [--engine moonshine|groq|chain] [--speech FILE] [--config FILE] [--groq-url URL] [--pace MS]
//
// moonshine (default): Moonshine on the cabinet, from provisioning's speech.json.
// groq: Groq alone, with the key from the cabinet's config (run as arcade: the file is 0600). About $0.0001 a clip.
// chain: what a hold does, Groq first and Moonshine when Groq can't (D263); --groq-url to an unreachable
//   address shows the fallback without touching the cabinet's network. Prints which engine answered each clip.
// CLIPS_DIR holds 16 kHz mono WAVs, each with its words in a .txt beside it (scripts/speech/make-clips.sh).
// Prints one line per clip and a summary, overall and per voice (the clip name's part before the first "-").
// Never on kids' audio in the repo: their clips stay on the cabinet or the mini, and are deleted after.
// Never prints the key.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { groqEngine, liveSpeech, moonshineEngine, pcmOfWav, SPEECH_FILE } from "../src/speech-live.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    speech: { type: "string", default: SPEECH_FILE },
    config: { type: "string", default: "/etc/arcade/service.json" },
    engine: { type: "string", default: "moonshine" },
    "groq-url": { type: "string" },
    // Groq's free tier allows about 20 transcriptions a minute: --pace 3500 stays under it.
    pace: { type: "string", default: "0" },
    quiet: { type: "boolean", default: false },
  },
});
const dir = positionals[0];
if (!dir || !["moonshine", "groq", "chain"].includes(/** @type {string} */ (values.engine))) {
  console.error("usage: node bench.mjs CLIPS_DIR [--engine moonshine|groq|chain] [--speech FILE] [--config FILE] [--groq-url URL]");
  process.exit(2);
}

/** @type {any} */
let moon = null;
if (values.engine !== "groq") {
  const s = JSON.parse(fs.readFileSync(/** @type {string} */ (values.speech), "utf8"));
  moon = moonshineEngine({ python: s.python, helper: s.helper, modelDir: s.model_dir, arch: s.arch, log: (m) => console.log(m) });
  const t0 = Date.now();
  if (!(await moon.ready)) {
    console.error("Moonshine didn't start");
    process.exit(1);
  }
  console.log(`Moonshine ${s.arch} started in ${Date.now() - t0} ms`);
}
/** @type {any} */
let groq = null;
if (values.engine !== "moonshine") {
  const key = JSON.parse(fs.readFileSync(/** @type {string} */ (values.config), "utf8")).groq_api_key;
  if (!key) {
    console.error(`no groq_api_key in ${values.config}`);
    process.exit(1);
  }
  groq = groqEngine({ key, url: values["groq-url"] });
  console.log(`Groq whisper-large-v3-turbo${values["groq-url"] ? ` at ${values["groq-url"]}` : ""}`);
}

/** The engine that answered each clip, for the chain. */
let answered = "";
/** @type {(pcm: Buffer) => Promise<string>} */
let transcribe;
let logFile = "";
if (values.engine === "chain") {
  // The service's own chain, with a stand-in recorder that "hears" each clip, and its log in a temp folder.
  logFile = path.join(fs.mkdtempSync("/tmp/bench-speech-"), "speech.jsonl");
  /** @type {Buffer} */
  let next = Buffer.alloc(0);
  const chain = liveSpeech({ recorder: { start() {}, stop: async () => next }, engines: [groq, moon], logFile });
  transcribe = async (pcm) => {
    next = pcm;
    chain.start();
    const { text } = await chain.stop();
    const last = fs.readFileSync(logFile, "utf8").trim().split("\n").pop();
    const e = JSON.parse(/** @type {string} */ (last));
    answered = `${e.engine}${e.skipped?.length ? ` after ${e.skipped.join("; ")}` : ""}`;
    return text;
  };
} else {
  const e = groq ?? moon;
  transcribe = (pcm) => e.transcribe(pcm);
}

const NUM = "zero one two three four five six seven eight nine ten eleven twelve".split(" ");
/** @param {string} t */
const words = (t) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (/^\d+$/.test(w) && Number(w) < 13 ? NUM[Number(w)] : w));
/** Word-level edit distance. @param {string[]} r @param {string[]} h */
function edits(r, h) {
  let d = Array.from({ length: h.length + 1 }, (_, j) => j);
  for (let i = 1; i <= r.length; i++) {
    const n = [i];
    for (let j = 1; j <= h.length; j++) n[j] = Math.min(d[j] + 1, n[j - 1] + 1, d[j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
    d = n;
  }
  return d[h.length];
}

const clips = fs.readdirSync(dir).filter((f) => f.endsWith(".wav") && fs.existsSync(path.join(dir, f.replace(/\.wav$/, ".txt")))).sort();
/** @type {Record<string, [number, number]>} */
const byVoice = {};
/** @type {Record<string, number>} */
const byEngine = {};
let errs = 0;
let total = 0;
/** @type {number[]} */
const ms = [];
/** @type {number[]} */
const rtf = [];
for (const [i, f] of clips.entries()) {
  if (i && Number(values.pace)) await new Promise((r) => setTimeout(r, Number(values.pace)));
  const ref = fs.readFileSync(path.join(dir, f.replace(/\.wav$/, ".txt")), "utf8").trim();
  const pcm = pcmOfWav(fs.readFileSync(path.join(dir, f)));
  const audioMs = (pcm.length / 2 / 16000) * 1000;
  const t = performance.now();
  /** @type {string} */
  let hyp;
  try {
    hyp = await transcribe(Buffer.from(pcm));
  } catch (/** @type {any} */ e) {
    hyp = "";
    answered = `failed: ${e.name === "TimeoutError" ? "timed out" : e.message}`;
  }
  const took = performance.now() - t;
  const r = words(ref);
  const e = edits(r, words(hyp));
  errs += e;
  total += r.length;
  ms.push(took);
  rtf.push(took / audioMs);
  const v = f.split("-")[0];
  byVoice[v] ??= [0, 0];
  byVoice[v][0] += e;
  byVoice[v][1] += r.length;
  if (answered) byEngine[answered.split(" ")[0]] = (byEngine[answered.split(" ")[0]] ?? 0) + 1;
  if (!values.quiet) console.log(`${f}\t${Math.round(took)} ms\t${answered ? `${answered}\t` : ""}${e ? `${e} wrong: "${hyp}"` : "exact"}`);
}
moon?.close?.();
ms.sort((a, b) => a - b);
rtf.sort((a, b) => a - b);
const pct = (/** @type {number} */ a, /** @type {number} */ b) => `${((100 * a) / b).toFixed(1)}%`;
console.log(`\n${values.engine}: ${clips.length} clips, WER ${pct(errs, total)}, latency median ${Math.round(ms[ms.length >> 1])} ms, p90 ${Math.round(ms[Math.floor(ms.length * 0.9)])} ms, max ${Math.round(ms[ms.length - 1])} ms, ${rtf[rtf.length >> 1].toFixed(2)}x real time`);
console.log(`per voice: ${Object.entries(byVoice).map(([v, [a, b]]) => `${v} ${pct(a, b)}`).join(", ")}`);
if (Object.keys(byEngine).length) console.log(`answered by: ${Object.entries(byEngine).map(([k, n]) => `${k} ${n}`).join(", ")}`);
if (logFile) fs.rmSync(path.dirname(logFile), { recursive: true, force: true });
