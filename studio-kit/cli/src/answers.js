// Where answers come from: a person at the terminal, or a recorded file (D43).
import fs from "node:fs";
import { formatPlan, formatQuestion, parseChoice } from "./tiles.js";

/**
 * @typedef {{choice: "A"|"B"|"C"|"D", said?: string}} QuestionAnswer
 * @typedef {{choice: "build"|"change", said?: string}} PlanAnswer
 * @typedef {object} Answerer
 * @property {(q: {question: string, option_a: string, option_b: string}) => Promise<QuestionAnswer>} question
 * @property {(p: {summary: string, rules: any[]}) => Promise<PlanAnswer>} plan
 * @property {() => string[]} [notes]   things to log, e.g. replay_unmatched
 * @property {() => any[]} [replayLog]   each replayed question: asked, matched, reply (D47)
 *
 * Recorded answers file:
 *   {"request": "...", "maker": "A", "questions": [{"choice":"A"}, {"choice":"C","said":"..."}],
 *    "plan": [{"choice":"build"}]}
 */

/**
 * Ask at the terminal. `prompt` reads one line (readline's question()).
 * @param {{prompt: (text: string) => Promise<string>, print: (text: string) => void}} io
 * @returns {Answerer}
 */
export function liveAnswerer(io) {
  return {
    async question(q) {
      io.print(formatQuestion(q));
      for (;;) {
        const choice = parseChoice(await io.prompt("Pick A, B, C or D: "));
        if (!choice) continue;
        if (choice !== "C") return { choice };
        return { choice, said: await askUntilSaid(io, "Say it (type your answer): ") };
      }
    },
    async plan(p) {
      io.print(formatPlan(p));
      for (;;) {
        const c = parseChoice(await io.prompt("Pick A or B: "));
        if (c === "A") return { choice: "build" };
        if (c === "B") return { choice: "change", said: await askUntilSaid(io, "What should change? ") };
      }
    },
  };
}

async function askUntilSaid(io, prompt) {
  for (;;) {
    const said = (await io.prompt(prompt)).trim();
    if (said) return said;
  }
}

const STOP = new Set("a an and at be do does for from how if in is it of on or should so the then to what when where which will with you your".split(" "));
const words = (text) => new Set(String(text ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w)).map((w) => (w.length > 3 ? w.replace(/s$/, "") : w)));

/** Shared words as a share of all the words in either. */
export function overlap(a, b) {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / new Set([...x, ...y]).size;
}

/** Do these say the same thing: the same content words, both ways? (D171) */
function sameWords(a, b) {
  const x = words(a);
  const y = words(b);
  return x.size > 0 && x.size === y.size && [...x].every((w) => y.has(w));
}

/** Does this recorded answer apply to the question asked? */
function applies(rec, question) {
  if (Array.isArray(rec.match)) return rec.match.every((re) => new RegExp(re, "i").test(question));
  return Boolean(rec.question) && overlap(rec.question, question) >= 0.5;
}

/**
 * Say a recorded answer on this question's tiles (D47, D171). A tile only if it
 * says the same thing; otherwise its own words through C, so nothing is lost to
 * a tile that merely shares most of its words.
 * @returns {QuestionAnswer}
 */
function replyFor(rec, q) {
  const said = rec.answer ?? rec.said;
  if (!said) return { choice: rec.choice, ...(rec.said ? { said: rec.said } : {}) };
  if (sameWords(said, q.option_a)) return { choice: "A" };
  if (sameWords(said, q.option_b)) return { choice: "B" };
  return { choice: "C", said };
}

/**
 * Replay a recorded answers file (D47). Answers match by question; a question
 * with no recorded answer gets D and notes() reports replay_unmatched, or with
 * `unmatched: "A"` (D168) gets A and notes() reports replay_fallback. A file
 * with no questions in it replays by position. An extra plan gets build and
 * replay_replanned.
 * @param {{questions?: any[], plan?: PlanAnswer[]}} recorded
 * @param {{print?: (text: string) => void, unmatched?: "A"|"D"}} [io]
 * @returns {Answerer}
 */
export function replayAnswerer(recorded, io = {}) {
  const fallback = io.unmatched === "A";
  const all = recorded.questions ?? [];
  const byQuestion = all.some((r) => r.question || r.match);
  const positional = byQuestion ? [] : [...all];
  const used = new Set();
  const ps = [...(recorded.plan ?? [])];
  const notes = new Set();
  /** @type {any[]} */
  const log = [];
  const print = io.print ?? (() => {});
  const fresh = (q) => all.find((r) => !used.has(r) && applies(r, q));
  const again = (q) => all.find((r) => applies(r, q));
  return {
    async question(q) {
      print(formatQuestion(q));
      /** @type {QuestionAnswer} */
      let a;
      let matched = null;
      if (byQuestion) {
        const rec = fresh(q.question) ?? again(q.question);
        if (rec) {
          used.add(rec);
          matched = rec.question ?? String(rec.match);
          a = replyFor(rec, q);
        } else if (fallback) {
          notes.add("replay_fallback");
          a = { choice: "A" };
        } else {
          notes.add("replay_unmatched");
          a = { choice: "D" };
        }
      } else {
        const rec = positional.shift();
        if (rec) {
          matched = "(by position)";
          a = rec;
        } else {
          notes.add("replay_exhausted");
          a = { choice: "D" };
        }
      }
      const fell = fallback && byQuestion && !matched;
      log.push({ asked: q.question, option_a: q.option_a, option_b: q.option_b, matched, choice: a.choice, said: a.said ?? null, ...(fell ? { fallback: true } : {}) });
      print(`(replay) ${a.choice}${a.said ? `: ${a.said}` : ""}${matched ? "" : " (no recorded answer)"}`);
      return a;
    },
    async plan(p) {
      print(formatPlan(p));
      const a = ps.shift();
      if (!a) {
        // A re-plan the recording never saw isn't the questions running out.
        if (recorded.plan?.length) notes.add("replay_replanned");
        print("(replay) build");
        return { choice: "build" };
      }
      print(`(replay) ${a.choice}${a.said ? `: ${a.said}` : ""}`);
      return a;
    },
    notes: () => [...notes],
    replayLog: () => log,
  };
}

/** @param {string} file */
export function loadAnswers(file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(data.questions)) throw new Error(`${file}: expected a "questions" array`);
  for (const a of data.questions) {
    if (!parseChoice(a.choice)) throw new Error(`${file}: bad choice ${JSON.stringify(a.choice)}`);
  }
  return data;
}
