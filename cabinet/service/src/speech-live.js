// Real speech on the cabinet (D260-D265), behind the Speech interface of speech.js (D184).
// Hold a button: the recorder captures 16 kHz mono from the cabinet's mic into memory. Release:
// Groq transcribes it when the cabinet has a key, Moonshine on the cabinet otherwise or when Groq
// fails. The audio lives only in this process's memory and is dropped when the transcript is back:
// it is never written to disk, logged or kept (§3.1, CLAUDE.md).
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { appendLineDurable } from "@game-studio-arcade/studio-cli/src/durable.js";

export const RATE = 16000;
// No length cutoff and no silence stop (D470, Geoff 2026-11-14): a hold records for exactly as long as the
// button is held. Memory doesn't force a limit: 16 kHz mono is 1.9 MB a minute, 115 MB an hour, on an 8 GB Pi.
// Where a provider has a limit, the audio is split into pieces, never cut.
/** Groq takes up to 25 MB a file on the free tier; 10 minutes of 16 kHz mono WAV is 19.2 MB (D470). */
export const GROQ_CHUNK_SECONDS = 600;
/** Moonshine is given pieces of at most 30 s, the length its models are trained on (D470). */
export const MOONSHINE_CHUNK_SECONDS = 30;
/** Groq's free tier allows 20 requests a minute; two pieces at a time is plenty. */
const GROQ_PARALLEL = 2;
export const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
export const GROQ_MODEL = "whisper-large-v3-turbo";
/** Groq is skipped after this long, and Moonshine answers instead (D263). */
export const GROQ_TIMEOUT_MS = 3000;
/**
 * How long Groq gets before Moonshine answers instead: 3 s, plus 0.1 s for each second of audio for the upload.
 * On the virtual cabinet, 52 Groq calls all answered within 0.7 s (2026-11-13), while a Groq that never answers
 * kept a kid waiting the whole timeout, so this is short.
 * @param {Buffer} pcm
 */
export const groqTimeoutMs = (pcm) => GROQ_TIMEOUT_MS + Math.round((pcm.length / 2 / RATE) * 100);
/** Where provisioning says what it installed (D261). */
export const SPEECH_FILE = "/opt/arcade/speech/speech.json";

/**
 * @typedef {object} Recorder
 * @property {() => void} start
 * @property {() => Promise<Buffer>} stop    the PCM captured since start, 16-bit little-endian, mono, 16 kHz
 * @property {(fn: ((pcm: Buffer) => void) | null) => void} [onData]  each piece of audio as it arrives (D492)
 * @property {() => boolean} [alive]  still capturing: false once the mic has gone while the button is still down
 * @property {() => void} [close]
 */
/**
 * @typedef {object} Engine
 * @property {string} name
 * @property {(pcm: Buffer) => Promise<string>} transcribe
 * @property {() => void} [warm]   get ready for a clip soon: called when a button goes down
 * @property {LiveWords} [live]   words while the kid talks (D492): Moonshine only
 * @property {() => void} [close]
 */
/**
 * @typedef {object} LiveWords
 * @property {() => Promise<void>} begin
 * @property {(pcm: Buffer) => Promise<string>} add   the words so far
 * @property {() => Promise<string>} end              the final words
 */
/** Live words get audio in steps of a quarter second (D492). */
const LIVE_STEP_BYTES = RATE / 2;
/** The end of the live words is what's shown: three lines need far fewer than this. */
const LIVE_TAIL = 400;
/**
 * @typedef {{ listening: boolean, seconds: number, words: string | null, stopped: boolean }} LiveView
 *   words: null when live words aren't on (none asked, no Moonshine, or it fell behind and stopped);
 *   stopped: the mic went quiet for good while the button is still down
 */
