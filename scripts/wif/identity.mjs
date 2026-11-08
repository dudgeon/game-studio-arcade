#!/usr/bin/env node
// Device identity for Workload Identity Federation (WIF).
//
// Each machine that calls the Claude API (the Mac mini now, the cabinet later)
// holds its own ES256 private key. Anthropic knows only the public half, which
// is registered inline on a "Custom OIDC" federation issuer. To call the API
// the device mints a short-lived, single-use JWT, and the SDK exchanges it at
// POST /v1/oauth/token for a short-lived Anthropic access token.
//
// No dependencies; Node 18+.
//
//   identity.mjs keygen [--device NAME]    create the key if missing, print public JWKS keys
//   identity.mjs jwks   [--device NAME]    print the public JWKS keys array (paste into Console)
//   identity.mjs mint   [--device NAME] [--ttl SECONDS] [--out FILE]
//                                          print (or write) a fresh signed JWT
//
// Settings (flags win over env):
//   --device   GSA_DEVICE        default: mac-mini
//   --dir      GSA_IDENTITY_DIR  default: ~/.config/game-studio-arcade/identity
//   --issuer   GSA_ISSUER        default: https://game-studio-arcade.home.arpa
//   --audience GSA_AUDIENCE      default: https://api.anthropic.com
//   subject is always "device:<device>"

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i > 0 && i + 1 < args.length ? args[i + 1] : undefined;
};

const device = flag("device") ?? process.env.GSA_DEVICE ?? "mac-mini";
const dir =
  flag("dir") ??
  process.env.GSA_IDENTITY_DIR ??
  path.join(os.homedir(), ".config", "game-studio-arcade", "identity");
const issuer = flag("issuer") ?? process.env.GSA_ISSUER ?? "https://game-studio-arcade.home.arpa";
const audience = flag("audience") ?? process.env.GSA_AUDIENCE ?? "https://api.anthropic.com";
const keyFile = path.join(dir, `${device}.key.pem`);

if (!/^[a-z0-9-]+$/.test(device)) die(`device name must match ^[a-z0-9-]+$ (got "${device}")`);

function die(msg) {
  process.stderr.write(`identity: ${msg}\n`);
  process.exit(1);
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");

function loadKey() {
  if (!fs.existsSync(keyFile)) die(`no key at ${keyFile}; run: identity.mjs keygen --device ${device}`);
  const mode = fs.statSync(keyFile).mode & 0o777;
  if (mode & 0o077) die(`${keyFile} is readable by others (mode ${mode.toString(8)}); run: chmod 600 ${keyFile}`);
  return crypto.createPrivateKey(fs.readFileSync(keyFile));
}

function publicJwk(privateKey) {
  const { kty, crv, x, y } = crypto.createPublicKey(privateKey).export({ format: "jwk" });
  // RFC 7638 thumbprint as the key id: members in lexicographic order.
  const kid = b64url(
    crypto.createHash("sha256").update(JSON.stringify({ crv, kty, x, y })).digest(),
  );
  return { kty, crv, x, y, kid, use: "sig", alg: "ES256" };
}

function keygen() {
  if (fs.existsSync(keyFile)) {
    process.stderr.write(`identity: key already exists at ${keyFile}; keeping it\n`);
  } else {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    fs.writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
    process.stderr.write(`identity: created ${keyFile}\n`);
  }
  jwks();
}

function jwks() {
  process.stdout.write(JSON.stringify([publicJwk(loadKey())], null, 2) + "\n");
}

function mint() {
  const ttl = Number(flag("ttl") ?? 300);
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 3600) die("--ttl must be an integer from 60 to 3600");
  const key = loadKey();
  const { kid } = publicJwk(key);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", typ: "JWT", kid };
  const claims = {
    iss: issuer,
    sub: `device:${device}`,
    aud: audience,
    iat: now,
    nbf: now,
    exp: now + ttl,
    jti: crypto.randomUUID(), // single use: mint a fresh token for every exchange
  };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const sig = crypto.sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
  const jwt = `${input}.${b64url(sig)}`;

  const out = flag("out");
  if (out) {
    const tmp = `${out}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, jwt, { mode: 0o600 });
    fs.renameSync(tmp, out); // atomic, so a reader never sees half a token
  } else {
    process.stdout.write(jwt + "\n");
  }
}

switch (cmd) {
  case "keygen": keygen(); break;
  case "jwks": jwks(); break;
  case "mint": mint(); break;
  default:
    process.stderr.write("usage: identity.mjs keygen|jwks|mint [--device NAME] [--ttl S] [--out FILE]\n");
    process.exit(2);
}
