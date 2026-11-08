// The cabinet's key file (D131, D185). A fake key only; nothing here calls the API.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient, createCabinetClient, AuthSetupError, CabinetAuthError } from "../index.js";

const FAKE_KEY = "fake-cabinet-key-not-real";

/** @param {string | null} body @param {number} [mode] */
function configFile(body, mode = 0o600) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gsa-cabinet-auth-"));
  const file = path.join(dir, "service.json");
  if (body !== null) {
    fs.writeFileSync(file, body);
    fs.chmodSync(file, mode);
  }
  return file;
}

test("the key comes from a 0600 file and goes to the SDK", () => {
  const client = createCabinetClient({ configFile: configFile(JSON.stringify({ anthropic_api_key: FAKE_KEY })) });
  assert.equal(client.apiKey, FAKE_KEY);
  assert.equal(client.authToken, null);
});

test("the file's key outranks whatever is in the environment", () => {
  process.env.ANTHROPIC_API_KEY = "stray-key";
  process.env.ANTHROPIC_AUTH_TOKEN = "stray-token";
  try {
    const client = createCabinetClient({ configFile: configFile(JSON.stringify({ anthropic_api_key: FAKE_KEY })) });
    assert.equal(client.apiKey, FAKE_KEY);
    assert.equal(client.authToken, null);
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  }
});

test("a file others can read or write is refused, and the error has no key", () => {
  for (const mode of [0o644, 0o640, 0o604, 0o660, 0o666, 0o620]) {
    const file = configFile(JSON.stringify({ anthropic_api_key: FAKE_KEY }), mode);
    assert.throws(
      () => createCabinetClient({ configFile: file }),
      (/** @type {any} */ e) => {
        assert.ok(e instanceof CabinetAuthError);
        assert.match(e.message, /0600/);
        assert.ok(!e.message.includes(FAKE_KEY));
        return true;
      },
    );
  }
});

test("a missing file, bad JSON and a missing key are refused without quoting the file", () => {
  assert.throws(() => createCabinetClient({ configFile: configFile(null) }), CabinetAuthError);
  assert.throws(() => createCabinetClient({ configFile: "" }), CabinetAuthError);
  for (const body of [`{"anthropic_api_key": "${FAKE_KEY}"`, "{}", '{"anthropic_api_key": "  "}', '{"anthropic_api_key": 7}', "null"]) {
    assert.throws(
      () => createCabinetClient({ configFile: configFile(body) }),
      (/** @type {any} */ e) => {
        assert.ok(e instanceof CabinetAuthError);
        assert.ok(!e.message.includes(FAKE_KEY));
        return true;
      },
    );
  }
});

test("no other credentials on the cabinet path; the mini's path still takes no key", () => {
  const file = configFile(JSON.stringify({ anthropic_api_key: FAKE_KEY }));
  for (const k of ["apiKey", "authToken", "credentials", "config", "profile"]) {
    assert.throws(() => createCabinetClient({ configFile: file, sdkOptions: /** @type {any} */ ({ [k]: "x" }) }), CabinetAuthError);
  }
  assert.throws(() => createClient(/** @type {any} */ ({ apiKey: FAKE_KEY })), AuthSetupError);
});
