// Real speech without a mic (D260-D265): a fake recorder, fake engines, a fake Moonshine helper and arecord.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { alsaRecorder, cabinetSpeech, captureDevice, groqEngine, groqTimeoutMs, GROQ_CHUNK_SECONDS, GROQ_MODEL, MOONSHINE_CHUNK_SECONDS, splitPcm, GROQ_URL, liveSpeech, moonshineEngine, pcmOfWav, RATE, wavOf } from "../src/speech-live.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "gsa-speech-"));
const second = (s = 1) => Buffer.alloc(Math.round(RATE * 2 * s), 1);

/** @param {Buffer} pcm */
const fakeRecorder = (pcm) => {
  const r = { started: 0, stopped: 0, start: () => void r.started++, stop: async () => (r.stopped++, pcm) };
  return r;
};
/** @param {string} name @param {(pcm: Buffer) => Promise<string>} fn */
const engine = (name, fn) => {
  const e = { name, calls: 0, transcribe: (/** @type {Buffer} */ p) => (e.calls++, fn(p)) };
  return e;
};

test("a hold goes to the first engine; the words come back and the log has no words or audio", async () => {
  const dir = tmp();
  const logFile = path.join(dir, "speech.jsonl");
  const rec = fakeRecorder(second(2));
  const s = liveSpeech({ recorder: rec, engines: [engine("moonshine", async () => " a cat that catches fish ")], logFile });
  assert.equal(s.kind, "moonshine");
  assert.deepEqual(await s.stop(), { text: "" }, "nothing held, nothing heard");
  s.start();
  assert.deepEqual(await s.stop(), { text: "a cat that catches fish" });
  assert.equal(rec.started, 1);
  const lines = fs.readFileSync(logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].engine, "moonshine");
  assert.equal(lines[0].audio_ms, 2000);
  assert.equal(lines[0].words, 5);
  assert.doesNotMatch(fs.readFileSync(logFile, "utf8"), /cat|fish/);
  assert.deepEqual(fs.readdirSync(dir), ["speech.jsonl"], "no audio file anywhere");
});

test("Groq first; Moonshine answers when Groq fails, times out or the cabinet is offline", async () => {
  const moon = engine("moonshine", async () => "from moonshine");
  const groqOk = engine("groq", async () => "from groq");
  let s = liveSpeech({ recorder: fakeRecorder(second()), engines: [groqOk, moon] });
  assert.equal(s.kind, "groq+moonshine");
  s.start();
  assert.equal((await s.stop()).text, "from groq");
  assert.equal(moon.calls, 0);

  const groqDown = engine("groq", async () => Promise.reject(new Error("Groq answered 503")));
  s = liveSpeech({ recorder: fakeRecorder(second()), engines: [groqDown, moon] });
  s.start();
  assert.equal((await s.stop()).text, "from moonshine");

  const groqSlow = groqEngine({ key: "k", timeoutMs: 50, fetchFn: (_u, init) => new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))) });
  const dir = tmp();
  s = liveSpeech({ recorder: fakeRecorder(second()), engines: [groqSlow, moon], logFile: path.join(dir, "s.jsonl") });
  s.start();
  const alive = setInterval(() => {}, 20); // the timeout's timer doesn't hold the process open; the service's server does
  assert.equal((await s.stop()).text, "from moonshine");
  clearInterval(alive);
  assert.match(fs.readFileSync(path.join(dir, "s.jsonl"), "utf8"), /groq: timed out/);

  const groqNever = engine("groq", async () => "never");
  s = liveSpeech({ recorder: fakeRecorder(second()), engines: [groqNever, moon], online: () => false });
  s.start();
  assert.equal((await s.stop()).text, "from moonshine");
  assert.equal(groqNever.calls, 0, "offline: Groq isn't tried");
});

test("too short is silence, and no engine is asked; every engine failing is silence too", async () => {
  const e = engine("moonshine", async () => "x");
  let s = liveSpeech({ recorder: fakeRecorder(second(0.1)), engines: [e] });
  s.start();
  assert.deepEqual(await s.stop(), { text: "" });
  assert.equal(e.calls, 0);
  s = liveSpeech({ recorder: fakeRecorder(second()), engines: [engine("moonshine", async () => Promise.reject(new Error("down")))] });
  s.start();
  assert.deepEqual(await s.stop(), { text: "" });
});

