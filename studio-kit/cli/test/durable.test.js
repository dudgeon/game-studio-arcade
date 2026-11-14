// Writes that survive a power cut (D371). What a cut does to a disk is rehearsed in QEMU
// (scripts/cabinet-card/test/power-rehearsal.sh); here, the parts that need no cut.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendLineDurable, writeFileDurable, writeJsonDurable } from "../src/durable.js";
import { appendLog, readLog } from "../src/log.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "durable-"));

test("a durable write replaces the file whole and leaves no temp file behind", () => {
  const d = tmp();
  const f = path.join(d, "sub", "makers.json");
  writeJsonDurable(f, [{ id: "alina" }]);
  writeJsonDurable(f, [{ id: "alina" }, { id: "owen" }]);
  assert.deepEqual(JSON.parse(fs.readFileSync(f, "utf8")), [{ id: "alina" }, { id: "owen" }]);
  assert.deepEqual(fs.readdirSync(path.dirname(f)), ["makers.json"]);
  writeFileDurable(path.join(d, "b.bin"), Buffer.from([1, 2, 3]));
  assert.deepEqual([...fs.readFileSync(path.join(d, "b.bin"))], [1, 2, 3]);
});

test("an append after a torn line starts its own line, so it isn't lost with the torn one", () => {
  const d = tmp();
  const f = path.join(d, "coin_ledger.jsonl");
  appendLineDurable(f, JSON.stringify({ id: 1 }));
  // What a power cut can leave: half a line, or zeros where the data never reached the disk.
  fs.appendFileSync(f, '{"id":2,"cen');
  appendLineDurable(f, JSON.stringify({ id: 3 }));
  fs.appendFileSync(f, Buffer.alloc(8));
  appendLineDurable(f, JSON.stringify({ id: 4 }));
  const ok = fs.readFileSync(f, "utf8").split("\n").flatMap((l) => {
    try {
      return [JSON.parse(l).id];
    } catch {
      return [];
    }
  });
  assert.deepEqual(ok, [1, 3, 4]);
});

test("logs: appends go through the same guard, and reading skips a torn line instead of throwing", () => {
  const d = tmp();
  appendLog(d, "cart_version", { cart_id: "a" });
  fs.appendFileSync(path.join(d, "cart_version.jsonl"), '{"type":"cart_ver');
  appendLog(d, "cart_version", { cart_id: "b" });
  assert.deepEqual(readLog(path.join(d, "cart_version.jsonl")).map((r) => r.cart_id), ["a", "b"]);
});

test("a library whose creation a power cut cut short (empty .git/HEAD) works again, with nothing else touched", async () => {
  const { ensureLibrary } = await import("../src/library.js");
  const { execFileSync } = await import("node:child_process");
  const root = path.join(tmp(), "carts");
  ensureLibrary(root);
  fs.writeFileSync(path.join(root, ".git", "HEAD"), "");
  assert.throws(() => execFileSync("git", ["-C", root, "log", "-1"], { stdio: "pipe" }), "git can't see it");
  ensureLibrary(root);
  assert.match(execFileSync("git", ["-C", root, "log", "-1", "--format=%s"], { encoding: "utf8" }), /Start the dev cart library/);
  assert.ok(fs.existsSync(path.join(root, "README.md")));
});

test("the library's commits ask git to flush objects, refs and the index (core.fsync)", () => {
  for (const f of ["../src/library.js", "../../../cabinet/service/src/arcade-mcp.js"]) {
    const s = fs.readFileSync(new URL(f, import.meta.url), "utf8");
    assert.match(s, /GIT_CONFIG_KEY_0: "core\.fsync"/, f);
    assert.match(s, /GIT_CONFIG_VALUE_0: "added"/, f);
  }
});
