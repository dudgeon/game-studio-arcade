// npm run check: prove this machine's Claude API sign-in works from Node.
import { checkAuth, AuthSetupError } from "./index.js";

try {
  const r = await checkAuth();
  console.log(`✓ Claude API reachable with profile "${r.profile}" (first model: ${r.firstModel})`);
} catch (err) {
  console.error(err instanceof AuthSetupError ? `✗ ${err.message}` : err);
  process.exit(1);
}