/** The helper's requests that aren't a clip (moonshine_helper.py). */
const WARM_OP = 0xffffffff;
const LIVE_BEGIN = 0xfffffffe;
const LIVE_AUDIO = 0xfffffffd;
const LIVE_END = 0xfffffffc;
/** Idle longer than this and Moonshine is warmed again when a hold starts. */
export const WARM_AFTER_MS = 30_000;

/**
 * The cabinet's first capture device, as ALSA lists it, or null. A USB mic on the Pi and the virtio
 * sound input in the VM both show up here; plughw converts whatever rate they run at to 16 kHz.
 * @param {string} listing  what `arecord -l` prints
 */
export function captureDevice(listing) {
  const m = /^card (\d+):.*?device (\d+):/m.exec(listing);
  return m ? `plughw:${m[1]},${m[2]}` : null;
}

/**
 * ALSA's arecord, into memory. The device is looked up at each start, so a mic plugged in late works.
 * @param {{ device?: string | null, arecord?: string, log?: (m: string) => void }} [o]
 * @returns {Recorder}
 */
export function alsaRecorder(o = {}) {
  const bin = o.arecord ?? "arecord";
  /** @type {import("node:child_process").ChildProcess | null} */
  let child = null;
  /** @type {Buffer[]} */
  let chunks = [];
  let size = 0;
  /** @type {Promise<void> | null} */
  let ended = null;
  /** @type {((pcm: Buffer) => void) | null} */
  let listener = null;
  let capturing = false;
  const findDevice = () => {
    if (o.device) return o.device;
    try {
      return captureDevice(execFileSync(bin, ["-l"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 }));
    } catch {
      return null;
    }
  };
  return {
    start() {
      if (child) return;
      chunks = [];
      size = 0;
      const device = findDevice();
      if (!device) {
        o.log?.("speech: no capture device; is the mic plugged in?");
        return;
      }
      // -t raw: no header, nothing but samples, on stdout. Never a file.
      const c = spawn(bin, ["-q", "-D", device, "-f", "S16_LE", "-r", String(RATE), "-c", "1", "-t", "raw"], { stdio: ["ignore", "pipe", "pipe"] });
      child = c;
      let err = "";
      c.stderr?.on("data", (d) => (err = (err + d).slice(-400)));
      capturing = true;
      c.stdout?.on("data", (/** @type {Buffer} */ d) => {
        chunks.push(d);
        size += d.length;
        listener?.(d);
      });
      ended = new Promise((resolve) => {
        c.on("error", (e) => {
          o.log?.(`speech: arecord: ${e.message}`);
          resolve();
        });
        c.on("close", (code, signal) => {
          if (code && signal !== "SIGINT" && signal !== "SIGTERM") o.log?.(`speech: arecord exited ${code}: ${err.trim()}`);
          capturing = false;
          resolve();
        });
      });
    },
    async stop() {
      const c = child;
      child = null;
      if (c) {
        // SIGINT makes arecord flush what it has and exit.
        c.kill("SIGINT");
        const t = setTimeout(() => c.kill("SIGKILL"), 1000);
        await ended;
        clearTimeout(t);
      }
      listener = null;
      capturing = false;
      const pcm = Buffer.concat(chunks, size);
      for (const c of chunks) c.fill(0);
      chunks = [];
      size = 0;
      return pcm;
    },
    onData(fn) {
      listener = fn;
    },
    alive: () => capturing,
    close() {
      child?.kill("SIGKILL");
      child = null;
    },
  };
}

/**
 * Long audio in pieces of at most maxSeconds, each cut at the quietest moment in the last searchSeconds
 * before its limit, so a word is rarely split (D470). The pieces are views of pcm, not copies, and joined
 * back they are pcm exactly.
 * @param {Buffer} pcm  16-bit mono at RATE
 * @param {number} maxSeconds
 * @param {number} [searchSeconds]
 * @returns {Buffer[]}
 */
