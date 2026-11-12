// The family coin pot's rules (handoff §2, D202-D205): one test per rule in its table,
// on the pot alone and through a real make on the replay, which charges what the
// recorded session cost.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dataPaths } from "@game-studio-arcade/studio-cli/src/config.js";
import { readLog } from "@game-studio-arcade/studio-cli/src/log.js";
import { coinsOf, monthOf, POT_DEFAULTS, potStore } from "../src/pot.js";
import { cabinetState } from "../src/cabinet-state.js";
import { createStudio, StudioRefused } from "../src/studio.js";
import { makersStore } from "../src/makers.js";
import { startService } from "../src/server.js";
import { stubSpeech } from "../src/speech.js";
import { replayApi, REPLAY_LOCK, usageOf } from "../test-support/replay-api.js";

const FIXTURES = path.resolve(import.meta.dirname, "../../../studio-kit/cli/fixtures");
const MAKE = path.join(FIXTURES, "penguin-catch");
// Recorded: Tester's live change to Log Hopper (D214, D215).
const CHANGE = path.join(FIXTURES, "log-hopper-change");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "gsa-pot-"));
const passing = {
  async validate() {
    return { ok: true, problems: [] };
  },
  async playtest() {
    return { ok: true, failing: [], report: { rules: [], generic: [] } };
  },
};

/** A clock the test moves. */
function clock(iso = "2026-11-11T12:00:00") {
  let t = new Date(iso).getTime();
  return { now: () => new Date(t), set: (/** @type {string} */ s) => (t = new Date(s).getTime()), tick: (ms = 1000) => (t += ms) };
}

/** A pot holding `cents`, by charging Owen the rest of 100 coins. @param {number} cents */
function potAt(cents, c = clock()) {
  const logs = tmp();
  const pot = potStore({ logsDir: logs, now: c.now });
  pot.charge({ maker: "owen", what: "new", session_id: "sesn_seed", cost_cents: 1000 - cents, outcome: "on the shelf" });
  return { pot, logs, c };
}

// ---------- numbers ----------

test("1 coin = 10 cents; screens round to nearest, ledger keeps exact cents (D202)", () => {
  assert.equal(POT_DEFAULTS.cents_per_coin, 10);
  assert.equal(coinsOf(56), 6, "56c shows as 6");
  assert.equal(coinsOf(53), 5);
  assert.equal(coinsOf(55), 6, "half rounds up");
  assert.equal(coinsOf(4), 0);
  assert.equal(coinsOf(-56), -6, "the same either side of zero");
  assert.equal(coinsOf(0), 0);
  const { pot } = potAt(1000);
  const e = pot.charge({ maker: "alina", what: "new", session_id: "s1", cost_cents: 56, outcome: "on the shelf" });
  assert.equal(e?.cost_cents, 56, "exact cents in the ledger");
  assert.equal(e?.coins, 6);
  assert.equal(pot.state().cents, 944);
  assert.equal(pot.state().coins, 94);
});

test("the pot starts at 100 coins = $10, one for the whole cabinet (D202)", () => {
  const pot = potStore({ logsDir: tmp(), now: clock().now });
  const s = pot.state();
  assert.equal(s.coins, 100);
  assert.equal(s.cents, 1000);
  assert.equal(s.refill_on, "2026-12-01");
  assert.equal(pot.history()[0].kind, "refill");
});

// ---------- the start gate (D203) ----------

test("start gate: 6 for a new game, 2 for a change (D214); with 5 coins a change starts and a new game doesn't", () => {
  assert.equal(potAt(60).pot.gate("new").ok, true, "6 coins: a new game starts");
  assert.equal(potAt(56).pot.gate("new").ok, true, "56c shows as 6, and 6 is enough");
  const five = potAt(50).pot;
  assert.deepEqual(five.gate("new"), { ok: false, why: "low", coins: 5, need: 6 });
  assert.equal(five.gate("change").ok, true, "5 coins: a change starts");
  assert.equal(potAt(30).pot.gate("change").ok, true);
  assert.equal(potAt(20).pot.gate("change").ok, true, "2 coins: a change starts (D214)");
  assert.deepEqual(potAt(10).pot.gate("change"), { ok: false, why: "low", coins: 1, need: 2 });
  assert.equal(potAt(0).pot.gate("change").why, "empty");
  assert.equal(potAt(-40).pot.gate("new").why, "empty");
});

