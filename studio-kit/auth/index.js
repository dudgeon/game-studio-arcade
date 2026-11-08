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
// Set GSA_PROFILE to use another profile (the cabinet will need one, D16).

import Anthropic from "@anthropic-ai/sdk";

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
