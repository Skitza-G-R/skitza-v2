-- SK-259: a producer can attach the existing agreement as a PDF while bringing
-- active work into Skitza. The exact frozen PDF metadata lives inside the
-- Purchase commercial snapshot; this nullable column keeps the private document
-- ledger (storage key, etag, sha256) beside the import attestation, the same
-- encoded shape Store products and private offers already use.
--
-- Additive only. Rows created before this migration stay NULL and keep working.

ALTER TABLE "purchase_import_attestations"
  ADD COLUMN "agreement_pdf_contract" text;
