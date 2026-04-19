-- Artist app — bridge `client_contacts` rows to a global Clerk user
-- identity. When an artist signs in for the first time, the Clerk
-- `user.created` webhook stamps their Clerk user id onto every
-- existing client_contacts row matching their email_hash. After
-- that, "all studios for this artist" is a single SELECT against
-- (clerk_user_id) — no email-hash join needed.
--
-- Nullable so existing rows (and every magic-link upsert path that
-- runs before the artist signs in) keep working unchanged.
--
-- Partial index: only the rows we actually query by clerk_user_id
-- get indexed, keeping the index small until artist sign-ups ramp.
BEGIN;

ALTER TABLE "client_contacts"
  ADD COLUMN IF NOT EXISTS "clerk_user_id" text;

CREATE INDEX IF NOT EXISTS "client_contacts_clerk_user_idx"
  ON "client_contacts" ("clerk_user_id")
  WHERE "clerk_user_id" IS NOT NULL;

COMMIT;
