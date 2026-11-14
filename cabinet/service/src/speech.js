// Speech to text as an interface (D184). start() when a button goes down, stop()
// when it comes up, returning a transcript. Phase 3 puts the bake-off's winner
// behind this. No audio is ever stored.
import fs from "node:fs";

/**
 * @typedef {object} Speech
 * @property {string} kind
 * @property {() => void} start
 * @property {(o?: { fast?: boolean }) => Promise<{ text: string }>} stop  fast: Moonshine first, for a game's
 *   voice actions, where speed matters more than the last word (D491); Groq only if Moonshine fails
 * @property {() => void} [cancel]  drop the hold: nothing transcribed, nothing sent, the audio gone (D491)
 * @property {(u: { text?: string, wav?: string }) => void} [feed]  stub only
 */

/** Is this a WAV? Enough to catch a wrong path. */
function isWav(file) {
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(12);
    fs.readSync(fd, head, 0, 12, 0);
    return head.toString("latin1", 0, 4) === "RIFF" && head.toString("latin1", 8, 12) === "WAVE";
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * The stub: transcripts come from a queue. An empty queue is silence. A WAV's
 * transcript is the .txt beside it, so the path can be tried before real speech.
 * @returns {Speech}
 */
export function stubSpeech() {
  /** @type {string[]} */
  const queue = [];
  let open = false;
  return {
    kind: "stub",
    start() {
      open = true;
    },
    async stop() {
      if (!open) return { text: "" };
      open = false;
      return { text: queue.shift() ?? "" };
    },
    cancel() {
      if (!open) return;
      open = false;
      queue.shift(); // what this hold would have heard goes with it
    },
    feed({ text, wav }) {
      if (typeof text === "string") {
        queue.push(text);
        return;
      }
      if (typeof wav !== "string") throw new Error("feed takes text or wav");
      if (!isWav(wav)) throw new Error(`${wav} isn't a WAV file`);
      const beside = wav.replace(/\.wav$/i, "") + ".txt";
      if (!fs.existsSync(beside)) throw new Error(`no transcript beside ${wav}: the stub reads ${beside}`);
      queue.push(fs.readFileSync(beside, "utf8").trim());
    },
  };
}
