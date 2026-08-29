-- SK-270: let an imported purchase carry the REAL first payment due date.
--
-- The "Bring active work" wizard now asks one optional question — "When is
-- the first payment due?" — defaulting to the import day. Two bugs die with
-- it: an imported client stops looking Overdue the day after the import, and
-- a Monthly imported plan can finally date installments 2..N (they used to
-- wait forever for a first confirmed payment that may never arrive).
--
-- validate_purchase_installment_schedule() used to demand, for position 1 of
-- an 'imported_existing_work' purchase, that BOTH due_at AND triggered_at
-- equal commercial_established_at. That made a real due date impossible to
-- store. This migration replaces the function with the identical body except
-- for that one rule:
--
--   * triggered_at MUST still equal commercial_established_at. It is the
--     provenance anchor — the instant the producer attested the work — and
--     nothing about it changes.
--   * due_at only has to be present. It is now either commercial_established_at
--     (what the app writes when the producer skips the question) or the date
--     the producer actually captured. The captured date is deliberately not
--     duplicated into any other column, so "not null" is the strongest honest
--     rule SQL can enforce here; the application decides which date to write.
--
-- Safe on existing data: every row written under the old rule has
-- due_at = commercial_established_at, which is not null, so it still passes.
-- Nothing is added or removed — no column, no enum value, no table, no
-- trigger — only this function body changes, so no row is rewritten and no
-- backfill is needed.
--
-- The constraint triggers that call this function (on purchases,
-- purchase_installments, purchase_acceptances and purchase_import_attestations)
-- keep pointing at the same function name and are left untouched.

CREATE OR REPLACE FUNCTION "validate_purchase_installment_schedule"()
RETURNS trigger AS $function$
DECLARE
  target_purchase_id uuid;
  purchase_total_cents integer;
  purchase_plan_kind text;
  purchase_source_kind text;
  purchase_snapshot jsonb;
  purchase_established_at timestamp with time zone;
  purchase_accepted_at timestamp with time zone;
  expected_installment_count integer;
  base_installment_amount integer;
  installment_remainder integer;
  monthly_installments_text text;
  installment_count integer;
  installment_sum bigint;
  minimum_position integer;
  maximum_position integer;
  activation_installment_count integer;
  invalid_amount_count integer;
  invalid_trigger_count integer;
  invalid_first_anchor_count integer;
BEGIN
  IF TG_TABLE_NAME = 'purchases' THEN
    target_purchase_id := COALESCE(NEW."id", OLD."id");
  ELSIF TG_OP = 'DELETE' THEN
    target_purchase_id := OLD."purchase_id";
  ELSE
    target_purchase_id := NEW."purchase_id";
  END IF;

  SELECT
    "total_cents",
    "payment_plan_kind"::text,
    "source_kind"::text,
    "commercial_snapshot",
    "commercial_established_at",
    "accepted_at"
  INTO
    purchase_total_cents,
    purchase_plan_kind,
    purchase_source_kind,
    purchase_snapshot,
    purchase_established_at,
    purchase_accepted_at
  FROM "purchases"
  WHERE "id" = target_purchase_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF purchase_total_cents = 0 THEN
    expected_installment_count := 0;
  ELSIF purchase_plan_kind = 'full' THEN
    expected_installment_count := 1;
  ELSIF purchase_plan_kind = 'split_50_50' THEN
    expected_installment_count := 2;
  ELSIF purchase_plan_kind = 'monthly' THEN
    monthly_installments_text :=
      purchase_snapshot->'selectedPaymentPlan'->>'installments';
    IF monthly_installments_text IS NULL
      OR monthly_installments_text !~ '^[0-9]+$'
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'SKITZA_PURCHASE_INSTALLMENT_SCHEDULE_INVALID';
    END IF;
    expected_installment_count := monthly_installments_text::integer;
    IF expected_installment_count < 2 OR expected_installment_count > 12 THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'SKITZA_PURCHASE_INSTALLMENT_SCHEDULE_INVALID';
    END IF;
  ELSE
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'SKITZA_PURCHASE_INSTALLMENT_SCHEDULE_INVALID';
  END IF;

  IF expected_installment_count > 0 THEN
    base_installment_amount := purchase_total_cents / expected_installment_count;
    installment_remainder :=
      purchase_total_cents - (base_installment_amount * expected_installment_count);
  END IF;

  SELECT
    count(*)::integer,
    COALESCE(sum("amount_cents"), 0)::bigint,
    min("position"),
    max("position"),
    count(*) FILTER (WHERE "required_for_activation")::integer,
    count(*) FILTER (
      WHERE "amount_cents" <>
        base_installment_amount
        + CASE WHEN "position" = 1 THEN installment_remainder ELSE 0 END
    )::integer,
    count(*) FILTER (
      WHERE
        (
          "position" = 1
          AND (
            NOT "required_for_activation"
            OR (
              purchase_source_kind = 'imported_existing_work'
              AND "due_trigger"::text <> 'producer_import'
            )
            OR (
              purchase_source_kind <> 'imported_existing_work'
              AND "due_trigger"::text <> 'acceptance'
            )
          )
        )
        OR (
          "position" > 1
          AND (
            "required_for_activation"
            OR (
              purchase_plan_kind = 'split_50_50'
              AND "due_trigger"::text <> 'artist_approval'
            )
            OR (
              purchase_plan_kind = 'monthly'
              AND "due_trigger"::text <> 'monthly_anniversary'
            )
          )
        )
    )::integer,
    count(*) FILTER (
      WHERE "position" = 1
        AND (
          (
            purchase_source_kind = 'imported_existing_work'
            AND (
              -- SK-270: due_at is the producer's real first payment date. It
              -- defaults to commercial_established_at and may be any captured
              -- date, but it must exist. triggered_at stays the exact
              -- provenance anchor.
              "due_at" IS NULL
              OR "triggered_at" IS DISTINCT FROM purchase_established_at
            )
          )
          OR (
            purchase_source_kind <> 'imported_existing_work'
            AND (
              "due_at" IS DISTINCT FROM purchase_accepted_at
              OR "triggered_at" IS DISTINCT FROM purchase_accepted_at
            )
          )
        )
    )::integer
  INTO
    installment_count,
    installment_sum,
    minimum_position,
    maximum_position,
    activation_installment_count,
    invalid_amount_count,
    invalid_trigger_count,
    invalid_first_anchor_count
  FROM "purchase_installments"
  WHERE "purchase_id" = target_purchase_id;

  IF (
    purchase_total_cents = 0
    AND installment_count <> 0
  ) OR (
    purchase_total_cents > 0
    AND (
      installment_count <> expected_installment_count
      OR installment_sum <> purchase_total_cents::bigint
      OR minimum_position <> 1
      OR maximum_position <> expected_installment_count
      OR activation_installment_count <> 1
      OR invalid_amount_count <> 0
      OR invalid_trigger_count <> 0
      OR invalid_first_anchor_count <> 0
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'SKITZA_PURCHASE_INSTALLMENT_SCHEDULE_INVALID';
  END IF;

  RETURN NULL;
END;
$function$ LANGUAGE plpgsql;
