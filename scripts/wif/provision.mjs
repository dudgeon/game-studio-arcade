#!/usr/bin/env node
// Provision Workload Identity Federation for one device, through the Admin API.
//
// Needs an org:admin OAuth login:  ant auth login --profile admin --scope "org:admin"
// The admin token is read from `ant auth print-credentials` and never printed.
//
// Idempotent: finds resources by name and reuses them; creates only what's missing.
//   1. the device's identity key (identity.mjs keygen)
//   2. the workspace (must already exist; looked up by name)
//   3. issuer "game-studio-arcade-home" with the device's public key inline
//      (keys from other devices already on the issuer are kept)
//   4. service account "studio-<device>" (developer), member of the workspace
//   5. rule "studio-<device>": sub=device:<device>, aud=https://api.anthropic.com,
//      workspace:developer, 600 s tokens
//   6. a live token exchange, plus Models and Managed Agents checks
//   7. the IDs saved to the repo's .env (not secret)
//
// Usage: node scripts/wif/provision.mjs [--device mac-mini] [--workspace game-studio-arcade]

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };

const DEVICE = flag("device", process.env.GSA_DEVICE ?? "mac-mini");
const WORKSPACE_NAME = flag("workspace", "game-studio-arcade");
const ISSUER_NAME = "game-studio-arcade-home";
const ISSUER_URL = process.env.GSA_ISSUER ?? "https://game-studio-arcade.home.arpa";
const AUDIENCE = process.env.GSA_AUDIENCE ?? "https://api.anthropic.com";
const NAME = `studio-${DEVICE}`;
const ENV_FILE = process.env.ENV_FILE ?? path.join(repo, ".env");
const API = "https://api.anthropic.com";
const VERSION = "2026-10-21";
const BETA = "managed-agents-2026-04-01";

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const info = (m) => console.log(`  · ${m}`);
const fail = (m) => { console.error(`  \x1b[31m✗\x1b[0m ${m}`); process.exit(1); };

const identity = (...a) =>
  execFileSync(process.execPath, [path.join(here, "identity.mjs"), ...a, "--device", DEVICE], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();

let ADMIN;
try {
  ADMIN = execFileSync("ant", ["auth", "print-credentials", "--profile", "admin", "--access-token"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
} catch {
  fail('No admin login. Run: ant auth login --profile admin --scope "org:admin"');
}
if (!ADMIN) fail("Admin login returned no token.");

async function call(method, p, body, token = ADMIN, extra = {}) {
  const res = await fetch(API + p, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "anthropic-version": VERSION,
      ...(body ? { "content-type": "application/json" } : {}),
      ...extra,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json, headers: res.headers };
}
async function must(method, p, body) {
  const r = await call(method, p, body);
  if (r.status >= 300) fail(`${method} ${p} → ${r.status}: ${r.json?.error?.message ?? JSON.stringify(r.json).slice(0, 300)}`);
  return r.json;
}
async function listAll(p) {
  const out = []; let page;
  do {
    const sep = p.includes("?") ? "&" : "?";
    const r = await must("GET", `${p}${sep}limit=100${page ? `&page=${encodeURIComponent(page)}` : ""}`);
    out.push(...(r.data ?? [])); page = r.next_page;
  } while (page);
  return out;
}

console.log(`\nProvisioning Workload Identity Federation for "${DEVICE}"\n`);

// 1. identity key
const jwks = JSON.parse(identity("keygen"));
const myKey = jwks[0];
ok(`Identity key ready (kid ${myKey.kid.slice(0, 10)}…)`);

// 2. organization + workspace
let ORG_ID = null;
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(process.env.ANTHROPIC_CONFIG_DIR ?? path.join(process.env.HOME, ".config/anthropic"), "configs/admin.json"), "utf8"));
  ORG_ID = cfg.organization_id ?? null;
} catch {}
if (!ORG_ID) {
  const me = await call("GET", "/v1/organizations/me");
  if (me.status < 300) ORG_ID = me.json.id ?? null;
}
const workspaces = await listAll("/v1/organizations/workspaces");
const ws = workspaces.find((w) => w.name === WORKSPACE_NAME && !w.archived_at);
if (!ws) fail(`Workspace "${WORKSPACE_NAME}" not found. Found: ${workspaces.map((w) => w.name).join(", ") || "none"}`);
ok(`Workspace ${WORKSPACE_NAME} (${ws.id})`);
if (!ORG_ID) {
  const r = await call("GET", `/v1/organizations/workspaces/${ws.id}`);
  ORG_ID = r.headers.get("anthropic-organization-id") ?? r.json.organization_id ?? null;
}
if (!ORG_ID) fail("Couldn't determine the organization ID.");
ok(`Organization ${ORG_ID}`);