test("usual costs are settings, not constants (D203)", () => {
  const logs = tmp();
  const pot = potStore({ logsDir: logs, now: clock().now, settings: { usual_cost_new: 8, usual_cost_change: 4 } });
  pot.charge({ maker: "owen", what: "new", session_id: "x", cost_cents: 930, outcome: "on the shelf" });
  assert.equal(pot.state().coins, 7);
  assert.equal(pot.gate("new").ok, false);
  assert.equal(pot.gate("change").ok, true);
  assert.deepEqual(pot.state().usual, { new: 8, change: 4 });
});

// ---------- charges ----------

test("a charge is once per session, whatever asks twice (a restart can't charge again)", () => {
  const { pot } = potAt(1000);
  assert.ok(pot.charge({ maker: "alina", what: "new", session_id: "s1", cost_cents: 40, outcome: "on the shelf" }));
  assert.equal(pot.charge({ maker: "alina", what: "new", session_id: "s1", cost_cents: 40, outcome: "on the shelf" }), null);
  assert.equal(pot.state().cents, 960);
});

test("per-maker totals: this month's coins and cents for each maker, most first, friends included", () => {
  const { pot } = potAt(1000);
  pot.charge({ maker: "alina", what: "new", session_id: "a1", cost_cents: 56, outcome: "on the shelf" });
  pot.charge({ maker: "sam", what: "change", session_id: "s1", cost_cents: 31, outcome: "on the shelf" });
  pot.charge({ maker: "alina", what: "change", session_id: "a2", cost_cents: 30, outcome: "didn't finish" });
  const ms = pot.state().makers.filter((m) => m.maker !== "owen");
  assert.deepEqual(ms, [
    { maker: "alina", cents: 86, makes: 2, coins: 9 },
    { maker: "sam", cents: 31, makes: 1, coins: 3 },
  ]);
});

test("refill: on the 1st the pot is set to 100, leftovers gone and a negative wiped (D202)", () => {
  const c = clock("2026-11-28T20:00:00");
  const { pot } = potAt(-120, c);
  assert.equal(pot.state().coins, -12);
  c.set("2026-12-01T00:00:05");
  const s = pot.state();
  assert.equal(s.coins, 100, "a negative balance is wiped");
  assert.equal(s.month, "2026-12");
  assert.equal(s.last_month?.ended_coins, -12);
  assert.equal(s.last_month?.makers[0].maker, "owen");
  assert.deepEqual(s.makers, [], "this month's totals start empty");
  const refill = pot.history()[0];
  assert.equal(refill.kind, "refill");
  assert.equal(refill.cents, 1120);
  assert.match(String(refill.reason), /went over/);
  // Leftovers too.
  c.set("2026-12-20T09:00:00");
  pot.charge({ maker: "alina", what: "new", session_id: "dec", cost_cents: 50, outcome: "on the shelf" });
  c.set("2027-01-01T08:00:00");
  assert.equal(pot.state().coins, 100, "leftovers don't carry over");
  assert.equal(pot.history().filter((e) => e.kind === "refill").length, 3, "once a month, however often it's read");
  pot.state();
  assert.equal(pot.history().filter((e) => e.kind === "refill").length, 3);
});

test("the refill is the cabinet's local month", () => {
  const d = new Date(2026, 11, 1, 0, 0, 1); // local midnight, Dec 1
  assert.equal(monthOf(d), "2026-12");
});

// ---------- grown-ups (D205) ----------

test("top-ups and resets: grown-ups only, each with a reason; the ledger is append-only", () => {
  const { pot, logs } = potAt(200);
  assert.throws(() => pot.topUp({ coins: 20, reason: "" }), /reason/);
  assert.throws(() => pot.topUp({ coins: 0, reason: "a bonus" }), /whole number/);
  assert.throws(() => pot.topUp({ coins: 2.5, reason: "a bonus" }), /whole number/);
  assert.throws(() => pot.reset({ reason: " " }), /reason/);
  const before = fs.readFileSync(path.join(logs, "coin_ledger.jsonl"), "utf8");
  const t = pot.topUp({ coins: 20, reason: "Birthday bonus", by: "Geoff" });
  assert.equal(t.cents, 200);
  assert.equal(pot.state().coins, 40);
  const r = pot.reset({ reason: "Fresh start after the fix" });
  assert.equal(r.pot_after_cents, 1000);
  assert.ok(fs.readFileSync(path.join(logs, "coin_ledger.jsonl"), "utf8").startsWith(before), "only appended (D5)");
  const kinds = pot.history().map((e) => e.kind);
  assert.deepEqual(kinds.slice(0, 2), ["reset", "topup"]);
});

