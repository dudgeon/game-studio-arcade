// The service without a browser: makers, speech stub, Studio relay, logs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { dataPaths } from "@game-studio-arcade/studio-cli/src/config.js";
import { readLog } from "@game-studio-arcade/studio-cli/src/log.js";
import { firstName, makersStore, NAME_MAX } from "../src/makers.js";
import { stubSpeech } from "../src/speech.js";
import { createStudio, kidMessage } from "../src/studio.js";
import { startService } from "../src/server.js";
import { replayApi, REPLAY_LOCK, stepsFrom } from "../test-support/replay-api.js";

const FIXTURE = path.resolve(import.meta.dirname, "../../../studio-kit/cli/fixtures/penguin-catch");
const passing = {
  async validate() {
    return { ok: true, problems: [] };
  },
  async playtest() {
    return { ok: true, failing: [], report: { rules: [{ id: "R1", kind: "auto", status: "pass" }], generic: [] } };
  },
};
const failing = {
  ...passing,
  async playtest() {
    return { ok: false, failing: ["R1"], report: { rules: [{ id: "R1", kind: "auto", status: "fail" }], generic: [] } };
  },
};

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "gsa-svc-"));

/** @param {any} [o] */
function setup(o = {}) {
  const paths = dataPaths(tmp());
  const made = o.replay ?? replayApi({ dir: FIXTURE });
  const studio = createStudio({
    paths,
    api: o.api ?? (async () => made.api),
    lock: () => REPLAY_LOCK,
    kit: async () => ({ fileId: "file_k", hash: "h" }),
    checker: o.checker ?? passing,
    titleOf: () => "Penguin Catch",
    nameOf: () => "Alina",
  });
  /** @param {(s: any) => boolean} pred */
  const until = (pred) =>
    new Promise((resolve) => {
      if (pred(studio.state())) return resolve(studio.state());
      const stop = studio.subscribe((s) => {
        if (pred(s)) {
          stop();
          resolve(s);
        }
      });
    });
  return { paths, studio, until, made };
}

test("first names: first word, tidied, capped", () => {
  assert.equal(firstName("alina"), "Alina");
  assert.equal(firstName("  owen the great "), "Owen");
  assert.equal(firstName("Zoë"), "Zoë");
  assert.equal(firstName("O'Neil-Smith"), "O'Neil-Smith");
  assert.equal(firstName("x".repeat(99))?.length, NAME_MAX);
  for (const bad of ["", "   ", "!!!", "🐧", null]) assert.equal(firstName(bad), null);
});

test("makers: an open list, most recent first, never removed, same name same maker", () => {
  let t = Date.parse("2026-11-08T10:00:00Z");
  const file = path.join(tmp(), "makers.json");
  const m = makersStore({ file, now: () => new Date((t += 1000)) });
  assert.deepEqual(m.list(), []);
  const a = m.add("alina");
  const o = m.add("Owen");
  assert.equal(a?.guest, true);
  assert.equal(m.add("ALINA")?.id, a?.id);
  assert.deepEqual(m.list().map((x) => x.id), ["owen", "alina"]);
  m.touch("alina");
  assert.deepEqual(m.list().map((x) => x.id), ["alina", "owen"]);
  assert.equal(m.add("!!!"), null);
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  raw[1].hidden = true;
  fs.writeFileSync(file, JSON.stringify(raw));
  assert.deepEqual(m.list().map((x) => x.id), ["alina"]);
  assert.equal(m.read().length, 2, "hidden isn't gone");
  assert.equal(m.get(o?.id ?? "")?.name, "Owen");
});

test("speech stub: text in, transcript out only while held; silence when empty", async () => {
  const s = stubSpeech();
  s.start();
  assert.deepEqual(await s.stop(), { text: "" });
  s.feed?.({ text: "hello" });
  assert.deepEqual(await s.stop(), { text: "" }, "not held");
  s.start();
  assert.deepEqual(await s.stop(), { text: "hello" });
});

