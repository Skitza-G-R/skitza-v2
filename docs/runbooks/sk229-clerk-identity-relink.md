# SK-229 Clerk identity relink runbook

This runbook moves the six existing Skitza principals from the Development
Clerk instance to Production without changing any application-owned identity,
role, ownership, Google Calendar connection, closure, or audit row.

Do not run a mutating step without Gili's approval for that exact run. Do not
commit the private manifest, real Clerk IDs, email addresses, email hashes,
secret keys, command output, or evidence bundle.

## Locked inventory

The private manifest must contain exactly six explicit old/new pairs:

- two Producer-only principals, each with zero Artist links;
- four Artist-only principals, with active and historical `client_contacts`
  row counts `1, 1, 2, 1` in any order;
- no dual-role principal;
- no terminal `registered_accounts.provider_state = 'deleted'` row;
- none of the six target provider IDs already appears in a Producer,
  `client_contacts`, or `registered_accounts` identity row.

The tool inventories `producers` and `client_contacts` directly. It does not
depend on `registered_accounts`, because the confirmed six production
principals have no matching registered-account rows at rehearsal time.

## Private manifest

Create a mode-0600 file outside the repository and backups. Use a fresh UUIDv4
or UUIDv7 batch ID. Every email value is a SHA-256 hash prefixed by `sha256:`;
plain email addresses are rejected. Do not derive a pair by searching Clerk for
an email. Copy each exact old and new user ID from the two provider records and
independently confirm that the same verified-email hash exists on both.

```json
{
  "version": 1,
  "batchId": "00000000-0000-4000-8000-000000000000",
  "sourceClerkInstanceId": "ins_source_placeholder",
  "targetClerkInstanceId": "ins_target_placeholder",
  "producerInvitationCutoff": "2026-01-01T00:00:00.000Z",
  "evidenceRef": "case:SK-229/relink-placeholder",
  "principals": [
    {
      "canonicalClerkUserId": "user_old_placeholder_1",
      "targetProviderClerkUserId": "user_new_placeholder_1",
      "verifiedEmailHash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      "expectedRoles": ["producer"],
      "expectedArtistLinkCount": 0
    }
  ]
}
```

Add the other five entries using the locked inventory above. The invitation
cutoff must be an exact canonical UTC instant and must exactly equal the web
deployment's `PRODUCER_INVITATION_CUTOFF`. Existing Producers are preserved by
their role row; the relink must never manufacture an invitation grant.

## Rehearsal

1. Confirm the target database is current Neon project `skitza-v3`
   (`raspy-pine-96654399`). Never use `quiet-sun-92221754`.
2. With explicit approval for the target, apply migration `0051` through
   `$skitza-migrate`. Do not use Drizzle's migration command.
3. Configure only the task-specific variables in a private shell:
   `SK229_RELINK_DATABASE_URL`, `SK229_RELINK_MANIFEST_PATH`,
   `SK229_RELINK_TARGET_CLASS` (`test` or `live`),
   `SK229_RELINK_SOURCE_CLERK_SECRET_KEY`,
   `SK229_RELINK_TARGET_CLERK_SECRET_KEY`, and
   `PRODUCER_INVITATION_CUTOFF`. Do not set `SK229_RELINK_APPROVAL` yet.
   For the canonical live target only, also set
   `SK229_RELINK_LIVE_CONFIRMATION=approved-live-clerk-identity-relink-sk229`.
   Generic database variables such as `DATABASE_URL` must be unset.
4. Run `pnpm --filter web sk229:clerk-relink rehearse`.

Before any manifest, Clerk, or mutation work, the tool verifies the database
through the same pinned Neon endpoint and provider-owned SK104 fingerprint used
by account closure; it explicitly rejects the frozen project. Rehearsal then
reads the two exact instances, fetches only the twelve exact user IDs
from the manifest, proves the verified-email hash on both sides, checks the
locked role/link inventory and terminal tombstones, and reports only the batch
ID, manifest digest, counts, and status. It performs no database write.