test("the audio is wiped once the words are back", async () => {
  const pcm = second();
  const s = liveSpeech({ recorder: fakeRecorder(pcm), engines: [engine("moonshine", async () => "ok")] });
  s.start();
  await s.stop();
  assert.ok(pcm.every((b) => b === 0));
});

test("a fed clip or text stands in for the mic at the next hold", async () => {
  const dir = tmp();
  const wav = path.join(dir, "clip.wav");
  fs.writeFileSync(wav, wavOf(second(1.5)));
  /** @type {number[]} */
  const sizes = [];
  const rec = fakeRecorder(second());
  const s = liveSpeech({ recorder: rec, engines: [engine("moonshine", async (p) => (sizes.push(p.length), "heard the clip"))] });
  s.feed?.({ wav });
  s.feed?.({ text: "typed" });
  s.start();
  assert.equal((await s.stop()).text, "typed", "text first: the flows' say");
  s.start();
  assert.equal((await s.stop()).text, "heard the clip");
  assert.deepEqual(sizes, [RATE * 2 * 1.5]);
  assert.equal(rec.started, 0, "the mic isn't opened for a fed clip");
  s.start();
  await s.stop();
  assert.equal(rec.started, 1);
  assert.throws(() => s.feed?.({ wav: path.join(dir, "missing.wav") }));
});

test("WAVs: built in memory, and only 16 kHz mono 16-bit read back", () => {
  const pcm = Buffer.from([1, 2, 3, 4]);
  const w = wavOf(pcm);
  assert.equal(w.length, 48);
  assert.deepEqual(pcmOfWav(w), pcm);
  const stereo = Buffer.from(w);
  stereo.writeUInt16LE(2, 22);
  assert.throws(() => pcmOfWav(stereo), /16 kHz mono/);
  assert.throws(() => pcmOfWav(Buffer.from("not a wav at all, really")), /not a WAV/);
});

test("Groq: whisper-large-v3-turbo, the key as a bearer token, and errors don't quote the body", async () => {
  /** @type {any} */
  let seen = null;
  const g = groqEngine({
    key: "gsk_test",
    fetchFn: async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ text: " a racing game " }), { status: 200 });
    },
  });
  assert.equal(await g.transcribe(second()), "a racing game");
  assert.equal(seen.url, GROQ_URL);
  assert.equal(seen.init.headers.authorization, "Bearer gsk_test");
  const form = /** @type {FormData} */ (seen.init.body);
  assert.equal(form.get("model"), GROQ_MODEL);
  assert.equal(form.get("language"), "en");
  const file = /** @type {File} */ (form.get("file"));
  assert.equal(file.size, 44 + RATE * 2);
  assert.equal(groqTimeoutMs(second(1)), 3100, "3 s, plus 0.1 s a second of audio");
  assert.equal(groqTimeoutMs(second(30)), 6000);
  const bad = groqEngine({ key: "gsk_test", fetchFn: async () => new Response("gsk_test is invalid", { status: 401 }) });
  await assert.rejects(bad.transcribe(second()), (/** @type {any} */ e) => e.message === "Groq answered 401");
});

test("the capture device is the first one ALSA lists", () => {
  assert.equal(captureDevice("**** List of CAPTURE Hardware Devices ****\n"), null);
  const usb = "**** List of CAPTURE Hardware Devices ****\ncard 2: Device [USB PnP Sound Device], device 0: USB Audio [USB Audio]\n  Subdevices: 1/1\n";
  assert.equal(captureDevice(usb), "plughw:2,0");
  assert.equal(captureDevice("card 0: SoundCard [VirtIO SoundCard], device 1: virtio-snd [VirtIO PCM 1]\n"), "plughw:0,1");
});

/**
 * A stand-in for arecord: -l lists a device; recording writes samples until SIGINT. burst: that many seconds of
 * "speech" at once (2 s loud, 0.3 s quiet, over and over), as if held that long, then nothing until SIGINT.
 * It leaves a "wrote" file once its samples are in the pipe, so a test waits on that, not on the clock: under
 * a full test run's load, starting a Node process can take longer than any fixed sleep.
 */
