import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCost, diffPaths, HARNESS } from "../parity/run-parity.js";

test("computeCost prices tokens and runtime at list rates", () => {
  const c = computeCost(
    {
      input_tokens: 1_000_000,
      output_tokens: 100_000,
      cache_read_input_tokens: 2_000_000,
      cache_creation: { ephemeral_5m_input_tokens: 400_000, ephemeral_1h_input_tokens: 0 },
      active_seconds: 3600,
    },
    "claude-haiku-5-5",
  );
  assert.ok(c);
  // 0.10 + 0.05 + 0.02 + 0.05 = 0.22 tokens; 0.08 runtime
  assert.equal(Math.round(c.tokens * 1e6), 220000);
  assert.equal(Math.round(c.runtime * 1e6), 80000);
  assert.equal(computeCost({}, "unknown-model"), null);
});

test("diffPaths lists where two reports differ", () => {
  assert.deepEqual(diffPaths({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] }), []);
  assert.deepEqual(diffPaths({ a: 1, b: [1, 2] }, { a: 2, b: [1, 3], c: true }), ["$.a: 1 != 2", "$.b[1]: 2 != 3", "$.c: undefined != true"]);
});

test("the harness prompt allows nothing but the one command", () => {
  assert.match(HARNESS, /run the exact shell command/);
  assert.match(HARNESS, /Don't call any other tool/);
});
