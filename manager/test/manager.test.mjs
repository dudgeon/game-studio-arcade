// The Cabinet Manager v0 (D280-D286), with a stand-in cabinet: no SSH, no real cabinet.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { activity } from "../activity.mjs";
import { loadCabinets } from "../cabinet.mjs";
import { toLinux } from "../keys.mjs";
import { updater } from "../update.mjs";
import { EventEmitter } from "node:events";
import { createManager, goodHost, homeAddress, houseTimeZone, managerKey } from "../server.mjs";

const PNG = Buffer.from("89504e470d0a1a0a0000", "hex");

function fakeCabinet(o = {}) {
  const c = {
    config: { label: "Fake", host: "fake.local" },
    problem: "",
    frame: null,
    canDrive: true,
    pressed: [],
    calls: [],
    paired: false,
    grabs: 0,
    async grab() {
      c.grabs++;
      const now = Date.now();
      c.frame = { png: PNG, hash: "h", at: now, changedAt: now };
    },
    async driveable() {
      return c.canDrive;
    },
    async keys(how, codes) {
      if (!c.canDrive) throw new Error("this cabinet has no driver keyboard (D282): use its own controls");
      c.pressed.push(`${how} ${codes.join(" ")}`);
    },
    async logs() {
      return o.logs ?? {};
    },
    async service(method, p, body) {
      c.calls.push({ method, p, body });
      if (o.unpaired) throw Object.assign(new Error("not paired"), { unpaired: true });
      if (p.startsWith("/api/manager/pot/preview")) return { status: 200, body: { over_limit: Number(p.split("=")[1]) > 50, month_total_cents: 1600, workspace_limit_cents: 1500 } };
      if (p === "/api/manager/pot/topup") return { status: 200, body: { ok: true, entry: { pot_after_cents: 1200 } } };
      return { status: 200, body: { pot: { coins: 98 }, history: [] } };
    },
    async pair() {
      c.paired = true;
    },
    close() {},
  };
  return c;
}

async function withManager(cabinets, fn, extra = {}) {
  const server = createManager({ key: "sesame", cabinets: new Map(Object.entries(cabinets)), ...extra });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}

async function login(base) {
  const r = await fetch(`${base}/?key=sesame`, { redirect: "manual" });
  assert.equal(r.status, 303);
  return r.headers.get("set-cookie").split(";")[0];
}

const post = (base, cookie, p, body, extra = {}) => fetch(`${base}${p}`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json", "X-Manager": "1", ...extra }, body: JSON.stringify(body) });

test("only home addresses and safe Host names (D285)", () => {
  for (const ip of ["127.0.0.1", "::ffff:192.168.86.20", "10.0.0.4", "172.20.1.1", "::1", "fe80::1"]) assert.ok(homeAddress(ip), ip);
  for (const ip of ["8.8.8.8", "::ffff:172.32.0.1", "2001:db8::1", undefined]) assert.ok(!homeAddress(ip), String(ip));
  for (const h of ["192.168.86.96:8335", "localhost:8335", "geoffs-mac-mini.local:8335", "[::1]:8335"]) assert.ok(goodHost(h), h);
  for (const h of ["evil.example.com:8335", "manager.attacker.net", undefined]) assert.ok(!goodHost(h), String(h));
});

test("the Manager key is made once, 0600", () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mk-")), "k");
  const k = managerKey(f);
  assert.match(k, /^[A-Za-z0-9_-]{20,}$/);
  assert.equal(managerKey(f), k);
  assert.equal(fs.statSync(f).mode & 0o777, 0o600);
});