/** Until the fake arecord has written its samples (its "wrote" file), then clears it for the next hold. @param {string} dir */
async function wrote(dir) {
  const f = path.join(dir, "wrote");
  for (let t = 0; !fs.existsSync(f); t += 20) {
    if (t > 60_000) throw new Error("the fake arecord never wrote");
    await new Promise((r) => setTimeout(r, 20));
  }
  fs.rmSync(f);
}

function fakeArecord(dir, { device = true, burst = 0 } = {}) {
  const bin = path.join(dir, "arecord");
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "-l") { ${device ? 'console.log("card 1: Mic [USB Mic], device 0: USB Audio [USB Audio]");' : 'console.log("**** List of CAPTURE Hardware Devices ****");'} process.exit(0); }
require("fs").writeFileSync(${JSON.stringify(path.join(dir, "args"))}, JSON.stringify(args));
if (${burst}) {
  const n = ${Math.round(burst * 16000)};
  const b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) b.writeInt16LE(i % 36800 < 32000 ? (i % 2 ? 3000 : -3000) : 0, i * 2);
  for (let at = 0; at < b.length; at += 65536) process.stdout.write(b.subarray(at, at + 65536));
  process.stdout.write("", () => require("fs").writeFileSync(${JSON.stringify(path.join(dir, "wrote"))}, ""));
  process.on("SIGINT", () => process.stdout.write("", () => process.exit(0)));
  setInterval(() => {}, 1000);
} else {
let n = 0;
const t = setInterval(() => process.stdout.write(Buffer.alloc(3200, 7), () => { if (++n === 3) require("fs").writeFileSync(${JSON.stringify(path.join(dir, "wrote"))}, ""); }), 20);
process.on("SIGINT", () => { clearInterval(t); process.stdout.write(Buffer.alloc(3200, 7), () => process.exit(0)); });
}
`,
  );
  fs.chmodSync(bin, 0o755);
  return bin;
}

test("arecord into memory: the device found, raw 16 kHz mono on stdout, nothing on disk", async () => {
  const dir = tmp();
  const rec = alsaRecorder({ arecord: fakeArecord(dir) });
  rec.start();
  await wrote(dir);
  const pcm = await rec.stop();
  assert.ok(pcm.length >= 3200 * 3, `got ${pcm.length} bytes`);
  const args = JSON.parse(fs.readFileSync(path.join(dir, "args"), "utf8"));
  assert.deepEqual(args, ["-q", "-D", "plughw:1,0", "-f", "S16_LE", "-r", "16000", "-c", "1", "-t", "raw"]);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["arecord", "args"]);
  assert.equal((await rec.stop()).length, 0, "a second stop has nothing");
});

test("no mic: the hold is silence, not a crash", async () => {
  const dir = tmp();
  /** @type {string[]} */
  const logged = [];
  const rec = alsaRecorder({ arecord: fakeArecord(dir, { device: false }), log: (m) => logged.push(m) });
  const s = liveSpeech({ recorder: rec, engines: [engine("moonshine", async () => "x")] });
  s.start();
  assert.deepEqual(await s.stop(), { text: "" });
  assert.match(logged.join("\n"), /no capture device/);
});

/** A stand-in for moonshine_helper.py that speaks its protocol: the text is the clip's length. */
function fakeHelper(dir, { fail = false } = {}) {
  const helper = path.join(dir, "helper.js");
  fs.writeFileSync(
    helper,
    `${fail ? 'console.log(JSON.stringify({ error: "no model" })); process.exit(1);' : ""}
