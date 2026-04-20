-- Phase — per-client tags get first-class shape. Phase H.2 added the
-- column as nullable (0015); batch-D makes it non-null so UI code can
-- skip the "null means no tags" branch everywhere. Existing rows with
-- NULL collapse to '{}' (empty array) before the NOT NULL constraint
-- applies. Rows with existing tags array are untouched.
BEGIN;

UPDATE "client_contacts" SET "tags" = '{}' WHERE "tags" IS NULL;
ALTER TABLE "client_contacts" ALTER COLUMN "tags" SET DEFAULT '{}';
ALTER TABLE "client_contacts" ALTER COLUMN "tags" SET NOT NULL;

COMMIT;