test("speech stub: a WAV needs to be one, with a transcript beside it", async () => {
  const dir = tmp();
  const wav = path.join(dir, "say.wav");
  const riff = Buffer.alloc(44);
  riff.write("RIFF", 0, "latin1");
  riff.write("WAVE", 8, "latin1");
  fs.writeFileSync(wav, riff);
  const s = stubSpeech();
  assert.throws(() => s.feed?.({ wav }), /no transcript/);
  fs.writeFileSync(path.join(dir, "say.txt"), "from the wav\n");
  s.feed?.({ wav });
  s.start();
  assert.deepEqual(await s.stop(), { text: "from the wav" });
  const notWav = path.join(dir, "no.wav");
  fs.writeFileSync(notWav, "this is not audio at all");
  assert.throws(() => s.feed?.({ wav: notWav }), /isn't a WAV/);
});

test("the recorded session relays through the service, commits and logs", async () => {
  const { studio, until, paths, made } = setup();
  studio.start({ maker: "alina", request: "a penguin game" });
  assert.throws(() => studio.start({ maker: "alina", request: "another" }), /already/);
  const seen = [];
  for (const [choice, said] of [["A"], ["B"], ["C", "slides like on ice"]]) {
    const s = await until((x) => x.pending?.kind === "question");
    seen.push(s.pending.question);
    assert.throws(() => studio.answer({ id: s.pending.id + 99, choice: "A" }), /gone/);
    assert.throws(() => studio.answer({ id: s.pending.id, choice: "Q" }), /isn't an answer/);
    studio.answer({ id: s.pending.id, choice, said });
  }
  assert.deepEqual(seen, ["What happens if you catch a boot?", "How should the game get harder?", "How does the penguin move?"]);
  const p = await until((x) => x.pending?.kind === "plan");
  assert.equal(p.pending.rules.length, 14);
  studio.answer({ id: p.pending.id, choice: "build" });
  const done = await until((x) => x.phase === "done");
  assert.equal(done.result.ok, true);
  assert.equal(done.result.title, "Penguin Catch");
  assert.ok(done.lines.includes("All done! Your penguin game is ready to play"));
  assert.ok(done.lines.every((/** @type {string} */ l) => !l.includes(paths.root)), "no paths on a kid's screen");
  assert.ok(made.mock.calls[0].startsWith("retrieveAgent:"), "D173: the check comes before anything else");

  const log = readLog(path.join(paths.logs, "studio_session.jsonl"));
  assert.equal(log.length, 1);
  assert.equal(log[0].maker, "alina");
  assert.equal(log[0].origin, "cabinet");
  assert.equal(log[0].outcome, "committed");
  assert.equal(log[0].brief, "applied-agent");
  assert.equal(log[0].brief_check.match, true);
  assert.equal(log[0].turns[2].said, "slides like on ice");
  assert.equal(readLog(path.join(paths.logs, "cart_version.jsonl")).length, 1);
  assert.ok(fs.existsSync(path.join(paths.carts, done.result.cart_id, "game.js")));
  studio.acknowledge();
  assert.equal(studio.state().phase, "idle");
});

test("make it now: D ends the questions, the later ones answered for the kid", async () => {
  const { studio, until, paths } = setup();
  studio.start({ maker: "alina", request: "a penguin game" });
  const s = await until((x) => x.pending?.kind === "question");
  studio.answer({ id: s.pending.id, choice: "D" });
  const p = await until((x) => x.pending?.kind === "plan");
  studio.answer({ id: p.pending.id, choice: "build" });
  await until((x) => x.phase === "done");
  const [rec] = readLog(path.join(paths.logs, "studio_session.jsonl"));
  assert.equal(rec.ended_by, "make_it_now");
});

test("a stale applied brief stops before anything starts, in kid words on screen and details in the log (D173)", async () => {
  const stale = replayApi({ dir: FIXTURE, appliedAgent: { version: 1, system: "an old brief", tools: [] } });
  const { studio, until, paths } = setup({ replay: stale });
  studio.start({ maker: "alina", request: "a penguin game" });
  const done = await until((x) => x.phase === "done");
  assert.equal(done.result.ok, false);
  assert.match(done.result.message, /isn't ready/);
  assert.doesNotMatch(done.result.message, /studio\.md/);
  assert.ok(!stale.mock.calls.includes("createSession"), "no session");
  const [rec] = readLog(path.join(paths.logs, "studio_session.jsonl"));
  assert.equal(rec.outcome, "error");
  assert.match(rec.error, /doesn't match agents\/studio\.md/);
  assert.equal(rec.request, "a penguin game");
});

test("failed checks: nothing on the shelf, the kid told plainly, everything logged", async () => {
  const { studio, until, paths } = setup({ checker: failing });
  studio.start({ maker: "alina", request: "a penguin game" });
  for (let i = 0; i < 3; i++) {
    const s = await until((x) => x.pending?.kind === "question");
    studio.answer({ id: s.pending.id, choice: "A" });
  }
  const p = await until((x) => x.pending?.kind === "plan");
  studio.answer({ id: p.pending.id, choice: "build" });
  const done = await until((x) => x.phase === "done");
  assert.equal(done.result.ok, false);
  assert.match(done.result.message, /didn't pass its tests/);
  assert.equal(readLog(path.join(paths.logs, "studio_session.jsonl"))[0].outcome, "checks_failed");
  assert.equal(readLog(path.join(paths.logs, "cart_version.jsonl")).length, 0);
});

test("no network: logged with the request and turns, and the error isn't on screen", async () => {
  const { studio, until, paths } = setup({
    api: async () => {
      throw new Error("connect ECONNREFUSED 1.2.3.4");
    },
  });
  studio.start({ maker: "alina", request: "a penguin game" });
  const done = await until((x) => x.phase === "done");
  assert.doesNotMatch(done.result.message, /ECONNREFUSED/);
  const [rec] = readLog(path.join(paths.logs, "studio_session.jsonl"));
  assert.equal(rec.outcome, "error");
  assert.match(rec.error, /ECONNREFUSED/);
  assert.deepEqual(rec.turns, []);
});

test("budget reached and a refusal get their own words", () => {
  assert.match(kidMessage({ outcome: "no_cart", stop_reason: "budget_reached" }), /building time/);
  assert.match(kidMessage({ outcome: "no_cart", stop_reason: "refusal" }), /different idea/);
  assert.match(kidMessage({ outcome: "no_cart", stop_reason: "end_turn" }), /couldn't finish/);
  assert.match(kidMessage({ outcome: "nonsense" }), /went wrong/);
});

test("a session that dies mid-stream ends cleanly", async () => {
  const script = stepsFrom([{ type: "user.message" }, { id: "i", type: "session.status_terminated" }]);
  const { studio, until } = setup({ replay: replayApi({ script, outputs: {} }) });
  studio.start({ maker: "alina", request: "x" });
  const done = await until((x) => x.phase === "done");
  assert.equal(done.result.ok, false);
});

test("the service won't start on a bad config, and doesn't quote it (D131, D185)", () => {
  const bin = path.resolve(import.meta.dirname, "../bin/cabinet-service.js");
  const KEY = "fake-cabinet-key-not-real";
  /** @param {string} body @param {number} mode */
  const start = (body, mode) => {
    const dir = tmp();
    const file = path.join(dir, "service.json");
    fs.writeFileSync(file, body);
    fs.chmodSync(file, mode);
    return spawnSync(process.execPath, [bin, "--port", "0", "--data", dir, "--config", file], { encoding: "utf8", timeout: 20000 });
  };
  const open = start(JSON.stringify({ anthropic_api_key: KEY, agent_id: "a", environment_id: "e" }), 0o644);
  assert.equal(open.status, 1);
  assert.match(open.stderr, /0600/);
  const broken = start(`{"anthropic_api_key": "${KEY}"`, 0o600);
  assert.equal(broken.status, 1);
  assert.ok(!broken.stderr.includes(KEY), "a broken config isn't quoted");
  const noAgent = start(JSON.stringify({ anthropic_api_key: KEY }), 0o600);
  assert.equal(noAgent.status, 1);
  assert.match(noAgent.stderr, /agent_id/);
  assert.ok(!noAgent.stderr.includes(KEY));
});

test("the server: routes, origin guard, bad input", async () => {
  const data = tmp();
  const paths = dataPaths(data);
  const { studio } = setup();
  const s = await startService({ studio, makers: makersStore({ file: path.join(data, "makers.json") }), speech: stubSpeech(), libraryDir: paths.carts, logsDir: paths.logs, port: 0 });
  /** @param {string} u @param {any} [body] @param {any} [headers] */
  const post = (u, body = {}, headers = {}) => fetch(s.url + u, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  try {
    assert.match(await (await fetch(`${s.url}/`)).text(), /launcher\/app\.js/);
    assert.equal((await fetch(`${s.url}/launcher/../src/server.js`)).status, 404);
    assert.equal((await fetch(`${s.url}/launcher/nope.js`)).status, 404);
    assert.deepEqual((await (await fetch(`${s.url}/api/config`)).json()).speech, "stub");
    assert.deepEqual(await (await fetch(`${s.url}/api/carts`)).json().then((b) => b.carts), [], "the player's handler is mounted");
    assert.equal((await post("/api/makers", { name: "!!!" })).status, 400);
    assert.equal((await post("/api/makers", { name: "alina" }, { Origin: "http://evil.example" })).status, 403);
    assert.equal((await post("/api/makers", { name: "alina" }, { Origin: "null" })).status, 403);
    assert.equal((await (await post("/api/makers", { name: "alina" })).json()).maker.id, "alina");
    assert.equal((await post("/api/studio/start", { maker: "nobody", request: "x" })).status, 400);
    assert.equal((await post("/api/studio/start", { maker: "alina", request: "  " })).status, 400);
    assert.equal((await post("/api/studio/answer", { id: 1, choice: "A" })).status, 409);
    assert.equal((await post("/api/speech/feed", { text: "hi" })).status, 200);
    await post("/api/speech/start");
    assert.equal((await (await post("/api/speech/stop")).json()).text, "hi");
    assert.equal((await post("/api/nope")).status, 404);
  } finally {
    await s.close();
  }
});
