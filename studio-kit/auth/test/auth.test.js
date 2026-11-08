// Offline unit tests (node --test). The live check is check.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient, profileName, checkAuth, AuthSetupError, DEFAULT_PROFILE } from "../index.js";

test("default profile name", () => {
  delete process.env.GSA_PROFILE;
  assert.equal(profileName(), DEFAULT_PROFILE);
});

test("GSA_PROFILE and explicit option override the default", () => {
  process.env.GSA_PROFILE = "cabinet";
  assert.equal(profileName(), "cabinet");
  assert.equal(profileName({ profile: "other" }), "other");
  delete process.env.GSA_PROFILE;
});

test("refuses explicit credentials", () => {
  for (const k of ["apiKey", "authToken", "credentials", "config"]) {
    assert.throws(() => createClient({ [k]: "x" }), AuthSetupError);
  }
});

test("a missing profile becomes an AuthSetupError with the setup hint", async () => {
  const dir = await import("node:fs").then((fs) => fs.mkdtempSync("/tmp/gsa-auth-test-"));
  process.env.ANTHROPIC_CONFIG_DIR = dir;
  try {
    const client = createClient({ profile: "does-not-exist", maxRetries: 0 });
    await assert.rejects(checkAuth(client), (/** @type {any} */ err) => {
      assert.ok(err instanceof AuthSetupError, `got ${err?.name}: ${err?.message}`);
      assert.match(err.message, /setup-anthropic-auth\.sh/);
      return true;
    });
  } finally {
    delete process.env.ANTHROPIC_CONFIG_DIR;
  }
});
