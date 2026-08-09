# Private agreement PDF storage readiness

Abandoned private agreement uploads use the docs-bucket prefix
`agreement-pdf-staging/`. The production bucket must expire that exact prefix
after one day. Immutable accepted evidence uses `agreement-pdfs/` and must not
match any enabled current-object expiration rule.

From `apps/web`, with the exact target environment's `R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET_DOCS` loaded:

```sh
pnpm readiness:agreement-pdf-staging
pnpm ops:apply-agreement-pdf-staging-lifecycle
pnpm readiness:agreement-pdf-staging
```

The apply command preserves unrelated rules, refuses to run if an existing
expiration can match `agreement-pdfs/`, and reads the bucket again after its
PUT. It is an explicit operations step, not a CI mutation. Production promotion
is blocked until the apply command has run against the intended docs bucket and
the final read-only readiness command passes.
