// Measures speech on test clips through the cabinet's own engine code (D265): word error rate and latency.
//
//   node bench.mjs CLIPS_DIR [--speech /opt/arcade/speech/speech.json]
//
// CLIPS_DIR holds 16 kHz mono WAVs, each with its words in a .txt beside it (scripts/speech/make-clips.sh).
// Prints one line per clip and a summary, overall and per voice (the clip name's part before the first "-").
// Never on kids' audio in the repo: their clips stay on the cabinet or the mini, and are deleted after.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { moonshineEngine, pcmOfWav, SPEECH_FILE } from "../src/speech-live.js";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { speech: { type: "string", default: SPEECH_FILE }, quiet: { type: "boolean", default: false } } });
const dir = positionals[0];
if (!dir) {
  console.error("usage: node bench.mjs CLIPS_DIR [--speech FILE]");
  process.exit(2);
}
const s = JSON.parse(fs.readFileSync(values.speech, "utf8"));
const engine = moonshineEngine({ python: s.python, helper: s.helper, modelDir: s.model_dir, arch: s.arch, log: (m) => console.log(m) });
const t0 = Date.now();
if (!(await engine.ready)) {
  console.error("Moonshine didn't start");
  process.exit(1);
}
console.log(`started in ${Date.now() - t0} ms`);

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

const clips = fs.readdirSync(dir).filter((f) => f.endsWith(".wav")).sort();
/** @type {Record<string, [number, number]>} */
const byVoice = {};
let errs = 0;
let total = 0;
/** @type {number[]} */
const ms = [];
/** @type {number[]} */
const rtf = [];
for (const f of clips) {
  const ref = fs.readFileSync(path.join(dir, f.replace(/\.wav$/, ".txt")), "utf8").trim();
  const pcm = pcmOfWav(fs.readFileSync(path.join(dir, f)));
  const t = performance.now();
  const hyp = await engine.transcribe(Buffer.from(pcm));
  const took = performance.now() - t;
  const r = words(ref);
  const e = edits(r, words(hyp));
  errs += e;
  total += r.length;
  ms.push(took);
  rtf.push(took / ((pcm.length / 2 / 16000) * 1000));
  const v = f.split("-")[0];
  byVoice[v] ??= [0, 0];
  byVoice[v][0] += e;
  byVoice[v][1] += r.length;
  if (!values.quiet) console.log(`${f}\t${Math.round(took)} ms\t${e ? `${e} wrong: "${hyp}"` : "exact"}`);
}
engine.close?.();
ms.sort((a, b) => a - b);
rtf.sort((a, b) => a - b);
const pct = (/** @type {number} */ a, /** @type {number} */ b) => `${((100 * a) / b).toFixed(1)}%`;
console.log(`\n${s.arch}: ${clips.length} clips, WER ${pct(errs, total)}, latency median ${Math.round(ms[ms.length >> 1])} ms, p90 ${Math.round(ms[Math.floor(ms.length * 0.9)])} ms, max ${Math.round(ms[ms.length - 1])} ms, ${rtf[rtf.length >> 1].toFixed(2)}x real time`);
console.log(`per voice: ${Object.entries(byVoice).map(([v, [a, b]]) => `${v} ${pct(a, b)}`).join(", ")}`);