export function splitPcm(pcm, maxSeconds, searchSeconds = Math.min(10, maxSeconds / 3)) {
  const total = Math.floor(pcm.length / 2);
  const max = Math.floor(maxSeconds * RATE);
  const search = Math.floor(searchSeconds * RATE);
  const frame = RATE / 50; // 20 ms
  /** @type {Buffer[]} */
  const out = [];
  let at = 0;
  while (total - at > max) {
    let best = at + max;
    let bestEnergy = Infinity;
    for (let f = at + max - frame; f >= at + max - search; f -= frame) {
      let e = 0;
      for (let i = f; i < f + frame; i++) e += Math.abs(pcm.readInt16LE(i * 2));
      if (e < bestEnergy) {
        bestEnergy = e;
        best = f + frame / 2;
      }
    }
    out.push(pcm.subarray(at * 2, best * 2));
    at = best;
  }
  out.push(pcm.subarray(at * 2, total * 2));
  return out;
}

/** How many pieces an engine's split makes of this audio, for the log. @param {string} name @param {Buffer} pcm */
const pieces = (name, pcm) => Math.ceil(pcm.length / 2 / RATE / (name === "groq" ? GROQ_CHUNK_SECONDS : MOONSHINE_CHUNK_SECONDS) - 1e-9) || 1;

/** Each piece, at most `parallel` at a time, the texts joined in order. @param {Buffer[]} pieces @param {number} parallel @param {(p: Buffer) => Promise<string>} fn */
async function eachPiece(pieces, parallel, fn) {
  /** @type {string[]} */
  const texts = new Array(pieces.length).fill("");
  let next = 0;
  const worker = async () => {
    while (next < pieces.length) {
      const i = next++;
      texts[i] = (await fn(pieces[i])).trim();
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, pieces.length) }, worker));
  return texts.filter(Boolean).join(" ");
}

/**
 * Moonshine, in one long-lived Python process that loads the model once (moonshine_helper.py).
 * Started at once, so the first kid doesn't wait for the model. Restarted if it dies.
 * @param {{ python: string, helper: string, modelDir: string, arch: string, log?: (m: string) => void, spawnFn?: typeof spawn }} o
 * @returns {Engine & { ready: Promise<boolean> }}
 */
