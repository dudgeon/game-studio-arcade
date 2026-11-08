import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startPlayer } from "../src/server.js";
import { makeData, readRecords, git } from "./helpers.js";

/** @type {ReturnType<typeof makeData>} */
let data;
/** @type {Awaited<ReturnType<typeof startPlayer>>} */
let s;

before(async () => {
  data = makeData();
  s = await startPlayer({ port: 0, libraryDir: data.carts, logsDir: data.logs, checker: "G", now: () => new Date("2026-11-07T21:30:00Z") });
});
after(async () => {
  await s.close();
  data.cleanup();
});

const getCarts = async () => /** @type {any} */ (await (await fetch(`${s.url}/api/carts`)).json());
/** @param {string} p @param {unknown} body @param {Record<string, string>} [headers] */
const postJson = (p, body, headers = {}) =>
  fetch(`${s.url}${p}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

test("lists the library with you-check rules, version, commit and status", async () => {
  const { carts, checker, players } = await getCarts();
  assert.equal(checker, "G");
  assert.equal(players, 1, "one controller by default, like the cabinet (D110)");
  assert.deepEqual(
    carts.map((c) => c.id),
    ["smile", "bare", "broken"],
  );
  const smile = carts[0];
  assert.equal(smile.title, "Smile");
  assert.equal(smile.version, 1);
  assert.equal(smile.maker, "A");
  assert.equal(smile.session_id, "sesn_fixture_01");
  assert.equal(smile.url, "/carts/smile/game.js");
  assert.equal(smile.autoRules, 2);
  assert.deepEqual(
    smile.youCheck.map((r) => r.id),
    ["R2", "R4"],
  );
  assert.match(smile.youCheck[1].text, /happy.*not scary/s);
  assert.equal(smile.commit, git(data.carts, ["rev-parse", "HEAD"]));
  assert.equal(smile.answered, null);
  assert.equal(smile.plays, 0);
  assert.equal(smile.dir, undefined, "no file paths reach the page");
  const bare = carts[1];
  assert.equal(bare.title, "bare");
  assert.equal(bare.version, 1);
  assert.deepEqual(bare.youCheck, []);
});

test("serves the page, its files, the runtime and the carts", async () => {
  for (const [p, type] of [
    ["/", "text/html"],
    ["/player/player.js", "text/javascript"],
    ["/player/player.css", "text/css"],
    ["/runtime/src/host.js", "text/javascript"],
    ["/runtime/frame.html", "text/html"],
    ["/carts/smile/game.js", "text/javascript"],
  ]) {
    const r = await fetch(`${s.url}${p}`);
    assert.equal(r.status, 200, p);
    assert.ok(r.headers.get("content-type")?.startsWith(type), `${p}: ${r.headers.get("content-type")}`);
  }
  const cart = await fetch(`${s.url}/carts/smile/game.js`);
  assert.equal(cart.headers.get("access-control-allow-origin"), "*", "the sandboxed frame needs CORS (D21)");
  const frame = await fetch(`${s.url}/runtime/frame.html`);
  assert.match(frame.headers.get("content-security-policy") ?? "", /default-src 'none'/);
});

test("refuses paths outside the web folder and the carts", async () => {
  for (const p of ["/player/../src/server.js", "/player/%2e%2e/src/server.js", "/carts/smile/../../logs/play.jsonl", "/carts/nope/game.js", "/player/server.js"]) {
    const r = await fetch(`${s.url}${p}`);
    assert.equal(r.status, 404, p);
  }
});

test("a cart committed after start shows up without a restart (D70)", async () => {
  const dir = path.join(data.carts, "late");
  fs.mkdirSync(dir);
  fs.copyFileSync(path.join(data.carts, "bare", "game.js"), path.join(dir, "game.js"));
  try {
    const { carts } = await getCarts();
    assert.ok(carts.some((c) => c.id === "late"));
    assert.equal((await fetch(`${s.url}/carts/late/game.js`)).status, 200);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test("a play is logged with the library's version and commit (D72)", async () => {
  const base = { cart_id: "smile", sides: ["p2", "p1", "p1", "bogus"], started_at: "2026-11-07T21:00:00.000Z", ticks: 300, ended: "star", errors: 0 };
  let r = await postJson("/api/plays", { ...base, play_id: "pl_short", duration_s: 5.04, cart_version: 99 });
  assert.equal(r.status, 200);
  r = await postJson("/api/plays", { ...base, play_id: "pl_long", duration_s: 45, ended: "weird" });
  assert.equal(r.status, 200);
  const plays = readRecords(data.logs, "play");
  assert.equal(plays.length, 2);
  const [a, b] = plays;
  assert.deepEqual(a, {
    type: "play",
    id: "pl_short",
    cart_id: "smile",
    cart_version: 1,
    commit: git(data.carts, ["rev-parse", "HEAD"]),
    session_id: "sesn_fixture_01",
    origin: "desktop",
    sides: ["p1"], // p2 doesn't exist with one controller (D111)
    started_at: "2026-11-07T21:00:00.000Z",
    duration_s: 5,
    ticks: 300,
    early_quit: true,
    ended: "star",
    errors: 0,
  });
  assert.equal(b.early_quit, false);
  assert.equal(b.ended, "back");
  assert.equal((await getCarts()).carts[0].plays, 2);
});

test("you-check answers are appended, and the latest counts (D71, D72)", async () => {
  let r = await postJson("/api/you-check", {
    cart_id: "smile",
    play_id: "pl_short",
    answers: [
      { rule: "R2", answer: "yes", said: "" },
      { rule: "R4", answer: "not_sure", said: "  a bit loud  " },
    ],
  });
  assert.equal(r.status, 200, await r.clone().text());
  r = await postJson("/api/you-check", { cart_id: "smile", answers: [{ rule: "R4", answer: "no" }] });
  assert.equal(r.status, 200);
  const recs = readRecords(data.logs, "you_check");
  assert.equal(recs.length, 2, "never overwritten");
  const [first] = recs;
  assert.match(first.id, /^yc_[0-9a-f]{16}$/);
  assert.deepEqual(
    { ...first, id: undefined },
    {
      type: "you_check",
      id: undefined,
      cart_id: "smile",
      cart_version: 1,
      commit: git(data.carts, ["rev-parse", "HEAD"]),
      session_id: "sesn_fixture_01",
      checker: "G",
      play_id: "pl_short",
      answered_at: "2026-11-07T21:30:00.000Z",
      answers: [
        { rule: "R2", text: "The sparkles look pretty when you press A.", answer: "yes", said: null },
        { rule: "R4", text: recs[0].answers[1].text, answer: "not_sure", said: "a bit loud" },
      ],
    },
  );
  assert.equal(recs[1].play_id, null);
  const smile = (await getCarts()).carts[0];
  assert.equal(smile.answered.by, "G");
  assert.deepEqual(
    smile.answered.answers.map((a) => a.answer),
    ["no"],
  );
});

test("bad writes are refused and log nothing", async () => {
  const before = readRecords(data.logs, "you_check").length + readRecords(data.logs, "play").length;
  const ok = { cart_id: "smile", answers: [{ rule: "R2", answer: "yes" }] };
  /** @type {[string, unknown, number, Record<string, string>?][]} */
  const cases = [
    ["/api/you-check", { ...ok, cart_id: "nope" }, 404],
    ["/api/you-check", { ...ok, answers: [{ rule: "R1", answer: "yes" }] }, 400], // an auto rule
    ["/api/you-check", { ...ok, answers: [{ rule: "R2", answer: "maybe" }] }, 400],
    ["/api/you-check", { ...ok, answers: [ok.answers[0], ok.answers[0]] }, 400],
    ["/api/you-check", { ...ok, answers: [] }, 400],
    ["/api/you-check", "not json", 400],
    ["/api/you-check", { ...ok, pad: "x".repeat(20000) }, 413],
    ["/api/you-check", ok, 403, { Origin: "http://evil.example" }],
    ["/api/you-check", ok, 403, { Origin: "null" }], // the sandboxed cart frame
    ["/api/plays", { cart_id: "smile", play_id: "../x", started_at: "2026-11-07T21:00:00Z", duration_s: 1 }, 400],
    ["/api/plays", { cart_id: "smile", play_id: "p", started_at: "yesterday", duration_s: 1 }, 400],
    ["/api/plays", { cart_id: "smile", play_id: "p", started_at: "2026-11-07T21:00:00Z", duration_s: -1 }, 400],
    ["/api/nothing", {}, 404],
  ];
  for (const [p, body, status, headers] of cases) {
    const r = await postJson(p, body, headers);
    assert.equal(r.status, status, `${p} ${JSON.stringify(body).slice(0, 80)} ${JSON.stringify(headers ?? {})}`);
  }
  const ownOrigin = await postJson("/api/you-check", ok, { Origin: s.url });
  assert.equal(ownOrigin.status, 200, "the player page's own origin may write");
  const after = readRecords(data.logs, "you_check").length + readRecords(data.logs, "play").length;
  assert.equal(after, before + 1);
});

test("--examples adds the runtime's examples; the library wins a clash", async () => {
  const d = makeData();
  fs.cpSync(path.join(d.carts, "bare"), path.join(d.carts, "hello"), { recursive: true });
  const s2 = await startPlayer({ port: 0, libraryDir: d.carts, logsDir: d.logs, examples: true });
  try {
    const { carts } = /** @type {any} */ (await (await fetch(`${s2.url}/api/carts`)).json());
    const hello = carts.find((c) => c.id === "hello");
    assert.equal(hello.source, "library");
    const s3 = await startPlayer({ port: 0, libraryDir: path.join(d.root, "missing"), logsDir: d.logs, examples: true });
    try {
      const only = /** @type {any} */ (await (await fetch(`${s3.url}/api/carts`)).json()).carts;
      assert.deepEqual(
        only.map((c) => [c.id, c.source]),
        [["hello", "example"]],
      );
    } finally {
      await s3.close();
    }
  } finally {
    await s2.close();
    d.cleanup();
  }
});

test("--players sets the controller count; bad values fail at start-up (D110)", async () => {
  const d = makeData();
  const s2 = await startPlayer({ port: 0, libraryDir: d.carts, logsDir: d.logs, players: 3 });
  try {
    const body = /** @type {any} */ (await (await fetch(`${s2.url}/api/carts`)).json());
    assert.equal(body.players, 3);
    const r = await fetch(`${s2.url}/api/plays`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cart_id: "bare", play_id: "pl_3", started_at: "2026-11-08T10:00:00Z", duration_s: 40, sides: ["p3", "p1", "p4", "p9"] }),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(readRecords(d.logs, "play")[0].sides, ["p1", "p3"]);
  } finally {
    await s2.close();
    d.cleanup();
  }
  for (const bad of [0, 9, 1.5, Number.NaN, /** @type {any} */ ("two")]) {
    assert.throws(() => startPlayer({ port: 0, players: bad }), /players .* must be a whole number from 1 to 8/, String(bad));
  }
});