console.log(JSON.stringify({ ready: true, load_ms: 5 }));
let buf = Buffer.alloc(0);
process.stdin.on("data", (d) => {
  buf = Buffer.concat([buf, d]);
  while (buf.length >= 4) {
    const n = buf.readUInt32LE(0);
    if (n === 0xffffffff) {
      buf = buf.subarray(4);
      require("fs").appendFileSync(${JSON.stringify(path.join(dir, "warmed"))}, "w");
      console.log(JSON.stringify({ text: "", ms: 1, warm: true }));
      continue;
    }
    if (buf.length < 4 + n) return;
    buf = buf.subarray(4 + n);
    console.log(JSON.stringify(n === 0 ? { text: "", ms: 0 } : { text: "bytes " + n, ms: 1 }));
  }
});
`,
  );
  return helper;
}

test("Moonshine's helper: loaded once, clips answered in order", async () => {
  const dir = tmp();
  /** @type {string[]} */
  const logged = [];
  const m = moonshineEngine({ python: process.execPath, helper: fakeHelper(dir), modelDir: "/m", arch: "medium-streaming", log: (x) => logged.push(x) });
  assert.equal(await m.ready, true);
  const [a, b] = await Promise.all([m.transcribe(Buffer.alloc(6400)), m.transcribe(Buffer.alloc(32000))]);
  assert.equal(a, "bytes 6400");
  assert.equal(b, "bytes 32000");
  assert.match(logged.join("\n"), /ready in 5 ms/);
  m.close?.();
});

test("Moonshine is warmed when a hold starts after a quiet spell, and the clip's answer is still its own", async () => {
  const dir = tmp();
  const m = moonshineEngine({ python: process.execPath, helper: fakeHelper(dir), modelDir: "/m", arch: "medium-streaming" });
  const s = liveSpeech({ recorder: fakeRecorder(Buffer.alloc(16000)), engines: [m] });
  s.start(); // idle since it began: warms
  assert.equal((await s.stop()).text, "bytes 16000");
  s.start(); // just used: no warm-up, and the answer still lines up
  assert.equal((await s.stop()).text, "bytes 16000");
  assert.equal(fs.readFileSync(path.join(dir, "warmed"), "utf8"), "w", "warmed once");
  m.close?.();
});

test("a helper that can't load the model makes Moonshine fail, so the hold is silence", async () => {
  const dir = tmp();
  const m = moonshineEngine({ python: process.execPath, helper: fakeHelper(dir, { fail: true }), modelDir: "/m", arch: "x" });
  assert.equal(await m.ready, false);
  await assert.rejects(m.transcribe(second()), /isn't running/);
  m.close?.();
});

test("cabinetSpeech: the stub without provisioning's speech.json; Groq first only with a key", () => {
  const dir = tmp();
  assert.equal(cabinetSpeech({ config: {}, speechFile: path.join(dir, "none.json"), logsDir: dir }), null);
  const file = path.join(dir, "speech.json");
  fs.writeFileSync(file, JSON.stringify({ python: process.execPath, helper: fakeHelper(dir), model_dir: "/m", arch: "medium-streaming" }));
  const a = cabinetSpeech({ config: {}, speechFile: file, logsDir: dir });
  assert.equal(a?.kind, "moonshine");
  /** @type {any} */ (a).close();
  const b = cabinetSpeech({ config: { groq_api_key: "gsk_x" }, speechFile: file, logsDir: dir });
  assert.equal(b?.kind, "groq+moonshine");
  /** @type {any} */ (b).close();
  assert.equal(cabinetSpeech({ config: { speech: "stub" }, speechFile: file, logsDir: dir }), null);
});

// ---------- no length cutoff (D470) ----------

/** Speech-like PCM: 2 s loud, 0.3 s quiet, over and over. @param {number} seconds */
function speechLike(seconds) {
  const n = Math.round(seconds * RATE);
  const b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) b.writeInt16LE(i % 36800 < 32000 ? (i % 2 ? 3000 : -3000) : 0, i * 2);
  return b;
}
/** A short wait, for the fake arecord to hand over what it wrote. @param {number} ms */
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

test("splitPcm: pieces no longer than the limit, cut in the quiet, and together exactly the audio", () => {
  const pcm = speechLike(95);
  const pieces = splitPcm(pcm, 30);
  assert.equal(pieces.length, 4);
  for (const p of pieces) assert.ok(p.length <= 30 * RATE * 2, `a piece of ${p.length / 2 / RATE} s`);
  assert.ok(Buffer.concat(pieces).equals(pcm));
  for (const p of pieces.slice(0, -1)) {
    const last = p.readInt16LE(p.length - 2);
    assert.equal(last, 0, "each cut lands in a quiet stretch");
  }
  assert.equal(splitPcm(speechLike(12), 30).length, 1, "short audio is one piece");
});

test("a 3-minute hold: arecord keeps it all, Groq gets it whole, and Moonshine falls back in 30 s pieces", async () => {
  const dir = tmp();
  const rec = alsaRecorder({ arecord: fakeArecord(dir, { burst: 180 }) });
  /** @type {number[]} */
  const groqSizes = [];
  let groqUp = true;
  const groq = groqEngine({
    key: "gsk_x",
    fetchFn: async (_u, init) => {
      const file = /** @type {File} */ (/** @type {FormData} */ (init?.body).get("file"));
      groqSizes.push(file.size);
      if (!groqUp) return new Response("", { status: 503 });
      return new Response(JSON.stringify({ text: `heard ${(file.size - 44) / 2 / RATE} seconds` }), { status: 200 });
    },
  });
  const m = moonshineEngine({ python: process.execPath, helper: fakeHelper(dir), modelDir: "/m", arch: "medium-streaming" });
  const logFile = path.join(dir, "speech.jsonl");
  const s = liveSpeech({ recorder: rec, engines: [groq, m], logFile });

  s.start();
  await wrote(dir); // the fake writes all 3 minutes at once
  let out = await s.stop();
  assert.equal(out.text, "heard 180 seconds", "all 180 s reached Groq, in one piece");
  assert.deepEqual(groqSizes, [44 + 180 * RATE * 2]);
  assert.deepEqual(Object.keys(out), ["text"]);

  groqUp = false;
  s.start();
  await wrote(dir);
  out = await s.stop();
  const pieces = [...out.text.matchAll(/bytes (\d+)/g)].map((x) => Number(x[1]));
  assert.ok(pieces.length >= 6, `Moonshine got ${pieces.length} pieces`);
  for (const b of pieces) assert.ok(b <= MOONSHINE_CHUNK_SECONDS * RATE * 2);
  assert.equal(pieces.reduce((a, b) => a + b, 0), 180 * RATE * 2, "every sample reached Moonshine");
  const last = JSON.parse(fs.readFileSync(logFile, "utf8").trim().split("\n").pop() ?? "{}");
  assert.equal(last.engine, "moonshine");
  assert.equal(last.audio_ms, 180000);
  m.close?.();
  s.close();
});

test("a 25-minute hold: arecord keeps every second, Groq gets it in pieces under its file limit, two at a time, in order", async () => {
  let inFlight = 0;
  let most = 0;
  /** @type {number[]} */
  const sizes = [];
  const groq = groqEngine({
    key: "gsk_x",
    fetchFn: async (_u, init) => {
      const file = /** @type {File} */ (/** @type {FormData} */ (init?.body).get("file"));
      const i = sizes.push(file.size);
      inFlight++;
      most = Math.max(most, inFlight);
      await settle(30 * (4 - i)); // later pieces answer first: the order must still hold
      inFlight--;
      return new Response(JSON.stringify({ text: `piece${i}` }), { status: 200 });
    },
  });
  const dir = tmp();
  const logFile = path.join(dir, "speech.jsonl");
  const s = liveSpeech({ recorder: alsaRecorder({ arecord: fakeArecord(dir, { burst: 25 * 60 }) }), engines: [groq], logFile });
  s.start();
  await wrote(dir); // the fake writes all 25 minutes at once
  const { text } = await s.stop();
  assert.equal(text, "piece1 piece2 piece3");
  const entry = JSON.parse(fs.readFileSync(logFile, "utf8").trim());
  assert.equal(entry.audio_ms, 25 * 60 * 1000, "not a second cut");
  assert.equal(entry.pieces, 3);
  assert.equal(sizes.length, 3);
  for (const n of sizes) assert.ok(n <= 44 + GROQ_CHUNK_SECONDS * RATE * 2 && n < 25 * 1000 * 1000, `a piece of ${n} bytes`);
  assert.equal(most, 2);
});
