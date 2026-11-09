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
    questionTimeoutMs: o.questionTimeoutMs,
    warningMs: o.warningMs,
  });
  /** @param {(s: any) => boolean} pred */
  const until = (pred) =>
    new Promise((resolve) => {
      if (pred(studio.state())) return resolve(studio.state());
      // The walk-away timers don't hold a process open, so this has to.
      const alive = setInterval(() => {}, 20);
      const stop = studio.subscribe((s) => {
        if (pred(s)) {
          clearInterval(alive);
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
  /** @type {string[]} */
  let lines = [];
  studio.subscribe((x) => {
    if (x.lines) lines = x.lines;
  });
  studio.answer({ id: p.pending.id, choice: "build" });
  const done = await until((x) => x.results?.length);
  assert.equal(done.results[0].ok, true);
  assert.equal(done.results[0].maker_name, "Alina");
  assert.equal(done.results[0].title, "Penguin Catch");
  assert.ok(lines.includes("All done! Your penguin game is ready to play"));
  assert.ok(lines.every((/** @type {string} */ l) => !l.includes(paths.root)), "no paths on a kid's screen");
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
  assert.ok(fs.existsSync(path.join(paths.carts, done.results[0].cart_id, "game.js")));
  assert.equal(studio.state().phase, "idle", "Make is free as soon as it ends (D192)");
  studio.viewResult(done.results[0].id);
  assert.deepEqual(studio.state(), { phase: "idle" });
});

test("make it now: D ends the questions, the later ones answered for the kid", async () => {
  const { studio, until, paths } = setup();
  studio.start({ maker: "alina", request: "a penguin game" });
  const s = await until((x) => x.pending?.kind === "question");
  studio.answer({ id: s.pending.id, choice: "D" });
  const p = await until((x) => x.pending?.kind === "plan");
  studio.answer({ id: p.pending.id, choice: "build" });
  await until((x) => x.results?.length);
  const [rec] = readLog(path.join(paths.logs, "studio_session.jsonl"));
  assert.equal(rec.ended_by, "make_it_now");
});

test("a stale applied brief stops before anything starts, in kid words on screen and details in the log (D173)", async () => {
  const stale = replayApi({ dir: FIXTURE, appliedAgent: { version: 1, system: "an old brief", tools: [] } });
  const { studio, until, paths } = setup({ replay: stale });
  studio.start({ maker: "alina", request: "a penguin game" });
  const done = await until((x) => x.results?.length);
  assert.equal(done.results[0].ok, false);
  assert.match(done.results[0].message, /isn't ready/);
  assert.doesNotMatch(done.results[0].message, /studio\.md/);
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
  const done = await until((x) => x.results?.length);
  assert.equal(done.results[0].ok, false);
  assert.match(done.results[0].message, /didn't pass its tests/);
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
  const done = await until((x) => x.results?.length);
  assert.doesNotMatch(done.results[0].message, /ECONNREFUSED/);
  const [rec] = readLog(path.join(paths.logs, "studio_session.jsonl"));
  assert.equal(rec.outcome, "error");
  assert.match(rec.error, /ECONNREFUSED/);
  assert.deepEqual(rec.turns, []);
});

test("a question nobody answers: a warning, then released, archived and logged; Make is free (D188)", async () => {
  const replay = replayApi({ dir: FIXTURE });
  const { studio, until, paths } = setup({ replay, questionTimeoutMs: 120, warningMs: 60 });
  studio.start({ maker: "alina", request: "a penguin game" });
  const first = await until((x) => x.pending?.kind === "question");
  studio.answer({ id: first.pending.id, choice: "A" });
  const q = await until((x) => x.pending?.question === "How should the game get harder?");
  assert.equal(q.pending.warn, false);
  const warned = await until((x) => x.pending?.warn === true);
  assert.equal(warned.pending.id, q.pending.id);
  const gone = await until((x) => x.phase === "idle");
  assert.match(gone.notice.message, /away for a while/);
  assert.equal(fs.existsSync(path.join(paths.root, "studio-run.json")), false, "the journal has gone");
  // Make is free straight away, even before the API calls finish.
  studio.start({ maker: "alina", request: "another" });
  assert.equal(studio.state().phase, "running");
  assert.equal(studio.state().notice, undefined);
  await new Promise((r) => setTimeout(r, 200));
  const rec = readLog(path.join(paths.logs, "studio_session.jsonl")).find((r) => r.outcome === "abandoned");
  assert.equal(rec.outcome, "abandoned");
  assert.equal(rec.ended_by, "timed_out");
  assert.equal(rec.id, "sesn_replay");
  assert.equal(rec.request, "a penguin game");
  assert.deepEqual(rec.turns.map((/** @type {any} */ t) => t.choice), ["A"]);
  assert.deepEqual(rec.archive, { ok: true });
  assert.ok(replay.mock.calls.includes("archiveSession"));
  assert.ok(!replay.mock.calls.some((c) => /delete/i.test(c)), "sessions aren't deleted (D5)");
  assert.ok(fs.existsSync(path.join(paths.sessions, "sesn_replay", "events.jsonl")), "its events are kept");
});

test("a key pressed resets the clock and clears the warning (D188)", async () => {
  const { studio, until } = setup({ questionTimeoutMs: 200, warningMs: 100 });
  studio.start({ maker: "alina", request: "a penguin game" });
  await until((x) => x.pending?.kind === "question");
  await until((x) => x.pending?.warn === true);
  studio.stillHere();
  assert.equal(studio.state().pending.warn, false);
  await new Promise((r) => setTimeout(r, 150));
  studio.stillHere();
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(studio.state().phase, "running", "past the first deadline, and still waiting");
  assert.ok(studio.state().pending);
});

test("the kid chooses to stop: released with no message, and stop needs something waiting (D188)", async () => {
  const replay = replayApi({ dir: FIXTURE });
  const { studio, until, paths } = setup({ replay });
  assert.throws(() => studio.stop(), /nothing is waiting/);
  studio.start({ maker: "alina", request: "a penguin game" });
  await until((x) => x.pending?.kind === "question");
  studio.stop();
  assert.deepEqual(studio.state(), { phase: "idle" });
  await new Promise((r) => setTimeout(r, 100));
  const [rec] = readLog(path.join(paths.logs, "studio_session.jsonl"));
  assert.equal(rec.outcome, "abandoned");
  assert.equal(rec.ended_by, "stopped");
});

test("an archive that's refused interrupts and tries again; one that fails is logged and Make stays free (D188)", async () => {
  const once = replayApi({ dir: FIXTURE, archiveRefusals: 1 });
  const a = setup({ replay: once });
  a.studio.start({ maker: "alina", request: "x" });
  await a.until((x) => x.pending?.kind === "question");
  a.studio.stop();
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(readLog(path.join(a.paths.logs, "studio_session.jsonl"))[0].archive, { ok: true });
  assert.ok(once.mock.sent.some((e) => e.type === "user.interrupt"));

  const never = replayApi({ dir: FIXTURE, archiveRefusals: 9 });
  const b = setup({ replay: never });
  b.studio.start({ maker: "alina", request: "x" });
  await b.until((x) => x.pending?.kind === "question");
  b.studio.stop();
  assert.equal(b.studio.state().phase, "idle");
  await new Promise((r) => setTimeout(r, 200));
  const rec = readLog(path.join(b.paths.logs, "studio_session.jsonl"))[0];
  assert.equal(rec.archive.ok, false);
  assert.match(rec.archive.error, /can't be archived/);
});

/** @param {any} paths @param {any} journal */
const leaveJournal = (paths, journal) => {
  fs.mkdirSync(paths.root, { recursive: true });
  fs.writeFileSync(path.join(paths.root, "studio-run.json"), JSON.stringify({ session_id: "sesn_replay", maker: "alina", maker_name: "Alina", request: "a penguin game", turns: [], answered: 0, waiting: false, started_at: "2026-11-08T20:00:00Z", ...journal }));
};
/** @param {any} paths @param {any} api @param {any} [extra] */
const reboot = (paths, api, extra = {}) =>
  createStudio({ paths, api, lock: () => REPLAY_LOCK, kit: async () => ({ fileId: "f", hash: "h" }), checker: passing, titleOf: () => "Penguin Catch", recheckMs: 20, ...extra });
const logged = (/** @type {any} */ paths, type = "studio_session") => readLog(path.join(paths.logs, `${type}.jsonl`));
/** @param {() => boolean} pred */
const eventually = async (pred) => {
  for (let i = 0; i < 400 && !pred(); i++) await new Promise((r) => setTimeout(r, 25));
  assert.ok(pred(), "never happened");
};

test("a restart mid-question: logged, told, archived, since nobody can answer it (D189, D191)", async () => {
  const a = setup();
  a.studio.start({ maker: "alina", request: "a penguin game" });
  const q = await a.until((x) => x.pending?.kind === "question");
  a.studio.answer({ id: q.pending.id, choice: "B" });
  await a.until((x) => x.pending?.question === "How should the game get harder?");
  // The process dies here: nothing runs after this. A new one starts on the same data.
  const journal = JSON.parse(fs.readFileSync(path.join(a.paths.root, "studio-run.json"), "utf8"));
  assert.equal(journal.waiting, true);
  assert.equal(journal.answered, 1);
  const replay = replayApi({ dir: FIXTURE, resume: { answered: 1 } });
  const b = reboot(a.paths, async () => replay.api);
  const s = b.state();
  assert.equal(s.phase, "idle");
  assert.match(s.notice.message, /didn't get finished/);
  const [rec] = logged(a.paths);
  assert.equal(rec.outcome, "service_restarted");
  assert.equal(rec.session_left_running, true);
  assert.equal(rec.id, "sesn_replay");
  assert.equal(rec.request, "a penguin game");
  assert.deepEqual(rec.turns.map((/** @type {any} */ t) => t.choice), ["B"]);
  assert.equal(fs.existsSync(path.join(a.paths.root, "studio-run.json")), false);
  b.dismissNotice(s.notice.id + 1);
  assert.ok(b.state().notice, "another message's id doesn't clear it");
  b.dismissNotice(s.notice.id);
  assert.deepEqual(b.state(), { phase: "idle" });
  await b.collectLeft();
  const rel = logged(a.paths).find((r) => r.outcome === "abandoned");
  assert.equal(rel.ended_by, "no_one_to_answer");
  assert.deepEqual(rel.archive, { ok: true });
  assert.deepEqual(b.state(), { phase: "idle" }, "they've been told; no entry as well");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(a.paths.root, "studio-left.json"), "utf8")), []);
  // And a clean start has nothing to report.
  const c = reboot(dataPaths(tmp()), async () => replayApi({ dir: FIXTURE }).api);
  assert.deepEqual(c.state(), { phase: "idle" });
  await c.collectLeft();
  a.studio.stop();
});

test("a restart mid-build: the session is picked up, its cart collected and on the shelf, then archived (D191)", async () => {
  const paths = dataPaths(tmp());
  leaveJournal(paths, { answered: 4, kit_hash: "abc", lock: REPLAY_LOCK });
  const replay = replayApi({ dir: FIXTURE, resume: { answered: 4 } });
  const b = reboot(paths, async () => replay.api);
  assert.match(b.state().notice.message, /may still finish/);
  await b.collectLeft();

  const r = b.state().results[0];
  assert.equal(r.ok, true);
  assert.equal(r.maker_name, "Alina");
  assert.equal(r.note, "It finished while the cabinet was restarting.");
  assert.equal(b.state().phase, "idle");

  const rec = logged(paths).find((x) => x.outcome === "committed");
  assert.equal(rec.id, "sesn_replay");
  assert.equal(rec.resumed_after_restart, true);
  assert.equal(rec.playtest.local.ok, true);
  assert.equal(rec.kit, "abc");
  assert.deepEqual(rec.turns.map((/** @type {any} */ t) => t.choice), ["A", "B", "C"], "turns rebuilt from the session's history");
  assert.equal(rec.turns[2].said, "slides left and right but really slippery like on ice");
  assert.deepEqual(rec.plan_turns.map((/** @type {any} */ t) => t.choice), ["build"]);
  assert.ok(fs.existsSync(path.join(paths.carts, r.cart_id, "game.js")));
  assert.equal(logged(paths, "cart_version")[0].session_id, "sesn_replay");

  const calls = replay.mock.calls;
  assert.ok(!calls.includes("createSession"), "no new session");
  assert.ok(!calls.includes("send:user.message"));
  assert.ok(replay.mock.results.size > 0, "tell_player is relayed, or the session would stall");
  assert.ok(calls.indexOf("archiveSession") > calls.findIndex((c) => c.startsWith("download:")), "archived after collecting");
  assert.ok(!calls.some((c) => /delete/i.test(c)));
  assert.deepEqual(logged(paths, "studio_session_correction")[0].archive, { ok: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(paths.root, "studio-left.json"), "utf8")), []);
});

test("picked up and failing its checks: nothing on the shelf, the kid told, and archived (D191)", async () => {
  const paths = dataPaths(tmp());
  leaveJournal(paths, { answered: 4 });
  const replay = replayApi({ dir: FIXTURE, resume: { answered: 4 } });
  const b = reboot(paths, async () => replay.api, { checker: failing });
  await b.collectLeft();
  const r = b.state().results[0];
  assert.equal(r.ok, false);
  assert.match(r.message, /didn't pass its tests/);
  assert.equal(logged(paths, "cart_version").length, 0);
  assert.ok(replay.mock.calls.includes("archiveSession"));
});

test("a question that comes up after the restart gets an entry, not silence (D191)", async () => {
  const paths = dataPaths(tmp());
  leaveJournal(paths, { answered: 0, waiting: false });
  const b = reboot(paths, async () => replayApi({ dir: FIXTURE, resume: { answered: 0 } }).api);
  await b.collectLeft();
  assert.match(b.state().results[0].message, /nobody could answer/);
  assert.equal(logged(paths).find((x) => x.outcome === "abandoned").ended_by, "no_one_to_answer");
});

test("no network: it stays on the list and tries again; another restart doesn't log it twice (D191)", async () => {
  const paths = dataPaths(tmp());
  leaveJournal(paths, { answered: 4 });
  let tries = 0;
  const flaky = async () => {
    if (++tries < 3) throw new Error("connect ECONNREFUSED");
    return replayApi({ dir: FIXTURE, resume: { answered: 4 } }).api;
  };
  const refused = reboot(paths, async () => {
    throw new Error("connect ECONNREFUSED");
  }, { recheckMs: 3_600_000 });
  await refused.collectLeft();
  assert.equal(JSON.parse(fs.readFileSync(path.join(paths.root, "studio-left.json"), "utf8")).length, 1, "still to collect");

  const b = reboot(paths, flaky);
  assert.equal(logged(paths).filter((x) => x.outcome === "service_restarted").length, 1);
  assert.equal(b.state().notice, undefined, "it's already been said");
  const alive = setInterval(() => {}, 20);
  await b.collectLeft();
  await eventually(() => b.state().results?.length === 1);
  clearInterval(alive);
  assert.equal(b.state().results[0].ok, true);
  assert.equal(tries, 3);
});

test("a session the API no longer has is logged and dropped (D191)", async () => {
  const paths = dataPaths(tmp());
  leaveJournal(paths, { answered: 4 });
  const b = reboot(paths, async () => {
    throw Object.assign(new Error("not found"), { status: 404 });
  });
  await b.collectLeft();
  assert.match(logged(paths, "studio_session_correction")[0].why, /no longer has/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(paths.root, "studio-left.json"), "utf8")), []);
});

test("how a make ended is an entry: Make is free, and it stays until viewed, across a restart (D192)", async () => {
  const { studio, until, paths } = setup();
  studio.start({ maker: "alina", request: "a penguin game" });
  const s = await until((x) => x.pending?.kind === "question");
  studio.answer({ id: s.pending.id, choice: "D" });
  const p = await until((x) => x.pending?.kind === "plan");
  studio.answer({ id: p.pending.id, choice: "build" });
  const done = await until((x) => x.results?.length);
  const r = done.results[0];
  assert.equal(done.phase, "idle");
  assert.equal(r.maker, "alina");
  assert.equal(typeof r.run_id, "number");
  const after = reboot(paths, async () => replayApi({ dir: FIXTURE }).api);
  assert.equal(after.state().results[0].id, r.id, "still there after a restart");
  after.viewResult(r.id);
  assert.deepEqual(after.state(), { phase: "idle" });
  const kept = JSON.parse(fs.readFileSync(path.join(paths.root, "studio-results.json"), "utf8"));
  assert.equal(kept.length, 1, "viewed, not removed");
  assert.ok(kept[0].viewed_at);
});

test("a make that ends normally leaves no journal (D189)", async () => {
  const { studio, until, paths } = setup();
  const journal = path.join(paths.root, "studio-run.json");
  studio.start({ maker: "alina", request: "a penguin game" });
  assert.ok(fs.existsSync(journal));
  const s = await until((x) => x.pending?.kind === "question");
  studio.answer({ id: s.pending.id, choice: "D" });
  const p = await until((x) => x.pending?.kind === "plan");
  studio.answer({ id: p.pending.id, choice: "build" });
  await until((x) => x.results?.length);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(fs.existsSync(journal), false);
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
  const done = await until((x) => x.results?.length);
  assert.equal(done.results[0].ok, false);
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
