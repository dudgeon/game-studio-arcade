// The publish gate (D310): the cabinet re-tests a game in its own Chromium before the
// shelf, at low priority, and never while a game is being played.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dataPaths } from "@game-studio-arcade/studio-cli/src/config.js";
import { defaultChecker } from "@game-studio-arcade/studio-cli/src/checks.js";
import { readLog } from "@game-studio-arcade/studio-cli/src/log.js";
import { findChromium, findPlaywright } from "@game-studio-arcade/playtest";
import { createGate, gateSettings, gatedChecker, playTracker, guestGate, cabinetProfile, PI_BUDGET_MS, liveGateRuns } from "../src/gate.js";
import { createStudio } from "../src/studio.js";
import { potStore } from "../src/pot.js";
import { startService } from "../src/server.js";
import { makersStore } from "../src/makers.js";
import { stubSpeech } from "../src/speech.js";
import { createGuests, startGuestServer } from "../src/guests.js";
import { replayApi, REPLAY_LOCK, usageOf } from "../test-support/replay-api.js";

const FIXTURE = path.resolve(import.meta.dirname, "../../../studio-kit/cli/fixtures/penguin-catch");
const PT_FIXTURES = path.resolve(import.meta.dirname, "../../../studio-kit/playtest/test/fixtures");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "gsa-gate-"));
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
/** Until it's so, however long a busy mini takes. The time is the give-up for a thing that never comes, not a pace. @param {() => boolean} pred @param {string} what */
const eventually = async (pred, what) => {
  for (const end = Date.now() + 120_000; !pred() && Date.now() < end; ) await sleep(20);
  assert.ok(pred(), what);
};

/** A Chromium to run real gates on: GSA_CHROMIUM, Playwright's full build, or the machine's own. */
function chromium() {
  if (process.env.GSA_CHROMIUM) return process.env.GSA_CHROMIUM;
  try {
    const own = findPlaywright().playwright.chromium.executablePath();
    if (fs.existsSync(own)) return own;
  } catch {}
  return findChromium();
}
const CHROMIUM = chromium();
const noChromium = !CHROMIUM && "there's no Chromium here";
/** Settings for a real gate here: the virtual cabinet's budget, but a little nicer to a laptop. */
const realSettings = () => ({ ...gateSettings({ profile: "virtual" }), chromium: CHROMIUM, nice: 10 });

/** A report as the harness gives it. @param {boolean} ok */
const report = (ok) => ({
  ok,
  rules: [{ id: "R1", kind: "auto", status: ok ? "pass" : "fail", reason: ok ? null : "the basket didn't move" }],
  generic: [{ id: "loads", status: "pass", reason: null }],
  coverage: [],
  frameTime: { meanMs: 1, p95Ms: 2, maxMs: 3, frames: 2400, budgetMs: 5.57 },
});

test("settings: the virtual cabinet's frame budget is the Pi's over its cpu factor, labelled virtual (D128)", () => {
  const v = gateSettings({ profile: "virtual" });
  assert.equal(v.host, "virtual");
  assert.equal(v.cpuFactor, 3);
  assert.equal(v.budgetMs, Math.round((PI_BUDGET_MS / 3) * 100) / 100);
  assert.equal(v.nice, 19);
  const p = gateSettings({ profile: "picade" });
  assert.equal(p.host, "picade");
  assert.equal(p.budgetMs, PI_BUDGET_MS);
  assert.equal(gateSettings({ profile: "virtual", gate: { cpu_factor: 4 } }).budgetMs, 4.18);
  assert.equal(gateSettings({ profile: null }).host, "dev");
  const conf = path.join(tmp(), "cabinet.conf");
  fs.writeFileSync(conf, "profile=virtual\nplayers=1\n");
  assert.equal(cabinetProfile(conf), "virtual");
  assert.equal(cabinetProfile(path.join(tmp(), "none")), null);
});

test("a play counts until it ends, or until the launcher has been quiet for 30 s", () => {
  let t = 0;
  const p = playTracker({ now: () => t });
  assert.equal(p.playing(), false);
  p.set(true, "penguin-catch");
  assert.equal(p.playing(), true);
  assert.equal(p.what(), "penguin-catch");
  t = 29_000;
  assert.equal(p.playing(), true);
  t = 30_000;
  assert.equal(p.playing(), false, "a launcher that went away can't hold the gate forever");
  p.set(true);
  p.set(false);
  assert.equal(p.playing(), false);
});

