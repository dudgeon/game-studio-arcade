# Workload Identity Federation tooling (parked)

These scripts give each device its own signing key and set up WIF through the Admin API:

- `identity.mjs`: create a device key, print its public JWKS, mint single-use identity tokens. Tested.
- `provision.mjs`: create the issuer `game-studio-arcade-home`, the service account and rule `studio-<device>`, and the workspace membership, then test a live exchange and save the IDs to `.env`. It's idempotent.

**Not usable on Geoff's current account.** WIF and the Admin API aren't available to *Individual* Console accounts. On 2026-11-07 the service-account and issuer endpoints returned 404 and the workspace listing returned 403. `provision.mjs` stopped at the workspace lookup and created nothing. See D15 in `docs/decisions.md`.

To use them: convert the Console account to an organization (`platform.claude.com/settings/organization`), sign in with `ant auth login --profile admin --scope "org:admin"`, run `node scripts/wif/provision.mjs --device <name>`, then `ant auth logout --profile admin`.

Only `identity.mjs` has been tested end to end. `provision.mjs` has never completed a run.
