// scripts/coin.mjs against a real service on this machine (D215): show, add with a reason, the
// workspace-limit warning, reset, a token file others can read, and the token never in the output.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { main } from "../coin.mjs";
import { startService } from "../../cabinet/service/src/server.js";
import { potStore } from "../../cabinet/service/src/pot.js";
import { makersStore } from "../../cabinet/service/src/makers.js";
import { stubSpeech } from "../../cabinet/service/src/speech.js";
import { createStudio } from "../../cabinet/service/src/studio.js";
import { dataPaths } from "../../studio-kit/cli/src/config.js";

const TOKEN = "a".repeat(64);

async function cabinet() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gsa-coin-"));
  const paths = dataPaths(root);
  const pot = potStore({ logsDir: paths.logs });
  pot.charge({ maker: "alina", what: "new", session_id: "s1", cost_cents: 54, outcome: "on the shelf" });
  const makers = makersStore({ file: path.join(root, "makers.json") });
  makers.add("alina");
  const studio = createStudio({ paths, api: async () => { throw new Error("no API here"); }, lock: () => ({ agentId: "a", environmentId: "e" }), kit: async () => ({ fileId: "", hash: "" }), checker: /** @type {any} */ ({}), pot });
  // The token as the cabinet reads it: from its file, on each request.
  const cabinetFile = path.join(root, "manager-token");
  fs.writeFileSync(cabinetFile, TOKEN, { mode: 0o600 });
  const s = await startService({ studio, makers, speech: stubSpeech(), libraryDir: paths.carts, logsDir: paths.logs, pot, managerToken: () => fs.readFileSync(cabinetFile, "utf8").trim(), port: 0 });
  const mine = path.join(root, "mine-token");
  fs.writeFileSync(mine, `${TOKEN}\n`, { mode: 0o600 });
  /** @type {string[]} */
  const out = [];
  const run = (/** @type {string[]} */ args) => main([...args, "--url", s.url, "--token-file", mine], { log: (l) => out.push(l) });
  return { s, run, out, root, mine, pot, url: s.url };
}

test("coin: show, add with a reason the kids see, the $15 warning, reset (D205, D211, D215)", async () => {
  const c = await cabinet();
  try {
    assert.equal(await c.run(["show"]), 0);
    assert.match(c.out.join("\n"), /Pot: 95 coins \(\$9\.46\) of 100/);
    assert.match(c.out.join("\n"), /Alina: 5 coins/);

    assert.equal(await c.run(["add", "20", "Owen", "helped", "clean", "the", "basement", "--by", "Geoff"]), 0);
    assert.match(c.out.at(-1) ?? "", /Added 20 coins \(\$2\.00\): "Owen helped clean the basement"\. The pot now has 115 coins/);
    const history = await (await fetch(`${c.url}/api/pot`)).json();
    assert.equal(history.history[0].reason, "Owen helped clean the basement", "the launcher's coin history (A2) has the reason");
    assert.equal(history.history[0].by, "Geoff");

    // $0.54 spent + $11.46 in the pot + $4 = $16: past $15, so it stops and asks.
    assert.equal(await c.run(["add", "40", "Too much"]), 3);
    assert.match(c.out.at(-1) ?? "", /past the workspace's real limit of \$15\.00/);
    assert.equal(c.pot.state().coins, 115, "nothing added without --yes");
    assert.equal(await c.run(["add", "40", "Too much", "--yes"]), 0);
    assert.equal(c.pot.state().coins, 155);

    assert.equal(await c.run(["reset", "Back", "to", "normal"]), 0);
    assert.equal(c.pot.state().coins, 100);
    await assert.rejects(c.run(["add", "5"]), /needs a reason/);
    await assert.rejects(c.run(["reset"]), /needs a reason/);
    await assert.rejects(c.run(["add", "two", "x"]), /whole number/);
    assert.ok(!c.out.join("\n").includes(TOKEN), "the token is never printed");
  } finally {
    await c.s.close();
  }
});

test("coin: a wrong token is refused, and a token file others can read isn't used", async () => {
  const c = await cabinet();
  try {
    fs.writeFileSync(c.mine, "b".repeat(64), { mode: 0o600 });
    await assert.rejects(c.run(["show"]), /said 401/);
    fs.chmodSync(c.mine, 0o644);
    await assert.rejects(c.run(["show"]), /can be read by others/);
    fs.rmSync(c.mine);
    await assert.rejects(c.run(["show"]), /Run: node scripts\/coin\.mjs pair/);
  } finally {
    await c.s.close();
  }
});
