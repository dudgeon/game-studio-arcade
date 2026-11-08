// API client (D17): always from @game-studio-arcade/auth, which passes the
// `ant` login profile explicitly, so a stray ANTHROPIC_API_KEY is ignored.
// Loaded lazily so tests and offline commands never need the SDK.

/** @param {{profile?: string}} [opts] */
export async function createClient(opts = {}) {
  const auth = await import("@game-studio-arcade/auth");
  return auth.createClient(opts);
}