test("the Manager is warned when a top-up would take the month past the workspace limit (D204)", () => {
  const { pot } = potAt(1000);
  assert.equal(pot.preview(40).over_limit, false, "$10 + $4 is under $15 (D211)");
  assert.equal(pot.preview(60).over_limit, true, "$10 + $6 is over $15");
  assert.equal(pot.preview(20).dollars, 2);
});

// ---------- through a make ----------

/** @param {any} [o] */
function studioWith(o = {}) {
  const c = o.clock ?? clock();
  const paths = dataPaths(tmp());
  const pot = potStore({ logsDir: paths.logs, now: c.now });
  if (o.potCents != null) pot.charge({ maker: "owen", what: "new", session_id: "sesn_seed", cost_cents: 1000 - o.potCents, outcome: "on the shelf" });
  const cabinet = cabinetState({ root: paths.root, now: c.now });
  /** @type {Map<string, any>} */
  const carts = new Map();
  const studio = createStudio({
    paths,
    api: async (/** @type {any} */ _r, /** @type {any} */ what) =>
      o.api ?? replayApi({ dir: what?.kind === "change" ? CHANGE : MAKE, usage: o.usage ?? usageOf(what?.kind === "change" ? CHANGE : MAKE), noCart: o.noCart }).api,
    lock: () => REPLAY_LOCK,
    kit: async () => ({ fileId: "file_k", hash: "h" }),
    checker: passing,
    titleOf: () => "Penguin Catch",
    nameOf: (id) => id[0].toUpperCase() + id.slice(1),
    pot,
    cabinet,
    findCart: (id) => carts.get(id) ?? null,
  });
  const until = (/** @type {(s: any) => boolean} */ pred) =>
    new Promise((resolve) => {
      if (pred(studio.state())) return resolve(studio.state());
      const alive = setInterval(() => {}, 20);
      const stop = studio.subscribe((s) => {
        if (pred(s)) {
          clearInterval(alive);
          stop();
          resolve(s);
        }
      });
    });
  /** Answer everything A, then build. */
  const runThrough = async () => {
    for (;;) {
      const s = /** @type {any} */ (await until((x) => x.pending || x.results?.length));
      if (s.results?.length) return s.results[s.results.length - 1];
      studio.answer({ id: s.pending.id, choice: s.pending.kind === "plan" ? "build" : "A" });
    }
  };
  return { paths, pot, studio, until, runThrough, carts, cabinet, clock: c };
}

test("a make is charged its real cost at the end: the session's list cost, in cents (D202)", async () => {
  const { studio, runThrough, pot, paths } = studioWith();
  studio.start({ maker: "alina", request: "a penguin game" });
  const r = await runThrough();
  assert.equal(r.ok, true);
  assert.equal(r.cost_cents, 68, "what the recorded session cost");
  assert.equal(r.coins, 7);
  assert.equal(r.pot_after_cents, 932);
  assert.equal(pot.state().makers[0].maker, "alina");
  const [e] = readLog(path.join(paths.logs, "coin_ledger.jsonl")).filter((x) => x.kind === "charge");
  assert.equal(e.session_id, "sesn_replay", "joins the studio_session record (§9.5)");
  assert.equal(e.outcome, "on the shelf");
  assert.equal(e.cart_id, r.cart_id);
  assert.equal(e.what, "new game");
  assert.equal(readLog(path.join(paths.logs, "studio_session.jsonl"))[0].id, "sesn_replay");
});

