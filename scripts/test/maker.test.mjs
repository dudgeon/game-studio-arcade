// scripts/maker.mjs against a real service on this machine (D236): add a grown-up maker, once; a
// maker already there left as is; the token needed; and the service never writes makers.json itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { main } from "../maker.mjs";
import { startService } from "../../cabinet/service/src/server.js";
import { potStore } from "../../cabinet/service/src/pot.js";
import { makersStore } from "../../cabinet/service/src/makers.js";
import { stubSpeech } from "../../cabinet/service/src/speech.js";
import { createStudio } from "../../cabinet/service/src/studio.js";
import { createGuests } from "../../cabinet/service/src/guests.js";
import { dataPaths } from "../../studio-kit/cli/src/config.js";

const TOKEN = "b".repeat(64);
const REPO_GUESTS = path.resolve(import.meta.dirname, "../../guests");

async function cabinet() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gsa-maker-"));
  const paths = dataPaths(root);
  const pot = potStore({ logsDir: paths.logs });
  const file = path.join(root, "makers.json");
  const makers = makersStore({ file });
  makers.add("alina");
  const before = fs.readFileSync(file, "utf8");
  const studio = createStudio({ paths, api: async () => { throw new Error("no API here"); }, lock: () => ({ agentId: "a", environmentId: "e" }), kit: async () => ({ fileId: "", hash: "" }), checker: /** @type {any} */ ({}), pot });
  // The real guests, Geoff's version among them: the service starts with them and must not touch makers.json.
  const guests = createGuests({ dirs: [REPO_GUESTS], logsDir: paths.logs });
  const s = await startService({ studio, makers, speech: stubSpeech(), libraryDir: paths.carts, logsDir: paths.logs, pot, guests, managerToken: TOKEN, port: 0 });
  const mine = path.join(root, "mine-token");
  fs.writeFileSync(mine, `${TOKEN}\n`, { mode: 0o600 });
  /** @type {string[]} */
  const out = [];
  const run = (/** @type {string[]} */ args, token = mine) => main([...args, "--url", s.url, "--token-file", token], { log: (l) => out.push(l) });
  return { s, run, out, root, file, before, makers };
}

test("maker: add a grown-up once; the kids' list doesn't offer them; a cabinet name is left as is (D236)", async () => {
  const c = await cabinet();
  try {
    assert.equal(fs.readFileSync(c.file, "utf8"), c.before, "starting the service with a guest version wrote nothing");
    assert.equal(await c.run(["add-grown-up", "Geoff"]), 0);
    assert.match(c.out.at(-1) ?? "", /Added Geoff \(geoff\) as a grown-up maker/);
    assert.equal(await c.run(["add-grown-up", "geoff"]), 0);
    assert.match(c.out.at(-1) ?? "", /Geoff \(geoff\) is already a maker, a grown-up\. Left as is\./);
    const all = JSON.parse(fs.readFileSync(c.file, "utf8"));
    assert.deepEqual(all.map((/** @type {any} */ m) => [m.id, m.guest, m.grown_up ?? false]), [["alina", true, false], ["geoff", false, true]]);
    // M1 (the kids' list) still offers only Alina; the Manager's list has both.
    assert.deepEqual((await (await fetch(`${c.s.url}/api/makers`)).json()).makers.map((/** @type {any} */ m) => m.id), ["alina"]);
    assert.equal(await c.run(["list"]), 0);
    assert.match(c.out.at(-1) ?? "", /Alina \(alina\), added at the cabinet\n {2}Geoff \(geoff\), grown-up/);
    // A kid's own name stays theirs.
    assert.equal(await c.run(["add-grown-up", "Alina"]), 0);
    assert.match(c.out.at(-1) ?? "", /Alina \(alina\) is already a maker, added at the cabinet\. Left as is\./);
    assert.equal(JSON.parse(fs.readFileSync(c.file, "utf8"))[0].guest, true);
  } finally {
    await c.s.close();
  }
});

test("maker: add a kid from the mini, as 'Someone new' would; once; a grown-up's name is left as is (D236)", async () => {
  const c = await cabinet();
  try {
    assert.equal(await c.run(["add", "owen"]), 0);
    assert.match(c.out.at(-1) ?? "", /Added Owen \(owen\) as a maker, as "Someone new" at the cabinet would/);
    const all = JSON.parse(fs.readFileSync(c.file, "utf8"));
    assert.deepEqual(all.map((/** @type {any} */ m) => [m.id, m.name, m.guest, m.grown_up ?? false]), [["alina", "Alina", true, false], ["owen", "Owen", true, false]]);
    // The kids' list offers them, as any kid.
    assert.deepEqual((await (await fetch(`${c.s.url}/api/makers`)).json()).makers.map((/** @type {any} */ m) => m.id).sort(), ["alina", "owen"]);
    assert.equal(await c.run(["add", "Owen"]), 0);
    assert.match(c.out.at(-1) ?? "", /Owen \(owen\) is already a maker, added at the cabinet\. Left as is\./);
    assert.equal(JSON.parse(fs.readFileSync(c.file, "utf8")).length, 2);
    await c.run(["add-grown-up", "Geoff"]);
    assert.equal(await c.run(["add", "Geoff"]), 0);
    assert.match(c.out.at(-1) ?? "", /Geoff \(geoff\) is already a maker, a grown-up\. Left as is\./);
    assert.equal(JSON.parse(fs.readFileSync(c.file, "utf8")).find((/** @type {any} */ m) => m.id === "geoff").grown_up, true);
    // The token is needed first: a wrong one adds nobody.
    const wrong = path.join(c.root, "wrong-token");
    fs.writeFileSync(wrong, `${"c".repeat(64)}\n`, { mode: 0o600 });
    await assert.rejects(c.run(["add", "Zoe"], wrong), /401/);
    assert.ok(!JSON.parse(fs.readFileSync(c.file, "utf8")).some((/** @type {any} */ m) => m.id === "zoe"));
    await assert.rejects(c.run(["add"]), /needs a first name/);
  } finally {
    await c.s.close();
  }
});

test("maker: the Manager's token is needed, and a name is needed", async () => {
  const c = await cabinet();
  try {
    const wrong = path.join(c.root, "wrong-token");
    fs.writeFileSync(wrong, `${"c".repeat(64)}\n`, { mode: 0o600 });
    await assert.rejects(c.run(["add-grown-up", "Geoff"], wrong), /401/);
    await assert.rejects(c.run(["add-grown-up"]), /needs a first name/);
    const r = await fetch(`${c.s.url}/api/manager/makers/grown-up`, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: "!!!" }) });
    assert.equal(r.status, 400);
    assert.equal(fs.readFileSync(c.file, "utf8"), c.before, "nothing was written");
    assert.doesNotMatch(c.out.join("\n"), new RegExp(TOKEN), "the token is never printed");
  } finally {
    await c.s.close();
  }
});
