# SK-102 isolated browser fixtures

This directory owns the disposable database and R2 fixture lifecycle used by the authenticated browser suite. It never creates provider resources or deploys the application. Provisioning the exact isolated Neon branch, Clerk development instance/users, and dedicated R2 buckets remains approval-gated. Browser execution is local-only; Clerk webhook reachability is a separate approval and product decision, with no deployment authorized by SK-102.

## Safety boundary

Both commands first require `approvedSk102Runtime()` to approve the complete environment. That gate rejects production deployment state, protected database endpoint/target fingerprints, protected or shared R2 buckets, live payment credentials, non-development Clerk credentials, non-local application origins, and recipients outside the private `example.com` capture domain. The database must then match the exact 33-table application inventory, migrations `0027` through `0034`, and required trigger markers.

Cleanup uses an exclusive workflow advisory lock, aborts all incomplete multipart uploads, empties both dedicated buckets (including captured email), truncates the exact application-table allowlist without `CASCADE`, and preserves the migration ledger. It never calls Drizzle migration commands.

## Configuration

Configure the approved runtime variables documented in `docs/runbooks/sk102-isolated-browser-environment.md`, plus these stable test-user values:

- `SKITZA_E2E_PRODUCER_EMAIL` and `SKITZA_E2E_ARTIST_EMAIL`: distinct Clerk development test addresses using the exact `+clerk_test` suffix before the approved capture domain.
- `SKITZA_E2E_PRODUCER_CLERK_USER_ID` and `SKITZA_E2E_ARTIST_CLERK_USER_ID`: the matching distinct Clerk development user IDs.

Provider identifiers, credentials, database URLs, object keys, email addresses, and Clerk IDs must never be passed on the command line or included in screenshots/reports. They are read only from the approved environment and omitted from command output and the generated manifest.

Local commands load the fixed `.skitza/sk102-browser.env` file. It must be a
regular, non-symlink file with mode exactly `0600`, containing only literal
unquoted `NAME=value` lines from the documented allowlist. The CORS mutation
confirmation is intentionally not allowed in this persistent file.

## Seed and cleanup

From the repository root:

```sh
corepack pnpm e2e:seed -- --slot desktop --manifest .skitza/e2e/desktop.json
corepack pnpm e2e:cleanup -- --slot desktop --manifest .skitza/e2e/desktop.json
```

Valid logical slots are `desktop`, `phone390`, and `phone360`. The browser runner executes them sequentially because the approved deployment uses one disposable database and one pair of dedicated buckets.

The external target is exclusive across machines. The browser wrapper holds a
database advisory lease across seed, browser work, and cleanup; standalone
seed/cleanup commands acquire the same lease and fail if a browser run owns it.
Confirm no protected CI job or local operator is using it before starting.

Seed always performs a full cleanup first, creates deterministic semantic fixtures, verifies lifecycle coverage, and writes a sanitized mode-0600 manifest plus tiny local WAV/PNG upload files under ignored `.skitza/e2e/`. If seed fails after mutation begins, it attempts the same full cleanup and returns only a generic failure code.

The fixtures include two studios connected to the same artist, an uninvited client, reorderable products/clients/projects, all project/purchase/request/private-offer/proof/booking states, due/upcoming/history payment buckets, proof confirmation/rejection/replacement cases, a final 50/50 audio version for artist approval, and a paid session allowance.

## Repeatability and rollback

Rerunning seed is replacement, not append: the command empties the approved disposable targets before creating the selected slot. Normal rollback is the cleanup command. If cleanup reports failure, stop browser verification, preserve the generic failure result, and inspect the isolated targets through the provider consoles without copying credentials, raw identifiers, object keys, or customer data into logs. Do not fall back to a production or frozen database/bucket.

No live provider execution is part of repository verification. The first real seed/cleanup run happens only after Gili approves the exact external targets and actions in the SK-102 runbook.