test("every finished session is archived at Anthropic, a game on the shelf too, and the archive logged (D301)", async () => {
  const made = replayApi({ dir: MAKE, usage: usageOf(MAKE) });
  const { studio, runThrough, paths } = studioWith({ api: made.api });
  studio.start({ maker: "alina", request: "a penguin game" });
  const r = await runThrough();
  assert.equal(r.ok, true);
  for (let i = 0; i < 100 && !made.mock.calls.includes("archiveSession"); i++) await new Promise((res) => setTimeout(res, 10));
  assert.ok(made.mock.calls.includes("archiveSession"), "archived, never deleted");
  const c = readLog(path.join(paths.logs, "studio_session_correction.jsonl")).at(-1);
  assert.equal(c?.corrects, "sesn_replay");
  assert.equal(c?.archive?.ok, true);
});

test("the coins used so far count up during the build, from the session's usage (M10)", async () => {
  const { studio, until, runThrough } = studioWith();
  /** @type {number[]} */
  const seen = [];
  studio.subscribe((s) => {
    if (s.phase === "running" && seen.at(-1) !== s.used_cents) seen.push(s.used_cents);
  });
  studio.start({ maker: "alina", request: "a penguin game" });
  await runThrough();
  assert.ok(seen.length >= 4, `counted up: ${seen}`);
  assert.deepEqual([...seen].sort((a, b) => a - b), seen, "never backwards");
  assert.equal(seen.at(-1), 68);
  void until;
});

test("the gate refuses a new game under 6 coins, before anything starts or is spent (D203)", async () => {
  const { studio, pot } = studioWith({ potCents: 50 });
  assert.throws(() => studio.start({ maker: "alina", request: "x" }), (e) => e instanceof StudioRefused && e.why === "low");
  assert.equal(studio.state().phase, "idle");
  assert.equal(pot.history().filter((e) => e.kind === "charge").length, 1, "only the seed");
});

test("with 5 coins a change starts: the maker's own change is version 2 of the same game (D203, D206)", async () => {
  const { studio, runThrough, carts, paths, pot } = studioWith({ potCents: 50 });
  carts.set("penguin-catch", { id: "penguin-catch", dir: path.join(MAKE, "cart"), version: 1, maker: "alina", title: "Penguin Catch", session_id: null });
  studio.start({ maker: "alina", request: "make the logs float a bit faster", parent: "penguin-catch" });
  assert.equal(studio.state().kind, "change");
  const r = await runThrough();
  assert.equal(r.ok, true);
  assert.equal(r.kind, "change");
  assert.equal(r.version, 2);
  assert.equal(r.cost_cents, 14, "what the recorded live change cost (D214)");
  const cart = JSON.parse(fs.readFileSync(path.join(paths.carts, r.cart_id, "cart.json"), "utf8"));
  assert.equal(r.cart_id, "penguin-catch-v2");
  assert.equal(cart.parent, "penguin-catch@1");
  assert.equal(cart.family, "penguin-catch");
  assert.equal(cart.branch, "penguin-catch");
  assert.equal(cart.maker, "alina");
  assert.equal(pot.state().cents, 50 - 14);
  const charge = pot.history().find((e) => e.session_id === "sesn_replay");
  assert.equal(charge?.what, "change");
  assert.equal(charge?.cart_version, 2);
});

test("someone else's change is their own version: a new line, version 1, the original untouched (D206)", async () => {
  const { studio, runThrough, carts, paths } = studioWith();
  // The parent is on the shelf, in the library, as it would be.
  const parentDir = path.join(paths.carts, "penguin-catch");
  fs.cpSync(path.join(MAKE, "cart"), parentDir, { recursive: true });
  const before = fs.readFileSync(path.join(parentDir, "spec.md"), "utf8");
  carts.set("penguin-catch", { id: "penguin-catch", dir: parentDir, version: 1, maker: "alina", title: "Penguin Catch", session_id: null });
  studio.start({ maker: "owen", request: "make the logs float a bit faster", parent: "penguin-catch" });
  const r = await runThrough();
  assert.equal(r.version, 1);
  const cart = JSON.parse(fs.readFileSync(path.join(paths.carts, r.cart_id, "cart.json"), "utf8"));
  assert.equal(cart.maker, "owen");
  assert.equal(cart.parent, "penguin-catch@1");
  assert.equal(cart.family, "penguin-catch");
  assert.equal(cart.branch, undefined, "its own line starts with itself");
  assert.notEqual(r.cart_id, "penguin-catch");
  assert.equal(fs.readFileSync(path.join(parentDir, "spec.md"), "utf8"), before);
});

