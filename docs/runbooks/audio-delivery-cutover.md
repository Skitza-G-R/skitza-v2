# SK-40 protected audio cutover

SK-40 is not safe as an ordinary rolling deployment. The repository runner may
need to apply Chat 12 migration `0032_purchase_session_allowance.sql` before
SK-40 migration `0033_purchase_version_download_overrides.sql`. Migration
`0032` changes the required booking write protocol, while `0033` makes stored
audio URLs app-owned and the old app still writes permanent R2 URLs. The
combined app, every pending migration, and the storage privacy change must
therefore be completed in one approved maintenance window before traffic
resumes.

## Required approvals

- Gili must approve the exact database target and the ordered set of pending
  migrations for the run.
- Gili must approve the exact deployment and production storage/config change.
- Never use `drizzle-kit migrate` or `pnpm -F db db:migrate`. Use the repository
  migration runner described by `skitza-migrate`.

## Cutover order

1. Put the app into maintenance mode and drain all old app instances. Confirm
   that no upload, payment, correction, override, playback, deletion, purchase
   acceptance, booking/session, availability/timezone, or project-lifecycle
   write can still reach the old code.
2. Deploy the combined app version while traffic remains drained. Do not reopen
   it or exercise its preview against shared storage or external services.
3. On the explicitly approved target, confirm whether migration `0032` is
   recorded with the repository's matching digest and which migrations are
   pending. The observed ordered pending set must exactly match Gili's approval.
   If it differs or any recorded digest mismatches, keep traffic drained, stop,
   and obtain fresh approval. Do not manually mark, skip, renumber, or partially
   apply either migration.
4. From `packages/db/`, run `node apply-migrations.mjs` with the approved
   environment. If both are pending, the runner must apply and verify `0032`
   before `0033`; each file commits in its own transaction. Their `NOWAIT`
   locks and data audits must fail closed. If either migration fails, keep all
   traffic drained. Any production data repair or configuration change requires
   Gili's separate approval for that exact action before rerunning the repository
   runner. If `0032` committed before `0033` failed, never reopen the old app or
   skip forward: remain drained until `0033` and all combined checks pass.
5. Make the audio bucket/origin private, disable the public R2 development URL
   or equivalent direct origin, and invalidate any cache that could still serve
   captured permanent audio URLs. Do not alter the private document bucket.
6. With traffic still drained, verify the combined booking/session lifecycle
   and producer timezone/availability paths, then one exact producer
   stream/download, one exact artist stream, paid and unpaid artist download
   decisions, an active early override, a public sample, Range seeking, and a
   deleted version.
7. Reopen traffic only after database, app, and storage checks all pass.

## Completion evidence

Record the approved target (without credentials or raw endpoint identifiers),
the preflight state and result for both `0032` and `0033`, deployed commit,
storage privacy confirmation, cache purge, and combined smoke-test results on
SK-40. Previously copied R2 URLs must fail before the cutover is considered
complete.