test("the gate waits while a game is being played, then runs (D310)", async () => {
  let playing = true;
  /** @type {string[][]} */
  const calls = [];
  const gate = createGate({
    settings: gateSettings({ profile: "virtual" }),
    playing: () => playing,
    logsDir: tmp(),
    pollMs: 10,
    run: async (args) => (calls.push(args), { driver: "browser", fallback: null, report: report(true) }),
  });
  const r = gate.cart("/carts/x");
  await sleep(80);
  assert.equal(calls.length, 0, "nothing runs while a game is being played");
  assert.equal(gate.busy(), true);
  playing = false;
  const done = await r;
  assert.equal(done.ok, true);
  assert.ok(done.waited_s >= 0, String(done.waited_s));
  assert.deepEqual(calls[0].slice(0, 4), ["--cart", "/carts/x", "--budget-ms", "5.57"]);
  assert.equal(gate.busy(), false);
});

test("a game started mid-test stops the test; it runs again when the game ends, so play is never interrupted (D310)", async () => {
  let playing = false;
  let runs = 0;
  const logs = tmp();
  const gate = createGate({
    settings: gateSettings({ profile: "virtual" }),
    playing: () => playing,
    logsDir: logs,
    pollMs: 10,
    // The first run is still going whenever the game starts: it ends only by being stopped. The run after it
    // finishes. So the order is the test's, not the clock's.
    run: (_args, o) =>
      new Promise((resolve, reject) => {
        runs++;
        if (runs > 1) return resolve({ driver: "browser", fallback: null, report: report(true) });
        o.signal.addEventListener("abort", () => {
          reject(new Error("stopped: a game started"));
          sayStopped();
        });
      }),
  });
  /** @type {() => void} */
  let sayStopped = () => {};
  const stopped = new Promise((resolve) => (sayStopped = () => resolve(undefined)));
  const r = gate.cart("/carts/x", { what: "Penguin Catch" });
  await eventually(() => runs === 1, "the test is running");
  playing = true;
  await stopped;
  await sleep(50); // several of the gate's 10 ms looks at whether the game is still on
  assert.equal(runs, 1, "and it doesn't run again while the game is on");
  playing = false;
  const done = await r;
  assert.equal(done.ok, true);
  assert.equal(done.restarts, 1);
  assert.equal(runs, 2);
  const logged = readLog(path.join(logs, "publish_gate.jsonl"));
  assert.equal(logged.length, 1);
  assert.equal(logged[0].what, "Penguin Catch");
  assert.equal(logged[0].restarts, 1);
  assert.equal(logged[0].report, undefined, "the log keeps the summary, not the whole report");
});

test("one test at a time, in order", async () => {
  let now = 0;
  let most = 0;
  /** @type {string[]} */
  const order = [];
  const gate = createGate({
    settings: gateSettings({ profile: "virtual" }),
    playing: () => false,
    logsDir: tmp(),
    run: async (args) => {
      now++;
      most = Math.max(most, now);
      await sleep(20);
      order.push(args[1]);
      now--;
      return { driver: "browser", fallback: null, report: report(args[1] !== "/b") };
    },
  });
  const [a, b, c] = await Promise.all([gate.cart("/a"), gate.cart("/b"), gate.cart("/c")]);
  assert.equal(most, 1);
  assert.deepEqual(order, ["/a", "/b", "/c"]);
  assert.deepEqual([a.ok, b.ok, c.ok], [true, false, true]);
  assert.deepEqual(b.failing, [{ id: "R1", passed: false, reason: "the basket didn't move" }]);
});

