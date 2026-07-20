# SK-40 protected audio cutover

SK-40 is not safe as an ordinary rolling deployment. Migration `0033` makes
stored audio URLs app-owned, while the old app still writes permanent R2 URLs.
The app, migration, and storage privacy change must therefore be completed in
one approved maintenance window before traffic resumes.

## Required approvals

- Gili must approve the exact database target and migration run.
- Gili must approve the exact deployment and production storage/config change.
- Never use `drizzle-kit migrate` or `pnpm -F db db:migrate`. Use the repository
  migration runner described by `skitza-migrate`.

## Cutover order

1. Put the app into maintenance mode and drain all old app instances. Confirm
   that no upload, payment, correction, override, playback, or deletion request
   can still reach the old code.
2. Deploy the SK-40 app version while traffic remains drained. Do not reopen it.
3. Run migration `0033_purchase_version_download_overrides.sql` against the
   explicitly approved target. Its `NOWAIT` table locks must fail the whole
   transaction if traffic was not fully drained; fix the drain and retry the
   complete migration rather than applying any statement manually.
4. Make the audio bucket/origin private, disable the public R2 development URL
   or equivalent direct origin, and invalidate any cache that could still serve
   captured permanent audio URLs. Do not alter the private document bucket.
5. With traffic still drained, verify one exact producer stream/download, one
   exact artist stream, paid and unpaid artist download decisions, an active
   early override, a public sample, Range seeking, and a deleted version.
6. Reopen traffic only after database, app, and storage checks all pass.

## Completion evidence

Record the approved target (without credentials or raw endpoint identifiers),
migration result, deployed commit, storage privacy confirmation, cache purge,
and smoke-test results on SK-40. Previously copied R2 URLs must fail before the
cutover is considered complete.