test("without the key: locked; a wrong key: refused; the right one sets a cookie", async () => {
  await withManager({ virtual: fakeCabinet() }, async (base) => {
    let r = await fetch(`${base}/`);
    assert.equal(r.status, 401);
    assert.match(await r.text(), /Ask a grown-up/);
    assert.equal((await fetch(`${base}/api/cabinets`)).status, 401);
    assert.equal((await fetch(`${base}/?key=nope`, { redirect: "manual" })).status, 403);
    const cookie = await login(base);
    assert.match(cookie, /^gsa_manager=/);
    r = await fetch(`${base}/`, { headers: { Cookie: cookie } });
    assert.equal(r.status, 200);
    assert.match(await r.text(), /Cabinet Manager/);
    r = await fetch(`${base}/api/cabinets`, { headers: { Cookie: cookie } });
    const j = await r.json();
    assert.deepEqual(j.cabinets.map((c) => c.name), ["virtual"]);
    assert.ok(j.controls.some((c) => c.id === "coin" && c.code === "F2"));
  });
});

test("a foreign Host is refused before anything else (D285)", async () => {
  await withManager({ virtual: fakeCabinet() }, async (base) => {
    const status = await new Promise((resolve, reject) => {
      const u = new URL(base);
      http.get({ host: u.hostname, port: u.port, path: "/?key=sesame", headers: { Host: "rebind.example.com" } }, (r) => {
        r.resume();
        resolve(r.statusCode);
      }).on("error", reject);
    });
    assert.equal(status, 403);
  });
});

test("keys go down and up in order, and a POST without the Manager header is refused (D282)", async () => {
  const cab = fakeCabinet();
  await withManager({ virtual: cab }, async (base) => {
    const cookie = await login(base);
    assert.equal((await fetch(`${base}/api/c/virtual/keys`, { method: "POST", headers: { Cookie: cookie }, body: JSON.stringify({ how: "down", codes: ["KeyZ"] }) })).status, 403);
    assert.equal((await post(base, cookie, "/api/c/virtual/keys", { how: "down", codes: ["KeyZ"] }, { Origin: "http://evil.example.com" })).status, 403);
    assert.equal((await post(base, cookie, "/api/c/virtual/keys", { how: "down", codes: ["F2"], viewer: "v1" })).status, 200);
    assert.equal((await post(base, cookie, "/api/c/virtual/keys", { how: "up", codes: ["F2"], viewer: "v1" })).status, 200);
    assert.equal((await post(base, cookie, "/api/c/virtual/keys", { how: "down", codes: ["Nope"] })).status, 502);
    assert.deepEqual(cab.pressed, ["down 60", "up 60"]);
  });
});

test("a viewer that goes away lets go of what it held (D282)", async () => {
  const cab = fakeCabinet();
  await withManager({ virtual: cab }, async (base) => {
    const cookie = await login(base);
    const ac = new AbortController();
    const stream = await fetch(`${base}/api/c/virtual/screen?viewer=v2`, { headers: { Cookie: cookie }, signal: ac.signal });
    assert.equal(stream.status, 200);
    await post(base, cookie, "/api/c/virtual/keys", { how: "down", codes: ["F1"], viewer: "v2" });
    ac.abort();
    // Until the key is let go, however long a busy mini takes; the count is the give-up (a minute), not a pace.
    for (let i = 0; i < 2400 && cab.pressed.length < 2; i++) await new Promise((r) => setTimeout(r, 25));
    assert.deepEqual(cab.pressed, ["down 59", "up 59"]);
  });
});

test("the screen stream sends frames and freshness while watched, and stops grabbing after (D281)", async () => {
  const cab = fakeCabinet();
  await withManager({ virtual: cab }, async (base) => {
    const cookie = await login(base);
    const ac = new AbortController();
    const r = await fetch(`${base}/api/c/virtual/screen`, { headers: { Cookie: cookie }, signal: ac.signal });
    const reader = r.body.getReader();
    let text = "";
    while (!/event: frame/.test(text)) text += new TextDecoder().decode((await reader.read()).value);
    assert.match(text, /event: status/);
    const frame = JSON.parse(/event: frame\ndata: (.*)/.exec(text)[1]);
    assert.equal(Buffer.from(frame.png, "base64").toString("hex"), PNG.toString("hex"));
    ac.abort();
    await new Promise((res) => setTimeout(res, 100));
    const n = cab.grabs;
    await new Promise((res) => setTimeout(res, 600));
    assert.equal(cab.grabs, n);
  });
});

