// Claude API client for game-studio-arcade (D16).
//
// Authenticates through the ant CLI's browser-login profile, never through an
// API key in the environment. The profile is passed to the SDK explicitly,
// which outranks ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN, so a stray key in a
// shell can't silently switch accounts or workspaces.
//
//   import { createClient, checkAuth } from "@game-studio-arcade/auth";
//   const client = createClient();          // profile "game-studio-arcade"
//   await checkAuth(client);                // optional: fail fast with a clear message
//
// Set GSA_PROFILE to use another profile. A cabinet signs in differently, with
// its own key file: createCabinetClient() (D131, D185).

import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

export class CabinetAuthError extends Error {
  constructor(message) {
    super(`${message}. See D131 and cabinet/service/README.md.`);
    this.name = "CabinetAuthError";
  }
}

/** A config file group or others can touch isn't a safe home for a key (D131). */
const UNSAFE_MODE = 0o077;

/**
 * The cabinet's path (D131, D185): read the workspace-scoped key from the
 * cabinet service's config file and hand it to the SDK directly. Never for the
 * mini, which stays profile-only: createClient() still refuses a key. An
 * explicit key outranks ANTHROPIC_API_KEY, and authToken: null keeps a stray
 * token out of the request. No error here ever contains the key.
 * @param {{ configFile: string, sdkOptions?: object }} options
 */
export function createCabinetClient({ configFile, sdkOptions = {} }) {
  if (!configFile) throw new CabinetAuthError("no cabinet config file was given");
  let stat;
  try {
    stat = fs.statSync(configFile);
  } catch (err) {
    throw new CabinetAuthError(`can't read the cabinet config ${configFile}: ${err.code ?? "error"}`);
  }
  if (!stat.isFile()) throw new CabinetAuthError(`the cabinet config ${configFile} isn't a file`);
  if (stat.mode & UNSAFE_MODE) {
    throw new CabinetAuthError(`the cabinet config ${configFile} must be mode 0600, is ${(stat.mode & 0o777).toString(8).padStart(4, "0")}`);
  }
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  } catch {
    // Not err.message: JSON errors can quote the file's contents.
    throw new CabinetAuthError(`the cabinet config ${configFile} isn't valid JSON`);
  }
  const apiKey = config?.anthropic_api_key;
  if (typeof apiKey !== "string" || !apiKey.trim()) throw new CabinetAuthError(`the cabinet config ${configFile} has no anthropic_api_key`);
  for (const forbidden of ["apiKey", "authToken", "credentials", "config", "profile"]) {
    if (forbidden in sdkOptions) throw new CabinetAuthError(`createCabinetClient() does not accept "${forbidden}": the key comes from the config file`);
  }
  return new Anthropic({ ...sdkOptions, apiKey: apiKey.trim(), authToken: null });
}

export const DEFAULT_PROFILE = "game-studio-arcade";
export const SETUP_HINT = "Run scripts/setup-anthropic-auth.sh to sign in (ant auth login).";

export class AuthSetupError extends Error {
  constructor(message, options) {
    super(`${message}\n${SETUP_HINT}`, options);
    this.name = "AuthSetupError";
  }
}

/** The profile name this process will use. */
export function profileName(options = {}) {
  return options.profile ?? process.env.GSA_PROFILE ?? DEFAULT_PROFILE;
}

/**
 * Create an Anthropic client bound to the game-studio-arcade profile.
 * Extra options (timeout, maxRetries, logLevel…) pass through to the SDK.
 */
export function createClient(options = {}) {
  const { profile: _ignored, ...sdkOptions } = options;
  for (const forbidden of ["apiKey", "authToken", "credentials", "config"]) {
    if (forbidden in sdkOptions) {
      throw new AuthSetupError(`createClient() does not accept "${forbidden}": auth comes from the CLI profile.`);
    }
  }
  return new Anthropic({ ...sdkOptions, profile: profileName(options) });
}

/**
 * Make one cheap read (GET /v1/models) to prove the credentials work.
 * Throws AuthSetupError with a fix-it hint on auth failures.
 */
export async function checkAuth(client = createClient()) {
  try {
    const page = await client.models.list({ limit: 1 });
    return { ok: true, profile: profileName(), firstModel: page.data[0]?.id ?? null };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw new AuthSetupError(`Claude API rejected the "${profileName()}" profile (${err.status}).`, { cause: err });
    }
    if (err instanceof Anthropic.APIError) throw err; // 429/5xx etc.: not a setup problem
    // Missing profile, unreadable credentials, expired refresh token…
    throw new AuthSetupError(`Couldn't load credentials for profile "${profileName()}": ${err.message}`, { cause: err });
  }
}