Stop if the result is not `rehearsed`, if the principal count is not six, or if
an existing plan has anything other than the exact six active source-native
bindings and six same-digest target relinks.

## Stage and activate

1. Copy the exact digest printed by the successful rehearsal.
2. Get approval for the exact stage operation. Set:

   `SK229_RELINK_APPROVAL=stage:<batch-id>:<manifest-digest>`

3. Run `pnpm --filter web sk229:clerk-relink stage`. This transaction reruns
   provider and inventory proof, creates any missing source-native bindings as
   active self-maps, and inserts exactly six target relink bindings as
   `staged`. Existing exact active source-native bindings from an earlier
   rejected batch are reused. Source accounts remain usable throughout.
4. If any evidence is wrong, get approval for the exact rejection, set
   `SK229_RELINK_APPROVAL=reject-stage:<batch-id>:<manifest-digest>`, and run
   `pnpm --filter web sk229:clerk-relink reject-stage`. Rejected evidence is
   retained; a corrected manifest must use a new batch ID. Rejection validates
   the exact immutable stored plan and approval but deliberately does not
   require the now-bad or unavailable provider evidence. It revokes only the
   six target relinks; all six source-native bindings remain active.
5. For a correct staged batch, get separate activation approval and set:

   `SK229_RELINK_APPROVAL=activate:<batch-id>:<manifest-digest>`

6. Run `pnpm --filter web sk229:clerk-relink activate`. One advisory-locked
   database transaction verifies the exact plan, keeps all six source-native
   rows active, and changes exactly the six staged target relinks to active. A
   partial activation is an error and rolls back.
7. Run `pnpm --filter web sk229:clerk-relink inspect` and require twelve active
   bindings with the same digest.

Do not revoke the six native source bindings. Keeping source and target active
in separate instances is what makes a Clerk-key rollback safe.

## Deployment cutover

1. Drain Producer writes and active uploads for at least ten minutes. Confirm
   no invitation grant, account closure, admin reconciliation, or Calendar
   connection operation is running.
2. Deploy the canonical-auth code while the web app still uses the source Clerk
   keys and source webhook. Verify all six accounts resolve through their active
   native bindings and retain the exact role/link inventory.
3. With Gili's separate approval for that deployment, change the web Clerk
   publishable key, secret key, `CLERK_INSTANCE_ID`, and webhook secret/endpoint
   together to the target instance. Keep the exact invitation cutoff unchanged.
4. Sign in as each of the six exact target users. Verify the two Producers keep
   dashboards and Calendar connections; verify the four Artists see their
   expected `1, 1, 2, 1` studio links; verify no duplicate profile or account
   appears; verify each browser starts with fresh provider-keyed local state.
5. Run an admin reconciliation dry page and one exact Producer-invitation
   eligibility check. Both must resolve provider IDs back to canonical IDs.
6. Keep the source keys and webhook configuration available for rollback until
   the observation window is explicitly closed. Never delete source accounts
   during this window.

## Close the rollback window

After the target instance has passed the full observation window and Gili has
explicitly closed rollback:

1. Remove or rotate the exact source Clerk Secret Key at Clerk and verify that
   it can no longer call the source instance's Backend API.
2. Do not change `SKITZA_CAPABILITY_SECRET`. Its bytes intentionally remain as
   the application-owned signing secret, but must no longer be an active Clerk
   credential.
3. If the Development instance still needs Backend API access, create and use a
   different Clerk key. Never reuse the application capability secret as a
   provider credential.
4. Record only a short restricted evidence reference; never record either key.

## Rollback

If target sign-in or identity resolution fails, restore the source Clerk
publishable key, secret key, `CLERK_INSTANCE_ID`, and webhook secret/endpoint as
one deployment. The six source native bindings remain active, so no database or
historical ID rewrite is needed. Do not reverse migration `0051`, delete
bindings, rewrite role rows, or restore a database backup for an identity-only
rollback.

After rollback, inspect the same batch, record evidence outside the repository,
and diagnose before another cutover. A staged mistake is rejected through the
tool; an active target binding stays immutable and can be revoked only by a
separately approved operator workflow after the rollback window.