test("a cabinet without the driver keyboard says so", async () => {
  const cab = fakeCabinet();
  cab.canDrive = false;
  await withManager({ real: cab }, async (base) => {
    const cookie = await login(base);
    const r = await post(base, cookie, "/api/c/real/keys", { how: "down", codes: ["KeyZ"] });
    assert.match((await r.json()).error, /no driver keyboard/);
  });
});

test("a top-up past the workspace limit needs a second press (D284)", async () => {
  const cab = fakeCabinet();
  await withManager({ virtual: cab }, async (base) => {
    const cookie = await login(base);
    let j = await (await post(base, cookie, "/api/c/virtual/pot/topup", { coins: 80, reason: "Birthday" })).json();
    assert.equal(j.needs_confirm, true);
    assert.match(j.warning, /\$15\.00/);
    assert.ok(!cab.calls.some((s) => s.p === "/api/manager/pot/topup"));
    j = await (await post(base, cookie, "/api/c/virtual/pot/topup", { coins: 80, reason: "Birthday", confirm: true })).json();
    assert.equal(j.ok, true);
    const t = cab.calls.find((s) => s.p === "/api/manager/pot/topup");
    assert.equal(t.body.coins, 80);
    assert.equal(t.body.reason, "Birthday");
    assert.equal((await post(base, cookie, "/api/c/virtual/pot/topup", { coins: 5, reason: " " })).status, 400);
    assert.equal((await post(base, cookie, "/api/c/virtual/pot/reset", {})).status, 400);
    assert.equal((await post(base, cookie, "/api/c/virtual/pot/reset", { reason: "Fresh start" })).status, 200);
  });
});

test("an unpaired cabinet says so, and pairing works (D284)", async () => {
  const cab = fakeCabinet({ unpaired: true });
  await withManager({ virtual: cab }, async (base) => {
    const cookie = await login(base);
    const r = await fetch(`${base}/api/c/virtual/pot`, { headers: { Cookie: cookie } });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).unpaired, true);
    assert.equal((await post(base, cookie, "/api/c/virtual/pair", {})).status, 200);
    assert.equal(cab.paired, true);
  });
});

test("activity joins sessions, charges, plays and screened requests (D283)", () => {
  const a = activity({
    studio_session: [
      { id: "s1", maker: "tester", request: "dodge the rocks", kind: "new", parent: null, turns: [{ question: "How do you move?", option_a: "Left/right", option_b: "Anywhere", choice: "A", said: null }], ended_by: "answers", outcome: "committed", cart_id: "rock", cart_version: "1", list_cost: { amount: "19", currency: "USD" }, wall_seconds: 120, started_at: "2026-11-11T10:00:00Z", errors: [] },
      { id: "s2", maker: "tester", request: "make it faster", kind: "change", parent: "rock", turns: [], ended_by: "make_it_now", outcome: "failed", list_cost_usd: 0.07, started_at: "2026-11-11T11:00:00Z", errors: ["x"] },
    ],
    studio_session_correction: [{ corrects: "s1", why: "collected after a restart", at: "2026-11-11T10:05:00Z" }],
    coin_ledger: [{ kind: "charge", session_id: "s1", cost_cents: 19, cents: -19, coins: 2, outcome: "on the shelf", who: "tester", at: "2026-11-11T10:02:00Z", pot_after_cents: 981 }, { kind: "topup", cents: 200, reason: "Birthday", by: "geoff", at: "2026-11-11T12:00:00Z", pot_after_cents: 1181 }],
    play: [{ cart_id: "rock", cart_version: "1", session_id: "s1", started_at: "2026-11-11T10:10:00Z", duration_s: 47.7, score: 9, ended: "star", errors: 0 }],
    guest_play: [{ guest_id: "teti", guest_version: "1.4", started_at: "2026-11-11T09:00:00Z", duration_s: 13, ended: "star", errors: 0 }],
    request_screening: [{ at: "2026-11-11T13:00:00Z", maker: "tester", request: "something rude", verdict: "redirected", offered: "something kind" }],
  });
  assert.equal(a.makes[0].id, "s2");
  assert.equal(a.makes[0].kind, "change");
  assert.equal(a.makes[0].cents, 7);
  assert.equal(a.makes[0].charged, false);
  const m = a.makes[1];
  assert.deepEqual([m.who, m.said, m.coins, m.cents, m.kid_outcome, m.plays, m.minutes], ["tester", "dodge the rocks", 2, 19, "on the shelf", 1, 2]);
  assert.equal(m.answers[0].choice, "A");
  assert.equal(m.corrections.length, 1);
  assert.deepEqual(a.plays.map((p) => [p.game, p.guest, p.made_by]), [["rock", false, "tester"], ["teti", true, null]]);
  assert.deepEqual([a.screened[0].said, a.screened[0].verdict, a.screened[0].offered], ["something rude", "redirected", "something kind"]);
  assert.equal(a.coins[0].kind, "topup");
});