export function moonshineEngine(o) {
  const run = o.spawnFn ?? spawn;
  /** @type {import("node:child_process").ChildProcess | null} */
  let child = null;
  /** @type {Array<(r: any) => void>} */
  let waiting = [];
  /** @type {Promise<boolean>} */
  let ready = Promise.resolve(false);
  let closed = false;
  let queue = Promise.resolve();

  const launch = () => {
    const c = run(o.python, [o.helper, o.modelDir, o.arch], { stdio: ["pipe", "pipe", "pipe"] });
    child = c;
    let buf = "";
    /** @type {(ok: boolean) => void} */
    let markReady = () => {};
    ready = new Promise((resolve) => (markReady = resolve));
    c.stderr?.on("data", () => {}); // a progress bar, or a warning: not ours to keep
    c.stdout?.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        /** @type {any} */
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.ready) {
          o.log?.(`speech: Moonshine ${o.arch} ready in ${msg.load_ms} ms`);
          markReady(true);
        } else if (waiting.length) waiting.shift()?.(msg);
        else if (msg.error) {
          o.log?.(`speech: Moonshine: ${msg.error}`);
          markReady(false);
        }
      }
    });
    c.on("error", (e) => {
      o.log?.(`speech: Moonshine couldn't start: ${e.message}`);
      markReady(false);
    });
    c.on("close", () => {
      markReady(false);
      for (const w of waiting) w({ error: "Moonshine stopped" });
      waiting = [];
      if (child === c) child = null;
    });
  };
  launch();

  let lastUsed = 0;
  /**
   * One request to the helper, and its answer. @param {number} op  a clip's length, or one of the codes below
   * @param {Buffer | null} [body]  sent after a second length, for LIVE_AUDIO
   */
  const ask = async (op, body = null) => {
    if (!child && !closed) launch();
    if (!(await ready)) throw new Error("Moonshine isn't running");
    const c = /** @type {import("node:child_process").ChildProcess} */ (child);
    const answer = new Promise((resolve) => waiting.push(resolve));
    const head = Buffer.alloc(body ? 8 : 4);
    head.writeUInt32LE(op);
    if (body) head.writeUInt32LE(body.length, 4);
    c.stdin?.write(head);
    if (body?.length) c.stdin?.write(body);
    lastUsed = Date.now();
    /** @type {any} */
    const msg = await answer;
    if (msg.error) throw new Error(`Moonshine: ${msg.error}`);
    return msg;
  };
  /** @param {Buffer | null} pcm  null: warm up */
  const once = async (pcm) => {
    if (!pcm) return String((await ask(WARM_OP)).text ?? "");
    if (!child && !closed) launch();
    if (!(await ready)) throw new Error("Moonshine isn't running");
    const c = /** @type {import("node:child_process").ChildProcess} */ (child);
    const answer = new Promise((resolve) => waiting.push(resolve));
    const head = Buffer.alloc(4);
    head.writeUInt32LE(pcm.length);
    c.stdin?.write(head);
    if (pcm.length) c.stdin?.write(pcm);
    lastUsed = Date.now();
    /** @type {any} */
    const msg = await answer;
    if (msg.error) throw new Error(`Moonshine: ${msg.error}`);
    return String(msg.text ?? "");
  };
  /** In the queue, after whatever is ahead of it. @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
  const inTurn = (fn) => {
    const r = queue.then(fn);
    queue = r.then(
      () => {},
      () => {},
    );
    return r;
  };

  return {
    name: "moonshine",
    get ready() {
      return ready;
    },
    transcribe(pcm) {
      // One clip at a time, in order: the helper answers in the order it's asked. A long one goes in 30 s pieces (D470).
      return inTurn(() => eachPiece(splitPcm(pcm, MOONSHINE_CHUNK_SECONDS), 1, once));
    },
    live: {
      begin: () => inTurn(async () => void (await ask(LIVE_BEGIN))),
      add: (pcm) => inTurn(async () => String((await ask(LIVE_AUDIO, pcm)).live ?? "")),
      end: () => inTurn(async () => String((await ask(LIVE_END)).live ?? "")),
    },
    warm() {
      // Idle a while: the model may have gone cold. Warm it while the kid is still talking.
      if (Date.now() - lastUsed < WARM_AFTER_MS) return;
      lastUsed = Date.now();
      const r = queue.then(() => once(null));
      queue = r.then(
        () => {},
        () => {},
      );
    },
    close() {
      closed = true;
      child?.kill();
      child = null;
    },
  };
}

/**
 * A WAV for the PCM, built in memory: Groq takes a file upload, and this is it.
 * @param {Buffer} pcm
 */
export function wavOf(pcm) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "latin1");
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8, "latin1");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36, "latin1");
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/**
 * The PCM in a 16 kHz mono 16-bit WAV file, for clips fed through the same path as the mic.
 * @param {Buffer} wav
 */
export function pcmOfWav(wav) {
  if (wav.toString("latin1", 0, 4) !== "RIFF" || wav.toString("latin1", 8, 12) !== "WAVE") throw new Error("not a WAV file");
  let at = 12;
  /** @type {{ channels: number, rate: number, bits: number } | null} */
  let fmt = null;
  while (at + 8 <= wav.length) {
    const id = wav.toString("latin1", at, at + 4);
    const len = wav.readUInt32LE(at + 4);
    if (id === "fmt ") fmt = { channels: wav.readUInt16LE(at + 10), rate: wav.readUInt32LE(at + 12), bits: wav.readUInt16LE(at + 22) };
    if (id === "data") {
      if (!fmt || fmt.channels !== 1 || fmt.rate !== RATE || fmt.bits !== 16) throw new Error("the WAV must be 16 kHz mono 16-bit");
      return wav.subarray(at + 8, at + 8 + len);
    }
    at += 8 + len + (len & 1);
  }
  throw new Error("the WAV has no data");
}

