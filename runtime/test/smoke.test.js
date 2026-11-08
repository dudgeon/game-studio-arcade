import { test } from "node:test";
import assert from "node:assert/strict";

test("runs on Node 22 (D9)", () => {
  assert.equal(process.versions.node.split(".")[0], "22");
});