test("before calibration a slow frame time is logged, never blocking; once calibrated it blocks (D311)", async () => {
  const slow = () => {
    const r = report(true);
    return { ...r, ok: false, generic: [...r.generic, { id: "frame-time", status: "fail", reason: "the slowest 5% took 9 ms" }] };
  };
  const run = async () => ({ driver: "browser", fallback: null, report: slow() });
  for (const profile of ["virtual", "picade"]) {
    const g = createGate({ settings: gateSettings({ profile }), playing: () => false, logsDir: tmp(), run });
    const r = await g.cart("/a");
    assert.equal(r.ok, true, `${profile}: a guessed budget doesn't keep a game off the shelf`);
    assert.equal(r.frame_time_blocks, false);
    assert.deepEqual(r.advisory?.map((f) => f.id), ["generic:frame-time"]);
  }
  const calibrated = createGate({ settings: gateSettings({ profile: "picade", gate: { calibrated: true } }), playing: () => false, logsDir: tmp(), run });
  const r = await calibrated.cart("/a");
  assert.equal(r.ok, false);
  assert.deepEqual(r.failing.map((f) => f.id), ["generic:frame-time"]);
});

test("a gliding game's cost is kept with its result, and heavy glide is a warning that never blocks (D519)", async () => {
  const glide = (warning) => ({ fine: 4, path: "gpu", p50Ms: 7, p95Ms: 9, plainP50Ms: 1, plainP95Ms: 2, costMs: 6, warning });
  for (const calibrated of [false, true]) {
    const settings = gateSettings({ profile: "picade", gate: { calibrated } });
    const heavy = await createGate({ settings, playing: () => false, logsDir: tmp(), run: async () => ({ driver: "browser", fallback: null, report: { ...report(true), glide: glide("heavy") } }) }).cart("/a");
    assert.equal(heavy.ok, true, "a warning, not a block");
    assert.deepEqual(heavy.advisory?.map((f) => f.id), ["glide"]);
    assert.match(heavy.advisory?.[0].reason ?? "", /glide takes about 6 ms of each frame here \(9 ms at the slowest 5% with it, 2 ms without; the budget is 16\.7 ms\)/);
    assert.equal(heavy.glide.costMs, 6);
    const light = await createGate({ settings, playing: () => false, logsDir: tmp(), run: async () => ({ driver: "browser", fallback: null, report: { ...report(true), glide: glide(null) } }) }).cart("/a");
    assert.equal(light.advisory, undefined);
    assert.equal(light.glide.path, "gpu");
    const plain = await createGate({ settings, playing: () => false, logsDir: tmp(), run: async () => ({ driver: "browser", fallback: null, report: { ...report(true), glide: null } }) }).cart("/a");
    assert.equal("glide" in plain, false);
  }
});

test("real Chromium: a game started mid-test stops the run and its Chromium; it runs again after (D310)", { skip: noChromium, timeout: 180000 }, async () => {
  let playing = false;
  /** @type {() => void} */
  let sayStopped = () => {};
  const stopped = new Promise((resolve) => (sayStopped = () => resolve(undefined)));
  const gate = createGate({ settings: realSettings(), playing: () => playing, logsDir: tmp(), pollMs: 100, log: (line) => /a game started/.test(line) && sayStopped() });
  const r = gate.cart(path.join(PT_FIXTURES, "dot-catch"));
  try {
    // Each step waits on the gate itself, not on a guess at how long a busy mini takes to start a Chromium.
    await eventually(() => liveGateRuns() === 1, "the test is running");
    playing = true;
    await stopped; // the gate says so as it goes back to waiting for the game to end
    // Its whole process group (gate-run and Chromium) was killed, not just asked.
    await eventually(() => liveGateRuns() === 0, "nothing of the gate runs while a game is being played");
    await sleep(1500); // the game is played this long, and the gate's wait is counted from when it stopped: waited_s below
  } finally {
    playing = false;
  }
  const done = await r;
  assert.equal(done.ok, true, JSON.stringify(done.failing));
  assert.equal(done.restarts, 1);
  assert.ok(done.waited_s >= 1, String(done.waited_s));
});

test("a run that can't happen fails the gate with the reason, and never throws", async () => {
  const gate = createGate({ settings: gateSettings({ profile: "virtual" }), playing: () => false, logsDir: tmp(), run: () => Promise.reject(new Error("the test didn't finish within 600 s")) });
  const r = await gate.cart("/a");
  assert.equal(r.ok, false);
  assert.match(r.failing[0].reason ?? "", /couldn't run the test: the test didn't finish within 600 s/);
});