/**
 * Groq's whisper-large-v3-turbo (D263). The key comes from the cabinet's config, never an env var.
 * @param {{ key: string, fetchFn?: typeof fetch, timeoutMs?: number, url?: string }} o
 * @returns {Engine}
 */
export function groqEngine(o) {
  const f = o.fetchFn ?? fetch;
  return {
    name: "groq",
    transcribe(pcm) {
      // Long audio in pieces under Groq's 25 MB file limit, two at a time; any piece failing fails the lot (D470).
      return eachPiece(splitPcm(pcm, GROQ_CHUNK_SECONDS), GROQ_PARALLEL, once);
    },
  };
  /** @param {Buffer} pcm */
  async function once(pcm) {
    const form = new FormData();
    form.append("file", new Blob([wavOf(pcm)], { type: "audio/wav" }), "speech.wav");
    form.append("model", GROQ_MODEL);
    form.append("language", "en");
    form.append("temperature", "0");
    form.append("response_format", "json");
    const res = await f(o.url ?? GROQ_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${o.key}` },
      body: form,
      signal: AbortSignal.timeout(o.timeoutMs ?? groqTimeoutMs(pcm)),
    });
    // The status only: an error body could quote the request.
    if (!res.ok) throw new Error(`Groq answered ${res.status}`);
    const body = /** @type {any} */ (await res.json());
    return String(body.text ?? "");
  }
}

/**
 * Real speech: a recorder and engines tried in order (Groq, then Moonshine). Logs which engine
 * answered and how long it took, never what was said or the audio.
 * @param {{ recorder: Recorder, engines: Engine[], online?: () => boolean, logFile?: string, log?: (m: string) => void, now?: () => number }} o
 * @returns {import("./speech.js").Speech & { close: () => void, live: () => LiveView }}
 */
export function liveSpeech(o) {
  const now = o.now ?? Date.now;
  let open = false;
  /** @type {Buffer[]} clips fed in to stand in for the mic, one per hold */
  const fed = [];
  /** @type {string[]} */
  const fedText = [];
  let startedAt = 0;
  const kind = o.engines.map((e) => e.name).join("+") || "none";
  /** The engine whose live words show while the kid talks (D492): Moonshine on the cabinet. */
  const liveEngine = o.engines.find((e) => e.live);

  /**
   * The live words of the hold under way, if it asked for them (D492).
   * @type {null | { words: string, sent: number, busy: Promise<void>, pending: Buffer[], pendingBytes: number,
   *   failed: boolean, feeder: NodeJS.Timeout | null, clip: Buffer | null }}
   */
  let live = null;

  /** @param {any} entry */
  const record = (entry) => {
    if (!o.logFile) return;
    try {
      fs.mkdirSync(path.dirname(o.logFile), { recursive: true });
      appendLineDurable(o.logFile, JSON.stringify({ ts: new Date(now()).toISOString(), ...entry }));
    } catch {}
  };

  /** Send what's waiting to the stream, one request at a time, so a slow Pi batches rather than queues. */
  const pump = () => {
    const L = live;
    if (!L || L.failed || !liveEngine?.live) return;
    if (L.pendingBytes < LIVE_STEP_BYTES) return;
    const piece = Buffer.concat(L.pending, L.pendingBytes);
    L.pending = [];
    L.pendingBytes = 0;
    L.busy = L.busy.then(async () => {
      try {
        L.words = await /** @type {LiveWords} */ (liveEngine.live).add(piece);
        L.sent += piece.length;
      } catch (/** @type {any} */ e) {
        L.failed = true;
        o.log?.(`speech: live words stopped: ${e.message}`);
      } finally {
        piece.fill(0);
      }
    });
    L.busy.then(pump);
  };
  /** @param {Buffer} d */
  const take = (d) => {
    if (!live) return;
    const copy = Buffer.from(d); // the recorder wipes its own copy when the hold ends
    live.pending.push(copy);
    live.pendingBytes += copy.length;
    pump();
  };

  /**
   * End the hold's live words: send what hasn't gone, then the stream's final words. Null if there were none.
   * @param {Buffer | null} pcm  the whole hold, to send what the stream hasn't had
   */
  const endLive = async (pcm) => {
    const L = live;
    live = null;
    if (!L || !liveEngine?.live) return null;
    if (L.feeder) clearInterval(L.feeder);
    o.recorder.onData?.(null);
    await L.busy;
    for (const b of L.pending) b.fill(0);
    if (L.failed) {
      liveEngine.live.end().catch(() => {});
      return null;
    }
    const rest = pcm ? Buffer.from(pcm.subarray(L.sent)) : null;
    try {
      if (rest?.length) await liveEngine.live.add(rest);
      return (await liveEngine.live.end()).trim();
    } catch {
      return null;
    } finally {
      rest?.fill(0);
    }
  };

  return {
    kind,
    /** @param {{ live?: boolean }} [opts]  live: words while the kid talks, for the talk screens (D492) */
    start(opts = {}) {
      if (open) return;
      open = true;
      startedAt = now();
      if (!fedText.length) for (const e of o.engines) e.warm?.();
      if (!fed.length && !fedText.length) o.recorder.start();
      if (opts.live && liveEngine?.live && !fedText.length) {
        live = { words: "", sent: 0, busy: Promise.resolve(), pending: [], pendingBytes: 0, failed: false, feeder: null, clip: null };
        const L = live;
        L.busy = liveEngine.live.begin().catch((/** @type {any} */ e) => {
          L.failed = true;
          o.log?.(`speech: live words couldn't start: ${e.message}`);
        });
        if (fed.length) {
          // A fed clip stands in for the mic: it reaches the stream half a second at a time, as speech would.
          const clip = fed[0];
          let at = 0;
          L.feeder = setInterval(() => {
            if (at >= clip.length) return;
            take(clip.subarray(at, at + LIVE_STEP_BYTES * 2));
            at += LIVE_STEP_BYTES * 2;
          }, 100);
        } else o.recorder.onData?.(take);
      }
    },
    /** What the kid sees while holding the button (D492). */
    live() {
      const L = live;
      const stopped = open && !fed.length && o.recorder.alive ? !o.recorder.alive() : false;
      return { listening: open, seconds: open ? Math.floor((now() - startedAt) / 1000) : 0, words: L && !L.failed ? L.words.slice(-LIVE_TAIL) : null, stopped };
    },
    async stop(opts = {}) {
      if (!open) return { text: "" };
      open = false;
      if (fedText.length) return { text: /** @type {string} */ (fedText.shift()) };
      // D491: a game's voice action wants speed: Moonshine first, Groq only if it fails.
      const engines = opts.fast ? [...o.engines].sort((a, b) => (a.name === "moonshine" ? -1 : b.name === "moonshine" ? 1 : 0)) : o.engines;
      let pcm = fed.length ? /** @type {Buffer} */ (fed.shift()) : await o.recorder.stop();
      // The stream's final words are Moonshine's answer for this hold: it has heard it all already (D492).
      const liveFinal = live ? endLive(pcm) : null;
      const heldMs = now() - startedAt;
      const audioMs = Math.round((pcm.length / 2 / RATE) * 1000);
      if (pcm.length < RATE * 2 * 0.2) {
        record({ engine: null, held_ms: heldMs, audio_ms: audioMs, ms: 0, result: "too short" });
        await liveFinal;
        pcm.fill(0);
        return { text: "" };
      }
      /** @type {string[]} */
      const skipped = [];
      try {
        for (const engine of engines) {
          if (engine.name === "groq" && o.online && !o.online()) {
            skipped.push("groq: offline");
            continue;
          }
          const t = now();
          try {
            const streamed = engine === liveEngine && liveFinal ? await liveFinal : null;
            const text = streamed ?? (await engine.transcribe(pcm)).trim();
            record({ engine: engine.name, held_ms: heldMs, audio_ms: audioMs, ms: now() - t, words: text ? text.split(/\s+/).length : 0, skipped, ...(opts.fast ? { fast: true } : {}), ...(liveFinal ? { live: true } : {}), ...(streamed == null && pieces(engine.name, pcm) > 1 ? { pieces: pieces(engine.name, pcm) } : {}) });
            return { text };
          } catch (/** @type {any} */ e) {
            skipped.push(`${engine.name}: ${e.name === "TimeoutError" ? "timed out" : e.message}`);
          }
        }
        record({ engine: null, held_ms: heldMs, audio_ms: audioMs, ms: 0, skipped, result: "no engine answered" });
        o.log?.(`speech: no engine answered (${skipped.join("; ")})`);
        return { text: "" };
      } finally {
        await liveFinal; // the stream has finished with the audio before it's wiped
        pcm.fill(0); // drop it: the audio is gone once the words are back
        pcm = Buffer.alloc(0);
      }
    },
    /** D491: drop the hold. The recorder stops, the audio is wiped, nothing is transcribed or sent anywhere. */
    cancel() {
      if (!open) return;
      open = false;
      if (fedText.length) {
        fedText.shift();
        return;
      }
      const ending = live ? endLive(null) : null;
      const from = fed.length ? Promise.resolve(/** @type {Buffer} */ (fed.shift())) : o.recorder.stop();
      from.then(async (pcm) => {
        await ending;
        pcm.fill(0);
        record({ engine: null, held_ms: now() - startedAt, audio_ms: Math.round((pcm.length / 2 / RATE) * 1000), ms: 0, result: "cancelled" });
      }, () => {});
    },
    /** A clip (16 kHz mono WAV) or text, to stand in for the mic at the next hold: tests, and checks without a kid. */
    feed({ text, wav }) {
      if (typeof text === "string") {
        fedText.push(text);
        return;
      }
      if (typeof wav !== "string") throw new Error("feed takes text or wav");
      fed.push(Buffer.from(pcmOfWav(fs.readFileSync(wav))));
    },
    close() {
      o.recorder.close?.();
      for (const e of o.engines) e.close?.();
    },
  };
}

