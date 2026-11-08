// API client construction. Auth (D16): the SDK resolves the `ant` CLI login
// from the `game-studio-arcade` profile. The kickoff session owns the real
// credentials() helper (task 1); until it lands, this stub returns the profile.
//
// Never set ANTHROPIC_API_KEY: it silently overrides the profile.

export const PROFILE = "game-studio-arcade";

/**
 * Options passed to `new Anthropic(...)`.
 * @returns {Promise<Record<string, unknown>>}
 */
export async function credentials() {
  return { profile: process.env.GSA_ANTHROPIC_PROFILE || PROFILE };
}

/**
 * @param {{credentials?: () => Promise<Record<string, unknown>>, env?: NodeJS.ProcessEnv}} [opts]
 */
export async function createClient(opts = {}) {
  const env = opts.env ?? process.env;
  for (const v of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) {
    if (v in env) throw new Error(`${v} is set; unset it so the ${PROFILE} profile is used (D16)`);
  }
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  return new Anthropic(await (opts.credentials ?? credentials)());
}