test("key names map to Linux codes; unknown keys are refused", () => {
  assert.deepEqual(toLinux(["ArrowUp", "KeyZ", "Enter", "Escape", "F1", "F2", "ShiftLeft"]), [103, 44, 28, 1, 59, 60, 42]);
  assert.throws(() => toLinux(["MetaLeft"]));
  assert.throws(() => toLinux([]));
});

test("cabinets: virtual reads the VM's host; cabinets.json overrides and adds (D286)", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "cabs-"));
  fs.mkdirSync(path.join(d, "vm"));
  fs.writeFileSync(path.join(d, "vm/host"), "192.168.64.2\n");
  let cabs = loadCabinets(d, path.join(d, "cfg"));
  assert.deepEqual(cabs.map((c) => [c.name, c.host]), [["virtual", "192.168.64.2"], ["real", "arcade.local"]]);
  fs.mkdirSync(path.join(d, "manager"));
  fs.writeFileSync(path.join(d, "manager/cabinets.json"), JSON.stringify({ real: { host: "192.168.86.50" }, spare: { host: "spare.local", key: "/k" } }));
  cabs = loadCabinets(d, path.join(d, "cfg"));
  assert.deepEqual(cabs.map((c) => [c.name, c.host]), [["virtual", "192.168.64.2"], ["real", "192.168.86.50"], ["spare", "spare.local"]]);
  assert.match(cabs[2].tokenFile, /manager-token-spare$/);
});

test("a make a restart cut off is one row, with its final outcome and a restart note (D283)", () => {
  const a = activity({
    studio_session: [
      { id: "s1", maker: "tester", request: "frogs", outcome: "service_restarted", started_at: "2026-11-12T23:35:00Z", ended_at: "2026-11-12T23:38:45Z" },
      { id: "s2", maker: "tester", request: "bees", outcome: "committed", cart_id: "bee", cart_version: "1", started_at: "2026-11-12T23:40:00Z" },
      { id: "s1", maker: "tester", request: "frogs", outcome: "committed", cart_id: "frog", cart_version: "1", started_at: "2026-11-12T23:35:00Z", ended_at: "2026-11-12T23:41:41Z" },
      { id: "s3", maker: "tester", request: "cut off, never collected", outcome: "service_restarted", started_at: "2026-11-12T23:30:00Z" },
    ],
    coin_ledger: [{ kind: "charge", session_id: "s1", cost_cents: 31, coins: 3, outcome: "restart, on the shelf", at: "2026-11-12T23:41:42Z" }],
  });
  assert.equal(a.makes.length, 3);
  const frog = a.makes.find((m) => m.id === "s1");
  assert.deepEqual([frog.outcome, frog.cart.id, frog.restarted, frog.coins, frog.kid_outcome], ["committed", "frog", true, 3, "restart, on the shelf"]);
  assert.equal(a.makes.find((m) => m.id === "s2").restarted, false);
  assert.deepEqual([a.makes.find((m) => m.id === "s3").outcome, a.makes.find((m) => m.id === "s3").restarted], ["service_restarted", true]);
});