/**
 * The speech a cabinet runs: real when provisioning installed Moonshine (speech.json), the stub otherwise
 * (the mini, tests, replays without it). A Groq key in the cabinet's config puts Groq first.
 * @param {{ config: any, speechFile?: string, logsDir: string, online?: () => boolean, log?: (m: string) => void }} o
 * @returns {import("./speech.js").Speech | null}  null: use the stub
 */
export function cabinetSpeech(o) {
  const file = o.speechFile ?? SPEECH_FILE;
  if (o.config?.speech === "stub" || !fs.existsSync(file)) return null;
  /** @type {any} */
  const s = JSON.parse(fs.readFileSync(file, "utf8"));
  /** @type {Engine[]} */
  const engines = [];
  if (typeof o.config?.groq_api_key === "string" && o.config.groq_api_key) engines.push(groqEngine({ key: o.config.groq_api_key, timeoutMs: o.config.groq_timeout_ms }));
  engines.push(moonshineEngine({ python: s.python, helper: s.helper, modelDir: s.model_dir, arch: s.arch, log: o.log }));
  return liveSpeech({
    recorder: alsaRecorder({ device: o.config?.mic_device ?? null, log: o.log }),
    engines,
    online: o.online,
    logFile: path.join(o.logsDir, "speech.jsonl"),
    log: o.log,
  });
}