test("real Chromium: a good cart passes; a broken one fails with each reason, labelled virtual (D310, D128)", { skip: noChromium, timeout: 180000 }, async () => {
  const logs = tmp();
  const gate = createGate({ settings: realSettings(), playing: () => false, logsDir: logs });
  const good = await gate.cart(path.join(PT_FIXTURES, "dot-catch"));
  assert.equal(good.ok, true, JSON.stringify(good.failing));
  assert.equal(good.driver, "browser");
  assert.equal(good.host, "virtual");
  assert.equal(good.frame_time.host, "virtual");
  assert.equal(good.frame_time.budgetMs, 5.57);
  assert.ok(good.seconds > 0);
  const bad = await gate.cart(path.join(PT_FIXTURES, "dot-catch-broken"));
  assert.equal(bad.ok, false);
  const ids = bad.failing.map((f) => f.id);
  for (const id of ["R1", "R2", "R5", "generic:no-errors", "generic:soak", "generic:palette", "generic:deterministic"]) assert.ok(ids.includes(id), `${id} in ${ids}`);
  assert.match(bad.failing.find((f) => f.id === "R1")?.reason ?? "", /holding right/);
  const logged = readLog(path.join(logs, "publish_gate.jsonl"));
  assert.deepEqual(logged.map((l) => l.ok), [true, false]);
});

/** A make through the Studio, answered with A and Build it, on a fixture. @param {any} studio */
async function makeIt(studio) {
  /** @param {(s: any) => boolean} pred */
  const until = (pred) =>
    new Promise((resolve) => {
      if (pred(studio.state())) return resolve(studio.state());
      const alive = setInterval(() => {}, 20);
      const stop = studio.subscribe((/** @type {any} */ s) => {
        if (pred(s)) {
          clearInterval(alive);
          stop();
          resolve(s);
        }
      });
    });
  studio.start({ maker: "ivy", request: "a penguin game" });
  for (;;) {
    const s = /** @type {any} */ (await until((x) => x.pending || x.results?.length));
    if (s.results?.length) return s.results[0];
    studio.answer(s.pending.kind === "plan" ? { id: s.pending.id, choice: "build" } : { id: s.pending.id, choice: "A" });
  }
}

/** The Studio with the real gate as its checker, on a replay of `dir`. @param {string} dir */
function gatedStudio(dir) {
  const paths = dataPaths(tmp());
  const pot = potStore({ logsDir: paths.logs });
  const gate = createGate({ settings: realSettings(), playing: () => false, logsDir: paths.logs });
  const studio = createStudio({ paths, api: async () => replayApi({ dir, usage: usageOf(dir, 40) }).api, lock: () => REPLAY_LOCK, kit: async () => ({ fileId: "f", hash: "h" }), checker: gatedChecker(defaultChecker(), gate), titleOf: () => "Penguin Catch", nameOf: () => "Ivy", pot });
  return { paths, studio, pot };
}

test("a made game that passes the cabinet's re-test goes on the shelf, and its record says how the gate went (D310)", { skip: noChromium, timeout: 180000 }, async () => {
  const { paths, studio } = gatedStudio(FIXTURE);
  const r = await makeIt(studio);
  assert.equal(r.ok, true, JSON.stringify(r));
  const rec = readLog(path.join(paths.logs, "studio_session.jsonl")).at(-1);
  assert.equal(rec.outcome, "committed");
  assert.equal(rec.playtest.local.ok, true);
  assert.equal(rec.playtest.local.gate.ok, true);
  assert.equal(rec.playtest.local.gate.host, "virtual");
  assert.equal(rec.playtest.local.gate.driver, "browser");
  assert.ok(fs.existsSync(path.join(paths.carts, r.cart_id, "game.js")), "on the shelf");
  const pt = JSON.parse(fs.readFileSync(path.join(paths.carts, r.cart_id, "playtest.json"), "utf8"));
  assert.equal(pt.driver, "browser", "the cart keeps the cabinet's own report");
  assert.equal(pt.frameTime.host, "virtual");
  assert.equal(readLog(path.join(paths.logs, "publish_gate.jsonl")).length, 1);
});