// 3. issuer
let issuer = (await listAll("/v1/organizations/federation_issuers")).find((i) => i.name === ISSUER_NAME);
if (!issuer) {
  issuer = await must("POST", "/v1/organizations/federation_issuers", {
    name: ISSUER_NAME, issuer_url: ISSUER_URL, jwks: { type: "inline", keys: [myKey] }, check_jti: true,
  });
  ok(`Created issuer ${ISSUER_NAME} (${issuer.id})`);
} else {
  if (issuer.issuer_url !== ISSUER_URL) fail(`Issuer ${ISSUER_NAME} has issuer_url ${issuer.issuer_url}, expected ${ISSUER_URL}`);
  const keys = issuer.jwks?.type === "inline" ? issuer.jwks.keys : [];
  if (keys.some((k) => k.kid === myKey.kid)) {
    ok(`Issuer ${ISSUER_NAME} (${issuer.id}) already has this device's key`);
  } else {
    issuer = await must("POST", `/v1/organizations/federation_issuers/${issuer.id}`, {
      jwks: { type: "inline", keys: [...keys, myKey] },
    });
    ok(`Added this device's key to issuer ${ISSUER_NAME} (${issuer.id})`);
  }
}

// 4. service account + workspace membership
let sa = (await listAll("/v1/organizations/service_accounts")).find((s) => s.name === NAME);
if (!sa) {
  sa = await must("POST", "/v1/organizations/service_accounts", {
    name: NAME, organization_role: "developer",
    description: `game-studio-arcade: API identity for device "${DEVICE}"`,
  });
  ok(`Created service account ${NAME} (${sa.id})`);
} else ok(`Service account ${NAME} (${sa.id}) exists`);
const members = await listAll(`/v1/organizations/service_accounts/${sa.id}/workspaces`);
if (members.some((m) => m.workspace_id === ws.id && !m.implicit)) ok(`${NAME} is a member of ${WORKSPACE_NAME}`);
else {
  await must("POST", `/v1/organizations/service_accounts/${sa.id}/workspaces`, {
    workspace_id: ws.id, workspace_role: "workspace_developer",
  });
  ok(`Added ${NAME} to ${WORKSPACE_NAME} as workspace_developer`);
}

// 5. rule
let rule = (await listAll(`/v1/organizations/federation_rules?issuer_id=${issuer.id}`)).find((r) => r.name === NAME);
if (!rule) {
  rule = await must("POST", "/v1/organizations/federation_rules", {
    name: NAME,
    issuer_id: issuer.id,
    match: { subject_prefix: `device:${DEVICE}`, audience: AUDIENCE },
    target: { type: "service_account", service_account_id: sa.id },
    workspace_id: ws.id,
    oauth_scope: "workspace:developer",
    token_lifetime_seconds: 600,
  });
  ok(`Created rule ${NAME} (${rule.id})`);
} else ok(`Rule ${NAME} (${rule.id}) exists`);

// 6. live test, as the device (not as admin)
console.log("\nTesting a real token exchange as the device…");
const exchange = await fetch(`${API}/v1/oauth/token`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: identity("mint"),
    federation_rule_id: rule.id,
    organization_id: ORG_ID,
    service_account_id: sa.id,
    workspace_id: ws.id,
  }),
});
const ex = await exchange.json().catch(() => ({}));
let passed = false;
if (exchange.status === 200 && ex.access_token) {
  ok(`Exchange worked: ${ex.scope}, expires in ${ex.expires_in}s`);
  const m = await call("GET", "/v1/models?limit=1", null, ex.access_token);
  if (m.status === 200) { ok("Models API accepts the device token"); passed = true; }
  else info(`Models API → ${m.status}: ${m.json?.error?.message}`);
  const a = await call("GET", "/v1/agents?limit=1", null, ex.access_token, { "anthropic-beta": BETA });
  if (a.status === 200) ok("Managed Agents is available");
  else info(`Managed Agents → ${a.status}: ${a.json?.error?.message}`);
} else {
  info(`Exchange → ${exchange.status}: ${ex?.error?.message ?? "no message"}`);
  info("Reason: https://platform.claude.com/settings/workload-identity-federation?tab=history");
}

// 7. save IDs
const keep = fs.existsSync(ENV_FILE)
  ? fs.readFileSync(ENV_FILE, "utf8").split("\n").filter((l) =>
      l && !/^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_ORGANIZATION_ID|ANTHROPIC_WORKSPACE_ID|ANTHROPIC_SERVICE_ACCOUNT_ID|ANTHROPIC_FEDERATION_RULE_ID|GSA_DEVICE|GSA_ISSUER|GSA_AUDIENCE)=/.test(l) &&
      !l.startsWith("# Workload Identity Federation"))
  : [];
const lines = [
  ...keep,
  "# Workload Identity Federation (written by scripts/wif/provision.mjs). Not secret.",
  `ANTHROPIC_ORGANIZATION_ID=${ORG_ID}`,
  `ANTHROPIC_WORKSPACE_ID=${ws.id}`,
  `ANTHROPIC_SERVICE_ACCOUNT_ID=${sa.id}`,
  `ANTHROPIC_FEDERATION_RULE_ID=${rule.id}`,
  `GSA_DEVICE=${DEVICE}`,
  `GSA_ISSUER=${ISSUER_URL}`,
  `GSA_AUDIENCE=${AUDIENCE}`,
];
fs.writeFileSync(ENV_FILE, lines.join("\n") + "\n", { mode: 0o600 });
fs.chmodSync(ENV_FILE, 0o600);
ok(`Saved IDs to ${path.relative(process.cwd(), ENV_FILE) || ENV_FILE}`);

console.log(passed ? "\nDone: this device can call the Claude API with federation.\n" : "\nResources are in place, but the live test didn't pass (see above).\n");
process.exit(passed ? 0 : 1);