test("a desktop publish is its own kind of row: origin desktop, no coins, its gate (D343, D345)", () => {
  const a = activity({
    studio_session: [{ id: "desk_1", origin: "desktop", maker: "alina", with: "geoff", request: "Faster fish.", summary: "Faster fish.", kind: "change", parent: "penguin-catch@1", turns: [], ended_by: "published", list_cost: null, outcome: "committed", cart_id: "penguin-catch-v2", cart_version: 2, started_at: "2026-11-13T20:00:00Z", playtest: { local: { ok: true, gate: { ok: true, seconds: 6.1, failing: [] } } } }],
  });
  const m = a.makes[0];
  assert.deepEqual([m.origin, m.kind, m.cents, m.coins, m.charged, m.said, m.answers.length], ["desktop", "change", null, null, false, "Faster fish.", 0]);
  assert.ok(m.gate);
  const page = fs.readFileSync(new URL("../page/app.js", import.meta.url), "utf8");
  assert.match(page, /made at the desk/);
});

test("times are shown in the house's time zone: the mini's, or MANAGER_TZ (D283)", async () => {
  const was = process.env.MANAGER_TZ;
  try {
    process.env.MANAGER_TZ = "America/New_York";
    assert.equal(houseTimeZone(), "America/New_York");
    process.env.MANAGER_TZ = "Not/AZone";
    assert.equal(houseTimeZone(), "UTC");
    delete process.env.MANAGER_TZ;
    assert.equal(houseTimeZone(), Intl.DateTimeFormat().resolvedOptions().timeZone);
    process.env.MANAGER_TZ = "America/New_York";
    await withManager({ virtual: fakeCabinet() }, async (base) => {
      const cookie = await login(base);
      const j = await (await fetch(`${base}/api/cabinets`, { headers: { Cookie: cookie } })).json();
      assert.equal(j.time_zone, "America/New_York");
    });
  } finally {
    if (was === undefined) delete process.env.MANAGER_TZ;
    else process.env.MANAGER_TZ = was;
  }
});

// The Update button (D338): the same update-cabinet.mjs a grown-up runs, with a stand-in for the process.
function fakeRun() {
  const runs = [];
  const run = (args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    runs.push({ args, child });
    return child;
  };
  return { runs, run };
}

test("the Update button runs update-cabinet.mjs for that cabinet, one at a time, and keeps its output (D338)", async () => {
  const f = fakeRun();
  const updates = updater({ run: f.run, checkout: () => "abc123def456" });
  const cab = fakeCabinet();
  cab.exec = async () => "0.1.0-111\nabc123def456\n";
  await withManager({ real: cab, other: fakeCabinet() }, async (base) => {
    const cookie = await login(base);
    const get = async (n) => (await fetch(`${base}/api/c/${n}/update`, { headers: { Cookie: cookie } })).json();
    let s = await get("real");
    assert.deepEqual([s.running, s.checkout, s.cabinet.version, s.cabinet.commit], [false, "abc123def456", "0.1.0-111", "abc123def456"]);
    assert.equal((await post(base, cookie, "/api/c/real/update", { os: true })).status, 200);
    assert.deepEqual(f.runs[0].args, ["--picade", "--os"]);
    assert.equal((await post(base, cookie, "/api/c/real/update", {})).status, 409, "one at a time");
    assert.equal((await post(base, cookie, "/api/c/other/update", {})).status, 404, "only cabinets it knows how to update");
    const out = f.runs[0].child.stdout;
    out.emit("data", '[update] sending abc to the picade cabinet\n{\n "ok": false,\n "reason": "a game is being played (teti): nothing was changed"\n}\n');
    out.emit("data", "[update] Stopped: a game is being played\n");
    f.runs[0].child.emit("close", 1);
    s = await get("real");
    assert.equal(s.running, false);
    assert.equal(s.ok, false);
    assert.equal(s.result.reason, "a game is being played (teti): nothing was changed");
    assert.deepEqual(s.lines, ["[update] sending abc to the picade cabinet", "[update] Stopped: a game is being played"]);
    assert.equal((await post(base, cookie, "/api/c/real/update", {})).status, 200, "another once it's done");
    assert.deepEqual(f.runs[1].args, ["--picade"]);
  }, { updates });
});