test("a made game that fails the re-test stays off the shelf: the kid gets E3, it's charged, and the log says why (D310)", { skip: noChromium, timeout: 180000 }, async () => {
  // The recorded make, with a game that breaks once it's played for a moment.
  const dir = path.join(tmp(), "penguin-broken");
  fs.cpSync(FIXTURE, dir, { recursive: true });
  const game = path.join(dir, "cart", "game.js");
  fs.writeFileSync(game, fs.readFileSync(game, "utf8").replace(/update\(g, s\) \{/, "update(g, s) { if (g.frame > 30) throw new Error('the penguin fell off the ice');"));
  assert.match(fs.readFileSync(game, "utf8"), /the penguin fell off the ice/, "the fixture's update was found and broken");
  const { paths, studio, pot } = gatedStudio(dir);
  const before = pot.state().cents;
  const r = await makeIt(studio);
  assert.equal(r.ok, false);
  assert.equal(r.failed, true, "a failed make with its request is the E3 board");
  assert.equal(r.request, "a penguin game");
  assert.equal(r.cost_cents, 40, "charged as designed: no refunds (D202)");
  assert.equal(pot.state().cents, before - 40);
  const charge = readLog(path.join(paths.logs, "coin_ledger.jsonl")).find((e) => e.kind === "charge");
  assert.equal(charge?.outcome, "didn't finish");
  assert.ok(!fs.existsSync(paths.carts) || fs.readdirSync(paths.carts).filter((f) => !f.startsWith(".")).length === 0, "nothing on the shelf");
  const rec = readLog(path.join(paths.logs, "studio_session.jsonl")).at(-1);
  assert.equal(rec.outcome, "checks_failed");
  assert.equal(rec.playtest.local.gate.ok, false);
  const reasons = rec.playtest.local.gate.failing.map((/** @type {any} */ f) => `${f.id}: ${f.reason}`).join("\n");
  assert.match(reasons, /the penguin fell off the ice/);
  assert.equal(readLog(path.join(paths.logs, "publish_gate.jsonl"))[0].ok, false);
  assert.ok(fs.existsSync(path.join(paths.sessions, rec.id, "cart", "game.js")), "everything is kept (D5)");
});

test("the launcher's play heartbeat reaches the tracker", async () => {
  const paths = dataPaths(tmp());
  const plays = playTracker();
  const studio = createStudio({ paths, api: async () => replayApi({ dir: FIXTURE }).api, lock: () => REPLAY_LOCK, kit: async () => ({ fileId: "", hash: "" }), checker: defaultChecker() });
  const s = await startService({ studio, makers: makersStore({ file: path.join(paths.root, "makers.json") }), speech: stubSpeech(), libraryDir: paths.carts, logsDir: paths.logs, plays, port: 0 });
  try {
    const post = (/** @type {any} */ body) => fetch(`${s.url}/api/arcade/playing`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await post({ playing: true, what: "teti" })).status, 200);
    assert.equal(plays.playing(), true);
    assert.equal(plays.what(), "teti");
    // What an update asks before it starts (D332).
    assert.deepEqual(await (await fetch(`${s.url}/api/arcade/playing`)).json(), { playing: true, what: "teti", gate_busy: false });
    await post({ playing: false });
    assert.equal(plays.playing(), false);
    assert.equal((await (await fetch(`${s.url}/api/arcade/playing`)).json()).playing, false);
  } finally {
    await s.close();
  }
});