test("no refunds: a make that fails is charged what it cost (D202)", async () => {
  const { studio, runThrough, pot } = studioWith({ noCart: true });
  studio.start({ maker: "alina", request: "a penguin game" });
  const r = await runThrough();
  assert.equal(r.ok, false);
  assert.equal(r.failed, true);
  assert.equal(r.cost_cents, 68);
  assert.equal(r.request, "a penguin game", "the idea is kept, for Try again (E3)");
  assert.equal(pot.state().cents, 932);
  assert.equal(pot.history()[0].outcome, "didn't finish");
});

test("a make that fails on the cabinet's side after its session ran is charged and archived (D214, D219)", async () => {
  const made = replayApi({ dir: MAKE, usage: usageOf(MAKE) });
  // As the live change did: the session ends, then bringing it home fails.
  made.api.listOutputs = async () => Promise.reject(new Error("400 file_not_downloadable"));
  const { studio, runThrough, pot, paths } = studioWith({ api: made.api });
  studio.start({ maker: "alina", request: "a penguin game" });
  const r = await runThrough();
  assert.equal(r.ok, false);
  assert.equal(r.cost_cents, 68, "charged what it cost (D202)");
  for (let i = 0; i < 100 && !made.mock.calls.includes("archiveSession"); i++) await new Promise((res) => setTimeout(res, 10));
  assert.ok(made.mock.calls.includes("archiveSession"), "archived, never deleted");
  const corrections = readLog(path.join(paths.logs, "studio_session_correction.jsonl"));
  assert.equal(corrections.at(-1)?.archive?.ok, true);
  assert.equal(pot.history()[0].outcome, "didn't finish");
});

test("no refunds: a make stopped at a question is charged what it used (D202, E8)", async () => {
  const { studio, until, pot } = studioWith({ usage: { list_cost: { amount: "11", currency: "USD" } } });
  studio.start({ maker: "alina", request: "a penguin game" });
  await until((s) => s.pending?.kind === "question");
  studio.stop();
  for (let i = 0; i < 200 && !pot.history().some((e) => e.kind === "charge" && e.session_id === "sesn_replay"); i++) await new Promise((r) => setTimeout(r, 10));
  const e = pot.history().find((x) => x.session_id === "sesn_replay");
  assert.equal(e?.cost_cents, 11);
  assert.equal(e?.outcome, "stopped");
});

test("an overrun finishes and leaves the pot negative until the 1st (D203, L3)", async () => {
  const c = clock();
  const { studio, runThrough, pot, clock: k } = studioWith({ potCents: 60, usage: { list_cost: { amount: "140", currency: "USD" } }, clock: c });
  studio.start({ maker: "alina", request: "a penguin game" });
  const r = await runThrough();
  assert.equal(r.ok, true, "it finished");
  assert.equal(r.cost_cents, 140);
  assert.equal(r.pot_before_cents, 60);
  assert.equal(r.pot_after_cents, -80);
  assert.equal(r.over_pot, true);
  assert.equal(r.over_usual, true, "140c is over 1.5 x 6 coins (L4)");
  assert.match(r.why_more, /Claude/);
  assert.equal(pot.state().coins, -8);
  assert.equal(pot.gate("change").why, "empty", "no more making this month (L2)");
  k.set("2026-12-01T07:00:00");
  assert.equal(pot.state().coins, 100, "the 1st starts fresh");
});

test("the workspace's real limit refusing a session: the Studio rests until the 1st, nothing charged (D204, L5)", async () => {
  const api = replayApi({ dir: MAKE }).api;
  api.createSession = async () => Promise.reject(new Error("400 invalid_request_error: this workspace has reached its spend limit"));
  const { studio, until, pot, cabinet, clock: c } = studioWith({ api });
  studio.start({ maker: "alina", request: "a penguin game" });
  const s = /** @type {any} */ (await until((x) => x.results?.length));
  assert.equal(s.results[0].resting, true);
  assert.equal(cabinet.resting(), true);
  assert.equal(studio.state().resting, true);
  assert.throws(() => studio.start({ maker: "alina", request: "again" }), (e) => e instanceof StudioRefused && e.why === "resting");
  assert.equal(pot.history().filter((e) => e.kind === "charge").length, 0);
  c.set("2026-12-01T09:00:00");
  assert.equal(cabinet.resting(), false, "making comes back on the 1st");
});

