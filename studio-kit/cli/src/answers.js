// Where answers come from: a person at the terminal, or a recorded file (D43).
import fs from "node:fs";
import { formatPlan, formatQuestion, parseChoice } from "./tiles.js";

/**
 * @typedef {{choice: "A"|"B"|"C"|"D", said?: string}} QuestionAnswer
 * @typedef {{choice: "build"|"change", said?: string}} PlanAnswer
 * @typedef {object} Answerer
 * @property {(q: {question: string, option_a: string, option_b: string}) => Promise<QuestionAnswer>} question
 * @property {(p: {summary: string, rules: any[]}) => Promise<PlanAnswer>} plan
 * @property {() => string[]} [notes]   things to log, e.g. replay_exhausted
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

/**
 * Replay a recorded answers file by position. When it runs out, questions get D
 * and notes() reports replay_exhausted; an extra plan gets build and replay_replanned.
 * @param {{questions?: QuestionAnswer[], plan?: PlanAnswer[]}} recorded
 * @param {{print?: (text: string) => void}} [io]
 * @returns {Answerer}
 */
export function replayAnswerer(recorded, io = {}) {
  const qs = [...(recorded.questions ?? [])];
  const ps = [...(recorded.plan ?? [])];
  const notes = new Set();
  const print = io.print ?? (() => {});
  return {
    async question(q) {
      print(formatQuestion(q));
      const a = qs.shift();
      if (!a) {
        notes.add("replay_exhausted");
        print("(replay) D, out of recorded answers");
        return { choice: "D" };
      }
      print(`(replay) ${a.choice}${a.said ? `: ${a.said}` : ""}`);
      return a;
    },
    async plan(p) {
      print(formatPlan(p));
      const a = ps.shift();
      if (!a) {
        // A re-plan the recording never saw (D44) isn't the questions running out.
        if (recorded.plan?.length) notes.add("replay_replanned");
        print("(replay) build");
        return { choice: "build" };
      }
      print(`(replay) ${a.choice}${a.said ? `: ${a.said}` : ""}`);
      return a;
    },
    notes: () => [...notes],
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