test("real Chromium: a downloaded game is on the shelf once its smoke check passes; one that throws or reaches out isn't (D310)", { skip: noChromium, timeout: 120000 }, async () => {
  const root = tmp();
  /** @param {string} id @param {string} script */
  const guest = (id, script) => {
    fs.mkdirSync(path.join(root, id, "play"), { recursive: true });
    fs.writeFileSync(path.join(root, id, "guest.json"), JSON.stringify({ id, title: id, version: "1", kind: "web", entry: "index.html" }));
    fs.writeFileSync(path.join(root, id, "play", "index.html"), `<!doctype html><title>${id}</title><canvas></canvas><script>${script}</script>`);
  };
  guest("calm", "document.title = 'ok';");
  guest("throws", "setTimeout(() => { throw new Error('no level 1'); }, 200);");
  guest("reaches", "fetch('http://example.invalid/score').catch(() => {});");
  const logs = tmp();
  const gate = createGate({ settings: { ...realSettings(), watchMs: 1000 }, playing: () => false, logsDir: logs });
  /** @type {any} */
  let guests;
  const checks = guestGate({ file: path.join(root, "..", `${path.basename(root)}-gate.json`), gate, urlOf: (id, meta) => `http://127.0.0.1:${guests.port}/${id}/${meta.entry}` });
  guests = createGuests({ dirs: [root], logsDir: logs, admit: (id, meta) => checks.admitted(id, meta) });
  const server = await startGuestServer(guests, { port: 0 });
  guests.port = server.port;
  try {
    assert.deepEqual(guests.list("").map((/** @type {any} */ g) => g.id), [], "nothing until it's checked");
    assert.equal(checks.pending(), 3);
    while (checks.pending()) await sleep(100);
    assert.deepEqual(guests.list("").map((/** @type {any} */ g) => g.id), ["calm"]);
    assert.match(checks.result("throws", { version: "1" })?.failing[0].reason ?? "", /no level 1/);
    assert.equal(checks.result("reaches", { version: "1" })?.failing[0].id, "no-network");
    assert.match(checks.result("reaches", { version: "1" })?.failing[0].reason ?? "", /example\.invalid/);
    // A new version is checked again.
    fs.writeFileSync(path.join(root, "calm", "guest.json"), JSON.stringify({ id: "calm", title: "calm", version: "2", kind: "web", entry: "index.html" }));
    assert.deepEqual(guests.list("").map((/** @type {any} */ g) => g.id), []);
    while (checks.pending()) await sleep(100);
    assert.deepEqual(guests.list("").map((/** @type {any} */ g) => g.id), ["calm"]);
    assert.equal(readLog(path.join(logs, "publish_gate.jsonl")).filter((l) => l.kind === "guest").length, 4);
  } finally {
    await server.close();
  }
});

test("real Chromium: a guest played by a player must draw: a real TIC-80 cart passes, a flat screen doesn't (D381)", { skip: noChromium, timeout: 120000 }, async () => {
  const root = tmp();
  // A shortlisted TIC-80 guest as it is: its player needs WebGL, which the gate's Chromium draws in software.
  fs.cpSync(path.resolve(import.meta.dirname, "../../../guests/grow-quickly"), path.join(root, "grow-quickly"), { recursive: true });
  // A player that never starts: nothing thrown, nothing drawn.
  fs.mkdirSync(path.join(root, "flat", "play"), { recursive: true });
  fs.writeFileSync(path.join(root, "flat", "guest.json"), JSON.stringify({ id: "flat", title: "flat", version: "1", kind: "web", entry: "index.html", player: { name: "tic80" } }));
  fs.writeFileSync(path.join(root, "flat", "play", "index.html"), "<!doctype html><title>flat</title><style>html,body{margin:0;height:100%;background:#000}</style><canvas></canvas>");
  // The same flat page with no player: a plain web game isn't asked to draw (D312 as it was).
  fs.mkdirSync(path.join(root, "plain", "play"), { recursive: true });
  fs.writeFileSync(path.join(root, "plain", "guest.json"), JSON.stringify({ id: "plain", title: "plain", version: "1", kind: "web", entry: "index.html" }));
  fs.copyFileSync(path.join(root, "flat", "play", "index.html"), path.join(root, "plain", "play", "index.html"));
  const logs = tmp();
  const gate = createGate({ settings: { ...realSettings(), watchMs: 4000 }, playing: () => false, logsDir: logs });
  /** @type {any} */
  let guests;
  const checks = guestGate({ file: path.join(tmp(), "gate.json"), gate, urlOf: (id, meta) => `http://127.0.0.1:${guests.port}/${id}/${meta.entry}` });
  guests = createGuests({ dirs: [root], logsDir: logs, admit: (id, meta) => checks.admitted(id, meta) });
  const server = await startGuestServer(guests, { port: 0 });
  guests.port = server.port;
  try {
    guests.list("");
    while (checks.pending()) await sleep(100);
    assert.deepEqual(guests.list("").map((/** @type {any} */ g) => g.id), ["grow-quickly", "plain"]);
    const flat = checks.result("flat", { version: "1" });
    assert.equal(flat?.failing[0].id, "draws");
    assert.match(flat?.failing[0].reason ?? "", /one flat colour/);
  } finally {
    await server.close();
  }
});

test("no gate (development): every guest is on the shelf", () => {
  const checks = guestGate({ file: path.join(tmp(), "g.json"), gate: null, urlOf: () => null });
  assert.equal(checks.admitted("teti", { version: "1" }), true);
});