test("the Update button needs the Manager's page, like every POST (D285)", async () => {
  const f = fakeRun();
  await withManager({ virtual: fakeCabinet() }, async (base) => {
    const cookie = await login(base);
    const r = await fetch(`${base}/api/c/virtual/update`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: "{}" });
    assert.equal(r.status, 403);
    assert.equal(f.runs.length, 0);
  }, { updates: updater({ run: f.run, checkout: () => "x" }) });
});

test("Games: the list, Remove from shelf and Put back, hiding a maker, all asked of the cabinet with its token (D364)", async () => {
  const cab = fakeCabinet();
  const calls = [];
  cab.service = async (method, p, body) => {
    calls.push({ method, p, body });
    if (p === "/api/manager/games") return { status: 200, body: { games: [{ id: "rock-rain", on_shelf: true }], history: [] } };
    if (p === "/api/manager/makers") return { status: 200, body: { makers: [{ id: "owen", on_list: true }] } };
    if (p === "/api/manager/games/remove" && body.id === "nope") return { status: 404, body: { ok: false, error: 'no game "nope" on this cabinet' } };
    return { status: 200, body: { ok: true, changed: true } };
  };
  await withManager({ virtual: cab }, async (base) => {
    const cookie = await login(base);
    const games = await (await fetch(`${base}/api/c/virtual/games`, { headers: { Cookie: cookie } })).json();
    assert.equal(games.games[0].id, "rock-rain");
    assert.equal((await post(base, cookie, "/api/c/virtual/games/remove", { id: "rock-rain", reason: "test game" })).status, 200);
    assert.equal((await post(base, cookie, "/api/c/virtual/games/restore", { id: "rock-rain" })).status, 200);
    assert.equal((await post(base, cookie, "/api/c/virtual/makers/hide", { id: "owen" })).status, 200);
    assert.equal((await post(base, cookie, "/api/c/virtual/makers/show", { id: "owen" })).status, 200);
    assert.equal((await post(base, cookie, "/api/c/virtual/games/remove", { id: "../x" })).status, 400);
    const missing = await post(base, cookie, "/api/c/virtual/games/remove", { id: "nope" });
    assert.equal(missing.status, 404);
    // Without the Manager's own header, nothing is asked of the cabinet.
    assert.equal((await fetch(`${base}/api/c/virtual/games/remove`, { method: "POST", headers: { Cookie: cookie }, body: JSON.stringify({ id: "rock-rain" }) })).status, 403);
    const posts = calls.filter((c) => c.method === "POST");
    assert.deepEqual(posts.map((c) => [c.p, c.body.id]), [["/api/manager/games/remove", "rock-rain"], ["/api/manager/games/restore", "rock-rain"], ["/api/manager/makers/hide", "owen"], ["/api/manager/makers/show", "owen"], ["/api/manager/games/remove", "nope"]]);
    assert.equal(posts[0].body.reason, "test game");
    assert.match(posts[0].body.by, /in the Manager$/);
  });
});