// ---------- the Manager's endpoints, and A2 ----------

test("a Manager top-up, with its reason, shows in the coin history the launcher reads (D205, A2)", async () => {
  const paths = dataPaths(tmp());
  const pot = potStore({ logsDir: paths.logs });
  const makers = makersStore({ file: path.join(paths.root, "makers.json") });
  const studio = createStudio({ paths, api: async () => replayApi({ dir: MAKE }).api, lock: () => REPLAY_LOCK, kit: async () => ({ fileId: "", hash: "" }), checker: passing, pot });
  const s = await startService({ studio, makers, speech: stubSpeech(), libraryDir: paths.carts, logsDir: paths.logs, pot, managerToken: "tok-123", port: 0 });
  try {
    const post = (/** @type {string} */ p, /** @type {any} */ body, /** @type {Record<string,string>} */ h = {}) =>
      fetch(`${s.url}${p}`, { method: "POST", headers: { "Content-Type": "application/json", ...h }, body: JSON.stringify(body) });
    assert.equal((await post("/api/manager/pot/topup", { coins: 20, reason: "Birthday bonus" })).status, 401, "the launcher has no token");
    assert.equal((await post("/api/manager/pot/topup", { coins: 20, reason: "Birthday bonus" }, { Authorization: "Bearer nope-12" })).status, 401);
    assert.equal((await post("/api/manager/pot/topup", { coins: 20 }, { Authorization: "Bearer tok-123" })).status, 400, "a reason is required");
    const ok = await post("/api/manager/pot/topup", { coins: 20, reason: "Birthday bonus", by: "Geoff" }, { Authorization: "Bearer tok-123" });
    assert.equal(ok.status, 200);
    const { history, pot: state } = await (await fetch(`${s.url}/api/pot`)).json();
    assert.equal(state.coins, 120);
    assert.equal(history[0].kind, "topup");
    assert.equal(history[0].reason, "Birthday bonus");
    const warn = await (await post("/api/manager/pot/topup", { coins: 40, reason: "Another" }, { Authorization: "Bearer tok-123" })).json();
    assert.match(warn.warning, /past the workspace/);
    const rules = await (await fetch(`${s.url}/api/manager/pot`, { headers: { Authorization: "Bearer tok-123" } })).json();
    assert.equal(rules.rules.usual_cost_new, 6);
    const reset = await post("/api/manager/pot/reset", { reason: "Back to normal" }, { Authorization: "Bearer tok-123" });
    assert.equal((await reset.json()).entry.pot_after_cents, 1000);
  } finally {
    await s.close();
  }
  // No token configured: no Manager endpoints at all.
  const s2 = await startService({ studio, makers, speech: stubSpeech(), libraryDir: paths.carts, logsDir: paths.logs, pot, port: 0 });
  try {
    const r = await fetch(`${s2.url}/api/manager/pot/reset`, { method: "POST", headers: { Authorization: "Bearer x" }, body: "{}" });
    assert.equal(r.status, 404);
  } finally {
    await s2.close();
  }
});

test("the start endpoint says why the pot refused, so the launcher can show L1 or L2", async () => {
  const paths = dataPaths(tmp());
  const pot = potStore({ logsDir: paths.logs });
  pot.charge({ maker: "owen", what: "new", session_id: "x", cost_cents: 960, outcome: "on the shelf" });
  const makers = makersStore({ file: path.join(paths.root, "makers.json") });
  makers.add("alina");
  const studio = createStudio({ paths, api: async () => replayApi({ dir: MAKE }).api, lock: () => REPLAY_LOCK, kit: async () => ({ fileId: "", hash: "" }), checker: passing, pot });
  const s = await startService({ studio, makers, speech: stubSpeech(), libraryDir: paths.carts, logsDir: paths.logs, pot, port: 0 });
  try {
    const r = await fetch(`${s.url}/api/studio/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ maker: "alina", request: "a game" }) });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).why, "low");
  } finally {
    await s.close();
  }
});
