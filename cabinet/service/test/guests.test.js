// Guest games (D230–D232): the folder format, the guest port's files and the
// launcher-side API. The real guests/ folder is used, so teti's guest.json is checked too.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createGuests, listGuests, startGuestServer } from "../src/guests.js";

const REPO_GUESTS = path.resolve(import.meta.dirname, "../../../guests");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "gsa-guests-"));

/** @param {string} url @param {{ method?: string, headers?: Record<string, string>, body?: string }} [o] */
function request(url, o = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: o.method ?? "GET", headers: o.headers }, (res) => {
      const chunks = /** @type {Buffer[]} */ ([]);
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end(o.body);
  });
}

/** The service's API side, on its own little server. @param {ReturnType<typeof createGuests>} guests */
function apiServer(guests) {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://x").pathname;
    if (!guests.api(req, res, pathname)) res.writeHead(418).end("not a guest path");
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`, close: () => server.close() })));
}

test("the repo's guests: teti is one, with a complete guest.json, a NOTICE and a play folder", () => {
  const guests = listGuests(REPO_GUESTS);
  const teti = guests.find((g) => g.id === "teti");
  assert.ok(teti, "teti is listed");
  assert.equal(teti.meta.title, "teti");
  assert.match(teti.meta.entry, /^index\.html\?cabinet$/);
  assert.match(teti.meta.upstream.commit, /^[0-9a-f]{40}$/);
  assert.ok(teti.meta.howToPlay.controls.length > 0);
  assert.ok(fs.existsSync(path.join(teti.dir, "NOTICE.md")), "every guest says where its files come from (D231)");
  assert.ok(fs.existsSync(path.join(teti.dir, "LICENSE")));
});

test("teti loads nothing from the network: no http(s) URL in its page, styles or scripts' imports", () => {
  const play = path.join(REPO_GUESTS, "teti", "play");
  const html = fs.readFileSync(path.join(play, "index.html"), "utf8");
  assert.doesNotMatch(html, /(src|href)="https?:/);
  for (const f of fs.readdirSync(path.join(play, "styles")).filter((f) => f.endsWith(".css"))) {
    assert.doesNotMatch(fs.readFileSync(path.join(play, "styles", f), "utf8"), /url\(['"]?https?:/, f);
  }
  // Every sound and the song the game names are files that exist.
  const named = [...fs.readFileSync(path.join(play, "src/data/sfxlist.js"), "utf8").matchAll(/"path": "([^"]+)"/g), ...fs.readFileSync(path.join(play, "src/data/data.js"), "utf8").matchAll(/"path": "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(named.length > 60);
  for (const p of named) assert.ok(fs.existsSync(path.join(play, p)), p);
});

test("a folder without a valid guest.json or play/ isn't a guest", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "broken", "play"), { recursive: true });
  fs.writeFileSync(path.join(dir, "broken", "guest.json"), "{nope");
  fs.mkdirSync(path.join(dir, "noplay"));
  fs.writeFileSync(path.join(dir, "noplay", "guest.json"), JSON.stringify({ id: "noplay", title: "x", entry: "index.html" }));
  fs.mkdirSync(path.join(dir, "wrongid", "play"), { recursive: true });
  fs.writeFileSync(path.join(dir, "wrongid", "guest.json"), JSON.stringify({ id: "other", title: "x", entry: "index.html" }));
  fs.mkdirSync(path.join(dir, "ok", "play"), { recursive: true });
  fs.writeFileSync(path.join(dir, "ok", "guest.json"), JSON.stringify({ id: "ok", title: "OK", entry: "index.html" }));
  assert.deepEqual(listGuests(dir).map((g) => g.id), ["ok"]);
  assert.deepEqual(listGuests(path.join(dir, "missing")), []);
});

test("the guest port serves play/ only, puts the escape script first in pages, and handles byte ranges", async () => {
  const guests = createGuests({ dirs: [REPO_GUESTS], logsDir: tmp() });
  const s = await startGuestServer(guests, { port: 0 });
  try {
    const page = /** @type {any} */ (await request(`${s.url}/teti/index.html?cabinet`));
    assert.equal(page.status, 200);
    const html = page.body.toString();
    const at = html.indexOf('<script src="/__cabinet/escape.js"></script>');
    assert.ok(at > 0 && at < html.indexOf("<script", at + 10) && at < html.indexOf("<title"), "the escape script comes before anything of the game's");
    const esc = /** @type {any} */ (await request(`${s.url}/__cabinet/escape.js`));
    assert.match(esc.body.toString(), /stopImmediatePropagation/);
    const js = /** @type {any} */ (await request(`${s.url}/teti/src/cabinet.js`));
    assert.equal(js.status, 200);
    assert.match(js.headers["content-type"], /text\/javascript/);
    assert.equal(/** @type {any} */ (await request(`${s.url}/teti/../guest.json`)).status, 404, "nothing outside play/");
    assert.equal(/** @type {any} */ (await request(`${s.url}/teti/%2e%2e/guest.json`)).status, 404);
    assert.equal(/** @type {any} */ (await request(`${s.url}/nobody/index.html`)).status, 404);
    assert.equal(/** @type {any} */ (await request(`${s.url}/teti/index.html`, { method: "POST" })).status, 405);
    const part = /** @type {any} */ (await request(`${s.url}/teti/assets/music/brick-parade.wav`, { headers: { range: "bytes=0-43" } }));
    assert.equal(part.status, 206);
    assert.equal(part.body.length, 44);
    assert.equal(part.body.subarray(0, 4).toString(), "RIFF");
  } finally {
    await s.close();
  }
});

test("the API lists guests with their guest-port URL, and logs plays from the launcher only", async () => {
  const logsDir = tmp();
  const guests = createGuests({ dirs: [REPO_GUESTS], logsDir, now: () => new Date("2026-11-11T12:00:00Z") });
  guests.port = 8340;
  const api = /** @type {any} */ (await apiServer(guests));
  try {
    const host = new URL(api.url).host;
    const listed = JSON.parse(/** @type {any} */ (await request(`${api.url}/api/guests`)).body.toString()).guests;
    const teti = listed.find((/** @type {any} */ g) => g.id === "teti");
    assert.equal(teti.url, "http://127.0.0.1:8340/teti/index.html?cabinet");
    assert.equal(teti.guest, true);
    assert.equal(teti.plays, 0);

    const play = { guest_id: "teti", play_id: "pl_1", started_at: "2026-11-11T11:58:00Z", duration_s: 95.44, ended: "star" };
    const ok = /** @type {any} */ (await request(`${api.url}/api/guest-plays`, { method: "POST", headers: { origin: `http://${host}` }, body: JSON.stringify(play) }));
    assert.equal(ok.status, 200);
    const [record] = fs.readFileSync(path.join(logsDir, "guest_play.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(record, { id: "pl_1", guest_id: "teti", guest_version: "1.4.4-cabinet.1", origin: "cabinet", started_at: "2026-11-11T11:58:00.000Z", duration_s: 95.4, ended: "star", errors: 0, logged_at: "2026-11-11T12:00:00.000Z" });

    const fromGuest = /** @type {any} */ (await request(`${api.url}/api/guest-plays`, { method: "POST", headers: { origin: "http://127.0.0.1:8340" }, body: JSON.stringify(play) }));
    assert.equal(fromGuest.status, 403, "a guest page can't write the cabinet's logs (D232)");
    const unknown = /** @type {any} */ (await request(`${api.url}/api/guest-plays`, { method: "POST", body: JSON.stringify({ ...play, guest_id: "nobody" }) }));
    assert.equal(unknown.status, 404);
    const bad = /** @type {any} */ (await request(`${api.url}/api/guest-plays`, { method: "POST", body: JSON.stringify({ ...play, play_id: "no spaces" }) }));
    assert.equal(bad.status, 400);
    assert.equal(JSON.parse(/** @type {any} */ (await request(`${api.url}/api/guests`)).body.toString()).guests.find((/** @type {any} */ g) => g.id === "teti").plays, 1);
    assert.equal(/** @type {any} */ (await request(`${api.url}/api/other`)).status, 418, "other paths are handed on");
  } finally {
    api.close();
  }
});
