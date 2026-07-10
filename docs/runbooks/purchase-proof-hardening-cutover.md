# Purchase proof hardening cutover

PR #193 must not be deployed directly over the invoice-backed proof flow.
The old version signs 15-minute browser uploads into the public audio bucket
before it creates a database row. Migration 0023 protects database rows, but
it cannot revoke an already-issued upload URL or discover an abandoned object.

## Required order

1. Deploy a small bridge change on the current production version that makes
   `artist.purchase.proofOfPayment.presign` return maintenance/unavailable
   before it signs a public audio-bucket PUT.
2. Wait at least 15 minutes after the bridge owns all traffic. This drains
   every public PUT URL issued by the previous version. Rotating the R2 API key
   used by the old deployment can invalidate those URLs immediately, but that
   is a production credential change and needs explicit approval.
3. With the deployment environment loaded, run:

   ```sh
   corepack pnpm --filter web audit:legacy-proof-objects
   ```

   The command prints aggregate counts only and exits `2` if any object exists
   under the legacy public path `producers/<producer>/proofs/`.

4. Re-run the read-only database inventory:

   ```sql
   SELECT count(*)
   FROM invoices
   WHERE purchase_request_id IS NOT NULL
     AND proof_file_url IS NOT NULL;
   ```

5. If either inventory is non-zero, stop. Copy each object to a unique private
   docs key with source-ETag protection, verify the destination, preserve/link
   its database record, then delete the public source only with explicit
   production-data approval. Re-run both inventories until they are zero.
6. Apply migration 0023. Its atomic preflight will also refuse any unexpected
   invoice-backed proof and will not delete or relabel it.
7. Deploy PR #193. New uploads use one private staging key, a conditional
   server-side copy to an unexposed final key, file-signature validation, and
   ETag verification before producer confirmation.
8. Smoke-test one disposable/non-customer purchase, then re-run the public R2
   inventory. The expected result is `legacyProofObjects: 0`.

## Rollback

Do not roll application code back to the public-upload version after migration 0023. If the new deployment must be removed, keep the bridge presign block in
place and roll back to a build that does not issue public proof uploads.
