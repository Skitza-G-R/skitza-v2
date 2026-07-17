-- SK-90: purchase-owned commercial history and post-reset project foundation.
--
-- This migration intentionally does not reset, backfill, or synthesize data.
-- The separately reviewed reset artifact must first empty every allowlisted
-- mock-commercial table. This statement locks and verifies that boundary,
-- rejects disallowed preserved catalog/card state, then replaces only those
-- already-empty tables. The whole schema transition is one atomic statement.
DO $migration$
DECLARE
  reset_table text;
  completed_target_tables CONSTANT text[] := ARRAY[
    'bookings',
    'notifications',
    'payment_proofs',
    'private_offers',
    'project_tracks',
    'projects',
    'purchase_acceptances',
    'purchase_cancellations',
    'purchase_download_override_events',
    'purchase_installments',
    'purchase_payment_corrections',
    'purchase_payments',
    'purchase_requests',
    'purchase_session_allowances',
    'purchase_waivers',
    'purchases',
    'song_public_links',
    'track_comments',
    'track_versions',
    'version_approval_events'
  ];
  reviewed_source_tables CONSTANT text[] := ARRAY[
    'agreement_acceptances',
    'bookings',
    'client_contacts',
    'invoices',
    'notifications',
    'payment_proofs',
    'producers',
    'products',
    'project_tracks',
    'projects',
    'purchase_requests',
    'store_purchase_intents',
    'stripe_customers',
    'track_comments',
    'track_versions'
  ];
  expected_constraint_inventory_md5 CONSTANT text := '9352daa8371782e6b631df6a8695e7ec';
  expected_constraint_structure_md5 CONSTANT text := 'eb03a328756137e134dcc6c356694d64';
  expected_index_inventory_md5 CONSTANT text := '7b2d0efab45b7054356672abdd7860c3';
  expected_trigger_inventory_md5 CONSTANT text := '677dce4214de0287faf26913cca2cb69';
  expected_function_inventory_md5 CONSTANT text := '2addb4c5aa54f215d1c7535a92404156';
BEGIN
  -- A completed application is a no-op, but a partial lookalike is a hard stop.
  IF to_regclass('public.purchases') IS NOT NULL THEN
    -- Parse the approved CHECK expressions with this target's PostgreSQL
    -- version. Comparing the deparsed definitions below rejects a same-named
    -- but weakened constraint without relying on version-sensitive literals.
    -- These empty, session-local tables disappear with this transaction.
    -- SKITZA_0027_EXPECTED_CHECK_CONTRACTS_BEGIN
    CREATE TEMP TABLE "skitza_0027_expected_purchase_requests"
      (LIKE "public"."purchase_requests") ON COMMIT DROP;
    ALTER TABLE "skitza_0027_expected_purchase_requests"
      ADD CONSTRAINT "purchase_requests_requested_song_qty_positive"
        CHECK ("requested_song_qty" IS NULL OR "requested_song_qty" > 0),
      ADD CONSTRAINT "purchase_requests_status_timestamp_shape" CHECK ((
        (
          "status" = 'pending'
          AND "approved_at" IS NULL
          AND "declined_at" IS NULL
          AND "canceled_at" IS NULL
          AND "converted_at" IS NULL
        )
        OR (
          "status" = 'approved'
          AND "approved_at" IS NOT NULL
          AND "declined_at" IS NULL
          AND "canceled_at" IS NULL
          AND "converted_at" IS NULL
        )
        OR (
          "status" = 'declined'
          AND "approved_at" IS NULL
          AND "declined_at" IS NOT NULL
          AND "canceled_at" IS NULL
          AND "converted_at" IS NULL
        )
        OR (
          "status" = 'canceled'
          AND "declined_at" IS NULL
          AND "canceled_at" IS NOT NULL
          AND "converted_at" IS NULL
        )
        OR (
          "status" = 'converted'
          AND "declined_at" IS NULL
          AND "canceled_at" IS NULL
          AND "converted_at" IS NOT NULL
        )
      ) IS TRUE);

    CREATE TEMP TABLE "skitza_0027_expected_purchases"
      (LIKE "public"."purchases") ON COMMIT DROP;
    ALTER TABLE "skitza_0027_expected_purchases"
      ADD CONSTRAINT "purchases_nonnegative_amounts"
        CHECK ("subtotal_cents" >= 0 AND "tax_cents" >= 0 AND "total_cents" >= 0),
      ADD CONSTRAINT "purchases_payment_plan_shape" CHECK (
        ("total_cents" = 0 AND "payment_plan_kind" IS NULL)
        OR ("total_cents" > 0 AND "payment_plan_kind" IS NOT NULL)
      ),
      ADD CONSTRAINT "purchases_zero_total_activation_shape" CHECK (
        (
          "total_cents" > 0
          OR (
            "lifecycle_status" IN ('active', 'canceled')
            AND "activated_at" = "accepted_at"
          )
        ) IS TRUE
      ),
      ADD CONSTRAINT "purchases_lifecycle_timestamp_shape" CHECK (
        (
          (
            "lifecycle_status" = 'waiting_for_payment'
            AND "activated_at" IS NULL
            AND "canceled_at" IS NULL
          )
          OR (
            "lifecycle_status" = 'active'
            AND "activated_at" >= "accepted_at"
            AND "canceled_at" IS NULL
          )
          OR (
            "lifecycle_status" = 'canceled'
            AND (
              (
                "activated_at" IS NULL
                AND "canceled_at" >= "accepted_at"
              )
              OR (
                "activated_at" >= "accepted_at"
                AND "canceled_at" >= "activated_at"
              )
            )
          )
        ) IS TRUE
      ),
      ADD CONSTRAINT "purchases_snapshot_scalar_consistency" CHECK ((
        ("commercial_snapshot"->>'version')::integer = "snapshot_version"
        AND ("commercial_snapshot"->>'subtotalCents')::integer = "subtotal_cents"
        AND ("commercial_snapshot"->'tax'->>'amountCents')::integer = "tax_cents"
        AND ("commercial_snapshot"->>'totalCents')::integer = "total_cents"
        AND "commercial_snapshot"->>'currency' = "currency"
        AND (
          (
            "total_cents" = 0
            AND jsonb_typeof("commercial_snapshot"->'selectedPaymentPlan') = 'null'
          )
          OR (
            "total_cents" > 0
            AND "commercial_snapshot"->'selectedPaymentPlan'->>'kind' =
              "payment_plan_kind"::text
          )
        )
      ) IS TRUE),
      ADD CONSTRAINT "purchases_agreement_text_shape" CHECK ((
        jsonb_typeof("commercial_snapshot"->'agreementText') = 'string'
        AND NULLIF(btrim("commercial_snapshot"->>'agreementText'), '') IS NOT NULL
      ) IS TRUE),
      ADD CONSTRAINT "purchases_tax_shape" CHECK ((
        ("commercial_snapshot"->'tax'->>'ratePct')::integer BETWEEN 0 AND 100
        AND (
          (
            "commercial_snapshot"->'tax'->>'mode' = 'tax_free'
            AND "tax_cents" = 0
            AND "total_cents" = "subtotal_cents"
          )
          OR (
            "commercial_snapshot"->'tax'->>'mode' = 'tax_included'
            AND "total_cents" = "subtotal_cents"
            AND "tax_cents" = round(
              "total_cents"::numeric
              * ("commercial_snapshot"->'tax'->>'ratePct')::integer
              / (100 + ("commercial_snapshot"->'tax'->>'ratePct')::integer)::numeric
            )::integer
          )
          OR (
            "commercial_snapshot"->'tax'->>'mode' = 'tax_added'
            AND "tax_cents" = round(
              "subtotal_cents"::numeric
              * ("commercial_snapshot"->'tax'->>'ratePct')::integer
              / 100::numeric
            )::integer
            AND "total_cents"::bigint = "subtotal_cents"::bigint + "tax_cents"::bigint
          )
        )
      ) IS TRUE),
      ADD CONSTRAINT "purchases_discount_shape" CHECK ((
        ("commercial_snapshot"->>'listSubtotalCents')::bigint >= 0
        AND ("commercial_snapshot"->>'discountCents')::bigint >= 0
        AND ("commercial_snapshot"->>'listSubtotalCents')::bigint =
          "subtotal_cents"::bigint
          + ("commercial_snapshot"->>'discountCents')::bigint
      ) IS TRUE),
      ADD CONSTRAINT "purchases_source_link_shape" CHECK ((
        (
          "source_kind" IN ('store_product', 'session_product')
          AND "product_id" IS NOT NULL
          AND "purchase_request_id" IS NOT NULL
          AND "private_offer_id" IS NULL
        )
        OR (
          "source_kind" = 'private_offer'
          AND "private_offer_id" IS NOT NULL
          AND "purchase_request_id" IS NULL
        )
        OR (
          "source_kind" IN ('paid_add_on', 'no_charge_add_on')
          AND (
            "product_id" IS NOT NULL
            OR "private_offer_id" IS NOT NULL
            OR "purchase_request_id" IS NOT NULL
          )
        )
      ) IS TRUE),
      ADD CONSTRAINT "purchases_source_amount_shape" CHECK ((
        (
          "source_kind" IN ('store_product', 'session_product', 'paid_add_on')
          AND "total_cents" > 0
        )
        OR ("source_kind" = 'no_charge_add_on' AND "total_cents" = 0)
        OR "source_kind" = 'private_offer'
      ) IS TRUE);

    CREATE TEMP TABLE "skitza_0027_expected_purchase_installments"
      (LIKE "public"."purchase_installments") ON COMMIT DROP;
    ALTER TABLE "skitza_0027_expected_purchase_installments"
      ADD CONSTRAINT "purchase_installments_positive_position" CHECK ("position" > 0),
      ADD CONSTRAINT "purchase_installments_positive_amount" CHECK ("amount_cents" > 0);

    CREATE TEMP TABLE "skitza_0027_expected_payment_proofs"
      (LIKE "public"."payment_proofs") ON COMMIT DROP;
    ALTER TABLE "skitza_0027_expected_payment_proofs"
      ADD CONSTRAINT "payment_proofs_positive_amount" CHECK ("amount_cents" > 0),
      ADD CONSTRAINT "payment_proofs_nonnegative_size" CHECK ("size_bytes" >= 0),
      ADD CONSTRAINT "payment_proofs_private_bucket_only" CHECK ("storage_bucket" = 'docs'),
      ADD CONSTRAINT "payment_proofs_does_not_replace_self"
        CHECK ("replaces_proof_id" IS NULL OR "replaces_proof_id" <> "id"),
      ADD CONSTRAINT "payment_proofs_status_shape" CHECK (
        (
          "status" = 'pending'
          AND "confirmed_at" IS NULL
          AND "rejected_at" IS NULL
          AND "rejection_note" IS NULL
        )
        OR (
          "status" = 'confirmed'
          AND "confirmed_at" IS NOT NULL
          AND "rejected_at" IS NULL
          AND "rejection_note" IS NULL
        )
        OR (
          "status" = 'rejected'
          AND "confirmed_at" IS NULL
          AND "rejected_at" IS NOT NULL
          AND NULLIF(btrim("rejection_note"), '') IS NOT NULL
        )
      );

    CREATE TEMP TABLE "skitza_0027_expected_purchase_payments"
      (LIKE "public"."purchase_payments") ON COMMIT DROP;
    ALTER TABLE "skitza_0027_expected_purchase_payments"
      ADD CONSTRAINT "purchase_payments_positive_amount" CHECK ("amount_cents" > 0),
      ADD CONSTRAINT "purchase_payments_source_proof_consistency" CHECK (
        "source" = 'manual'
        OR ("source" = 'proof' AND "proof_id" IS NOT NULL)
      );

    CREATE TEMP TABLE "skitza_0027_expected_purchase_payment_corrections"
      (LIKE "public"."purchase_payment_corrections") ON COMMIT DROP;
    ALTER TABLE "skitza_0027_expected_purchase_payment_corrections"
      ADD CONSTRAINT "purchase_payment_corrections_positive_sequence" CHECK ("sequence" > 0),
      ADD CONSTRAINT "purchase_payment_corrections_nonnegative_amounts"
        CHECK ("previous_amount_cents" >= 0 AND "new_amount_cents" >= 0);

    CREATE TEMP TABLE "skitza_0027_expected_purchase_waivers"
      (LIKE "public"."purchase_waivers") ON COMMIT DROP;
    ALTER TABLE "skitza_0027_expected_purchase_waivers"
      ADD CONSTRAINT "purchase_waivers_positive_amount" CHECK ("amount_cents" > 0);

    CREATE TEMP TABLE "skitza_0027_expected_purchase_session_allowances"
      (LIKE "public"."purchase_session_allowances") ON COMMIT DROP;
    ALTER TABLE "skitza_0027_expected_purchase_session_allowances"
      ADD CONSTRAINT "purchase_session_allowances_limit_shape" CHECK (
        (
          ("kind" = 'fixed' AND "session_limit" > 0)
          OR ("kind" = 'unlimited' AND "session_limit" IS NULL)
        ) IS TRUE
      ),
      ADD CONSTRAINT "purchase_session_allowances_close_shape" CHECK (
        ("closed_at" IS NULL AND "close_reason" IS NULL)
        OR ("closed_at" IS NOT NULL AND "close_reason" IS NOT NULL)
      );

    CREATE TEMP TABLE "skitza_0027_expected_track_versions"
      (LIKE "public"."track_versions") ON COMMIT DROP;
    ALTER TABLE "skitza_0027_expected_track_versions"
      ADD CONSTRAINT "track_versions_audio_identity_shape" CHECK ((
        ("audio_url" IS NULL AND "audio_r2_key" IS NULL AND "size_bytes" IS NULL
          AND "audio_object_etag" IS NULL AND "audio_identity_fingerprint" IS NULL)
        OR
        ("audio_url" IS NOT NULL AND "audio_r2_key" IS NOT NULL AND "size_bytes" > 0
          AND "audio_object_etag" <> ''
          AND "audio_identity_fingerprint" = 'sha256:' || encode(sha256(convert_to(
            'skitza-track-audio-v1|'
            || octet_length("audio_r2_key")::text || ':' || "audio_r2_key"
            || '|' || octet_length("audio_object_etag")::text || ':' || "audio_object_etag"
            || '|' || octet_length("size_bytes"::text)::text || ':' || "size_bytes"::text,
            'UTF8'
          )), 'hex'))
      ) IS TRUE);
    -- SKITZA_0027_EXPECTED_CHECK_CONTRACTS_END

    IF EXISTS (
        SELECT 1
        FROM unnest(ARRAY[
          'bookings',
          'notifications',
          'payment_proofs',
          'private_offers',
          'project_tracks',
          'projects',
          'purchase_acceptances',
          'purchase_cancellations',
          'purchase_download_override_events',
          'purchase_installments',
          'purchase_payment_corrections',
          'purchase_payments',
          'purchase_requests',
          'purchase_session_allowances',
          'purchase_waivers',
          'purchases',
          'song_public_links',
          'track_comments',
          'track_versions',
          'version_approval_events'
        ]) AS expected_table
        WHERE to_regclass(format('public.%I', expected_table)) IS NULL
      )
      OR EXISTS (
        SELECT 1
        FROM (VALUES
          ('bookings', 'id:pg_catalog.uuid:NO:gen_random_uuid(),producer_id:pg_catalog.uuid:NO:<none>,project_id:pg_catalog.uuid:NO:<none>,purchase_id:pg_catalog.uuid:NO:<none>,session_allowance_id:pg_catalog.uuid:NO:<none>,song_id:pg_catalog.uuid:YES:<none>,artist_name:pg_catalog.text:NO:<none>,artist_email:pg_catalog.text:NO:<none>,artist_phone:pg_catalog.text:YES:<none>,notes:pg_catalog.text:YES:<none>,starts_at:pg_catalog.timestamptz:NO:<none>,duration_min:pg_catalog.int4:NO:<none>,status:public.booking_status:NO:pending_approval,status_changed_at:pg_catalog.timestamptz:YES:<none>,outcome:public.session_use_outcome:NO:reserved,outcome_changed_at:pg_catalog.timestamptz:YES:<none>,reminder_sent_24h:pg_catalog.timestamptz:YES:<none>,reminder_sent_1h:pg_catalog.timestamptz:YES:<none>,created_at:pg_catalog.timestamptz:NO:now()'),
          ('notifications', 'id:pg_catalog.uuid:NO:gen_random_uuid(),producer_id:pg_catalog.uuid:NO:<none>,kind:public.notification_kind:NO:<none>,title:pg_catalog.text:NO:<none>,body:pg_catalog.text:NO:,project_id:pg_catalog.uuid:YES:<none>,track_version_id:pg_catalog.uuid:YES:<none>,comment_id:pg_catalog.uuid:YES:<none>,booking_id:pg_catalog.uuid:YES:<none>,purchase_request_id:pg_catalog.uuid:YES:<none>,purchase_id:pg_catalog.uuid:YES:<none>,read_at:pg_catalog.timestamptz:YES:<none>,archived_at:pg_catalog.timestamptz:YES:<none>,created_at:pg_catalog.timestamptz:NO:now()'),
          ('payment_proofs', 'id:pg_catalog.uuid:NO:gen_random_uuid(),purchase_id:pg_catalog.uuid:NO:<none>,installment_id:pg_catalog.uuid:NO:<none>,producer_id:pg_catalog.uuid:NO:<none>,project_id:pg_catalog.uuid:NO:<none>,client_contact_id:pg_catalog.uuid:NO:<none>,replaces_proof_id:pg_catalog.uuid:YES:<none>,amount_cents:pg_catalog.int4:NO:<none>,currency:pg_catalog.text:NO:<none>,storage_bucket:pg_catalog.text:NO:docs,storage_key:pg_catalog.text:NO:<none>,object_etag:pg_catalog.text:NO:<none>,original_file_name:pg_catalog.text:YES:<none>,content_type:pg_catalog.text:NO:<none>,size_bytes:pg_catalog.int4:NO:<none>,status:public.payment_proof_status:NO:pending,note:pg_catalog.text:YES:<none>,rejection_note:pg_catalog.text:YES:<none>,confirmed_at:pg_catalog.timestamptz:YES:<none>,rejected_at:pg_catalog.timestamptz:YES:<none>,created_at:pg_catalog.timestamptz:NO:now()'),
          ('private_offers', 'id:pg_catalog.uuid:NO:gen_random_uuid(),producer_id:pg_catalog.uuid:NO:<none>,client_contact_id:pg_catalog.uuid:NO:<none>,target_project_id:pg_catalog.uuid:YES:<none>,product_id:pg_catalog.uuid:YES:<none>,status:public.private_offer_status:NO:draft,commercial_draft:pg_catalog.jsonb:NO:<none>,expires_at:pg_catalog.timestamptz:NO:<none>,accepted_at:pg_catalog.timestamptz:YES:<none>,created_at:pg_catalog.timestamptz:NO:now(),updated_at:pg_catalog.timestamptz:NO:now()'),
          ('project_tracks', 'id:pg_catalog.uuid:NO:gen_random_uuid(),project_id:pg_catalog.uuid:NO:<none>,purchase_id:pg_catalog.uuid:NO:<none>,title:pg_catalog.text:NO:<none>,artist:pg_catalog.text:YES:<none>,position:pg_catalog.int4:NO:0,workflow_stage:public.workflow_stage:NO:brief,archived_at:pg_catalog.timestamptz:YES:<none>,portfolio_published_at:pg_catalog.timestamptz:YES:<none>,created_at:pg_catalog.timestamptz:NO:now()'),
          ('projects', 'id:pg_catalog.uuid:NO:gen_random_uuid(),producer_id:pg_catalog.uuid:NO:<none>,client_contact_id:pg_catalog.uuid:NO:<none>,title:pg_catalog.text:NO:<none>,lifecycle_status:public.project_lifecycle_status:NO:waiting_for_payment,lifecycle_changed_at:pg_catalog.timestamptz:NO:now(),client_name:pg_catalog.text:YES:<none>,client_email:pg_catalog.text:YES:<none>,artist_name:pg_catalog.text:NO:<none>,artist_email:pg_catalog.text:NO:<none>,invite_token:pg_catalog.text:YES:<none>,created_at:pg_catalog.timestamptz:NO:now(),updated_at:pg_catalog.timestamptz:NO:now(),testimonial_requested_at:pg_catalog.timestamptz:YES:<none>,notes:pg_catalog.text:YES:<none>,position:pg_catalog.int4:NO:0,workflow_stage:public.workflow_stage:NO:brief,deadline_at:pg_catalog.timestamptz:YES:<none>'),
          ('purchase_acceptances', 'id:pg_catalog.uuid:NO:gen_random_uuid(),purchase_id:pg_catalog.uuid:NO:<none>,producer_id:pg_catalog.uuid:NO:<none>,client_contact_id:pg_catalog.uuid:NO:<none>,accepted_by_clerk_user_id:pg_catalog.text:NO:<none>,accepted_snapshot:pg_catalog.jsonb:NO:<none>,snapshot_digest:pg_catalog.text:NO:<none>,accepted_at:pg_catalog.timestamptz:NO:<none>,created_at:pg_catalog.timestamptz:NO:now()'),
          ('purchase_cancellations', 'id:pg_catalog.uuid:NO:gen_random_uuid(),purchase_id:pg_catalog.uuid:NO:<none>,producer_id:pg_catalog.uuid:NO:<none>,reason:pg_catalog.text:NO:<none>,canceled_by_clerk_user_id:pg_catalog.text:NO:<none>,canceled_at:pg_catalog.timestamptz:NO:<none>,created_at:pg_catalog.timestamptz:NO:now()'),
          ('purchase_download_override_events', 'id:pg_catalog.uuid:NO:gen_random_uuid(),purchase_id:pg_catalog.uuid:NO:<none>,version_id:pg_catalog.uuid:NO:<none>,producer_id:pg_catalog.uuid:NO:<none>,enabled:pg_catalog.bool:NO:<none>,changed_by_clerk_user_id:pg_catalog.text:NO:<none>,created_at:pg_catalog.timestamptz:NO:now()'),
          ('purchase_installments', 'id:pg_catalog.uuid:NO:gen_random_uuid(),purchase_id:pg_catalog.uuid:NO:<none>,producer_id:pg_catalog.uuid:NO:<none>,position:pg_catalog.int4:NO:<none>,amount_cents:pg_catalog.int4:NO:<none>,currency:pg_catalog.text:NO:<none>,due_trigger:public.purchase_installment_due_trigger:NO:<none>,due_at:pg_catalog.timestamptz:YES:<none>,triggered_at:pg_catalog.timestamptz:YES:<none>,required_for_activation:pg_catalog.bool:NO:false,status:public.purchase_installment_status:NO:not_paid,reminders_enabled:pg_catalog.bool:NO:true,created_at:pg_catalog.timestamptz:NO:now(),updated_at:pg_catalog.timestamptz:NO:now()'),
          ('purchase_payment_corrections', 'id:pg_catalog.uuid:NO:gen_random_uuid(),purchase_id:pg_catalog.uuid:NO:<none>,payment_id:pg_catalog.uuid:NO:<none>,producer_id:pg_catalog.uuid:NO:<none>,sequence:pg_catalog.int4:NO:<none>,previous_amount_cents:pg_catalog.int4:NO:<none>,new_amount_cents:pg_catalog.int4:NO:<none>,reason:pg_catalog.text:NO:<none>,corrected_by_clerk_user_id:pg_catalog.text:NO:<none>,created_at:pg_catalog.timestamptz:NO:now()'),
          ('purchase_payments', 'id:pg_catalog.uuid:NO:gen_random_uuid(),purchase_id:pg_catalog.uuid:NO:<none>,installment_id:pg_catalog.uuid:NO:<none>,producer_id:pg_catalog.uuid:NO:<none>,proof_id:pg_catalog.uuid:YES:<none>,operation_key:pg_catalog.text:NO:<none>,operation_digest:pg_catalog.text:NO:<none>,source:public.purchase_payment_source:NO:<none>,amount_cents:pg_catalog.int4:NO:<none>,currency:pg_catalog.text:NO:<none>,paid_at:pg_catalog.timestamptz:NO:<none>,added_by_clerk_user_id:pg_catalog.text:NO:<none>,note:pg_catalog.text:YES:<none>,created_at:pg_catalog.timestamptz:NO:now()'),
          ('purchase_requests', 'id:pg_catalog.uuid:NO:gen_random_uuid(),producer_id:pg_catalog.uuid:NO:<none>,client_contact_id:pg_catalog.uuid:NO:<none>,product_id:pg_catalog.uuid:NO:<none>,project_id:pg_catalog.uuid:YES:<none>,operation_key:pg_catalog.text:NO:<none>,operation_digest:pg_catalog.text:NO:<none>,ref_number:pg_catalog.text:NO:<none>,status:public.purchase_request_status:NO:pending,artist_name:pg_catalog.text:NO:<none>,artist_email:pg_catalog.text:NO:<none>,requested_song_qty:pg_catalog.int4:YES:<none>,brief:pg_catalog.text:YES:<none>,status_changed_at:pg_catalog.timestamptz:YES:<none>,approved_at:pg_catalog.timestamptz:YES:<none>,declined_at:pg_catalog.timestamptz:YES:<none>,canceled_at:pg_catalog.timestamptz:YES:<none>,converted_at:pg_catalog.timestamptz:YES:<none>,created_at:pg_catalog.timestamptz:NO:now(),updated_at:pg_catalog.timestamptz:NO:now()'),
          ('purchase_session_allowances', 'id:pg_catalog.uuid:NO:gen_random_uuid(),purchase_id:pg_catalog.uuid:NO:<none>,producer_id:pg_catalog.uuid:NO:<none>,kind:public.session_allowance_kind:NO:<none>,session_limit:pg_catalog.int4:YES:<none>,duration_min:pg_catalog.int4:NO:<none>,location_type:pg_catalog.text:NO:<none>,buffer_minutes:pg_catalog.int4:NO:<none>,min_lead_hours:pg_catalog.int4:NO:<none>,closed_at:pg_catalog.timestamptz:YES:<none>,close_reason:public.session_allowance_close_reason:YES:<none>,created_at:pg_catalog.timestamptz:NO:now()'),
          ('purchase_waivers', 'id:pg_catalog.uuid:NO:gen_random_uuid(),purchase_id:pg_catalog.uuid:NO:<none>,installment_id:pg_catalog.uuid:NO:<none>,producer_id:pg_catalog.uuid:NO:<none>,amount_cents:pg_catalog.int4:NO:<none>,reason:pg_catalog.text:NO:<none>,waived_by_clerk_user_id:pg_catalog.text:NO:<none>,created_at:pg_catalog.timestamptz:NO:now()'),
          ('purchases', 'id:pg_catalog.uuid:NO:gen_random_uuid(),producer_id:pg_catalog.uuid:NO:<none>,project_id:pg_catalog.uuid:NO:<none>,client_contact_id:pg_catalog.uuid:NO:<none>,product_id:pg_catalog.uuid:YES:<none>,private_offer_id:pg_catalog.uuid:YES:<none>,purchase_request_id:pg_catalog.uuid:YES:<none>,source_kind:public.purchase_source_kind:NO:<none>,operation_key:pg_catalog.text:NO:<none>,operation_digest:pg_catalog.text:NO:<none>,ref_number:pg_catalog.text:NO:<none>,lifecycle_status:public.purchase_lifecycle_status:NO:waiting_for_payment,payment_plan_kind:public.purchase_payment_plan_kind:YES:<none>,snapshot_version:pg_catalog.int4:NO:1,snapshot_digest:pg_catalog.text:NO:<none>,commercial_snapshot:pg_catalog.jsonb:NO:<none>,subtotal_cents:pg_catalog.int4:NO:<none>,tax_cents:pg_catalog.int4:NO:<none>,total_cents:pg_catalog.int4:NO:<none>,currency:pg_catalog.text:NO:<none>,accepted_at:pg_catalog.timestamptz:NO:<none>,activated_at:pg_catalog.timestamptz:YES:<none>,canceled_at:pg_catalog.timestamptz:YES:<none>,created_at:pg_catalog.timestamptz:NO:now(),updated_at:pg_catalog.timestamptz:NO:now()'),
          ('song_public_links', 'id:pg_catalog.uuid:NO:gen_random_uuid(),track_id:pg_catalog.uuid:NO:<none>,purchase_id:pg_catalog.uuid:NO:<none>,producer_id:pg_catalog.uuid:NO:<none>,token_hash:pg_catalog.text:NO:<none>,token_version:pg_catalog.int4:NO:1,enabled_at:pg_catalog.timestamptz:NO:<none>,disabled_at:pg_catalog.timestamptz:YES:<none>,created_at:pg_catalog.timestamptz:NO:now(),updated_at:pg_catalog.timestamptz:NO:now()'),
          ('track_comments', 'id:pg_catalog.uuid:NO:gen_random_uuid(),version_id:pg_catalog.uuid:NO:<none>,producer_id:pg_catalog.uuid:NO:<none>,author_name:pg_catalog.text:NO:<none>,author_email:pg_catalog.text:NO:<none>,body:pg_catalog.text:NO:<none>,timestamp_ms:pg_catalog.int4:NO:<none>,resolved_at:pg_catalog.timestamptz:YES:<none>,from_producer:pg_catalog.bool:NO:false,created_at:pg_catalog.timestamptz:NO:now()'),
          ('track_versions', 'id:pg_catalog.uuid:NO:gen_random_uuid(),track_id:pg_catalog.uuid:NO:<none>,purchase_id:pg_catalog.uuid:NO:<none>,producer_id:pg_catalog.uuid:NO:<none>,label:pg_catalog.text:NO:<none>,audio_url:pg_catalog.text:YES:<none>,duration_ms:pg_catalog.int4:YES:<none>,audio_r2_key:pg_catalog.text:YES:<none>,size_bytes:pg_catalog.int8:YES:<none>,audio_object_etag:pg_catalog.text:YES:<none>,audio_identity_fingerprint:pg_catalog.text:YES:<none>,peaks_r2_key:pg_catalog.text:YES:<none>,peaks:pg_catalog.jsonb:YES:<none>,description:pg_catalog.text:YES:<none>,uploaded_at:pg_catalog.timestamptz:NO:now(),producer_marked_final_at:pg_catalog.timestamptz:YES:<none>,audio_deleted_at:pg_catalog.timestamptz:YES:<none>'),
          ('version_approval_events', 'id:pg_catalog.uuid:NO:gen_random_uuid(),version_id:pg_catalog.uuid:NO:<none>,purchase_id:pg_catalog.uuid:NO:<none>,producer_id:pg_catalog.uuid:NO:<none>,client_contact_id:pg_catalog.uuid:NO:<none>,audio_identity_fingerprint:pg_catalog.text:NO:<none>,action:public.version_approval_action:NO:<none>,acted_by_clerk_user_id:pg_catalog.text:NO:<none>,created_at:pg_catalog.timestamptz:NO:now()')
        ) AS expected_columns("table_name", "column_contract")
        WHERE (
          SELECT string_agg(
            column_name || ':' || udt_schema || '.' || udt_name || ':' || is_nullable || ':' ||
              COALESCE(
                CASE
                  WHEN column_default ~ '^''[^'']*''::' THEN
                    regexp_replace(column_default, '^''([^'']*)''::.*$', '\1')
                  ELSE column_default
                END,
                '<none>'
              ),
            ',' ORDER BY ordinal_position
          )
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = expected_columns."table_name"
        ) IS DISTINCT FROM expected_columns."column_contract"
      )
      OR to_regclass('public.agreement_acceptances') IS NOT NULL
      OR to_regclass('public.invoices') IS NOT NULL
      OR to_regclass('public.store_purchase_intents') IS NOT NULL
      OR to_regclass('public.stripe_customers') IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM (VALUES
          ('products', 'products_id_producer_unique'),
          ('client_contacts', 'client_contacts_id_producer_unique'),
          ('projects', 'projects_pkey'),
          ('projects', 'projects_invite_token_unique'),
          ('projects', 'projects_id_producer_unique'),
          ('projects', 'projects_id_owner_unique'),
          ('projects', 'projects_producer_id_producers_id_fk'),
          ('projects', 'projects_client_producer_fk'),
          ('purchase_requests', 'purchase_requests_pkey'),
          ('purchase_requests', 'purchase_requests_ref_number_unique'),
          ('purchase_requests', 'purchase_requests_operation_key_unique'),
          ('purchase_requests', 'purchase_requests_id_owner_unique'),
          ('purchase_requests', 'purchase_requests_id_producer_unique'),
          ('purchase_requests', 'purchase_requests_id_project_owner_unique'),
          ('purchase_requests', 'purchase_requests_requested_song_qty_positive'),
          ('purchase_requests', 'purchase_requests_status_timestamp_shape'),
          ('purchase_requests', 'purchase_requests_status_timestamp_shape'),
          ('purchase_requests', 'purchase_requests_producer_id_producers_id_fk'),
          ('purchase_requests', 'purchase_requests_client_producer_fk'),
          ('purchase_requests', 'purchase_requests_product_producer_fk'),
          ('purchase_requests', 'purchase_requests_project_owner_fk'),
          ('private_offers', 'private_offers_pkey'),
          ('private_offers', 'private_offers_id_owner_unique'),
          ('private_offers', 'private_offers_id_project_owner_unique'),
          ('private_offers', 'private_offers_producer_id_producers_id_fk'),
          ('private_offers', 'private_offers_client_producer_fk'),
          ('private_offers', 'private_offers_project_owner_fk'),
          ('private_offers', 'private_offers_product_producer_fk'),
          ('purchases', 'purchases_pkey'),
          ('purchases', 'purchases_ref_number_unique'),
          ('purchases', 'purchases_operation_key_unique'),
          ('purchases', 'purchases_id_producer_unique'),
          ('purchases', 'purchases_id_producer_client_unique'),
          ('purchases', 'purchases_id_project_unique'),
          ('purchases', 'purchases_id_currency_unique'),
          ('purchases', 'purchases_id_snapshot_unique'),
          ('purchases', 'purchases_id_owner_unique'),
          ('purchases', 'purchases_nonnegative_amounts'),
          ('purchases', 'purchases_payment_plan_shape'),
          ('purchases', 'purchases_zero_total_activation_shape'),
          ('purchases', 'purchases_lifecycle_timestamp_shape'),
          ('purchases', 'purchases_snapshot_scalar_consistency'),
          ('purchases', 'purchases_agreement_text_shape'),
          ('purchases', 'purchases_tax_shape'),
          ('purchases', 'purchases_discount_shape'),
          ('purchases', 'purchases_source_link_shape'),
          ('purchases', 'purchases_source_amount_shape'),
          ('purchases', 'purchases_producer_id_producers_id_fk'),
          ('purchases', 'purchases_project_owner_fk'),
          ('purchases', 'purchases_client_producer_fk'),
          ('purchases', 'purchases_product_producer_fk'),
          ('purchases', 'purchases_private_offer_owner_fk'),
          ('purchases', 'purchases_private_offer_project_owner_fk'),
          ('purchases', 'purchases_purchase_request_owner_fk'),
          ('purchase_acceptances', 'purchase_acceptances_pkey'),
          ('purchase_acceptances', 'purchase_acceptances_purchase_unique'),
          ('purchase_acceptances', 'purchase_acceptances_purchase_owner_fk'),
          ('purchase_acceptances', 'purchase_acceptances_purchase_snapshot_fk'),
          ('purchase_installments', 'purchase_installments_pkey'),
          ('purchase_installments', 'purchase_installments_purchase_position_unique'),
          ('purchase_installments', 'purchase_installments_id_purchase_unique'),
          ('purchase_installments', 'purchase_installments_id_purchase_currency_unique'),
          ('purchase_installments', 'purchase_installments_positive_position'),
          ('purchase_installments', 'purchase_installments_positive_amount'),
          ('purchase_installments', 'purchase_installments_purchase_producer_fk'),
          ('purchase_installments', 'purchase_installments_purchase_currency_fk'),
          ('payment_proofs', 'payment_proofs_pkey'),
          ('payment_proofs', 'payment_proofs_storage_key_unique'),
          ('payment_proofs', 'payment_proofs_id_purchase_installment_producer_unique'),
          ('payment_proofs', 'payment_proofs_id_purchase_installment_producer_currency_unique'),
          ('payment_proofs', 'payment_proofs_positive_amount'),
          ('payment_proofs', 'payment_proofs_nonnegative_size'),
          ('payment_proofs', 'payment_proofs_private_bucket_only'),
          ('payment_proofs', 'payment_proofs_does_not_replace_self'),
          ('payment_proofs', 'payment_proofs_status_shape'),
          ('payment_proofs', 'payment_proofs_purchase_owner_fk'),
          ('payment_proofs', 'payment_proofs_installment_purchase_currency_fk'),
          ('payment_proofs', 'payment_proofs_replacement_identity_fk'),
          ('purchase_payments', 'purchase_payments_pkey'),
          ('purchase_payments', 'purchase_payments_id_purchase_unique'),
          ('purchase_payments', 'purchase_payments_operation_key_unique'),
          ('purchase_payments', 'purchase_payments_positive_amount'),
          ('purchase_payments', 'purchase_payments_source_proof_consistency'),
          ('purchase_payments', 'purchase_payments_purchase_producer_fk'),
          ('purchase_payments', 'purchase_payments_installment_purchase_currency_fk'),
          ('purchase_payments', 'purchase_payments_proof_purchase_installment_currency_fk'),
          ('purchase_payment_corrections', 'purchase_payment_corrections_pkey'),
          ('purchase_payment_corrections', 'purchase_payment_corrections_payment_sequence_unique'),
          ('purchase_payment_corrections', 'purchase_payment_corrections_positive_sequence'),
          ('purchase_payment_corrections', 'purchase_payment_corrections_nonnegative_amounts'),
          ('purchase_payment_corrections', 'purchase_payment_corrections_payment_purchase_fk'),
          ('purchase_payment_corrections', 'purchase_payment_corrections_purchase_producer_fk'),
          ('purchase_waivers', 'purchase_waivers_pkey'),
          ('purchase_waivers', 'purchase_waivers_positive_amount'),
          ('purchase_waivers', 'purchase_waivers_installment_purchase_fk'),
          ('purchase_waivers', 'purchase_waivers_purchase_producer_fk'),
          ('purchase_cancellations', 'purchase_cancellations_pkey'),
          ('purchase_cancellations', 'purchase_cancellations_purchase_unique'),
          ('purchase_cancellations', 'purchase_cancellations_purchase_producer_fk'),
          ('purchase_session_allowances', 'purchase_session_allowances_pkey'),
          ('purchase_session_allowances', 'purchase_session_allowances_purchase_unique'),
          ('purchase_session_allowances', 'purchase_session_allowances_id_purchase_unique'),
          ('purchase_session_allowances', 'purchase_session_allowances_limit_shape'),
          ('purchase_session_allowances', 'purchase_session_allowances_close_shape'),
          ('purchase_session_allowances', 'purchase_session_allowances_purchase_producer_fk'),
          ('project_tracks', 'project_tracks_pkey'),
          ('project_tracks', 'project_tracks_id_purchase_unique'),
          ('project_tracks', 'project_tracks_id_project_unique'),
          ('project_tracks', 'project_tracks_project_id_projects_id_fk'),
          ('project_tracks', 'project_tracks_purchase_id_purchases_id_fk'),
          ('project_tracks', 'project_tracks_purchase_project_fk'),
          ('track_versions', 'track_versions_pkey'),
          ('track_versions', 'track_versions_id_purchase_unique'),
          ('track_versions', 'track_versions_id_producer_unique'),
          ('track_versions', 'track_versions_audio_identity_unique'),
          ('track_versions', 'track_versions_audio_identity_shape'),
          ('track_versions', 'track_versions_track_id_project_tracks_id_fk'),
          ('track_versions', 'track_versions_purchase_id_purchases_id_fk'),
          ('track_versions', 'track_versions_track_purchase_fk'),
          ('track_versions', 'track_versions_purchase_producer_fk'),
          ('track_comments', 'track_comments_pkey'),
          ('track_comments', 'track_comments_id_producer_unique'),
          ('track_comments', 'track_comments_version_id_track_versions_id_fk'),
          ('track_comments', 'track_comments_version_producer_fk'),
          ('bookings', 'bookings_pkey'),
          ('bookings', 'bookings_id_producer_unique'),
          ('bookings', 'bookings_producer_id_producers_id_fk'),
          ('bookings', 'bookings_project_id_projects_id_fk'),
          ('bookings', 'bookings_purchase_id_purchases_id_fk'),
          ('bookings', 'bookings_session_allowance_id_purchase_session_allowances_id_fk'),
          ('bookings', 'bookings_song_id_project_tracks_id_fk'),
          ('bookings', 'bookings_purchase_project_fk'),
          ('bookings', 'bookings_purchase_producer_fk'),
          ('bookings', 'bookings_allowance_purchase_fk'),
          ('bookings', 'bookings_song_purchase_fk'),
          ('purchase_download_override_events', 'purchase_download_override_events_pkey'),
          ('purchase_download_override_events', 'purchase_download_overrides_purchase_producer_fk'),
          ('purchase_download_override_events', 'purchase_download_overrides_version_purchase_fk'),
          ('version_approval_events', 'version_approval_events_pkey'),
          ('version_approval_events', 'version_approval_events_version_purchase_fk'),
          ('version_approval_events', 'version_approval_events_audio_identity_fk'),
          ('version_approval_events', 'version_approval_events_purchase_owner_fk'),
          ('song_public_links', 'song_public_links_pkey'),
          ('song_public_links', 'song_public_links_token_hash_unique'),
          ('song_public_links', 'song_public_links_track_unique'),
          ('song_public_links', 'song_public_links_track_purchase_fk'),
          ('song_public_links', 'song_public_links_purchase_producer_fk'),
          ('notifications', 'notifications_pkey'),
          ('notifications', 'notifications_producer_id_producers_id_fk'),
          ('notifications', 'notifications_project_producer_fk'),
          ('notifications', 'notifications_track_version_producer_fk'),
          ('notifications', 'notifications_comment_producer_fk'),
          ('notifications', 'notifications_booking_producer_fk'),
          ('notifications', 'notifications_purchase_request_producer_fk'),
          ('notifications', 'notifications_purchase_producer_fk')
        ) AS expected_constraint("table_name", "constraint_name")
        WHERE NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE pg_constraint.conrelid = to_regclass(
              format('public.%I', expected_constraint."table_name")
            )
            AND pg_constraint.conname = expected_constraint."constraint_name"
        )
      )
      OR (
        SELECT md5(COALESCE(string_agg(
          table_relation.relname || '|' || pg_constraint.conname,
          E'\n' ORDER BY table_relation.relname COLLATE "C", pg_constraint.conname COLLATE "C"
        ), ''))
        FROM pg_constraint
        JOIN pg_class AS table_relation
          ON table_relation.oid = pg_constraint.conrelid
        JOIN pg_namespace AS table_namespace
          ON table_namespace.oid = table_relation.relnamespace
        WHERE table_namespace.nspname = 'public'
          AND table_relation.relname = ANY(completed_target_tables)
      ) IS DISTINCT FROM expected_constraint_inventory_md5
      OR (
        SELECT md5(COALESCE(string_agg(
          table_relation.relname || '|' ||
          pg_constraint.conname || '|' ||
          pg_constraint.contype::text || '|' ||
          COALESCE((
            SELECT string_agg(pg_attribute.attname::text, ',' ORDER BY key_column.ordinality)
            FROM unnest(pg_constraint.conkey) WITH ORDINALITY
              AS key_column(attnum, ordinality)
            JOIN pg_attribute
              ON pg_attribute.attrelid = pg_constraint.conrelid
             AND pg_attribute.attnum = key_column.attnum
          ), '') || '|' ||
          CASE
            WHEN pg_constraint.contype = 'f' THEN COALESCE(foreign_relation.relname, '')
            ELSE ''
          END || '|' ||
          CASE
            WHEN pg_constraint.contype = 'f' THEN COALESCE((
              SELECT string_agg(pg_attribute.attname::text, ',' ORDER BY key_column.ordinality)
              FROM unnest(pg_constraint.confkey) WITH ORDINALITY
                AS key_column(attnum, ordinality)
              JOIN pg_attribute
                ON pg_attribute.attrelid = pg_constraint.confrelid
               AND pg_attribute.attnum = key_column.attnum
            ), '')
            ELSE ''
          END || '|' ||
          CASE WHEN pg_constraint.contype = 'f' THEN pg_constraint.confupdtype::text ELSE '' END || '|' ||
          CASE WHEN pg_constraint.contype = 'f' THEN pg_constraint.confdeltype::text ELSE '' END || '|' ||
          CASE WHEN pg_constraint.contype = 'f' THEN pg_constraint.confmatchtype::text ELSE '' END || '|' ||
          pg_constraint.condeferrable::text || '|' ||
          pg_constraint.condeferred::text || '|' ||
          pg_constraint.convalidated::text || '|' ||
          pg_constraint.connoinherit::text || '|' ||
          CASE WHEN pg_constraint.contype IN ('p', 'u') THEN pg_index.indisvalid::text ELSE '' END || '|' ||
          CASE WHEN pg_constraint.contype IN ('p', 'u') THEN pg_index.indisready::text ELSE '' END || '|' ||
          CASE WHEN pg_constraint.contype IN ('p', 'u') THEN pg_index.indislive::text ELSE '' END || '|' ||
          CASE WHEN pg_constraint.contype IN ('p', 'u') THEN pg_index.indisunique::text ELSE '' END || '|' ||
          CASE WHEN pg_constraint.contype IN ('p', 'u') THEN pg_index.indisprimary::text ELSE '' END || '|' ||
          CASE WHEN pg_constraint.contype IN ('p', 'u') THEN pg_index.indnullsnotdistinct::text ELSE '' END,
          E'\n' ORDER BY table_relation.relname COLLATE "C", pg_constraint.conname COLLATE "C"
        ), ''))
        FROM pg_constraint
        JOIN pg_class AS table_relation
          ON table_relation.oid = pg_constraint.conrelid
        JOIN pg_namespace AS table_namespace
          ON table_namespace.oid = table_relation.relnamespace
        LEFT JOIN pg_class AS foreign_relation
          ON foreign_relation.oid = pg_constraint.confrelid
        LEFT JOIN pg_index
          ON pg_index.indexrelid = pg_constraint.conindid
         AND pg_constraint.contype IN ('p', 'u')
        WHERE table_namespace.nspname = 'public'
          AND pg_constraint.contype IN ('p', 'u', 'f')
          AND (
            table_relation.relname = ANY(completed_target_tables)
            OR (
              table_relation.relname = 'products'
              AND pg_constraint.conname = 'products_id_producer_unique'
            )
            OR (
              table_relation.relname = 'client_contacts'
              AND pg_constraint.conname = 'client_contacts_id_producer_unique'
            )
          )
      ) IS DISTINCT FROM expected_constraint_structure_md5
      OR EXISTS (
        SELECT 1
        FROM (VALUES
          ('purchase_requests', 'purchase_requests_requested_song_qty_positive'),
          ('purchases', 'purchases_nonnegative_amounts'),
          ('purchases', 'purchases_payment_plan_shape'),
          ('purchases', 'purchases_zero_total_activation_shape'),
          ('purchases', 'purchases_lifecycle_timestamp_shape'),
          ('purchases', 'purchases_snapshot_scalar_consistency'),
          ('purchases', 'purchases_agreement_text_shape'),
          ('purchases', 'purchases_tax_shape'),
          ('purchases', 'purchases_discount_shape'),
          ('purchases', 'purchases_source_link_shape'),
          ('purchases', 'purchases_source_amount_shape'),
          ('purchase_installments', 'purchase_installments_positive_position'),
          ('purchase_installments', 'purchase_installments_positive_amount'),
          ('payment_proofs', 'payment_proofs_positive_amount'),
          ('payment_proofs', 'payment_proofs_nonnegative_size'),
          ('payment_proofs', 'payment_proofs_private_bucket_only'),
          ('payment_proofs', 'payment_proofs_does_not_replace_self'),
          ('payment_proofs', 'payment_proofs_status_shape'),
          ('purchase_payments', 'purchase_payments_positive_amount'),
          ('purchase_payments', 'purchase_payments_source_proof_consistency'),
          ('purchase_payment_corrections', 'purchase_payment_corrections_positive_sequence'),
          ('purchase_payment_corrections', 'purchase_payment_corrections_nonnegative_amounts'),
          ('purchase_waivers', 'purchase_waivers_positive_amount'),
          ('purchase_session_allowances', 'purchase_session_allowances_limit_shape'),
          ('purchase_session_allowances', 'purchase_session_allowances_close_shape'),
          ('track_versions', 'track_versions_audio_identity_shape')
        ) AS approved_check("table_name", "constraint_name")
        WHERE NOT EXISTS (
          SELECT 1
          FROM pg_constraint AS actual_check
          JOIN pg_constraint AS expected_check
            ON expected_check.conrelid = to_regclass(format(
              'pg_temp.%I',
              'skitza_0027_expected_' || approved_check."table_name"
            ))
           AND expected_check.conname = approved_check."constraint_name"
           AND expected_check.contype = 'c'
          WHERE actual_check.conrelid = to_regclass(
              format('public.%I', approved_check."table_name")
            )
            AND actual_check.conname = approved_check."constraint_name"
            AND actual_check.contype = 'c'
            AND actual_check.convalidated
            AND NOT actual_check.connoinherit
            AND pg_get_constraintdef(actual_check.oid, false) =
              pg_get_constraintdef(expected_check.oid, false)
        )
      )
      OR EXISTS (
        SELECT 1
        FROM (VALUES
          ('purchase_requests', 'purchase_requests_operation_key_unique', 'u', ARRAY['producer_id', 'client_contact_id', 'operation_key']::text[], NULL::text, NULL::text[]),
          ('purchase_requests', 'purchase_requests_id_producer_unique', 'u', ARRAY['id', 'producer_id']::text[], NULL::text, NULL::text[]),
          ('purchase_requests', 'purchase_requests_id_project_owner_unique', 'u', ARRAY['id', 'product_id', 'project_id', 'producer_id', 'client_contact_id']::text[], NULL::text, NULL::text[]),
          ('private_offers', 'private_offers_id_project_owner_unique', 'u', ARRAY['id', 'target_project_id', 'producer_id', 'client_contact_id']::text[], NULL::text, NULL::text[]),
          ('purchases', 'purchases_operation_key_unique', 'u', ARRAY['producer_id', 'client_contact_id', 'operation_key']::text[], NULL::text, NULL::text[]),
          ('purchases', 'purchases_id_owner_unique', 'u', ARRAY['id', 'project_id', 'producer_id', 'client_contact_id']::text[], NULL::text, NULL::text[]),
          ('purchases', 'purchases_id_currency_unique', 'u', ARRAY['id', 'currency']::text[], NULL::text, NULL::text[]),
          ('purchases', 'purchases_project_owner_fk', 'f', ARRAY['project_id', 'producer_id', 'client_contact_id']::text[], 'projects', ARRAY['id', 'producer_id', 'client_contact_id']::text[]),
          ('purchases', 'purchases_private_offer_project_owner_fk', 'f', ARRAY['private_offer_id', 'project_id', 'producer_id', 'client_contact_id']::text[], 'private_offers', ARRAY['id', 'target_project_id', 'producer_id', 'client_contact_id']::text[]),
          ('purchases', 'purchases_purchase_request_owner_fk', 'f', ARRAY['purchase_request_id', 'product_id', 'project_id', 'producer_id', 'client_contact_id']::text[], 'purchase_requests', ARRAY['id', 'product_id', 'project_id', 'producer_id', 'client_contact_id']::text[]),
          ('purchase_acceptances', 'purchase_acceptances_purchase_owner_fk', 'f', ARRAY['purchase_id', 'producer_id', 'client_contact_id']::text[], 'purchases', ARRAY['id', 'producer_id', 'client_contact_id']::text[]),
          ('purchase_acceptances', 'purchase_acceptances_purchase_snapshot_fk', 'f', ARRAY['purchase_id', 'snapshot_digest']::text[], 'purchases', ARRAY['id', 'snapshot_digest']::text[]),
          ('purchase_installments', 'purchase_installments_purchase_position_unique', 'u', ARRAY['purchase_id', 'position']::text[], NULL::text, NULL::text[]),
          ('purchase_installments', 'purchase_installments_id_purchase_unique', 'u', ARRAY['id', 'purchase_id']::text[], NULL::text, NULL::text[]),
          ('purchase_installments', 'purchase_installments_id_purchase_currency_unique', 'u', ARRAY['id', 'purchase_id', 'currency']::text[], NULL::text, NULL::text[]),
          ('purchase_installments', 'purchase_installments_purchase_producer_fk', 'f', ARRAY['purchase_id', 'producer_id']::text[], 'purchases', ARRAY['id', 'producer_id']::text[]),
          ('purchase_installments', 'purchase_installments_purchase_currency_fk', 'f', ARRAY['purchase_id', 'currency']::text[], 'purchases', ARRAY['id', 'currency']::text[]),
          ('payment_proofs', 'payment_proofs_id_purchase_installment_producer_unique', 'u', ARRAY['id', 'purchase_id', 'installment_id', 'producer_id']::text[], NULL::text, NULL::text[]),
          ('payment_proofs', 'payment_proofs_id_purchase_installment_producer_currency_unique', 'u', ARRAY['id', 'purchase_id', 'installment_id', 'producer_id', 'currency']::text[], NULL::text, NULL::text[]),
          ('payment_proofs', 'payment_proofs_purchase_owner_fk', 'f', ARRAY['purchase_id', 'project_id', 'producer_id', 'client_contact_id']::text[], 'purchases', ARRAY['id', 'project_id', 'producer_id', 'client_contact_id']::text[]),
          ('payment_proofs', 'payment_proofs_installment_purchase_currency_fk', 'f', ARRAY['installment_id', 'purchase_id', 'currency']::text[], 'purchase_installments', ARRAY['id', 'purchase_id', 'currency']::text[]),
          ('payment_proofs', 'payment_proofs_replacement_identity_fk', 'f', ARRAY['replaces_proof_id', 'purchase_id', 'installment_id', 'producer_id']::text[], 'payment_proofs', ARRAY['id', 'purchase_id', 'installment_id', 'producer_id']::text[]),
          ('purchase_payments', 'purchase_payments_operation_key_unique', 'u', ARRAY['purchase_id', 'operation_key']::text[], NULL::text, NULL::text[]),
          ('purchase_payments', 'purchase_payments_installment_purchase_currency_fk', 'f', ARRAY['installment_id', 'purchase_id', 'currency']::text[], 'purchase_installments', ARRAY['id', 'purchase_id', 'currency']::text[]),
          ('purchase_payments', 'purchase_payments_proof_purchase_installment_currency_fk', 'f', ARRAY['proof_id', 'purchase_id', 'installment_id', 'producer_id', 'currency']::text[], 'payment_proofs', ARRAY['id', 'purchase_id', 'installment_id', 'producer_id', 'currency']::text[]),
          ('purchase_payment_corrections', 'purchase_payment_corrections_payment_sequence_unique', 'u', ARRAY['payment_id', 'sequence']::text[], NULL::text, NULL::text[]),
          ('purchase_waivers', 'purchase_waivers_installment_purchase_fk', 'f', ARRAY['installment_id', 'purchase_id']::text[], 'purchase_installments', ARRAY['id', 'purchase_id']::text[]),
          ('purchase_cancellations', 'purchase_cancellations_purchase_unique', 'u', ARRAY['purchase_id']::text[], NULL::text, NULL::text[]),
          ('purchase_session_allowances', 'purchase_session_allowances_purchase_unique', 'u', ARRAY['purchase_id']::text[], NULL::text, NULL::text[]),
          ('purchase_session_allowances', 'purchase_session_allowances_id_purchase_unique', 'u', ARRAY['id', 'purchase_id']::text[], NULL::text, NULL::text[]),
          ('project_tracks', 'project_tracks_purchase_project_fk', 'f', ARRAY['purchase_id', 'project_id']::text[], 'purchases', ARRAY['id', 'project_id']::text[]),
          ('track_versions', 'track_versions_track_purchase_fk', 'f', ARRAY['track_id', 'purchase_id']::text[], 'project_tracks', ARRAY['id', 'purchase_id']::text[]),
          ('track_versions', 'track_versions_id_producer_unique', 'u', ARRAY['id', 'producer_id']::text[], NULL::text, NULL::text[]),
          ('track_versions', 'track_versions_audio_identity_unique', 'u', ARRAY['id', 'purchase_id', 'audio_identity_fingerprint']::text[], NULL::text, NULL::text[]),
          ('track_versions', 'track_versions_purchase_producer_fk', 'f', ARRAY['purchase_id', 'producer_id']::text[], 'purchases', ARRAY['id', 'producer_id']::text[]),
          ('track_comments', 'track_comments_id_producer_unique', 'u', ARRAY['id', 'producer_id']::text[], NULL::text, NULL::text[]),
          ('track_comments', 'track_comments_version_producer_fk', 'f', ARRAY['version_id', 'producer_id']::text[], 'track_versions', ARRAY['id', 'producer_id']::text[]),
          ('bookings', 'bookings_id_producer_unique', 'u', ARRAY['id', 'producer_id']::text[], NULL::text, NULL::text[]),
          ('bookings', 'bookings_purchase_project_fk', 'f', ARRAY['purchase_id', 'project_id']::text[], 'purchases', ARRAY['id', 'project_id']::text[]),
          ('bookings', 'bookings_purchase_producer_fk', 'f', ARRAY['purchase_id', 'producer_id']::text[], 'purchases', ARRAY['id', 'producer_id']::text[]),
          ('bookings', 'bookings_allowance_purchase_fk', 'f', ARRAY['session_allowance_id', 'purchase_id']::text[], 'purchase_session_allowances', ARRAY['id', 'purchase_id']::text[]),
          ('bookings', 'bookings_song_purchase_fk', 'f', ARRAY['song_id', 'purchase_id']::text[], 'project_tracks', ARRAY['id', 'purchase_id']::text[]),
          ('purchase_download_override_events', 'purchase_download_overrides_version_purchase_fk', 'f', ARRAY['version_id', 'purchase_id']::text[], 'track_versions', ARRAY['id', 'purchase_id']::text[]),
          ('version_approval_events', 'version_approval_events_audio_identity_fk', 'f', ARRAY['version_id', 'purchase_id', 'audio_identity_fingerprint']::text[], 'track_versions', ARRAY['id', 'purchase_id', 'audio_identity_fingerprint']::text[]),
          ('version_approval_events', 'version_approval_events_purchase_owner_fk', 'f', ARRAY['purchase_id', 'producer_id', 'client_contact_id']::text[], 'purchases', ARRAY['id', 'producer_id', 'client_contact_id']::text[]),
          ('song_public_links', 'song_public_links_track_purchase_fk', 'f', ARRAY['track_id', 'purchase_id']::text[], 'project_tracks', ARRAY['id', 'purchase_id']::text[]),
          ('notifications', 'notifications_project_producer_fk', 'f', ARRAY['project_id', 'producer_id']::text[], 'projects', ARRAY['id', 'producer_id']::text[]),
          ('notifications', 'notifications_track_version_producer_fk', 'f', ARRAY['track_version_id', 'producer_id']::text[], 'track_versions', ARRAY['id', 'producer_id']::text[]),
          ('notifications', 'notifications_comment_producer_fk', 'f', ARRAY['comment_id', 'producer_id']::text[], 'track_comments', ARRAY['id', 'producer_id']::text[]),
          ('notifications', 'notifications_booking_producer_fk', 'f', ARRAY['booking_id', 'producer_id']::text[], 'bookings', ARRAY['id', 'producer_id']::text[]),
          ('notifications', 'notifications_purchase_request_producer_fk', 'f', ARRAY['purchase_request_id', 'producer_id']::text[], 'purchase_requests', ARRAY['id', 'producer_id']::text[]),
          ('notifications', 'notifications_purchase_producer_fk', 'f', ARRAY['purchase_id', 'producer_id']::text[], 'purchases', ARRAY['id', 'producer_id']::text[])
        ) AS critical_constraint(
          "table_name",
          "constraint_name",
          "constraint_type",
          "local_columns",
          "foreign_table_name",
          "foreign_columns"
        )
        WHERE NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE pg_constraint.conrelid = to_regclass(
              format('public.%I', critical_constraint."table_name")
            )
            AND pg_constraint.conname = critical_constraint."constraint_name"
            AND pg_constraint.contype::text = critical_constraint."constraint_type"
            AND pg_constraint.convalidated
            AND (
              SELECT array_agg(pg_attribute.attname::text ORDER BY key_column.ordinality)
              FROM unnest(pg_constraint.conkey) WITH ORDINALITY
                AS key_column(attnum, ordinality)
              JOIN pg_attribute
                ON pg_attribute.attrelid = pg_constraint.conrelid
               AND pg_attribute.attnum = key_column.attnum
            ) = critical_constraint."local_columns"
            AND (
              critical_constraint."foreign_table_name" IS NULL
              OR (
                pg_constraint.confrelid = to_regclass(
                  format('public.%I', critical_constraint."foreign_table_name")
                )
                AND pg_constraint.confdeltype = 'r'
                AND (
                  SELECT array_agg(pg_attribute.attname::text ORDER BY key_column.ordinality)
                  FROM unnest(pg_constraint.confkey) WITH ORDINALITY
                    AS key_column(attnum, ordinality)
                  JOIN pg_attribute
                    ON pg_attribute.attrelid = pg_constraint.confrelid
                   AND pg_attribute.attnum = key_column.attnum
                ) = critical_constraint."foreign_columns"
              )
            )
        )
      )
      OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE pg_constraint.conrelid = 'public.purchases'::regclass
          AND pg_constraint.conname = 'purchases_payment_plan_shape'
          AND pg_constraint.contype = 'c'
          AND pg_constraint.convalidated
          AND pg_get_constraintdef(pg_constraint.oid) ~*
            'total_cents = 0.*payment_plan_kind IS NULL.*total_cents > 0.*payment_plan_kind IS NOT NULL'
      )
      OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE pg_constraint.conrelid = 'public.purchases'::regclass
          AND pg_constraint.conname = 'purchases_zero_total_activation_shape'
          AND pg_constraint.contype = 'c'
          AND pg_constraint.convalidated
          AND pg_get_constraintdef(pg_constraint.oid) ~*
            'total_cents > 0.*lifecycle_status.*active.*canceled.*activated_at = accepted_at.*IS TRUE'
      )
      OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE pg_constraint.conrelid = 'public.purchase_installments'::regclass
          AND pg_constraint.conname = 'purchase_installments_positive_amount'
          AND pg_constraint.contype = 'c'
          AND pg_constraint.convalidated
          AND pg_get_constraintdef(pg_constraint.oid) ~* 'amount_cents > 0'
      )
      OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE pg_constraint.conrelid = 'public.track_versions'::regclass
          AND pg_constraint.conname = 'track_versions_audio_identity_shape'
          AND pg_constraint.contype = 'c'
          AND pg_constraint.convalidated
          AND pg_get_constraintdef(pg_constraint.oid) ~*
            'audio_url IS NULL.*audio_r2_key IS NULL.*size_bytes IS NULL.*audio_object_etag IS NULL.*audio_identity_fingerprint IS NULL.*audio_url IS NOT NULL.*audio_r2_key IS NOT NULL.*size_bytes > 0.*audio_object_etag <>.*audio_identity_fingerprint.*=.*sha256:.*encode.*sha256.*convert_to.*octet_length.*audio_r2_key.*audio_object_etag.*size_bytes.*IS TRUE'
      )
      OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE pg_constraint.conrelid = 'public.purchases'::regclass
          AND pg_constraint.conname = 'purchases_lifecycle_timestamp_shape'
          AND pg_constraint.contype = 'c'
          AND pg_constraint.convalidated
          AND pg_get_constraintdef(pg_constraint.oid) ~*
            'waiting_for_payment.*activated_at IS NULL.*canceled_at IS NULL.*active.*activated_at >= accepted_at.*canceled_at IS NULL.*canceled.*activated_at IS NULL.*canceled_at >= accepted_at.*activated_at >= accepted_at.*canceled_at >= activated_at.*IS TRUE'
      )
      OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE pg_constraint.conrelid = 'public.purchases'::regclass
          AND pg_constraint.conname = 'purchases_snapshot_scalar_consistency'
          AND pg_constraint.contype = 'c'
          AND pg_constraint.convalidated
          AND pg_get_constraintdef(pg_constraint.oid) ~*
            'commercial_snapshot.*version.*subtotalCents.*tax.*amountCents.*totalCents.*currency.*selectedPaymentPlan.*payment_plan_kind'
      )
      OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE pg_constraint.conrelid = 'public.purchases'::regclass
          AND pg_constraint.conname = 'purchases_tax_shape'
          AND pg_constraint.contype = 'c'
          AND pg_constraint.convalidated
          AND pg_get_constraintdef(pg_constraint.oid) ~*
            'ratePct.*BETWEEN 0 AND 100.*tax_free.*tax_cents = 0.*tax_included.*round.*total_cents.*ratePct.*100.*ratePct.*tax_added.*round.*subtotal_cents.*ratePct.*100.*IS TRUE'
      )
      OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE pg_constraint.conrelid = 'public.purchases'::regclass
          AND pg_constraint.conname = 'purchases_discount_shape'
          AND pg_constraint.contype = 'c'
          AND pg_constraint.convalidated
          AND pg_get_constraintdef(pg_constraint.oid) ~*
            'listSubtotalCents.*>= 0.*discountCents.*>= 0.*listSubtotalCents.*subtotal_cents.*discountCents.*IS TRUE'
      )
      OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE pg_constraint.conrelid = 'public.purchases'::regclass
          AND pg_constraint.conname = 'purchases_source_amount_shape'
          AND pg_constraint.contype = 'c'
          AND pg_constraint.convalidated
          AND pg_get_constraintdef(pg_constraint.oid) ~*
            'store_product.*session_product.*paid_add_on.*total_cents > 0.*no_charge_add_on.*total_cents = 0.*private_offer.*IS TRUE'
      )
      OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE pg_constraint.conrelid = 'public.purchases'::regclass
          AND pg_constraint.conname = 'purchases_agreement_text_shape'
          AND pg_constraint.contype = 'c'
          AND pg_constraint.convalidated
          AND pg_get_constraintdef(pg_constraint.oid) ~*
            'jsonb_typeof.*agreementText.*string.*NULLIF.*btrim.*IS TRUE'
      )
      OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE pg_constraint.conrelid = 'public.payment_proofs'::regclass
          AND pg_constraint.conname = 'payment_proofs_status_shape'
          AND pg_constraint.contype = 'c'
          AND pg_constraint.convalidated
          AND pg_get_constraintdef(pg_constraint.oid) ~*
            'pending.*confirmed_at IS NULL.*rejected_at IS NULL.*rejection_note IS NULL.*confirmed.*confirmed_at IS NOT NULL.*rejected.*rejected_at IS NOT NULL.*btrim'
      )
      OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE pg_constraint.conrelid = 'public.purchase_session_allowances'::regclass
          AND pg_constraint.conname = 'purchase_session_allowances_limit_shape'
          AND pg_constraint.contype = 'c'
          AND pg_constraint.convalidated
          AND pg_get_constraintdef(pg_constraint.oid) ~*
            'fixed.*session_limit > 0.*unlimited.*session_limit IS NULL.*IS TRUE'
      )
      OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE pg_constraint.conrelid = 'public.purchase_session_allowances'::regclass
          AND pg_constraint.conname = 'purchase_session_allowances_close_shape'
          AND pg_constraint.contype = 'c'
          AND pg_constraint.convalidated
          AND pg_get_constraintdef(pg_constraint.oid) ~*
            'closed_at IS NULL.*close_reason IS NULL.*closed_at IS NOT NULL.*close_reason IS NOT NULL'
      )
      OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE pg_constraint.conrelid = 'public.payment_proofs'::regclass
          AND pg_constraint.conname = 'payment_proofs_does_not_replace_self'
          AND pg_constraint.contype = 'c'
          AND pg_constraint.convalidated
          AND pg_get_constraintdef(pg_constraint.oid) ~*
            'replaces_proof_id IS NULL.*replaces_proof_id <> id'
      )
      OR EXISTS (
        SELECT 1
        FROM (VALUES
          ('projects', 'projects_producer_lifecycle_idx', $index$CREATE INDEX projects_producer_lifecycle_idx ON public.projects USING btree (producer_id, lifecycle_status, created_at)$index$),
          ('purchase_requests', 'purchase_requests_producer_status_created_idx', $index$CREATE INDEX purchase_requests_producer_status_created_idx ON public.purchase_requests USING btree (producer_id, status, created_at)$index$),
          ('private_offers', 'private_offers_producer_status_expiry_idx', $index$CREATE INDEX private_offers_producer_status_expiry_idx ON public.private_offers USING btree (producer_id, status, expires_at)$index$),
          ('purchases', 'purchases_private_offer_unique', $index$CREATE UNIQUE INDEX purchases_private_offer_unique ON public.purchases USING btree (private_offer_id) WHERE (private_offer_id IS NOT NULL)$index$),
          ('purchases', 'purchases_purchase_request_unique', $index$CREATE UNIQUE INDEX purchases_purchase_request_unique ON public.purchases USING btree (purchase_request_id) WHERE (purchase_request_id IS NOT NULL)$index$),
          ('purchases', 'purchases_project_created_idx', $index$CREATE INDEX purchases_project_created_idx ON public.purchases USING btree (project_id, created_at)$index$),
          ('purchases', 'purchases_client_created_idx', $index$CREATE INDEX purchases_client_created_idx ON public.purchases USING btree (client_contact_id, created_at)$index$),
          ('purchases', 'purchases_producer_lifecycle_idx', $index$CREATE INDEX purchases_producer_lifecycle_idx ON public.purchases USING btree (producer_id, lifecycle_status, created_at)$index$),
          ('purchase_installments', 'purchase_installments_one_activation_required', $index$CREATE UNIQUE INDEX purchase_installments_one_activation_required ON public.purchase_installments USING btree (purchase_id) WHERE (required_for_activation = true)$index$),
          ('purchase_installments', 'purchase_installments_due_status_idx', $index$CREATE INDEX purchase_installments_due_status_idx ON public.purchase_installments USING btree (status, due_at)$index$),
          ('payment_proofs', 'payment_proofs_one_pending_per_installment', $index$CREATE UNIQUE INDEX payment_proofs_one_pending_per_installment ON public.payment_proofs USING btree (installment_id) WHERE (status = 'pending'::payment_proof_status)$index$),
          ('payment_proofs', 'payment_proofs_replaces_proof_unique', $index$CREATE UNIQUE INDEX payment_proofs_replaces_proof_unique ON public.payment_proofs USING btree (replaces_proof_id) WHERE (replaces_proof_id IS NOT NULL)$index$),
          ('payment_proofs', 'payment_proofs_producer_status_created_idx', $index$CREATE INDEX payment_proofs_producer_status_created_idx ON public.payment_proofs USING btree (producer_id, status, created_at)$index$),
          ('purchase_payments', 'purchase_payments_proof_unique', $index$CREATE UNIQUE INDEX purchase_payments_proof_unique ON public.purchase_payments USING btree (proof_id) WHERE (proof_id IS NOT NULL)$index$),
          ('purchase_payments', 'purchase_payments_purchase_paid_idx', $index$CREATE INDEX purchase_payments_purchase_paid_idx ON public.purchase_payments USING btree (purchase_id, paid_at)$index$),
          ('project_tracks', 'project_tracks_purchase_position_idx', $index$CREATE INDEX project_tracks_purchase_position_idx ON public.project_tracks USING btree (purchase_id, "position")$index$),
          ('track_versions', 'track_versions_purchase_uploaded_idx', $index$CREATE INDEX track_versions_purchase_uploaded_idx ON public.track_versions USING btree (purchase_id, uploaded_at)$index$),
          ('bookings', 'bookings_producer_starts_idx', $index$CREATE INDEX bookings_producer_starts_idx ON public.bookings USING btree (producer_id, starts_at)$index$),
          ('bookings', 'bookings_purchase_starts_idx', $index$CREATE INDEX bookings_purchase_starts_idx ON public.bookings USING btree (purchase_id, starts_at)$index$),
          ('purchase_download_override_events', 'purchase_download_overrides_version_created_idx', $index$CREATE INDEX purchase_download_overrides_version_created_idx ON public.purchase_download_override_events USING btree (purchase_id, version_id, created_at)$index$),
          ('version_approval_events', 'version_approval_events_version_created_idx', $index$CREATE INDEX version_approval_events_version_created_idx ON public.version_approval_events USING btree (version_id, created_at)$index$),
          ('notifications', 'notifications_producer_active_idx', $index$CREATE INDEX notifications_producer_active_idx ON public.notifications USING btree (producer_id, archived_at, created_at)$index$)
        ) AS expected_index("table_name", "index_name", "index_definition")
        WHERE NOT EXISTS (
          SELECT 1
          FROM pg_class AS index_relation
          JOIN pg_namespace AS index_namespace
            ON index_namespace.oid = index_relation.relnamespace
          JOIN pg_index ON pg_index.indexrelid = index_relation.oid
          WHERE index_namespace.nspname = 'public'
            AND index_relation.relname = expected_index."index_name"
            AND pg_index.indrelid = to_regclass(format('public.%I', expected_index."table_name"))
            AND pg_index.indisvalid
            AND pg_index.indisready
            AND pg_index.indislive
            AND pg_get_indexdef(index_relation.oid) = expected_index."index_definition"
        )
      )
      OR (
        SELECT md5(COALESCE(string_agg(
          table_relation.relname || '|' || index_relation.relname,
          E'\n' ORDER BY table_relation.relname COLLATE "C", index_relation.relname COLLATE "C"
        ), ''))
        FROM pg_index
        JOIN pg_class AS table_relation
          ON table_relation.oid = pg_index.indrelid
        JOIN pg_namespace AS table_namespace
          ON table_namespace.oid = table_relation.relnamespace
        JOIN pg_class AS index_relation
          ON index_relation.oid = pg_index.indexrelid
        WHERE table_namespace.nspname = 'public'
          AND table_relation.relname = ANY(completed_target_tables)
          AND NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE pg_constraint.conindid = pg_index.indexrelid
          )
      ) IS DISTINCT FROM expected_index_inventory_md5
      OR EXISTS (
        SELECT 1
        FROM (VALUES
          ('bookings', 'bookings_protect_identity', 'protect_booking_identity', 27),
          ('payment_proofs', 'payment_proofs_protect_evidence', 'protect_payment_proof_evidence', 27),
          ('payment_proofs', 'payment_proofs_validate_replacement', 'validate_payment_proof_replacement', 7),
          ('private_offers', 'private_offers_protect_purchase_source', 'protect_private_offer_purchase_source', 19),
          ('project_tracks', 'project_tracks_protect_identity', 'protect_project_track_identity', 27),
          ('projects', 'projects_protect_owner', 'protect_project_owner', 19),
          ('purchase_acceptances', 'purchase_acceptances_append_only', 'prevent_append_only_mutation', 27),
          ('purchase_acceptances', 'purchase_acceptances_validate_schedule', 'validate_purchase_installment_schedule', 5),
          ('purchase_acceptances', 'purchase_acceptances_validate_purchase', 'validate_purchase_acceptance', 7),
          ('purchase_cancellations', 'purchase_cancellations_append_only', 'prevent_append_only_mutation', 27),
          ('purchase_download_override_events', 'purchase_download_overrides_append_only', 'prevent_append_only_mutation', 27),
          ('purchase_installments', 'purchase_installments_require_paid_purchase', 'require_paid_purchase_for_installment', 23),
          ('purchase_installments', 'purchase_installments_reject_accepted_append', 'reject_purchase_installment_after_acceptance', 7),
          ('purchase_installments', 'purchase_installments_protect_terms', 'protect_purchase_installment_terms', 27),
          ('purchase_installments', 'purchase_installments_validate_schedule', 'validate_purchase_installment_schedule', 29),
          ('purchase_payment_corrections', 'purchase_payment_corrections_append_only', 'prevent_append_only_mutation', 27),
          ('purchase_payments', 'purchase_payments_append_only', 'prevent_append_only_mutation', 27),
          ('purchase_requests', 'purchase_requests_protect_identity', 'protect_purchase_request_identity', 27),
          ('purchase_session_allowances', 'purchase_session_allowances_protect_terms', 'protect_session_allowance_terms', 27),
          ('purchase_waivers', 'purchase_waivers_append_only', 'prevent_append_only_mutation', 27),
          ('purchases', 'purchases_protect_commercial_snapshot', 'protect_purchase_commercial_snapshot', 27),
          ('purchases', 'purchases_validate_installment_schedule', 'validate_purchase_installment_schedule', 21),
          ('purchases', 'purchases_validate_source_links', 'validate_purchase_source_links', 7),
          ('track_versions', 'track_versions_protect_identity', 'protect_track_version_identity', 27),
          ('version_approval_events', 'version_approval_events_append_only', 'prevent_append_only_mutation', 27)
        ) AS expected_trigger("table_name", "trigger_name", "function_name", "trigger_type")
        WHERE NOT EXISTS (
          SELECT 1
          FROM pg_trigger
          WHERE tgrelid = to_regclass(format('public.%I', expected_trigger."table_name"))
            AND tgname = expected_trigger."trigger_name"
            AND tgfoid = to_regprocedure(format('public.%I()', expected_trigger."function_name"))
            AND tgtype = expected_trigger."trigger_type"::smallint
            AND tgdeferrable = (expected_trigger."trigger_name" IN (
              'purchase_acceptances_validate_schedule',
              'purchase_installments_validate_schedule',
              'purchases_validate_installment_schedule'
            ))
            AND tginitdeferred = (expected_trigger."trigger_name" IN (
              'purchase_acceptances_validate_schedule',
              'purchase_installments_validate_schedule',
              'purchases_validate_installment_schedule'
            ))
            AND tgenabled = 'O'
            AND tgnargs = 0
            AND tgqual IS NULL
            AND NOT tgisinternal
        )
      )
      OR (
        SELECT md5(COALESCE(string_agg(
          table_relation.relname || '|' || pg_trigger.tgname,
          E'\n' ORDER BY table_relation.relname COLLATE "C", pg_trigger.tgname COLLATE "C"
        ), ''))
        FROM pg_trigger
        JOIN pg_class AS table_relation
          ON table_relation.oid = pg_trigger.tgrelid
        JOIN pg_namespace AS table_namespace
          ON table_namespace.oid = table_relation.relnamespace
        WHERE table_namespace.nspname = 'public'
          AND table_relation.relname = ANY(completed_target_tables)
          AND NOT pg_trigger.tgisinternal
      ) IS DISTINCT FROM expected_trigger_inventory_md5
      OR EXISTS (
        SELECT 1
        FROM (VALUES
          ('prevent_append_only_mutation', '02474ebe9014c9c5269a35b4469682f6'),
          ('protect_booking_identity', '8498d7cda4fe7a29f840345c30a8010a'),
          ('protect_payment_proof_evidence', 'c7e286561222ef12eba553e6d7e3b116'),
          ('protect_private_offer_purchase_source', 'ab13bf7cbe91e5e76db73ec513814ddc'),
          ('protect_project_owner', 'c7729cbb8db585a71aa89d1f3ae3b64f'),
          ('protect_project_track_identity', '63748c02d4b51786ce82562dc10722c9'),
          ('protect_purchase_commercial_snapshot', '0d9fd8f3ff1c643d91b1092bac140c02'),
          ('protect_purchase_installment_terms', '341c644a414feac808128eea37ab6ec4'),
          ('protect_purchase_request_identity', 'efbf0f57f651250ae146b7d8ebf08411'),
          ('protect_session_allowance_terms', '358913a6c660186afa4c8f6e0ab28801'),
          ('protect_track_version_identity', 'e2e240ba419d12205262e9f5be4312f6'),
          ('reject_purchase_installment_after_acceptance', '6037c951f14674e68549cb1767701900'),
          ('require_paid_purchase_for_installment', '0d9c828272b00c7c84a6fbbc4529a8d7'),
          ('validate_payment_proof_replacement', '68327e8a4bcd272dced1d6f699c86906'),
          ('validate_purchase_acceptance', '47dd9978bf907048cccf402970622fa1'),
          ('validate_purchase_installment_schedule', '5f659194a7d2eea990d5119f82d6a068'),
          ('validate_purchase_source_links', '94773cd441ff66fb4e5c3f676d0dacde')
        ) AS expected_function("function_name", "source_md5")
        WHERE NOT EXISTS (
          SELECT 1
          FROM pg_proc
          JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
          JOIN pg_language ON pg_language.oid = pg_proc.prolang
          WHERE pg_namespace.nspname = 'public'
            AND pg_proc.proname = expected_function."function_name"
            AND pg_proc.prokind = 'f'
            AND pg_proc.pronargs = 0
            AND pg_proc.prorettype = 'trigger'::regtype
            AND pg_language.lanname = 'plpgsql'
            AND NOT pg_proc.prosecdef
            AND pg_proc.provolatile = 'v'
            AND pg_proc.proconfig IS NULL
            AND md5(pg_proc.prosrc) = expected_function."source_md5"
        )
      )
      OR (
        SELECT md5(COALESCE(string_agg(
          pg_proc.proname,
          E'\n' ORDER BY pg_proc.proname COLLATE "C"
        ), ''))
        FROM pg_proc
        JOIN pg_namespace
          ON pg_namespace.oid = pg_proc.pronamespace
        WHERE pg_namespace.nspname = 'public'
          AND pg_proc.pronargs = 0
          AND pg_proc.prorettype = 'trigger'::regtype
      ) IS DISTINCT FROM expected_function_inventory_md5
      OR EXISTS (
        SELECT 1
        FROM (VALUES
          ('booking_status', 'pending_approval,confirmed,rejected,cancelled,completed,no_show'),
          ('notification_kind', 'comment_created,booking_requested,track_approved,purchase_requested,purchase_approved,purchase_declined,agreement_accepted,proof_submitted'),
          ('payment_proof_status', 'pending,confirmed,rejected'),
          ('private_offer_status', 'draft,sent,accepted,declined,expired,canceled'),
          ('project_lifecycle_status', 'waiting_for_payment,active,paused,completed,canceled'),
          ('purchase_installment_due_trigger', 'acceptance,monthly_anniversary,artist_approval'),
          ('purchase_installment_status', 'not_paid,awaiting_review,partially_paid,confirmed,overdue,waived,canceled'),
          ('purchase_lifecycle_status', 'waiting_for_payment,active,canceled'),
          ('purchase_payment_plan_kind', 'full,split_50_50,monthly'),
          ('purchase_payment_source', 'proof,manual'),
          ('purchase_request_status', 'pending,approved,declined,canceled,converted'),
          ('purchase_source_kind', 'store_product,private_offer,session_product,paid_add_on,no_charge_add_on'),
          ('session_allowance_close_reason', 'project_completed,project_canceled,purchase_canceled'),
          ('session_allowance_kind', 'fixed,unlimited'),
          ('session_use_outcome', 'reserved,completed,cancelled_on_time,cancelled_by_producer,cancelled_late,no_show'),
          ('version_approval_action', 'approved,revoked'),
          ('workflow_stage', 'brief,production,mixing,mastering,done')
        ) AS expected_enum("type_name", "labels")
        WHERE (
          SELECT string_agg(pg_enum.enumlabel, ',' ORDER BY pg_enum.enumsortorder)
          FROM pg_enum
          JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
          JOIN pg_namespace ON pg_namespace.oid = pg_type.typnamespace
          WHERE pg_namespace.nspname = 'public'
            AND pg_type.typname = expected_enum."type_name"
        ) IS DISTINCT FROM expected_enum."labels"
      )
      OR EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'producers'
          AND column_name IN ('stripe_account_id', 'stripe_charges_enabled', 'tranzila_terminal_name')
      )
      OR EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'products'
          AND column_name IN ('deposit_pct', 'deposit_model', 'milestones')
      )
      OR to_regtype('public.invoice_status') IS NOT NULL
      OR to_regtype('public.project_stage') IS NOT NULL
      OR to_regprocedure('public.freeze_purchase_request_session_count()') IS NOT NULL
    THEN
      RAISE EXCEPTION 'SKITZA_0027_TARGET_SCHEMA_DRIFT';
    END IF;
    RETURN;
  END IF;

  -- The migration is valid only against the reviewed pre-reset schema.
  -- Lock every reset or preserved table before observing its fingerprint so
  -- no concurrent DDL can race the exact source-contract gate below.
  FOREACH reset_table IN ARRAY reviewed_source_tables
  LOOP
    IF to_regclass(format('public.%I', reset_table)) IS NULL THEN
      RAISE EXCEPTION 'SKITZA_0027_SOURCE_SCHEMA_DRIFT';
    END IF;
    EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', reset_table);
  END LOOP;

  -- Exact reviewed source columns. The contract is sorted by column name so
  -- it is independent of historical ADD COLUMN order while still binding the
  -- complete name/type/nullability/default surface for all fifteen tables.
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('agreement_acceptances', 'accepted_at:pg_catalog.timestamptz:NO:now(),accepted_by_clerk_user_id:pg_catalog.text:NO:<none>,agreement_url:pg_catalog.text:YES:<none>,client_contact_id:pg_catalog.uuid:NO:<none>,created_at:pg_catalog.timestamptz:NO:now(),id:pg_catalog.uuid:NO:gen_random_uuid(),producer_id:pg_catalog.uuid:NO:<none>,purchase_request_id:pg_catalog.uuid:NO:<none>'),
      ('bookings', 'artist_email:pg_catalog.text:NO:<none>,artist_name:pg_catalog.text:NO:<none>,artist_phone:pg_catalog.text:YES:<none>,created_at:pg_catalog.timestamptz:NO:now(),duration_min:pg_catalog.int4:NO:<none>,id:pg_catalog.uuid:NO:gen_random_uuid(),notes:pg_catalog.text:YES:<none>,package_name_snapshot:pg_catalog.text:YES:<none>,producer_acknowledged_at:pg_catalog.timestamptz:YES:<none>,producer_id:pg_catalog.uuid:NO:<none>,product_id:pg_catalog.uuid:YES:<none>,project_id:pg_catalog.uuid:YES:<none>,reminder_sent_1h:pg_catalog.timestamptz:YES:<none>,reminder_sent_24h:pg_catalog.timestamptz:YES:<none>,song_id:pg_catalog.uuid:YES:<none>,song_qty:pg_catalog.int4:YES:<none>,starts_at:pg_catalog.timestamptz:NO:<none>,status:public.booking_status:NO:pending_approval,status_changed_at:pg_catalog.timestamptz:YES:<none>,stripe_checkout_session_id:pg_catalog.text:YES:<none>,tranzila_confirmation_code:pg_catalog.text:YES:<none>,unit_price_cents:pg_catalog.int4:YES:<none>'),
      ('client_contacts', 'archived_at:pg_catalog.timestamptz:YES:<none>,clerk_user_id:pg_catalog.text:YES:<none>,email:pg_catalog.text:NO:<none>,email_hash:pg_catalog.text:NO:<none>,first_seen_at:pg_catalog.timestamptz:NO:now(),id:pg_catalog.uuid:NO:gen_random_uuid(),invited_at:pg_catalog.timestamptz:YES:<none>,last_seen_at:pg_catalog.timestamptz:NO:now(),name:pg_catalog.text:NO:<none>,notes:pg_catalog.text:YES:<none>,phone:pg_catalog.text:YES:<none>,position:pg_catalog.int4:NO:0,producer_id:pg_catalog.uuid:NO:<none>,referral_source:pg_catalog.text:YES:<none>,tags:pg_catalog._text:NO:{}'),
      ('invoices', 'amount_cents:pg_catalog.int4:NO:<none>,booking_id:pg_catalog.uuid:YES:<none>,created_at:pg_catalog.timestamptz:NO:now(),currency:pg_catalog.text:NO:<none>,customer_email:pg_catalog.text:YES:<none>,customer_name:pg_catalog.text:YES:<none>,description:pg_catalog.text:YES:<none>,id:pg_catalog.uuid:NO:gen_random_uuid(),kind:pg_catalog.text:NO:<none>,paid_at:pg_catalog.timestamptz:YES:<none>,payment_plan_project_id:pg_catalog.uuid:YES:<none>,payment_proof_id:pg_catalog.uuid:YES:<none>,producer_id:pg_catalog.uuid:NO:<none>,project_id:pg_catalog.uuid:YES:<none>,proof_file_url:pg_catalog.text:YES:<none>,proof_note:pg_catalog.text:YES:<none>,purchase_request_id:pg_catalog.uuid:YES:<none>,rejection_note:pg_catalog.text:YES:<none>,reminder_sent_at:pg_catalog.timestamptz:YES:<none>,status:public.invoice_status:NO:draft,stripe_checkout_session_id:pg_catalog.text:YES:<none>,stripe_payment_intent_id:pg_catalog.text:YES:<none>'),
      ('notifications', 'archived_at:pg_catalog.timestamptz:YES:<none>,body:pg_catalog.text:NO:,booking_id:pg_catalog.uuid:YES:<none>,comment_id:pg_catalog.uuid:YES:<none>,created_at:pg_catalog.timestamptz:NO:now(),id:pg_catalog.uuid:NO:gen_random_uuid(),kind:public.notification_kind:NO:<none>,producer_id:pg_catalog.uuid:NO:<none>,project_id:pg_catalog.uuid:YES:<none>,purchase_request_id:pg_catalog.uuid:YES:<none>,read_at:pg_catalog.timestamptz:YES:<none>,title:pg_catalog.text:NO:<none>,track_version_id:pg_catalog.uuid:YES:<none>'),
      ('payment_proofs', 'amount_cents:pg_catalog.int4:NO:<none>,confirmed_at:pg_catalog.timestamptz:YES:<none>,content_type:pg_catalog.text:NO:<none>,created_at:pg_catalog.timestamptz:NO:now(),currency:pg_catalog.text:NO:<none>,id:pg_catalog.uuid:NO:gen_random_uuid(),kind:pg_catalog.text:NO:<none>,note:pg_catalog.text:YES:<none>,object_etag:pg_catalog.text:YES:<none>,original_file_name:pg_catalog.text:YES:<none>,producer_id:pg_catalog.uuid:NO:<none>,project_id:pg_catalog.uuid:YES:<none>,purchase_request_id:pg_catalog.uuid:NO:<none>,rejected_at:pg_catalog.timestamptz:YES:<none>,rejection_note:pg_catalog.text:YES:<none>,size_bytes:pg_catalog.int4:NO:<none>,status:public.payment_proof_status:NO:pending,storage_bucket:pg_catalog.text:NO:docs,storage_key:pg_catalog.text:NO:<none>'),
      ('producers', 'auto_confirm_bookings:pg_catalog.bool:NO:false,autopilot_auto_archive:pg_catalog.bool:NO:false,autopilot_comment_notify:pg_catalog.bool:NO:true,autopilot_request_testimonial:pg_catalog.bool:NO:false,autopilot_unpaid_reminder:pg_catalog.bool:NO:false,autopilot_welcome_email:pg_catalog.bool:NO:false,brand:pg_catalog.jsonb:YES:{},cancellation_policy_hours:pg_catalog.int4:NO:24,clerk_user_id:pg_catalog.text:NO:<none>,created_at:pg_catalog.timestamptz:NO:now(),default_currency:pg_catalog.text:NO:USD,default_session_min:pg_catalog.int4:NO:60,display_name:pg_catalog.text:YES:<none>,email:pg_catalog.text:NO:<none>,genres:pg_catalog._text:YES:<none>,id:pg_catalog.uuid:NO:gen_random_uuid(),notification_prefs:pg_catalog.jsonb:NO:{},payment_details:pg_catalog.jsonb:NO:{},plan:pg_catalog.text:NO:free,released_summary:pg_catalog.text:YES:<none>,response_hours:pg_catalog.int4:YES:<none>,service_roles:pg_catalog._text:YES:{},slug:pg_catalog.text:NO:<none>,streams_summary:pg_catalog.text:YES:<none>,stripe_account_id:pg_catalog.text:YES:<none>,stripe_charges_enabled:pg_catalog.bool:NO:false,tax_mode:pg_catalog.text:NO:tax_free,tax_rate_pct:pg_catalog.int4:NO:18,timezone:pg_catalog.text:NO:UTC,tranzila_terminal_name:pg_catalog.text:YES:<none>,updated_at:pg_catalog.timestamptz:NO:now(),week_start:pg_catalog.text:NO:sunday'),
      ('products', 'active:pg_catalog.bool:NO:true,agreement_text:pg_catalog.text:YES:<none>,archived_at:pg_catalog.timestamptz:YES:<none>,buffer_minutes:pg_catalog.int4:NO:0,contract_url:pg_catalog.text:YES:<none>,created_at:pg_catalog.timestamptz:NO:now(),currency:pg_catalog.text:NO:USD,deliverables:pg_catalog._text:YES:<none>,deposit_model:pg_catalog.text:NO:flat,deposit_pct:pg_catalog.int4:NO:0,description:pg_catalog.text:YES:<none>,duration_min:pg_catalog.int4:NO:<none>,hourly_rate_cents:pg_catalog.int4:YES:<none>,id:pg_catalog.uuid:NO:gen_random_uuid(),kind:pg_catalog.text:NO:session,location_type:pg_catalog.text:NO:studio,milestones:pg_catalog.jsonb:YES:<none>,min_lead_hours:pg_catalog.int4:NO:12,name:pg_catalog.text:NO:<none>,payment_plans:pg_catalog.jsonb:NO:[{"kind":"full"}],position:pg_catalog.int4:NO:0,price_cents:pg_catalog.int4:NO:0,pricing_model:pg_catalog.text:NO:flat,producer_id:pg_catalog.uuid:NO:<none>,royalty_terms:pg_catalog.jsonb:YES:<none>,session_count:pg_catalog.int4:NO:1,volume_tiers:pg_catalog.jsonb:YES:<none>'),
      ('project_tracks', 'artist:pg_catalog.text:YES:<none>,created_at:pg_catalog.timestamptz:NO:now(),id:pg_catalog.uuid:NO:gen_random_uuid(),position:pg_catalog.int4:NO:0,project_id:pg_catalog.uuid:NO:<none>,title:pg_catalog.text:NO:<none>,workflow_stage:public.workflow_stage:NO:brief'),
      ('projects', 'artist_email:pg_catalog.text:NO:<none>,artist_name:pg_catalog.text:NO:<none>,booking_id:pg_catalog.uuid:YES:<none>,charges_completed:pg_catalog.int4:NO:0,charges_total:pg_catalog.int4:YES:<none>,client_email:pg_catalog.text:YES:<none>,client_name:pg_catalog.text:YES:<none>,created_at:pg_catalog.timestamptz:NO:now(),currency:pg_catalog.text:YES:<none>,deadline_at:pg_catalog.timestamptz:YES:<none>,deposit_cents:pg_catalog.int4:YES:<none>,deposit_paid:pg_catalog.bool:NO:false,engagement_total_cents:pg_catalog.int4:YES:<none>,final_paid:pg_catalog.bool:NO:false,id:pg_catalog.uuid:NO:gen_random_uuid(),installments:pg_catalog.int4:YES:<none>,invite_token:pg_catalog.text:YES:<none>,next_charge_at:pg_catalog.timestamptz:YES:<none>,notes:pg_catalog.text:YES:<none>,paid_at:pg_catalog.timestamptz:YES:<none>,payment_plan_kind:pg_catalog.text:YES:<none>,position:pg_catalog.int4:NO:0,producer_id:pg_catalog.uuid:NO:<none>,product_id:pg_catalog.uuid:YES:<none>,session_count:pg_catalog.int4:YES:1,song_qty:pg_catalog.int4:YES:<none>,stage:public.project_stage:NO:lead,stripe_customer_id:pg_catalog.text:YES:<none>,stripe_payment_method_id:pg_catalog.text:YES:<none>,stripe_subscription_schedule_id:pg_catalog.text:YES:<none>,testimonial_requested_at:pg_catalog.timestamptz:YES:<none>,title:pg_catalog.text:NO:<none>,total_amount_cents:pg_catalog.int4:YES:<none>,unit_price_cents:pg_catalog.int4:YES:<none>,updated_at:pg_catalog.timestamptz:NO:now(),workflow_stage:public.workflow_stage:NO:brief'),
      ('purchase_requests', 'agreement_text_snapshot:pg_catalog.text:YES:<none>,approved_at:pg_catalog.timestamptz:YES:<none>,artist_email:pg_catalog.text:NO:<none>,artist_name:pg_catalog.text:NO:<none>,booking_id:pg_catalog.uuid:YES:<none>,client_contact_id:pg_catalog.uuid:NO:<none>,contract_url_snapshot:pg_catalog.text:YES:<none>,created_at:pg_catalog.timestamptz:NO:now(),currency:pg_catalog.text:NO:<none>,declined_at:pg_catalog.timestamptz:YES:<none>,id:pg_catalog.uuid:NO:gen_random_uuid(),payment_plan_chosen_at:pg_catalog.timestamptz:YES:<none>,payment_plan_options_snapshot:pg_catalog.jsonb:YES:<none>,payment_plan_snapshot:pg_catalog.jsonb:NO:<none>,price_cents:pg_catalog.int4:NO:<none>,producer_id:pg_catalog.uuid:NO:<none>,product_id:pg_catalog.uuid:YES:<none>,product_name_snapshot:pg_catalog.text:NO:<none>,project_id:pg_catalog.uuid:YES:<none>,ref_number:pg_catalog.text:NO:<none>,royalty_terms_snapshot:pg_catalog.jsonb:YES:<none>,session_count_snapshot:pg_catalog.int4:YES:<none>,song_qty:pg_catalog.int4:YES:<none>,status:public.purchase_request_status:NO:pending,status_changed_at:pg_catalog.timestamptz:YES:<none>,unit_price_cents:pg_catalog.int4:YES:<none>'),
      ('store_purchase_intents', 'amount_cents:pg_catalog.int4:NO:<none>,artist_email:pg_catalog.text:NO:<none>,artist_name:pg_catalog.text:NO:<none>,artist_user_id:pg_catalog.text:YES:<none>,consumed_at:pg_catalog.timestamptz:YES:<none>,created_at:pg_catalog.timestamptz:NO:now(),currency:pg_catalog.text:NO:USD,id:pg_catalog.uuid:NO:gen_random_uuid(),package_name_snapshot:pg_catalog.text:NO:<none>,payment_plan_kind:pg_catalog.text:YES:<none>,producer_id:pg_catalog.uuid:NO:<none>,product_id:pg_catalog.uuid:NO:<none>,session_count:pg_catalog.int4:NO:<none>,song_qty:pg_catalog.int4:YES:<none>,unit_price_cents:pg_catalog.int4:YES:<none>'),
      ('stripe_customers', 'client_contact_id:pg_catalog.uuid:NO:<none>,created_at:pg_catalog.timestamptz:NO:now(),producer_id:pg_catalog.uuid:NO:<none>,stripe_customer_id:pg_catalog.text:NO:<none>'),
      ('track_comments', 'author_email:pg_catalog.text:NO:<none>,author_name:pg_catalog.text:NO:<none>,body:pg_catalog.text:NO:<none>,created_at:pg_catalog.timestamptz:NO:now(),from_producer:pg_catalog.bool:NO:false,id:pg_catalog.uuid:NO:gen_random_uuid(),resolved_at:pg_catalog.timestamptz:YES:<none>,timestamp_ms:pg_catalog.int4:NO:<none>,version_id:pg_catalog.uuid:NO:<none>'),
      ('track_versions', 'approved_at:pg_catalog.timestamptz:YES:<none>,audio_r2_key:pg_catalog.text:YES:<none>,audio_url:pg_catalog.text:YES:<none>,description:pg_catalog.text:YES:<none>,duration_ms:pg_catalog.int4:YES:<none>,id:pg_catalog.uuid:NO:gen_random_uuid(),label:pg_catalog.text:NO:<none>,peaks:pg_catalog.jsonb:YES:<none>,peaks_r2_key:pg_catalog.text:YES:<none>,size_bytes:pg_catalog.int8:YES:<none>,track_id:pg_catalog.uuid:NO:<none>,uploaded_at:pg_catalog.timestamptz:NO:now()')
    ) AS expected_source_columns("table_name", "column_contract")
    WHERE (
      SELECT string_agg(
        column_name || ':' || udt_schema || '.' || udt_name || ':' || is_nullable || ':' ||
          COALESCE(
            CASE
              WHEN column_default ~ '^''[^'']*''::' THEN
                regexp_replace(column_default, '^''([^'']*)''::.*$', '\1')
              ELSE column_default
            END,
            '<none>'
          ),
        ',' ORDER BY column_name COLLATE "C"
      )
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = expected_source_columns."table_name"
    ) IS DISTINCT FROM expected_source_columns."column_contract"
  ) THEN
    RAISE EXCEPTION 'SKITZA_0027_SOURCE_SCHEMA_DRIFT';
  END IF;

  -- These two preexisting enums survive the reset and are reused by the new
  -- tables. Bind their ordered labels on both sides of the cutover.
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('notification_kind', 'comment_created,booking_requested,track_approved,purchase_requested,purchase_approved,purchase_declined,agreement_accepted,proof_submitted'),
      ('workflow_stage', 'brief,production,mixing,mastering,done')
    ) AS expected_source_enum("type_name", "labels")
    WHERE (
      SELECT string_agg(pg_enum.enumlabel, ',' ORDER BY pg_enum.enumsortorder)
      FROM pg_enum
      JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
      JOIN pg_namespace ON pg_namespace.oid = pg_type.typnamespace
      WHERE pg_namespace.nspname = 'public'
        AND pg_type.typname = expected_source_enum."type_name"
    ) IS DISTINCT FROM expected_source_enum."labels"
  ) THEN
    RAISE EXCEPTION 'SKITZA_0027_SOURCE_SCHEMA_DRIFT';
  END IF;

  -- The only source trigger function removed by this migration must be the
  -- reviewed zero-argument PL/pgSQL function, not a same-named lookalike.
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('freeze_purchase_request_session_count', '6e652d5b9ab618aa5d7ceec0b252e9bd')
    ) AS expected_source_function("function_name", "source_md5")
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_proc
      JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
      JOIN pg_language ON pg_language.oid = pg_proc.prolang
      WHERE pg_namespace.nspname = 'public'
        AND pg_proc.proname = expected_source_function."function_name"
        AND pg_proc.prokind = 'f'
        AND pg_proc.pronargs = 0
        AND pg_proc.pronargdefaults = 0
        AND pg_proc.proargtypes = ''::oidvector
        AND pg_proc.proallargtypes IS NULL
        AND pg_proc.proargmodes IS NULL
        AND pg_proc.proargnames IS NULL
        AND pg_proc.proargdefaults IS NULL
        AND pg_proc.prorettype = 'trigger'::regtype
        AND NOT pg_proc.proretset
        AND NOT pg_proc.proisstrict
        AND NOT pg_proc.prosecdef
        AND NOT pg_proc.proleakproof
        AND pg_proc.provolatile = 'v'
        AND pg_proc.proparallel = 'u'
        AND pg_proc.proconfig IS NULL
        AND pg_language.lanname = 'plpgsql'
        AND md5(pg_proc.prosrc) = expected_source_function."source_md5"
    )
  ) THEN
    RAISE EXCEPTION 'SKITZA_0027_SOURCE_SCHEMA_DRIFT';
  END IF;

  -- Build the reviewed constraints on empty temporary copies. PostgreSQL
  -- deparses both sides with the target server version, so the comparison
  -- below binds full pg_get_constraintdef semantics without a version-fragile
  -- hand-written rendering. Foreign keys point only to temporary reference
  -- tables, avoiding even transient constraint-trigger changes on preserved
  -- public relations. The source tables remain untouched.
  CREATE TEMP TABLE "skitza_0027_source_reference_bookings"
    ("id" uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE "skitza_0027_source_reference_client_contacts"
    ("id" uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE "skitza_0027_source_reference_payment_proofs"
    ("id" uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE "skitza_0027_source_reference_producers"
    ("id" uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE "skitza_0027_source_reference_products"
    ("id" uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE "skitza_0027_source_reference_project_tracks"
    ("id" uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE "skitza_0027_source_reference_projects"
    ("id" uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE "skitza_0027_source_reference_purchase_requests"
    ("id" uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE "skitza_0027_source_reference_track_comments"
    ("id" uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE "skitza_0027_source_reference_track_versions"
    ("id" uuid PRIMARY KEY) ON COMMIT DROP;

  -- SKITZA_0027_EXPECTED_SOURCE_CONSTRAINTS_BEGIN
  CREATE TEMP TABLE "skitza_0027_source_expected_agreement_acceptances"
    (LIKE "public"."agreement_acceptances") ON COMMIT DROP;
  ALTER TABLE "skitza_0027_source_expected_agreement_acceptances"
    ADD CONSTRAINT "agreement_acceptances_pkey" PRIMARY KEY ("id"),
    ADD CONSTRAINT "agreement_acceptances_purchase_request_id_fkey"
      FOREIGN KEY ("purchase_request_id")
        REFERENCES "skitza_0027_source_reference_purchase_requests"("id")
      ON DELETE CASCADE,
    ADD CONSTRAINT "agreement_acceptances_producer_id_fkey"
      FOREIGN KEY ("producer_id") REFERENCES "skitza_0027_source_reference_producers"("id")
      ON DELETE CASCADE,
    ADD CONSTRAINT "agreement_acceptances_client_contact_id_fkey"
      FOREIGN KEY ("client_contact_id")
        REFERENCES "skitza_0027_source_reference_client_contacts"("id")
      ON DELETE CASCADE;

  CREATE TEMP TABLE "skitza_0027_source_expected_bookings"
    (LIKE "public"."bookings") ON COMMIT DROP;
  ALTER TABLE "skitza_0027_source_expected_bookings"
    ADD CONSTRAINT "bookings_pkey" PRIMARY KEY ("id"),
    ADD CONSTRAINT "bookings_producer_id_producers_id_fk"
      FOREIGN KEY ("producer_id") REFERENCES "skitza_0027_source_reference_producers"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION,
    ADD CONSTRAINT "bookings_product_id_products_id_fk"
      FOREIGN KEY ("product_id") REFERENCES "skitza_0027_source_reference_products"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION,
    ADD CONSTRAINT "bookings_project_id_projects_id_fk"
      FOREIGN KEY ("project_id") REFERENCES "skitza_0027_source_reference_projects"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION,
    ADD CONSTRAINT "bookings_song_id_fkey"
      FOREIGN KEY ("song_id")
        REFERENCES "skitza_0027_source_reference_project_tracks"("id")
      ON DELETE SET NULL;

  CREATE TEMP TABLE "skitza_0027_source_expected_client_contacts"
    (LIKE "public"."client_contacts") ON COMMIT DROP;
  ALTER TABLE "skitza_0027_source_expected_client_contacts"
    ADD CONSTRAINT "client_contacts_pkey" PRIMARY KEY ("id"),
    ADD CONSTRAINT "client_contacts_producer_email_unique"
      UNIQUE ("producer_id", "email_hash"),
    ADD CONSTRAINT "client_contacts_producer_id_producers_id_fk"
      FOREIGN KEY ("producer_id") REFERENCES "skitza_0027_source_reference_producers"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;

  CREATE TEMP TABLE "skitza_0027_source_expected_invoices"
    (LIKE "public"."invoices") ON COMMIT DROP;
  ALTER TABLE "skitza_0027_source_expected_invoices"
    ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("id"),
    ADD CONSTRAINT "invoices_producer_id_producers_id_fk"
      FOREIGN KEY ("producer_id") REFERENCES "skitza_0027_source_reference_producers"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION,
    ADD CONSTRAINT "invoices_project_id_projects_id_fk"
      FOREIGN KEY ("project_id") REFERENCES "skitza_0027_source_reference_projects"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION,
    ADD CONSTRAINT "invoices_booking_id_bookings_id_fk"
      FOREIGN KEY ("booking_id") REFERENCES "skitza_0027_source_reference_bookings"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION,
    ADD CONSTRAINT "invoices_payment_plan_project_id_projects_id_fk"
      FOREIGN KEY ("payment_plan_project_id")
        REFERENCES "skitza_0027_source_reference_projects"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION,
    ADD CONSTRAINT "invoices_purchase_request_id_fkey"
      FOREIGN KEY ("purchase_request_id")
        REFERENCES "skitza_0027_source_reference_purchase_requests"("id")
      ON DELETE SET NULL,
    ADD CONSTRAINT "invoices_legacy_purchase_proof_disabled"
      CHECK ("purchase_request_id" IS NULL OR "proof_file_url" IS NULL),
    ADD CONSTRAINT "invoices_payment_proof_id_payment_proofs_id_fk"
      FOREIGN KEY ("payment_proof_id")
        REFERENCES "skitza_0027_source_reference_payment_proofs"("id")
      ON DELETE SET NULL;

  CREATE TEMP TABLE "skitza_0027_source_expected_notifications"
    (LIKE "public"."notifications") ON COMMIT DROP;
  ALTER TABLE "skitza_0027_source_expected_notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
    ADD CONSTRAINT "notifications_producer_id_producers_id_fk"
      FOREIGN KEY ("producer_id") REFERENCES "skitza_0027_source_reference_producers"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION,
    ADD CONSTRAINT "notifications_project_id_projects_id_fk"
      FOREIGN KEY ("project_id") REFERENCES "skitza_0027_source_reference_projects"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION,
    ADD CONSTRAINT "notifications_track_version_id_track_versions_id_fk"
      FOREIGN KEY ("track_version_id")
        REFERENCES "skitza_0027_source_reference_track_versions"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION,
    ADD CONSTRAINT "notifications_comment_id_track_comments_id_fk"
      FOREIGN KEY ("comment_id")
        REFERENCES "skitza_0027_source_reference_track_comments"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION,
    ADD CONSTRAINT "notifications_booking_id_bookings_id_fk"
      FOREIGN KEY ("booking_id") REFERENCES "skitza_0027_source_reference_bookings"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION,
    ADD CONSTRAINT "notifications_purchase_request_id_fkey"
      FOREIGN KEY ("purchase_request_id")
        REFERENCES "skitza_0027_source_reference_purchase_requests"("id")
      ON DELETE CASCADE;

  CREATE TEMP TABLE "skitza_0027_source_expected_payment_proofs"
    (LIKE "public"."payment_proofs") ON COMMIT DROP;
  ALTER TABLE "skitza_0027_source_expected_payment_proofs"
    ADD CONSTRAINT "payment_proofs_pkey" PRIMARY KEY ("id"),
    ADD CONSTRAINT "payment_proofs_purchase_request_id_fkey"
      FOREIGN KEY ("purchase_request_id")
        REFERENCES "skitza_0027_source_reference_purchase_requests"("id")
      ON DELETE CASCADE,
    ADD CONSTRAINT "payment_proofs_producer_id_fkey"
      FOREIGN KEY ("producer_id") REFERENCES "skitza_0027_source_reference_producers"("id")
      ON DELETE CASCADE,
    ADD CONSTRAINT "payment_proofs_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "skitza_0027_source_reference_projects"("id")
      ON DELETE SET NULL,
    ADD CONSTRAINT "payment_proofs_amount_cents_check" CHECK ("amount_cents" > 0),
    ADD CONSTRAINT "payment_proofs_size_bytes_check" CHECK ("size_bytes" >= 0),
    ADD CONSTRAINT "payment_proofs_private_docs_bucket_only"
      CHECK ("storage_bucket" = 'docs');

  CREATE TEMP TABLE "skitza_0027_source_expected_producers"
    (LIKE "public"."producers") ON COMMIT DROP;
  ALTER TABLE "skitza_0027_source_expected_producers"
    ADD CONSTRAINT "producers_pkey" PRIMARY KEY ("id"),
    ADD CONSTRAINT "producers_clerk_user_id_unique" UNIQUE ("clerk_user_id"),
    ADD CONSTRAINT "producers_slug_unique" UNIQUE ("slug");

  CREATE TEMP TABLE "skitza_0027_source_expected_products"
    (LIKE "public"."products") ON COMMIT DROP;
  ALTER TABLE "skitza_0027_source_expected_products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id"),
    ADD CONSTRAINT "products_producer_id_producers_id_fk"
      FOREIGN KEY ("producer_id") REFERENCES "skitza_0027_source_reference_producers"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;

  CREATE TEMP TABLE "skitza_0027_source_expected_project_tracks"
    (LIKE "public"."project_tracks") ON COMMIT DROP;
  ALTER TABLE "skitza_0027_source_expected_project_tracks"
    ADD CONSTRAINT "project_tracks_pkey" PRIMARY KEY ("id"),
    ADD CONSTRAINT "project_tracks_project_id_projects_id_fk"
      FOREIGN KEY ("project_id") REFERENCES "skitza_0027_source_reference_projects"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;

  CREATE TEMP TABLE "skitza_0027_source_expected_projects"
    (LIKE "public"."projects") ON COMMIT DROP;
  ALTER TABLE "skitza_0027_source_expected_projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id"),
    ADD CONSTRAINT "projects_invite_token_unique" UNIQUE ("invite_token"),
    ADD CONSTRAINT "projects_producer_id_producers_id_fk"
      FOREIGN KEY ("producer_id") REFERENCES "skitza_0027_source_reference_producers"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION,
    ADD CONSTRAINT "projects_booking_id_bookings_id_fk"
      FOREIGN KEY ("booking_id") REFERENCES "skitza_0027_source_reference_bookings"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION,
    ADD CONSTRAINT "projects_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "skitza_0027_source_reference_products"("id")
      ON DELETE SET NULL;

  CREATE TEMP TABLE "skitza_0027_source_expected_purchase_requests"
    (LIKE "public"."purchase_requests") ON COMMIT DROP;
  ALTER TABLE "skitza_0027_source_expected_purchase_requests"
    ADD CONSTRAINT "purchase_requests_pkey" PRIMARY KEY ("id"),
    ADD CONSTRAINT "purchase_requests_producer_id_fkey"
      FOREIGN KEY ("producer_id") REFERENCES "skitza_0027_source_reference_producers"("id")
      ON DELETE CASCADE,
    ADD CONSTRAINT "purchase_requests_client_contact_id_fkey"
      FOREIGN KEY ("client_contact_id")
        REFERENCES "skitza_0027_source_reference_client_contacts"("id")
      ON DELETE CASCADE,
    ADD CONSTRAINT "purchase_requests_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "skitza_0027_source_reference_products"("id")
      ON DELETE SET NULL,
    ADD CONSTRAINT "purchase_requests_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "skitza_0027_source_reference_projects"("id")
      ON DELETE SET NULL,
    ADD CONSTRAINT "purchase_requests_booking_id_fkey"
      FOREIGN KEY ("booking_id") REFERENCES "skitza_0027_source_reference_bookings"("id")
      ON DELETE SET NULL;

  CREATE TEMP TABLE "skitza_0027_source_expected_store_purchase_intents"
    (LIKE "public"."store_purchase_intents") ON COMMIT DROP;
  ALTER TABLE "skitza_0027_source_expected_store_purchase_intents"
    ADD CONSTRAINT "store_purchase_intents_pkey" PRIMARY KEY ("id"),
    ADD CONSTRAINT "store_purchase_intents_producer_id_fk"
      FOREIGN KEY ("producer_id") REFERENCES "skitza_0027_source_reference_producers"("id")
      ON DELETE CASCADE,
    ADD CONSTRAINT "store_purchase_intents_product_id_fk"
      FOREIGN KEY ("product_id") REFERENCES "skitza_0027_source_reference_products"("id")
      ON DELETE NO ACTION;

  CREATE TEMP TABLE "skitza_0027_source_expected_stripe_customers"
    (LIKE "public"."stripe_customers") ON COMMIT DROP;
  ALTER TABLE "skitza_0027_source_expected_stripe_customers"
    ADD CONSTRAINT "stripe_customers_producer_id_client_contact_id_pk"
      PRIMARY KEY ("producer_id", "client_contact_id"),
    ADD CONSTRAINT "stripe_customers_producer_id_producers_id_fk"
      FOREIGN KEY ("producer_id") REFERENCES "skitza_0027_source_reference_producers"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION,
    ADD CONSTRAINT "stripe_customers_client_contact_id_client_contacts_id_fk"
      FOREIGN KEY ("client_contact_id")
        REFERENCES "skitza_0027_source_reference_client_contacts"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;

  CREATE TEMP TABLE "skitza_0027_source_expected_track_comments"
    (LIKE "public"."track_comments") ON COMMIT DROP;
  ALTER TABLE "skitza_0027_source_expected_track_comments"
    ADD CONSTRAINT "track_comments_pkey" PRIMARY KEY ("id"),
    ADD CONSTRAINT "track_comments_version_id_track_versions_id_fk"
      FOREIGN KEY ("version_id")
        REFERENCES "skitza_0027_source_reference_track_versions"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;

  CREATE TEMP TABLE "skitza_0027_source_expected_track_versions"
    (LIKE "public"."track_versions") ON COMMIT DROP;
  ALTER TABLE "skitza_0027_source_expected_track_versions"
    ADD CONSTRAINT "track_versions_pkey" PRIMARY KEY ("id"),
    ADD CONSTRAINT "track_versions_track_id_project_tracks_id_fk"
      FOREIGN KEY ("track_id")
        REFERENCES "skitza_0027_source_reference_project_tracks"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  -- SKITZA_0027_EXPECTED_SOURCE_CONSTRAINTS_END

  -- Full outer inventory rejects missing and extra constraints. Matching each
  -- actual definition against the server-parsed expected constraint also
  -- covers columns, referenced relations, match/update/delete behavior,
  -- deferrability, validation, inheritance, and backing-index validity.
  IF EXISTS (
    WITH expected_source_constraint AS (
      SELECT
        replace(
          expected_relation.relname,
          'skitza_0027_source_expected_',
          ''
        ) AS table_name,
        expected_constraint.conname AS constraint_name,
        expected_foreign_relation.relname AS expected_foreign_relation_name,
        expected_constraint.*
      FROM pg_constraint AS expected_constraint
      JOIN pg_class AS expected_relation
        ON expected_relation.oid = expected_constraint.conrelid
      LEFT JOIN pg_class AS expected_foreign_relation
        ON expected_foreign_relation.oid = expected_constraint.confrelid
      WHERE expected_relation.relnamespace = pg_my_temp_schema()
        AND expected_relation.relname LIKE 'skitza\_0027\_source\_expected\_%' ESCAPE '\'
    ),
    actual_source_constraint AS (
      SELECT
        actual_relation.relname AS table_name,
        actual_constraint.conname AS constraint_name,
        actual_foreign_namespace.nspname AS actual_foreign_namespace_name,
        actual_foreign_relation.relname AS actual_foreign_relation_name,
        actual_constraint.*
      FROM pg_constraint AS actual_constraint
      JOIN pg_class AS actual_relation
        ON actual_relation.oid = actual_constraint.conrelid
      JOIN pg_namespace AS actual_namespace
        ON actual_namespace.oid = actual_relation.relnamespace
      LEFT JOIN pg_class AS actual_foreign_relation
        ON actual_foreign_relation.oid = actual_constraint.confrelid
      LEFT JOIN pg_namespace AS actual_foreign_namespace
        ON actual_foreign_namespace.oid = actual_foreign_relation.relnamespace
      WHERE actual_namespace.nspname = 'public'
        AND actual_relation.relname = ANY(reviewed_source_tables)
    )
    SELECT 1
    FROM expected_source_constraint
    FULL JOIN actual_source_constraint
      USING (table_name, constraint_name)
    WHERE expected_source_constraint.oid IS NULL
      OR actual_source_constraint.oid IS NULL
      OR actual_source_constraint.contype IS DISTINCT FROM expected_source_constraint.contype
      OR actual_source_constraint.convalidated IS DISTINCT FROM
        expected_source_constraint.convalidated
      OR actual_source_constraint.condeferrable IS DISTINCT FROM
        expected_source_constraint.condeferrable
      OR actual_source_constraint.condeferred IS DISTINCT FROM
        expected_source_constraint.condeferred
      OR actual_source_constraint.confupdtype IS DISTINCT FROM
        expected_source_constraint.confupdtype
      OR actual_source_constraint.confdeltype IS DISTINCT FROM
        expected_source_constraint.confdeltype
      OR actual_source_constraint.confmatchtype IS DISTINCT FROM
        expected_source_constraint.confmatchtype
      OR actual_source_constraint.actual_foreign_namespace_name IS DISTINCT FROM
        CASE
          WHEN expected_source_constraint.expected_foreign_relation_name IS NULL THEN NULL
          ELSE 'public'
        END
      OR actual_source_constraint.actual_foreign_relation_name IS DISTINCT FROM
        replace(
          expected_source_constraint.expected_foreign_relation_name,
          'skitza_0027_source_reference_',
          ''
        )
      OR actual_source_constraint.conislocal IS DISTINCT FROM
        expected_source_constraint.conislocal
      OR actual_source_constraint.coninhcount IS DISTINCT FROM
        expected_source_constraint.coninhcount
      OR actual_source_constraint.connoinherit IS DISTINCT FROM
        expected_source_constraint.connoinherit
      OR actual_source_constraint.conparentid IS DISTINCT FROM
        expected_source_constraint.conparentid
      OR regexp_replace(
        pg_get_constraintdef(actual_source_constraint.oid, false),
        'public\.',
        '',
        'g'
      ) IS DISTINCT FROM
        regexp_replace(
          pg_get_constraintdef(expected_source_constraint.oid, false),
          '(pg_temp(_[0-9]+)?\.)?skitza_0027_source_reference_',
          '',
          'g'
        )
      OR (
        SELECT concat_ws(
          '|',
          pg_index.indisunique,
          pg_index.indnullsnotdistinct,
          pg_index.indisprimary,
          pg_index.indisexclusion,
          pg_index.indimmediate,
          pg_index.indisvalid,
          pg_index.indisready,
          pg_index.indislive
        )
        FROM pg_index
        WHERE pg_index.indexrelid = actual_source_constraint.conindid
      ) IS DISTINCT FROM (
        SELECT concat_ws(
          '|',
          pg_index.indisunique,
          pg_index.indnullsnotdistinct,
          pg_index.indisprimary,
          pg_index.indisexclusion,
          pg_index.indimmediate,
          pg_index.indisvalid,
          pg_index.indisready,
          pg_index.indislive
        )
        FROM pg_index
        WHERE pg_index.indexrelid = expected_source_constraint.conindid
      )
  ) THEN
    RAISE EXCEPTION 'SKITZA_0027_SOURCE_SCHEMA_DRIFT';
  END IF;

  -- Exact non-constraint index inventory. Definitions bind uniqueness,
  -- access method, key order, expressions, and predicates; catalog flags
  -- additionally reject invalid, unfinished, clustered, or replica-identity
  -- lookalikes with the same public name.
  IF EXISTS (
    WITH expected_source_index(
      table_name,
      index_name,
      index_definition,
      is_unique,
      nulls_not_distinct
    ) AS (VALUES
      ('agreement_acceptances', 'agreement_acceptances_request_unique', $index$CREATE UNIQUE INDEX agreement_acceptances_request_unique ON public.agreement_acceptances USING btree (purchase_request_id)$index$, true, false),
      ('client_contacts', 'client_contacts_clerk_user_idx', $index$CREATE INDEX client_contacts_clerk_user_idx ON public.client_contacts USING btree (clerk_user_id) WHERE (clerk_user_id IS NOT NULL)$index$, false, false),
      ('invoices', 'invoices_payment_proof_unique', $index$CREATE UNIQUE INDEX invoices_payment_proof_unique ON public.invoices USING btree (payment_proof_id) WHERE (payment_proof_id IS NOT NULL)$index$, true, false),
      ('invoices', 'invoices_producer_created_idx', $index$CREATE INDEX invoices_producer_created_idx ON public.invoices USING btree (producer_id, created_at)$index$, false, false),
      ('invoices', 'invoices_purchase_request_idx', $index$CREATE INDEX invoices_purchase_request_idx ON public.invoices USING btree (purchase_request_id)$index$, false, false),
      ('invoices', 'invoices_stripe_payment_intent_unique', $index$CREATE UNIQUE INDEX invoices_stripe_payment_intent_unique ON public.invoices USING btree (stripe_payment_intent_id) WHERE (stripe_payment_intent_id IS NOT NULL)$index$, true, false),
      ('notifications', 'notifications_producer_active_idx', $index$CREATE INDEX notifications_producer_active_idx ON public.notifications USING btree (producer_id, archived_at, created_at)$index$, false, false),
      ('payment_proofs', 'payment_proofs_one_pending_per_request', $index$CREATE UNIQUE INDEX payment_proofs_one_pending_per_request ON public.payment_proofs USING btree (purchase_request_id) WHERE (status = 'pending'::payment_proof_status)$index$, true, false),
      ('payment_proofs', 'payment_proofs_producer_status_created_idx', $index$CREATE INDEX payment_proofs_producer_status_created_idx ON public.payment_proofs USING btree (producer_id, status, created_at)$index$, false, false),
      ('payment_proofs', 'payment_proofs_purchase_status_idx', $index$CREATE INDEX payment_proofs_purchase_status_idx ON public.payment_proofs USING btree (purchase_request_id, status)$index$, false, false),
      ('payment_proofs', 'payment_proofs_storage_key_unique', $index$CREATE UNIQUE INDEX payment_proofs_storage_key_unique ON public.payment_proofs USING btree (storage_key)$index$, true, false),
      ('purchase_requests', 'purchase_requests_contact_status_idx', $index$CREATE INDEX purchase_requests_contact_status_idx ON public.purchase_requests USING btree (client_contact_id, status)$index$, false, false),
      ('purchase_requests', 'purchase_requests_producer_status_idx', $index$CREATE INDEX purchase_requests_producer_status_idx ON public.purchase_requests USING btree (producer_id, status, created_at)$index$, false, false),
      ('purchase_requests', 'purchase_requests_ref_number_unique', $index$CREATE UNIQUE INDEX purchase_requests_ref_number_unique ON public.purchase_requests USING btree (ref_number)$index$, true, false),
      ('store_purchase_intents', 'store_purchase_intents_created_idx', $index$CREATE INDEX store_purchase_intents_created_idx ON public.store_purchase_intents USING btree (created_at)$index$, false, false),
      ('stripe_customers', 'stripe_customers_customer_idx', $index$CREATE INDEX stripe_customers_customer_idx ON public.stripe_customers USING btree (stripe_customer_id)$index$, false, false)
    ),
    actual_source_index AS (
      SELECT
        source_table_relation.relname AS table_name,
        source_index_relation.relname AS index_name,
        source_index_relation.oid AS index_oid,
        pg_index.*
      FROM pg_index
      JOIN pg_class AS source_table_relation
        ON source_table_relation.oid = pg_index.indrelid
      JOIN pg_namespace AS source_table_namespace
        ON source_table_namespace.oid = source_table_relation.relnamespace
      JOIN pg_class AS source_index_relation
        ON source_index_relation.oid = pg_index.indexrelid
      JOIN pg_namespace AS source_index_namespace
        ON source_index_namespace.oid = source_index_relation.relnamespace
      WHERE source_table_namespace.nspname = 'public'
        AND source_index_namespace.nspname = 'public'
        AND source_table_relation.relname = ANY(reviewed_source_tables)
        AND NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE pg_constraint.conindid = pg_index.indexrelid
        )
    )
    SELECT 1
    FROM expected_source_index
    FULL JOIN actual_source_index USING (table_name, index_name)
    WHERE expected_source_index.table_name IS NULL
      OR actual_source_index.table_name IS NULL
      OR pg_get_indexdef(actual_source_index.index_oid) IS DISTINCT FROM
        expected_source_index.index_definition
      OR actual_source_index.indisunique IS DISTINCT FROM expected_source_index.is_unique
      OR actual_source_index.indnullsnotdistinct IS DISTINCT FROM
        expected_source_index.nulls_not_distinct
      OR actual_source_index.indisprimary
      OR actual_source_index.indisexclusion
      OR NOT actual_source_index.indimmediate
      OR NOT actual_source_index.indisvalid
      OR NOT actual_source_index.indisready
      OR NOT actual_source_index.indislive
      OR actual_source_index.indisclustered
      OR actual_source_index.indisreplident
      OR actual_source_index.indcheckxmin
  ) THEN
    RAISE EXCEPTION 'SKITZA_0027_SOURCE_SCHEMA_DRIFT';
  END IF;

  -- Parse the reviewed trigger predicate on the same server, then compare all
  -- non-internal source-trigger inventory and event-column semantics.
  CREATE TRIGGER "purchase_requests_freeze_session_count"
    BEFORE INSERT OR UPDATE OF "product_id", "song_qty"
    ON "skitza_0027_source_expected_purchase_requests"
    FOR EACH ROW
    WHEN (NEW."session_count_snapshot" IS NULL)
    EXECUTE FUNCTION "public"."freeze_purchase_request_session_count"();

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      (
        'purchase_requests',
        'purchase_requests_freeze_session_count',
        'freeze_purchase_request_session_count',
        23,
        'product_id,song_qty'
      )
    ) AS expected_source_trigger(
      "table_name",
      "trigger_name",
      "function_name",
      "trigger_type",
      "event_columns"
    )
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_trigger AS actual_source_trigger
      JOIN pg_class AS actual_trigger_relation
        ON actual_trigger_relation.oid = actual_source_trigger.tgrelid
      JOIN pg_namespace AS actual_trigger_namespace
        ON actual_trigger_namespace.oid = actual_trigger_relation.relnamespace
      WHERE actual_trigger_namespace.nspname = 'public'
        AND actual_trigger_relation.relname = expected_source_trigger."table_name"
        AND actual_source_trigger.tgname = expected_source_trigger."trigger_name"
        AND actual_source_trigger.tgfoid = to_regprocedure(
          format('public.%I()', expected_source_trigger."function_name")
        )
        AND actual_source_trigger.tgtype = expected_source_trigger."trigger_type"::smallint
        AND actual_source_trigger.tgenabled = 'O'
        AND actual_source_trigger.tgnargs = 0
        AND octet_length(actual_source_trigger.tgargs) = 0
        AND NOT actual_source_trigger.tgisinternal
        AND actual_source_trigger.tgconstraint = 0
        AND actual_source_trigger.tgconstrrelid = 0
        AND actual_source_trigger.tgconstrindid = 0
        AND NOT actual_source_trigger.tgdeferrable
        AND NOT actual_source_trigger.tginitdeferred
        AND actual_source_trigger.tgoldtable IS NULL
        AND actual_source_trigger.tgnewtable IS NULL
        AND (
          SELECT string_agg(
            event_attribute.attname,
            ',' ORDER BY event_column.ordinality
          )
          FROM unnest(actual_source_trigger.tgattr::smallint[]) WITH ORDINALITY
            AS event_column(attnum, ordinality)
          JOIN pg_attribute AS event_attribute
            ON event_attribute.attrelid = actual_source_trigger.tgrelid
           AND event_attribute.attnum = event_column.attnum
        ) = expected_source_trigger."event_columns"
        AND pg_get_expr(
          actual_source_trigger.tgqual,
          actual_source_trigger.tgrelid,
          false
        ) = (
          SELECT pg_get_expr(
            expected_trigger_catalog.tgqual,
            expected_trigger_catalog.tgrelid,
            false
          )
          FROM pg_trigger AS expected_trigger_catalog
          WHERE expected_trigger_catalog.tgrelid =
              'skitza_0027_source_expected_purchase_requests'::regclass
            AND expected_trigger_catalog.tgname = expected_source_trigger."trigger_name"
        )
    )
  ) OR (
    SELECT count(*)
    FROM pg_trigger AS source_trigger_inventory
    JOIN pg_class AS source_trigger_relation
      ON source_trigger_relation.oid = source_trigger_inventory.tgrelid
    JOIN pg_namespace AS source_trigger_namespace
      ON source_trigger_namespace.oid = source_trigger_relation.relnamespace
    WHERE source_trigger_namespace.nspname = 'public'
      AND source_trigger_relation.relname = ANY(reviewed_source_tables)
      AND NOT source_trigger_inventory.tgisinternal
  ) <> 1 THEN
    RAISE EXCEPTION 'SKITZA_0027_SOURCE_SCHEMA_DRIFT';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "public"."agreement_acceptances"
    UNION ALL SELECT 1 FROM "public"."bookings"
    UNION ALL SELECT 1 FROM "public"."invoices"
    UNION ALL SELECT 1 FROM "public"."notifications"
    UNION ALL SELECT 1 FROM "public"."payment_proofs"
    UNION ALL SELECT 1 FROM "public"."project_tracks"
    UNION ALL SELECT 1 FROM "public"."projects"
    UNION ALL SELECT 1 FROM "public"."purchase_requests"
    UNION ALL SELECT 1 FROM "public"."store_purchase_intents"
    UNION ALL SELECT 1 FROM "public"."stripe_customers"
    UNION ALL SELECT 1 FROM "public"."track_comments"
    UNION ALL SELECT 1 FROM "public"."track_versions"
  ) THEN
    RAISE EXCEPTION 'SKITZA_0027_RESET_REQUIRED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "public"."products"
    WHERE "deposit_model" <> 'flat'
      OR "milestones" IS NOT NULL
      OR jsonb_typeof("payment_plans") <> 'array'
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof("payment_plans") = 'array' THEN "payment_plans"
            ELSE '[]'::jsonb
          END
        ) AS plan
        WHERE plan ->> 'kind' NOT IN ('full', 'split_50_50', 'monthly')
      )
  ) THEN
    RAISE EXCEPTION 'SKITZA_0027_DISALLOWED_CATALOG_STATE';
  END IF;

  -- Deprecated Stripe account identifiers were explicitly approved for
  -- removal. A charge-enabled account or configured live terminal was not.
  IF EXISTS (
    SELECT 1
    FROM "public"."producers"
    WHERE "stripe_charges_enabled" IS TRUE
      OR "tranzila_terminal_name" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'SKITZA_0027_LIVE_CARD_STATE';
  END IF;

  DROP TABLE
    "public"."agreement_acceptances",
    "public"."bookings",
    "public"."invoices",
    "public"."notifications",
    "public"."payment_proofs",
    "public"."project_tracks",
    "public"."projects",
    "public"."purchase_requests",
    "public"."store_purchase_intents",
    "public"."stripe_customers",
    "public"."track_comments",
    "public"."track_versions";

  DROP FUNCTION IF EXISTS "public"."freeze_purchase_request_session_count"();
  DROP TYPE "public"."booking_status";
  DROP TYPE "public"."invoice_status";
  DROP TYPE "public"."payment_proof_status";
  DROP TYPE "public"."project_stage";
  DROP TYPE "public"."purchase_request_status";

  ALTER TABLE "public"."producers"
    DROP COLUMN "stripe_account_id",
    DROP COLUMN "stripe_charges_enabled",
    DROP COLUMN "tranzila_terminal_name";

  ALTER TABLE "public"."products"
    DROP COLUMN "deposit_pct",
    DROP COLUMN "deposit_model",
    DROP COLUMN "milestones",
    ADD CONSTRAINT "products_id_producer_unique" UNIQUE ("id", "producer_id");

  ALTER TABLE "public"."client_contacts"
    ADD CONSTRAINT "client_contacts_id_producer_unique" UNIQUE ("id", "producer_id");

  CREATE TYPE "public"."project_lifecycle_status" AS ENUM (
    'waiting_for_payment', 'active', 'paused', 'completed', 'canceled'
  );
  CREATE TYPE "public"."booking_status" AS ENUM (
    'pending_approval', 'confirmed', 'rejected', 'cancelled', 'completed', 'no_show'
  );
  CREATE TYPE "public"."session_use_outcome" AS ENUM (
    'reserved', 'completed', 'cancelled_on_time', 'cancelled_by_producer',
    'cancelled_late', 'no_show'
  );
  CREATE TYPE "public"."purchase_source_kind" AS ENUM (
    'store_product', 'private_offer', 'session_product', 'paid_add_on', 'no_charge_add_on'
  );
  CREATE TYPE "public"."purchase_request_status" AS ENUM (
    'pending', 'approved', 'declined', 'canceled', 'converted'
  );
  CREATE TYPE "public"."private_offer_status" AS ENUM (
    'draft', 'sent', 'accepted', 'declined', 'expired', 'canceled'
  );
  CREATE TYPE "public"."purchase_lifecycle_status" AS ENUM (
    'waiting_for_payment', 'active', 'canceled'
  );
  CREATE TYPE "public"."purchase_payment_plan_kind" AS ENUM (
    'full', 'split_50_50', 'monthly'
  );
  CREATE TYPE "public"."purchase_installment_due_trigger" AS ENUM (
    'acceptance', 'monthly_anniversary', 'artist_approval'
  );
  CREATE TYPE "public"."purchase_installment_status" AS ENUM (
    'not_paid', 'awaiting_review', 'partially_paid', 'confirmed', 'overdue', 'waived', 'canceled'
  );
  CREATE TYPE "public"."payment_proof_status" AS ENUM ('pending', 'confirmed', 'rejected');
  CREATE TYPE "public"."purchase_payment_source" AS ENUM ('proof', 'manual');
  CREATE TYPE "public"."session_allowance_kind" AS ENUM ('fixed', 'unlimited');
  CREATE TYPE "public"."session_allowance_close_reason" AS ENUM (
    'project_completed', 'project_canceled', 'purchase_canceled'
  );
  CREATE TYPE "public"."version_approval_action" AS ENUM ('approved', 'revoked');

  CREATE TABLE "public"."projects" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "producer_id" uuid NOT NULL,
    "client_contact_id" uuid NOT NULL,
    "title" text NOT NULL,
    "lifecycle_status" "public"."project_lifecycle_status" DEFAULT 'waiting_for_payment' NOT NULL,
    "lifecycle_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
    "client_name" text,
    "client_email" text,
    "artist_name" text NOT NULL,
    "artist_email" text NOT NULL,
    "invite_token" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "testimonial_requested_at" timestamp with time zone,
    "notes" text,
    "position" integer DEFAULT 0 NOT NULL,
    "workflow_stage" "public"."workflow_stage" DEFAULT 'brief' NOT NULL,
    "deadline_at" timestamp with time zone,
    CONSTRAINT "projects_invite_token_unique" UNIQUE ("invite_token"),
    CONSTRAINT "projects_id_producer_unique" UNIQUE ("id", "producer_id"),
    CONSTRAINT "projects_id_owner_unique" UNIQUE ("id", "producer_id", "client_contact_id"),
    CONSTRAINT "projects_producer_id_producers_id_fk"
      FOREIGN KEY ("producer_id") REFERENCES "public"."producers"("id") ON DELETE RESTRICT,
    CONSTRAINT "projects_client_producer_fk"
      FOREIGN KEY ("client_contact_id", "producer_id")
      REFERENCES "public"."client_contacts"("id", "producer_id") ON DELETE RESTRICT
  );
  CREATE INDEX "projects_producer_lifecycle_idx"
    ON "public"."projects" ("producer_id", "lifecycle_status", "created_at");

  CREATE TABLE "public"."purchase_requests" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "producer_id" uuid NOT NULL,
    "client_contact_id" uuid NOT NULL,
    "product_id" uuid NOT NULL,
    "project_id" uuid,
    "operation_key" text NOT NULL,
    "operation_digest" text NOT NULL,
    "ref_number" text NOT NULL,
    "status" "public"."purchase_request_status" DEFAULT 'pending' NOT NULL,
    "artist_name" text NOT NULL,
    "artist_email" text NOT NULL,
    "requested_song_qty" integer,
    "brief" text,
    "status_changed_at" timestamp with time zone,
    "approved_at" timestamp with time zone,
    "declined_at" timestamp with time zone,
    "canceled_at" timestamp with time zone,
    "converted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "purchase_requests_ref_number_unique" UNIQUE ("ref_number"),
    CONSTRAINT "purchase_requests_operation_key_unique"
      UNIQUE ("producer_id", "client_contact_id", "operation_key"),
    CONSTRAINT "purchase_requests_id_owner_unique"
      UNIQUE ("id", "producer_id", "client_contact_id"),
    CONSTRAINT "purchase_requests_id_producer_unique"
      UNIQUE ("id", "producer_id"),
    CONSTRAINT "purchase_requests_id_project_owner_unique"
      UNIQUE ("id", "product_id", "project_id", "producer_id", "client_contact_id"),
    CONSTRAINT "purchase_requests_requested_song_qty_positive"
      CHECK ("requested_song_qty" IS NULL OR "requested_song_qty" > 0),
    CONSTRAINT "purchase_requests_status_timestamp_shape" CHECK ((
      (
        "status" = 'pending'
        AND "approved_at" IS NULL
        AND "declined_at" IS NULL
        AND "canceled_at" IS NULL
        AND "converted_at" IS NULL
      )
      OR (
        "status" = 'approved'
        AND "approved_at" IS NOT NULL
        AND "declined_at" IS NULL
        AND "canceled_at" IS NULL
        AND "converted_at" IS NULL
      )
      OR (
        "status" = 'declined'
        AND "approved_at" IS NULL
        AND "declined_at" IS NOT NULL
        AND "canceled_at" IS NULL
        AND "converted_at" IS NULL
      )
      OR (
        "status" = 'canceled'
        AND "declined_at" IS NULL
        AND "canceled_at" IS NOT NULL
        AND "converted_at" IS NULL
      )
      OR (
        "status" = 'converted'
        AND "declined_at" IS NULL
        AND "canceled_at" IS NULL
        AND "converted_at" IS NOT NULL
      )
    ) IS TRUE),
    CONSTRAINT "purchase_requests_producer_id_producers_id_fk"
      FOREIGN KEY ("producer_id") REFERENCES "public"."producers"("id") ON DELETE RESTRICT,
    CONSTRAINT "purchase_requests_client_producer_fk"
      FOREIGN KEY ("client_contact_id", "producer_id")
      REFERENCES "public"."client_contacts"("id", "producer_id") ON DELETE RESTRICT,
    CONSTRAINT "purchase_requests_product_producer_fk"
      FOREIGN KEY ("product_id", "producer_id")
      REFERENCES "public"."products"("id", "producer_id") ON DELETE RESTRICT,
    CONSTRAINT "purchase_requests_project_owner_fk"
      FOREIGN KEY ("project_id", "producer_id", "client_contact_id")
      REFERENCES "public"."projects"("id", "producer_id", "client_contact_id") ON DELETE RESTRICT
  );
  CREATE INDEX "purchase_requests_producer_status_created_idx"
    ON "public"."purchase_requests" ("producer_id", "status", "created_at");

  CREATE TABLE "public"."private_offers" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "producer_id" uuid NOT NULL,
    "client_contact_id" uuid NOT NULL,
    "target_project_id" uuid,
    "product_id" uuid,
    "status" "public"."private_offer_status" DEFAULT 'draft' NOT NULL,
    "commercial_draft" jsonb NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "accepted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "private_offers_id_owner_unique"
      UNIQUE ("id", "producer_id", "client_contact_id"),
    CONSTRAINT "private_offers_id_project_owner_unique"
      UNIQUE ("id", "target_project_id", "producer_id", "client_contact_id"),
    CONSTRAINT "private_offers_producer_id_producers_id_fk"
      FOREIGN KEY ("producer_id") REFERENCES "public"."producers"("id") ON DELETE RESTRICT,
    CONSTRAINT "private_offers_client_producer_fk"
      FOREIGN KEY ("client_contact_id", "producer_id")
      REFERENCES "public"."client_contacts"("id", "producer_id") ON DELETE RESTRICT,
    CONSTRAINT "private_offers_project_owner_fk"
      FOREIGN KEY ("target_project_id", "producer_id", "client_contact_id")
      REFERENCES "public"."projects"("id", "producer_id", "client_contact_id") ON DELETE RESTRICT,
    CONSTRAINT "private_offers_product_producer_fk"
      FOREIGN KEY ("product_id", "producer_id")
      REFERENCES "public"."products"("id", "producer_id") ON DELETE RESTRICT
  );
  CREATE INDEX "private_offers_producer_status_expiry_idx"
    ON "public"."private_offers" ("producer_id", "status", "expires_at");

  CREATE TABLE "public"."purchases" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "producer_id" uuid NOT NULL,
    "project_id" uuid NOT NULL,
    "client_contact_id" uuid NOT NULL,
    "product_id" uuid,
    "private_offer_id" uuid,
    "purchase_request_id" uuid,
    "source_kind" "public"."purchase_source_kind" NOT NULL,
    "operation_key" text NOT NULL,
    "operation_digest" text NOT NULL,
    "ref_number" text NOT NULL,
    "lifecycle_status" "public"."purchase_lifecycle_status"
      DEFAULT 'waiting_for_payment' NOT NULL,
    "payment_plan_kind" "public"."purchase_payment_plan_kind",
    "snapshot_version" integer DEFAULT 1 NOT NULL,
    "snapshot_digest" text NOT NULL,
    "commercial_snapshot" jsonb NOT NULL,
    "subtotal_cents" integer NOT NULL,
    "tax_cents" integer NOT NULL,
    "total_cents" integer NOT NULL,
    "currency" text NOT NULL,
    "accepted_at" timestamp with time zone NOT NULL,
    "activated_at" timestamp with time zone,
    "canceled_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "purchases_ref_number_unique" UNIQUE ("ref_number"),
    CONSTRAINT "purchases_operation_key_unique"
      UNIQUE ("producer_id", "client_contact_id", "operation_key"),
    CONSTRAINT "purchases_id_producer_unique" UNIQUE ("id", "producer_id"),
    CONSTRAINT "purchases_id_producer_client_unique"
      UNIQUE ("id", "producer_id", "client_contact_id"),
    CONSTRAINT "purchases_id_project_unique" UNIQUE ("id", "project_id"),
    CONSTRAINT "purchases_id_currency_unique" UNIQUE ("id", "currency"),
    CONSTRAINT "purchases_id_snapshot_unique" UNIQUE ("id", "snapshot_digest"),
    CONSTRAINT "purchases_id_owner_unique"
      UNIQUE ("id", "project_id", "producer_id", "client_contact_id"),
    CONSTRAINT "purchases_nonnegative_amounts"
      CHECK ("subtotal_cents" >= 0 AND "tax_cents" >= 0 AND "total_cents" >= 0),
    CONSTRAINT "purchases_payment_plan_shape" CHECK (
      ("total_cents" = 0 AND "payment_plan_kind" IS NULL)
      OR ("total_cents" > 0 AND "payment_plan_kind" IS NOT NULL)
    ),
    CONSTRAINT "purchases_zero_total_activation_shape" CHECK (
      (
        "total_cents" > 0
        OR (
          "lifecycle_status" IN ('active', 'canceled')
          AND "activated_at" = "accepted_at"
        )
      ) IS TRUE
    ),
    CONSTRAINT "purchases_lifecycle_timestamp_shape" CHECK (
      (
        (
          "lifecycle_status" = 'waiting_for_payment'
          AND "activated_at" IS NULL
          AND "canceled_at" IS NULL
        )
        OR (
          "lifecycle_status" = 'active'
          AND "activated_at" >= "accepted_at"
          AND "canceled_at" IS NULL
        )
      OR (
        "lifecycle_status" = 'canceled'
        AND (
          (
            "activated_at" IS NULL
            AND "canceled_at" >= "accepted_at"
          )
          OR (
            "activated_at" >= "accepted_at"
            AND "canceled_at" >= "activated_at"
          )
        )
        )
      ) IS TRUE
    ),
    CONSTRAINT "purchases_snapshot_scalar_consistency" CHECK ((
      ("commercial_snapshot"->>'version')::integer = "snapshot_version"
      AND ("commercial_snapshot"->>'subtotalCents')::integer = "subtotal_cents"
      AND ("commercial_snapshot"->'tax'->>'amountCents')::integer = "tax_cents"
      AND ("commercial_snapshot"->>'totalCents')::integer = "total_cents"
      AND "commercial_snapshot"->>'currency' = "currency"
      AND (
        (
          "total_cents" = 0
          AND jsonb_typeof("commercial_snapshot"->'selectedPaymentPlan') = 'null'
        )
        OR (
          "total_cents" > 0
          AND "commercial_snapshot"->'selectedPaymentPlan'->>'kind' =
            "payment_plan_kind"::text
        )
      )
    ) IS TRUE),
    CONSTRAINT "purchases_agreement_text_shape" CHECK ((
      jsonb_typeof("commercial_snapshot"->'agreementText') = 'string'
      AND NULLIF(btrim("commercial_snapshot"->>'agreementText'), '') IS NOT NULL
    ) IS TRUE),
    CONSTRAINT "purchases_tax_shape" CHECK ((
      ("commercial_snapshot"->'tax'->>'ratePct')::integer BETWEEN 0 AND 100
      AND (
        (
          "commercial_snapshot"->'tax'->>'mode' = 'tax_free'
          AND "tax_cents" = 0
          AND "total_cents" = "subtotal_cents"
        )
        OR (
          "commercial_snapshot"->'tax'->>'mode' = 'tax_included'
          AND "total_cents" = "subtotal_cents"
          AND "tax_cents" = round(
            "total_cents"::numeric
            * ("commercial_snapshot"->'tax'->>'ratePct')::integer
            / (100 + ("commercial_snapshot"->'tax'->>'ratePct')::integer)::numeric
          )::integer
        )
        OR (
          "commercial_snapshot"->'tax'->>'mode' = 'tax_added'
          AND "tax_cents" = round(
            "subtotal_cents"::numeric
            * ("commercial_snapshot"->'tax'->>'ratePct')::integer
            / 100::numeric
          )::integer
          AND "total_cents"::bigint = "subtotal_cents"::bigint + "tax_cents"::bigint
        )
      )
    ) IS TRUE),
    CONSTRAINT "purchases_discount_shape" CHECK ((
      ("commercial_snapshot"->>'listSubtotalCents')::bigint >= 0
      AND ("commercial_snapshot"->>'discountCents')::bigint >= 0
      AND ("commercial_snapshot"->>'listSubtotalCents')::bigint =
        "subtotal_cents"::bigint
        + ("commercial_snapshot"->>'discountCents')::bigint
    ) IS TRUE),
    CONSTRAINT "purchases_source_link_shape" CHECK ((
      (
        "source_kind" IN ('store_product', 'session_product')
        AND "product_id" IS NOT NULL
        AND "purchase_request_id" IS NOT NULL
        AND "private_offer_id" IS NULL
      )
      OR (
        "source_kind" = 'private_offer'
        AND "private_offer_id" IS NOT NULL
        AND "purchase_request_id" IS NULL
      )
      OR (
        "source_kind" IN ('paid_add_on', 'no_charge_add_on')
        AND (
          "product_id" IS NOT NULL
          OR "private_offer_id" IS NOT NULL
          OR "purchase_request_id" IS NOT NULL
        )
      )
    ) IS TRUE),
    CONSTRAINT "purchases_source_amount_shape" CHECK ((
      (
        "source_kind" IN ('store_product', 'session_product', 'paid_add_on')
        AND "total_cents" > 0
      )
      OR ("source_kind" = 'no_charge_add_on' AND "total_cents" = 0)
      OR "source_kind" = 'private_offer'
    ) IS TRUE),
    CONSTRAINT "purchases_producer_id_producers_id_fk"
      FOREIGN KEY ("producer_id") REFERENCES "public"."producers"("id") ON DELETE RESTRICT,
    CONSTRAINT "purchases_project_owner_fk"
      FOREIGN KEY ("project_id", "producer_id", "client_contact_id")
      REFERENCES "public"."projects"("id", "producer_id", "client_contact_id") ON DELETE RESTRICT,
    CONSTRAINT "purchases_client_producer_fk"
      FOREIGN KEY ("client_contact_id", "producer_id")
      REFERENCES "public"."client_contacts"("id", "producer_id") ON DELETE RESTRICT,
    CONSTRAINT "purchases_product_producer_fk"
      FOREIGN KEY ("product_id", "producer_id")
      REFERENCES "public"."products"("id", "producer_id") ON DELETE RESTRICT,
    CONSTRAINT "purchases_private_offer_owner_fk"
      FOREIGN KEY ("private_offer_id", "producer_id", "client_contact_id")
      REFERENCES "public"."private_offers"("id", "producer_id", "client_contact_id")
      ON DELETE RESTRICT,
    CONSTRAINT "purchases_private_offer_project_owner_fk"
      FOREIGN KEY ("private_offer_id", "project_id", "producer_id", "client_contact_id")
      REFERENCES "public"."private_offers"(
        "id", "target_project_id", "producer_id", "client_contact_id"
      )
      ON DELETE RESTRICT,
    CONSTRAINT "purchases_purchase_request_owner_fk"
      FOREIGN KEY (
        "purchase_request_id", "product_id", "project_id", "producer_id", "client_contact_id"
      )
      REFERENCES "public"."purchase_requests"(
        "id", "product_id", "project_id", "producer_id", "client_contact_id"
      )
      ON DELETE RESTRICT
  );
  CREATE UNIQUE INDEX "purchases_private_offer_unique"
    ON "public"."purchases" ("private_offer_id") WHERE "private_offer_id" IS NOT NULL;
  CREATE UNIQUE INDEX "purchases_purchase_request_unique"
    ON "public"."purchases" ("purchase_request_id") WHERE "purchase_request_id" IS NOT NULL;
  CREATE INDEX "purchases_project_created_idx"
    ON "public"."purchases" ("project_id", "created_at");
  CREATE INDEX "purchases_client_created_idx"
    ON "public"."purchases" ("client_contact_id", "created_at");
  CREATE INDEX "purchases_producer_lifecycle_idx"
    ON "public"."purchases" ("producer_id", "lifecycle_status", "created_at");

  CREATE TABLE "public"."purchase_acceptances" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "purchase_id" uuid NOT NULL,
    "producer_id" uuid NOT NULL,
    "client_contact_id" uuid NOT NULL,
    "accepted_by_clerk_user_id" text NOT NULL,
    "accepted_snapshot" jsonb NOT NULL,
    "snapshot_digest" text NOT NULL,
    "accepted_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "purchase_acceptances_purchase_unique" UNIQUE ("purchase_id"),
    CONSTRAINT "purchase_acceptances_purchase_owner_fk"
      FOREIGN KEY ("purchase_id", "producer_id", "client_contact_id")
      REFERENCES "public"."purchases"("id", "producer_id", "client_contact_id")
      ON DELETE RESTRICT,
    CONSTRAINT "purchase_acceptances_purchase_snapshot_fk"
      FOREIGN KEY ("purchase_id", "snapshot_digest")
      REFERENCES "public"."purchases"("id", "snapshot_digest")
      ON DELETE RESTRICT
  );

  CREATE TABLE "public"."purchase_installments" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "purchase_id" uuid NOT NULL,
    "producer_id" uuid NOT NULL,
    "position" integer NOT NULL,
    "amount_cents" integer NOT NULL,
    "currency" text NOT NULL,
    "due_trigger" "public"."purchase_installment_due_trigger" NOT NULL,
    "due_at" timestamp with time zone,
    "triggered_at" timestamp with time zone,
    "required_for_activation" boolean DEFAULT false NOT NULL,
    "status" "public"."purchase_installment_status" DEFAULT 'not_paid' NOT NULL,
    "reminders_enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "purchase_installments_purchase_position_unique"
      UNIQUE ("purchase_id", "position"),
    CONSTRAINT "purchase_installments_id_purchase_unique" UNIQUE ("id", "purchase_id"),
    CONSTRAINT "purchase_installments_id_purchase_currency_unique"
      UNIQUE ("id", "purchase_id", "currency"),
    CONSTRAINT "purchase_installments_positive_position" CHECK ("position" > 0),
    CONSTRAINT "purchase_installments_positive_amount" CHECK ("amount_cents" > 0),
    CONSTRAINT "purchase_installments_purchase_producer_fk"
      FOREIGN KEY ("purchase_id", "producer_id")
      REFERENCES "public"."purchases"("id", "producer_id") ON DELETE RESTRICT,
    CONSTRAINT "purchase_installments_purchase_currency_fk"
      FOREIGN KEY ("purchase_id", "currency")
      REFERENCES "public"."purchases"("id", "currency") ON DELETE RESTRICT
  );
  CREATE UNIQUE INDEX "purchase_installments_one_activation_required"
    ON "public"."purchase_installments" ("purchase_id")
    WHERE "required_for_activation" = true;
  CREATE INDEX "purchase_installments_due_status_idx"
    ON "public"."purchase_installments" ("status", "due_at");

  CREATE TABLE "public"."payment_proofs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "purchase_id" uuid NOT NULL,
    "installment_id" uuid NOT NULL,
    "producer_id" uuid NOT NULL,
    "project_id" uuid NOT NULL,
    "client_contact_id" uuid NOT NULL,
    "replaces_proof_id" uuid,
    "amount_cents" integer NOT NULL,
    "currency" text NOT NULL,
    "storage_bucket" text DEFAULT 'docs' NOT NULL,
    "storage_key" text NOT NULL,
    "object_etag" text NOT NULL,
    "original_file_name" text,
    "content_type" text NOT NULL,
    "size_bytes" integer NOT NULL,
    "status" "public"."payment_proof_status" DEFAULT 'pending' NOT NULL,
    "note" text,
    "rejection_note" text,
    "confirmed_at" timestamp with time zone,
    "rejected_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "payment_proofs_storage_key_unique" UNIQUE ("storage_key"),
    CONSTRAINT "payment_proofs_id_purchase_installment_producer_unique"
      UNIQUE ("id", "purchase_id", "installment_id", "producer_id"),
    CONSTRAINT "payment_proofs_id_purchase_installment_producer_currency_unique"
      UNIQUE ("id", "purchase_id", "installment_id", "producer_id", "currency"),
    CONSTRAINT "payment_proofs_positive_amount" CHECK ("amount_cents" > 0),
    CONSTRAINT "payment_proofs_nonnegative_size" CHECK ("size_bytes" >= 0),
    CONSTRAINT "payment_proofs_private_bucket_only" CHECK ("storage_bucket" = 'docs'),
    CONSTRAINT "payment_proofs_does_not_replace_self"
      CHECK ("replaces_proof_id" IS NULL OR "replaces_proof_id" <> "id"),
    CONSTRAINT "payment_proofs_status_shape" CHECK (
      (
        "status" = 'pending'
        AND "confirmed_at" IS NULL
        AND "rejected_at" IS NULL
        AND "rejection_note" IS NULL
      )
      OR (
        "status" = 'confirmed'
        AND "confirmed_at" IS NOT NULL
        AND "rejected_at" IS NULL
        AND "rejection_note" IS NULL
      )
      OR (
        "status" = 'rejected'
        AND "confirmed_at" IS NULL
        AND "rejected_at" IS NOT NULL
        AND NULLIF(btrim("rejection_note"), '') IS NOT NULL
      )
    ),
    CONSTRAINT "payment_proofs_purchase_owner_fk"
      FOREIGN KEY ("purchase_id", "project_id", "producer_id", "client_contact_id")
      REFERENCES "public"."purchases"("id", "project_id", "producer_id", "client_contact_id")
      ON DELETE RESTRICT,
    CONSTRAINT "payment_proofs_installment_purchase_currency_fk"
      FOREIGN KEY ("installment_id", "purchase_id", "currency")
      REFERENCES "public"."purchase_installments"("id", "purchase_id", "currency")
      ON DELETE RESTRICT,
    CONSTRAINT "payment_proofs_replacement_identity_fk"
      FOREIGN KEY ("replaces_proof_id", "purchase_id", "installment_id", "producer_id")
      REFERENCES "public"."payment_proofs"("id", "purchase_id", "installment_id", "producer_id")
      ON DELETE RESTRICT
  );
  CREATE UNIQUE INDEX "payment_proofs_one_pending_per_installment"
    ON "public"."payment_proofs" ("installment_id") WHERE "status" = 'pending';
  CREATE UNIQUE INDEX "payment_proofs_replaces_proof_unique"
    ON "public"."payment_proofs" ("replaces_proof_id")
    WHERE "replaces_proof_id" IS NOT NULL;
  CREATE INDEX "payment_proofs_producer_status_created_idx"
    ON "public"."payment_proofs" ("producer_id", "status", "created_at");

  CREATE TABLE "public"."purchase_payments" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "purchase_id" uuid NOT NULL,
    "installment_id" uuid NOT NULL,
    "producer_id" uuid NOT NULL,
    "proof_id" uuid,
    "operation_key" text NOT NULL,
    "operation_digest" text NOT NULL,
    "source" "public"."purchase_payment_source" NOT NULL,
    "amount_cents" integer NOT NULL,
    "currency" text NOT NULL,
    "paid_at" timestamp with time zone NOT NULL,
    "added_by_clerk_user_id" text NOT NULL,
    "note" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "purchase_payments_id_purchase_unique" UNIQUE ("id", "purchase_id"),
    CONSTRAINT "purchase_payments_operation_key_unique" UNIQUE ("purchase_id", "operation_key"),
    CONSTRAINT "purchase_payments_positive_amount" CHECK ("amount_cents" > 0),
    CONSTRAINT "purchase_payments_source_proof_consistency" CHECK (
      "source" = 'manual'
      OR ("source" = 'proof' AND "proof_id" IS NOT NULL)
    ),
    CONSTRAINT "purchase_payments_purchase_producer_fk"
      FOREIGN KEY ("purchase_id", "producer_id")
      REFERENCES "public"."purchases"("id", "producer_id") ON DELETE RESTRICT,
    CONSTRAINT "purchase_payments_installment_purchase_currency_fk"
      FOREIGN KEY ("installment_id", "purchase_id", "currency")
      REFERENCES "public"."purchase_installments"("id", "purchase_id", "currency")
      ON DELETE RESTRICT,
    CONSTRAINT "purchase_payments_proof_purchase_installment_currency_fk"
      FOREIGN KEY ("proof_id", "purchase_id", "installment_id", "producer_id", "currency")
      REFERENCES "public"."payment_proofs"(
        "id", "purchase_id", "installment_id", "producer_id", "currency"
      )
      ON DELETE RESTRICT
  );
  CREATE UNIQUE INDEX "purchase_payments_proof_unique"
    ON "public"."purchase_payments" ("proof_id") WHERE "proof_id" IS NOT NULL;
  CREATE INDEX "purchase_payments_purchase_paid_idx"
    ON "public"."purchase_payments" ("purchase_id", "paid_at");

  CREATE TABLE "public"."purchase_payment_corrections" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "purchase_id" uuid NOT NULL,
    "payment_id" uuid NOT NULL,
    "producer_id" uuid NOT NULL,
    "sequence" integer NOT NULL,
    "previous_amount_cents" integer NOT NULL,
    "new_amount_cents" integer NOT NULL,
    "reason" text NOT NULL,
    "corrected_by_clerk_user_id" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "purchase_payment_corrections_payment_sequence_unique"
      UNIQUE ("payment_id", "sequence"),
    CONSTRAINT "purchase_payment_corrections_positive_sequence" CHECK ("sequence" > 0),
    CONSTRAINT "purchase_payment_corrections_nonnegative_amounts"
      CHECK ("previous_amount_cents" >= 0 AND "new_amount_cents" >= 0),
    CONSTRAINT "purchase_payment_corrections_payment_purchase_fk"
      FOREIGN KEY ("payment_id", "purchase_id")
      REFERENCES "public"."purchase_payments"("id", "purchase_id") ON DELETE RESTRICT,
    CONSTRAINT "purchase_payment_corrections_purchase_producer_fk"
      FOREIGN KEY ("purchase_id", "producer_id")
      REFERENCES "public"."purchases"("id", "producer_id") ON DELETE RESTRICT
  );

  CREATE TABLE "public"."purchase_waivers" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "purchase_id" uuid NOT NULL,
    "installment_id" uuid NOT NULL,
    "producer_id" uuid NOT NULL,
    "amount_cents" integer NOT NULL,
    "reason" text NOT NULL,
    "waived_by_clerk_user_id" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "purchase_waivers_positive_amount" CHECK ("amount_cents" > 0),
    CONSTRAINT "purchase_waivers_installment_purchase_fk"
      FOREIGN KEY ("installment_id", "purchase_id")
      REFERENCES "public"."purchase_installments"("id", "purchase_id") ON DELETE RESTRICT,
    CONSTRAINT "purchase_waivers_purchase_producer_fk"
      FOREIGN KEY ("purchase_id", "producer_id")
      REFERENCES "public"."purchases"("id", "producer_id") ON DELETE RESTRICT
  );

  CREATE TABLE "public"."purchase_cancellations" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "purchase_id" uuid NOT NULL,
    "producer_id" uuid NOT NULL,
    "reason" text NOT NULL,
    "canceled_by_clerk_user_id" text NOT NULL,
    "canceled_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "purchase_cancellations_purchase_unique" UNIQUE ("purchase_id"),
    CONSTRAINT "purchase_cancellations_purchase_producer_fk"
      FOREIGN KEY ("purchase_id", "producer_id")
      REFERENCES "public"."purchases"("id", "producer_id") ON DELETE RESTRICT
  );

  CREATE TABLE "public"."purchase_session_allowances" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "purchase_id" uuid NOT NULL,
    "producer_id" uuid NOT NULL,
    "kind" "public"."session_allowance_kind" NOT NULL,
    "session_limit" integer,
    "duration_min" integer NOT NULL,
    "location_type" text NOT NULL,
    "buffer_minutes" integer NOT NULL,
    "min_lead_hours" integer NOT NULL,
    "closed_at" timestamp with time zone,
    "close_reason" "public"."session_allowance_close_reason",
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "purchase_session_allowances_purchase_unique" UNIQUE ("purchase_id"),
    CONSTRAINT "purchase_session_allowances_id_purchase_unique" UNIQUE ("id", "purchase_id"),
    CONSTRAINT "purchase_session_allowances_limit_shape" CHECK (
      (
        ("kind" = 'fixed' AND "session_limit" > 0)
        OR ("kind" = 'unlimited' AND "session_limit" IS NULL)
      ) IS TRUE
    ),
    CONSTRAINT "purchase_session_allowances_close_shape" CHECK (
      ("closed_at" IS NULL AND "close_reason" IS NULL)
      OR ("closed_at" IS NOT NULL AND "close_reason" IS NOT NULL)
    ),
    CONSTRAINT "purchase_session_allowances_purchase_producer_fk"
      FOREIGN KEY ("purchase_id", "producer_id")
      REFERENCES "public"."purchases"("id", "producer_id") ON DELETE RESTRICT
  );

  CREATE TABLE "public"."project_tracks" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "project_id" uuid NOT NULL,
    "purchase_id" uuid NOT NULL,
    "title" text NOT NULL,
    "artist" text,
    "position" integer DEFAULT 0 NOT NULL,
    "workflow_stage" "public"."workflow_stage" DEFAULT 'brief' NOT NULL,
    "archived_at" timestamp with time zone,
    "portfolio_published_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "project_tracks_id_purchase_unique" UNIQUE ("id", "purchase_id"),
    CONSTRAINT "project_tracks_id_project_unique" UNIQUE ("id", "project_id"),
    CONSTRAINT "project_tracks_project_id_projects_id_fk"
      FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE RESTRICT,
    CONSTRAINT "project_tracks_purchase_id_purchases_id_fk"
      FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE RESTRICT,
    CONSTRAINT "project_tracks_purchase_project_fk"
      FOREIGN KEY ("purchase_id", "project_id")
      REFERENCES "public"."purchases"("id", "project_id") ON DELETE RESTRICT
  );
  CREATE INDEX "project_tracks_purchase_position_idx"
    ON "public"."project_tracks" ("purchase_id", "position");

  CREATE TABLE "public"."track_versions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "track_id" uuid NOT NULL,
    "purchase_id" uuid NOT NULL,
    "producer_id" uuid NOT NULL,
    "label" text NOT NULL,
    "audio_url" text,
    "duration_ms" integer,
    "audio_r2_key" text,
    "size_bytes" bigint,
    "audio_object_etag" text,
    "audio_identity_fingerprint" text,
    "peaks_r2_key" text,
    "peaks" jsonb,
    "description" text,
    "uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
    "producer_marked_final_at" timestamp with time zone,
    "audio_deleted_at" timestamp with time zone,
    CONSTRAINT "track_versions_id_purchase_unique" UNIQUE ("id", "purchase_id"),
    CONSTRAINT "track_versions_id_producer_unique" UNIQUE ("id", "producer_id"),
    CONSTRAINT "track_versions_audio_identity_unique"
      UNIQUE ("id", "purchase_id", "audio_identity_fingerprint"),
    CONSTRAINT "track_versions_audio_identity_shape" CHECK ((
      ("audio_url" IS NULL AND "audio_r2_key" IS NULL AND "size_bytes" IS NULL
        AND "audio_object_etag" IS NULL AND "audio_identity_fingerprint" IS NULL)
      OR
      ("audio_url" IS NOT NULL AND "audio_r2_key" IS NOT NULL AND "size_bytes" > 0
        AND "audio_object_etag" <> ''
        AND "audio_identity_fingerprint" = 'sha256:' || encode(sha256(convert_to(
          'skitza-track-audio-v1|'
          || octet_length("audio_r2_key")::text || ':' || "audio_r2_key"
          || '|' || octet_length("audio_object_etag")::text || ':' || "audio_object_etag"
          || '|' || octet_length("size_bytes"::text)::text || ':' || "size_bytes"::text,
          'UTF8'
        )), 'hex'))
    ) IS TRUE),
    CONSTRAINT "track_versions_track_id_project_tracks_id_fk"
      FOREIGN KEY ("track_id") REFERENCES "public"."project_tracks"("id") ON DELETE RESTRICT,
    CONSTRAINT "track_versions_purchase_id_purchases_id_fk"
      FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE RESTRICT,
    CONSTRAINT "track_versions_track_purchase_fk"
      FOREIGN KEY ("track_id", "purchase_id")
      REFERENCES "public"."project_tracks"("id", "purchase_id") ON DELETE RESTRICT,
    CONSTRAINT "track_versions_purchase_producer_fk"
      FOREIGN KEY ("purchase_id", "producer_id")
      REFERENCES "public"."purchases"("id", "producer_id") ON DELETE RESTRICT
  );
  CREATE INDEX "track_versions_purchase_uploaded_idx"
    ON "public"."track_versions" ("purchase_id", "uploaded_at");

  CREATE TABLE "public"."track_comments" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "version_id" uuid NOT NULL,
    "producer_id" uuid NOT NULL,
    "author_name" text NOT NULL,
    "author_email" text NOT NULL,
    "body" text NOT NULL,
    "timestamp_ms" integer NOT NULL,
    "resolved_at" timestamp with time zone,
    "from_producer" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "track_comments_id_producer_unique" UNIQUE ("id", "producer_id"),
    CONSTRAINT "track_comments_version_id_track_versions_id_fk"
      FOREIGN KEY ("version_id") REFERENCES "public"."track_versions"("id") ON DELETE RESTRICT,
    CONSTRAINT "track_comments_version_producer_fk"
      FOREIGN KEY ("version_id", "producer_id")
      REFERENCES "public"."track_versions"("id", "producer_id") ON DELETE RESTRICT
  );

  CREATE TABLE "public"."bookings" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "producer_id" uuid NOT NULL,
    "project_id" uuid NOT NULL,
    "purchase_id" uuid NOT NULL,
    "session_allowance_id" uuid NOT NULL,
    "song_id" uuid,
    "artist_name" text NOT NULL,
    "artist_email" text NOT NULL,
    "artist_phone" text,
    "notes" text,
    "starts_at" timestamp with time zone NOT NULL,
    "duration_min" integer NOT NULL,
    "status" "public"."booking_status" DEFAULT 'pending_approval' NOT NULL,
    "status_changed_at" timestamp with time zone,
    "outcome" "public"."session_use_outcome" DEFAULT 'reserved' NOT NULL,
    "outcome_changed_at" timestamp with time zone,
    "reminder_sent_24h" timestamp with time zone,
    "reminder_sent_1h" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "bookings_id_producer_unique" UNIQUE ("id", "producer_id"),
    CONSTRAINT "bookings_producer_id_producers_id_fk"
      FOREIGN KEY ("producer_id") REFERENCES "public"."producers"("id") ON DELETE RESTRICT,
    CONSTRAINT "bookings_project_id_projects_id_fk"
      FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE RESTRICT,
    CONSTRAINT "bookings_purchase_id_purchases_id_fk"
      FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE RESTRICT,
    CONSTRAINT "bookings_session_allowance_id_purchase_session_allowances_id_fk"
      FOREIGN KEY ("session_allowance_id")
      REFERENCES "public"."purchase_session_allowances"("id") ON DELETE RESTRICT,
    CONSTRAINT "bookings_song_id_project_tracks_id_fk"
      FOREIGN KEY ("song_id") REFERENCES "public"."project_tracks"("id") ON DELETE RESTRICT,
    CONSTRAINT "bookings_purchase_project_fk"
      FOREIGN KEY ("purchase_id", "project_id")
      REFERENCES "public"."purchases"("id", "project_id") ON DELETE RESTRICT,
    CONSTRAINT "bookings_purchase_producer_fk"
      FOREIGN KEY ("purchase_id", "producer_id")
      REFERENCES "public"."purchases"("id", "producer_id") ON DELETE RESTRICT,
    CONSTRAINT "bookings_allowance_purchase_fk"
      FOREIGN KEY ("session_allowance_id", "purchase_id")
      REFERENCES "public"."purchase_session_allowances"("id", "purchase_id") ON DELETE RESTRICT,
    CONSTRAINT "bookings_song_purchase_fk"
      FOREIGN KEY ("song_id", "purchase_id")
      REFERENCES "public"."project_tracks"("id", "purchase_id") ON DELETE RESTRICT
  );
  CREATE INDEX "bookings_producer_starts_idx"
    ON "public"."bookings" ("producer_id", "starts_at");
  CREATE INDEX "bookings_purchase_starts_idx"
    ON "public"."bookings" ("purchase_id", "starts_at");

  CREATE TABLE "public"."purchase_download_override_events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "purchase_id" uuid NOT NULL,
    "version_id" uuid NOT NULL,
    "producer_id" uuid NOT NULL,
    "enabled" boolean NOT NULL,
    "changed_by_clerk_user_id" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "purchase_download_overrides_purchase_producer_fk"
      FOREIGN KEY ("purchase_id", "producer_id")
      REFERENCES "public"."purchases"("id", "producer_id") ON DELETE RESTRICT,
    CONSTRAINT "purchase_download_overrides_version_purchase_fk"
      FOREIGN KEY ("version_id", "purchase_id")
      REFERENCES "public"."track_versions"("id", "purchase_id") ON DELETE RESTRICT
  );
  CREATE INDEX "purchase_download_overrides_version_created_idx"
    ON "public"."purchase_download_override_events" ("purchase_id", "version_id", "created_at");

  CREATE TABLE "public"."version_approval_events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "version_id" uuid NOT NULL,
    "purchase_id" uuid NOT NULL,
    "producer_id" uuid NOT NULL,
    "client_contact_id" uuid NOT NULL,
    "audio_identity_fingerprint" text NOT NULL,
    "action" "public"."version_approval_action" NOT NULL,
    "acted_by_clerk_user_id" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "version_approval_events_version_purchase_fk"
      FOREIGN KEY ("version_id", "purchase_id")
      REFERENCES "public"."track_versions"("id", "purchase_id") ON DELETE RESTRICT,
    CONSTRAINT "version_approval_events_audio_identity_fk"
      FOREIGN KEY ("version_id", "purchase_id", "audio_identity_fingerprint")
      REFERENCES "public"."track_versions"(
        "id", "purchase_id", "audio_identity_fingerprint"
      ) ON DELETE RESTRICT,
    CONSTRAINT "version_approval_events_purchase_owner_fk"
      FOREIGN KEY ("purchase_id", "producer_id", "client_contact_id")
      REFERENCES "public"."purchases"("id", "producer_id", "client_contact_id")
      ON DELETE RESTRICT
  );
  CREATE INDEX "version_approval_events_version_created_idx"
    ON "public"."version_approval_events" ("version_id", "created_at");

  CREATE TABLE "public"."song_public_links" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "track_id" uuid NOT NULL,
    "purchase_id" uuid NOT NULL,
    "producer_id" uuid NOT NULL,
    "token_hash" text NOT NULL,
    "token_version" integer DEFAULT 1 NOT NULL,
    "enabled_at" timestamp with time zone NOT NULL,
    "disabled_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "song_public_links_token_hash_unique" UNIQUE ("token_hash"),
    CONSTRAINT "song_public_links_track_unique" UNIQUE ("track_id"),
    CONSTRAINT "song_public_links_track_purchase_fk"
      FOREIGN KEY ("track_id", "purchase_id")
      REFERENCES "public"."project_tracks"("id", "purchase_id") ON DELETE RESTRICT,
    CONSTRAINT "song_public_links_purchase_producer_fk"
      FOREIGN KEY ("purchase_id", "producer_id")
      REFERENCES "public"."purchases"("id", "producer_id") ON DELETE RESTRICT
  );

  CREATE TABLE "public"."notifications" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "producer_id" uuid NOT NULL,
    "kind" "public"."notification_kind" NOT NULL,
    "title" text NOT NULL,
    "body" text DEFAULT '' NOT NULL,
    "project_id" uuid,
    "track_version_id" uuid,
    "comment_id" uuid,
    "booking_id" uuid,
    "purchase_request_id" uuid,
    "purchase_id" uuid,
    "read_at" timestamp with time zone,
    "archived_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "notifications_producer_id_producers_id_fk"
      FOREIGN KEY ("producer_id") REFERENCES "public"."producers"("id") ON DELETE CASCADE,
    CONSTRAINT "notifications_project_producer_fk"
      FOREIGN KEY ("project_id", "producer_id")
      REFERENCES "public"."projects"("id", "producer_id") ON DELETE RESTRICT,
    CONSTRAINT "notifications_track_version_producer_fk"
      FOREIGN KEY ("track_version_id", "producer_id")
      REFERENCES "public"."track_versions"("id", "producer_id") ON DELETE RESTRICT,
    CONSTRAINT "notifications_comment_producer_fk"
      FOREIGN KEY ("comment_id", "producer_id")
      REFERENCES "public"."track_comments"("id", "producer_id") ON DELETE RESTRICT,
    CONSTRAINT "notifications_booking_producer_fk"
      FOREIGN KEY ("booking_id", "producer_id")
      REFERENCES "public"."bookings"("id", "producer_id") ON DELETE RESTRICT,
    CONSTRAINT "notifications_purchase_request_producer_fk"
      FOREIGN KEY ("purchase_request_id", "producer_id")
      REFERENCES "public"."purchase_requests"("id", "producer_id") ON DELETE RESTRICT,
    CONSTRAINT "notifications_purchase_producer_fk"
      FOREIGN KEY ("purchase_id", "producer_id")
      REFERENCES "public"."purchases"("id", "producer_id") ON DELETE RESTRICT
  );
  CREATE INDEX "notifications_producer_active_idx"
    ON "public"."notifications" ("producer_id", "archived_at", "created_at");

  CREATE FUNCTION "public"."validate_purchase_source_links"()
  RETURNS trigger AS $function$
  BEGIN
    IF NEW."source_kind" IN ('store_product', 'session_product') THEN
      PERFORM 1
      FROM "public"."purchase_requests" AS source_request
      WHERE source_request."id" = NEW."purchase_request_id"
        AND source_request."product_id" = NEW."product_id"
        AND source_request."project_id" = NEW."project_id"
        AND source_request."producer_id" = NEW."producer_id"
        AND source_request."client_contact_id" = NEW."client_contact_id"
      FOR KEY SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          MESSAGE = 'SKITZA_PURCHASE_SOURCE_LINK_MISMATCH';
      END IF;
    ELSIF NEW."source_kind" = 'private_offer' THEN
      PERFORM 1
      FROM "public"."private_offers" AS source_offer
      WHERE source_offer."id" = NEW."private_offer_id"
        AND source_offer."target_project_id" = NEW."project_id"
        AND source_offer."product_id" IS NOT DISTINCT FROM NEW."product_id"
        AND source_offer."producer_id" = NEW."producer_id"
        AND source_offer."client_contact_id" = NEW."client_contact_id"
      FOR KEY SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          MESSAGE = 'SKITZA_PRIVATE_OFFER_SOURCE_MISMATCH';
      END IF;
    ELSE
      IF NEW."product_id" IS NOT NULL THEN
        PERFORM 1
        FROM "public"."products" AS source_product
        WHERE source_product."id" = NEW."product_id"
          AND source_product."producer_id" = NEW."producer_id"
        FOR KEY SHARE;
        IF NOT FOUND THEN
          RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'SKITZA_PURCHASE_SOURCE_LINK_MISMATCH';
        END IF;
      END IF;

      IF NEW."private_offer_id" IS NOT NULL THEN
        PERFORM 1
        FROM "public"."private_offers" AS source_offer
        WHERE source_offer."id" = NEW."private_offer_id"
          AND source_offer."target_project_id" = NEW."project_id"
          AND source_offer."producer_id" = NEW."producer_id"
          AND source_offer."client_contact_id" = NEW."client_contact_id"
          AND (
            NEW."product_id" IS NULL
            OR source_offer."product_id" IS NULL
            OR source_offer."product_id" = NEW."product_id"
          )
        FOR KEY SHARE;
        IF NOT FOUND THEN
          RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'SKITZA_PURCHASE_SOURCE_LINK_MISMATCH';
        END IF;
      END IF;

      IF NEW."purchase_request_id" IS NOT NULL THEN
        PERFORM 1
        FROM "public"."purchase_requests" AS source_request
        WHERE source_request."id" = NEW."purchase_request_id"
          AND source_request."project_id" = NEW."project_id"
          AND source_request."producer_id" = NEW."producer_id"
          AND source_request."client_contact_id" = NEW."client_contact_id"
          AND (
            NEW."product_id" IS NULL
            OR source_request."product_id" = NEW."product_id"
          )
        FOR KEY SHARE;
        IF NOT FOUND THEN
          RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'SKITZA_PURCHASE_SOURCE_LINK_MISMATCH';
        END IF;
      END IF;

      IF NEW."product_id" IS NULL
        AND NEW."private_offer_id" IS NOT NULL
        AND NEW."purchase_request_id" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "public"."private_offers" AS source_offer
          JOIN "public"."purchase_requests" AS source_request
            ON source_request."id" = NEW."purchase_request_id"
          WHERE source_offer."id" = NEW."private_offer_id"
            AND (
              source_offer."product_id" IS NULL
              OR source_offer."product_id" = source_request."product_id"
            )
        )
      THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          MESSAGE = 'SKITZA_PURCHASE_SOURCE_LINK_MISMATCH';
      END IF;
    END IF;

    RETURN NEW;
  END;
  $function$ LANGUAGE plpgsql;

  CREATE TRIGGER "purchases_validate_source_links"
    BEFORE INSERT ON "public"."purchases"
    FOR EACH ROW EXECUTE FUNCTION "public"."validate_purchase_source_links"();

  CREATE FUNCTION "public"."protect_private_offer_purchase_source"()
  RETURNS trigger AS $function$
  BEGIN
    IF ROW(OLD."target_project_id", OLD."product_id") IS DISTINCT FROM
      ROW(NEW."target_project_id", NEW."product_id")
      AND EXISTS (
        SELECT 1
        FROM "public"."purchases" AS linked_purchase
        WHERE linked_purchase."private_offer_id" = OLD."id"
      )
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'SKITZA_PRIVATE_OFFER_PURCHASE_SOURCE_IMMUTABLE';
    END IF;
    RETURN NEW;
  END;
  $function$ LANGUAGE plpgsql;

  CREATE TRIGGER "private_offers_protect_purchase_source"
    BEFORE UPDATE ON "public"."private_offers"
    FOR EACH ROW EXECUTE FUNCTION "public"."protect_private_offer_purchase_source"();

  CREATE FUNCTION "public"."protect_purchase_commercial_snapshot"()
  RETURNS trigger AS $function$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'SKITZA_PURCHASE_DELETE_FORBIDDEN';
    END IF;

    IF ROW(
      OLD."id",
      OLD."producer_id",
      OLD."project_id",
      OLD."client_contact_id",
      OLD."product_id",
      OLD."private_offer_id",
      OLD."purchase_request_id",
      OLD."source_kind",
      OLD."operation_key",
      OLD."operation_digest",
      OLD."ref_number",
      OLD."payment_plan_kind",
      OLD."snapshot_version",
      OLD."snapshot_digest",
      OLD."commercial_snapshot",
      OLD."subtotal_cents",
      OLD."tax_cents",
      OLD."total_cents",
      OLD."currency",
      OLD."accepted_at",
      OLD."created_at"
    ) IS DISTINCT FROM ROW(
      NEW."id",
      NEW."producer_id",
      NEW."project_id",
      NEW."client_contact_id",
      NEW."product_id",
      NEW."private_offer_id",
      NEW."purchase_request_id",
      NEW."source_kind",
      NEW."operation_key",
      NEW."operation_digest",
      NEW."ref_number",
      NEW."payment_plan_kind",
      NEW."snapshot_version",
      NEW."snapshot_digest",
      NEW."commercial_snapshot",
      NEW."subtotal_cents",
      NEW."tax_cents",
      NEW."total_cents",
      NEW."currency",
      NEW."accepted_at",
      NEW."created_at"
    ) THEN
      RAISE EXCEPTION 'SKITZA_PURCHASE_COMMERCIAL_SNAPSHOT_IMMUTABLE';
    END IF;

    IF OLD."lifecycle_status" = 'canceled' THEN
      RAISE EXCEPTION 'SKITZA_PURCHASE_CANCELED_TERMINAL';
    END IF;

    IF OLD."lifecycle_status" = NEW."lifecycle_status" THEN
      IF ROW(OLD."activated_at", OLD."canceled_at") IS DISTINCT FROM
        ROW(NEW."activated_at", NEW."canceled_at")
      THEN
        RAISE EXCEPTION 'SKITZA_PURCHASE_LIFECYCLE_TIMESTAMPS_IMMUTABLE';
      END IF;
    ELSIF NOT (
      (OLD."lifecycle_status" = 'waiting_for_payment' AND NEW."lifecycle_status" IN ('active', 'canceled'))
      OR (OLD."lifecycle_status" = 'active' AND NEW."lifecycle_status" = 'canceled')
    ) THEN
      RAISE EXCEPTION 'SKITZA_PURCHASE_LIFECYCLE_TRANSITION_FORBIDDEN';
    ELSIF OLD."lifecycle_status" = 'waiting_for_payment'
      AND NEW."lifecycle_status" = 'canceled'
      AND NEW."activated_at" IS NOT NULL
    THEN
      RAISE EXCEPTION 'SKITZA_PURCHASE_CANCELED_BEFORE_ACTIVATION';
    ELSIF OLD."activated_at" IS NOT NULL
      AND NEW."activated_at" IS DISTINCT FROM OLD."activated_at"
    THEN
      RAISE EXCEPTION 'SKITZA_PURCHASE_ACTIVATION_TIME_IMMUTABLE';
    END IF;

    RETURN NEW;
  END;
  $function$ LANGUAGE plpgsql;

  CREATE TRIGGER "purchases_protect_commercial_snapshot"
    BEFORE UPDATE OR DELETE ON "public"."purchases"
    FOR EACH ROW EXECUTE FUNCTION "public"."protect_purchase_commercial_snapshot"();

  CREATE FUNCTION "public"."validate_purchase_acceptance"()
  RETURNS trigger AS $function$
  BEGIN
    PERFORM 1
    FROM "public"."purchases"
    WHERE "id" = NEW."purchase_id"
      AND "producer_id" = NEW."producer_id"
      AND "client_contact_id" = NEW."client_contact_id"
      AND "snapshot_digest" = NEW."snapshot_digest"
      AND "commercial_snapshot" = NEW."accepted_snapshot"
      AND "accepted_at" = NEW."accepted_at"
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'SKITZA_ACCEPTANCE_MUST_MATCH_PURCHASE_SNAPSHOT';
    END IF;
    RETURN NEW;
  END;
  $function$ LANGUAGE plpgsql;

  CREATE TRIGGER "purchase_acceptances_validate_purchase"
    BEFORE INSERT ON "public"."purchase_acceptances"
    FOR EACH ROW EXECUTE FUNCTION "public"."validate_purchase_acceptance"();

  CREATE FUNCTION "public"."reject_purchase_installment_after_acceptance"()
  RETURNS trigger AS $function$
  BEGIN
    PERFORM 1
    FROM "public"."purchases"
    WHERE "id" = NEW."purchase_id"
    FOR UPDATE;

    IF EXISTS (
      SELECT 1
      FROM "public"."purchase_acceptances"
      WHERE "purchase_id" = NEW."purchase_id"
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'SKITZA_PURCHASE_INSTALLMENT_SCHEDULE_SEALED';
    END IF;
    RETURN NEW;
  END;
  $function$ LANGUAGE plpgsql;

  CREATE TRIGGER "purchase_installments_reject_accepted_append"
    BEFORE INSERT ON "public"."purchase_installments"
    FOR EACH ROW EXECUTE FUNCTION "public"."reject_purchase_installment_after_acceptance"();

  CREATE FUNCTION "public"."require_paid_purchase_for_installment"()
  RETURNS trigger AS $function$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM "public"."purchases"
      WHERE "id" = NEW."purchase_id"
        AND "producer_id" = NEW."producer_id"
        AND "total_cents" > 0
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'SKITZA_INSTALLMENT_REQUIRES_PAID_PURCHASE';
    END IF;
    RETURN NEW;
  END;
  $function$ LANGUAGE plpgsql;

  CREATE TRIGGER "purchase_installments_require_paid_purchase"
    BEFORE INSERT OR UPDATE ON "public"."purchase_installments"
    FOR EACH ROW EXECUTE FUNCTION "public"."require_paid_purchase_for_installment"();

  CREATE FUNCTION "public"."protect_purchase_installment_terms"()
  RETURNS trigger AS $function$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'SKITZA_PURCHASE_INSTALLMENT_DELETE_FORBIDDEN';
    END IF;
    IF ROW(
      OLD."id", OLD."purchase_id", OLD."producer_id", OLD."position",
      OLD."amount_cents", OLD."currency", OLD."due_trigger",
      OLD."required_for_activation", OLD."created_at"
    ) IS DISTINCT FROM ROW(
      NEW."id", NEW."purchase_id", NEW."producer_id", NEW."position",
      NEW."amount_cents", NEW."currency", NEW."due_trigger",
      NEW."required_for_activation", NEW."created_at"
    ) THEN
      RAISE EXCEPTION 'SKITZA_PURCHASE_INSTALLMENT_TERMS_IMMUTABLE';
    END IF;
    IF OLD."due_at" IS NOT NULL AND NEW."due_at" IS DISTINCT FROM OLD."due_at" THEN
      RAISE EXCEPTION 'SKITZA_PURCHASE_INSTALLMENT_DUE_AT_IMMUTABLE';
    END IF;
    IF OLD."triggered_at" IS NOT NULL
      AND NEW."triggered_at" IS DISTINCT FROM OLD."triggered_at"
    THEN
      RAISE EXCEPTION 'SKITZA_PURCHASE_INSTALLMENT_TRIGGERED_AT_IMMUTABLE';
    END IF;
    IF OLD."status" IN ('confirmed', 'waived', 'canceled')
      AND NEW."status" IS DISTINCT FROM OLD."status"
    THEN
      RAISE EXCEPTION 'SKITZA_PURCHASE_INSTALLMENT_TERMINAL_STATUS_IMMUTABLE';
    END IF;
    RETURN NEW;
  END;
  $function$ LANGUAGE plpgsql;

  CREATE TRIGGER "purchase_installments_protect_terms"
    BEFORE UPDATE OR DELETE ON "public"."purchase_installments"
    FOR EACH ROW EXECUTE FUNCTION "public"."protect_purchase_installment_terms"();

  CREATE FUNCTION "public"."validate_purchase_installment_schedule"()
  RETURNS trigger AS $function$
  DECLARE
    target_purchase_id uuid;
    purchase_total_cents integer;
    purchase_plan_kind text;
    purchase_snapshot jsonb;
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
  BEGIN
    IF TG_TABLE_NAME = 'purchases' THEN
      target_purchase_id := NEW."id";
    ELSIF TG_OP = 'DELETE' THEN
      target_purchase_id := OLD."purchase_id";
    ELSE
      target_purchase_id := NEW."purchase_id";
    END IF;

    SELECT "total_cents", "payment_plan_kind"::text, "commercial_snapshot"
    INTO purchase_total_cents, purchase_plan_kind, purchase_snapshot
    FROM "public"."purchases"
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
              OR "due_trigger" <> 'acceptance'
            )
          )
          OR (
            "position" > 1
            AND (
              "required_for_activation"
              OR (
                purchase_plan_kind = 'split_50_50'
                AND "due_trigger" <> 'artist_approval'
              )
              OR (
                purchase_plan_kind = 'monthly'
                AND "due_trigger" <> 'monthly_anniversary'
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
      invalid_trigger_count
    FROM "public"."purchase_installments"
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
      )
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'SKITZA_PURCHASE_INSTALLMENT_SCHEDULE_INVALID';
    END IF;

    RETURN NULL;
  END;
  $function$ LANGUAGE plpgsql;

  CREATE CONSTRAINT TRIGGER "purchases_validate_installment_schedule"
    AFTER INSERT OR UPDATE ON "public"."purchases"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION "public"."validate_purchase_installment_schedule"();

  CREATE CONSTRAINT TRIGGER "purchase_installments_validate_schedule"
    AFTER INSERT OR UPDATE OR DELETE ON "public"."purchase_installments"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION "public"."validate_purchase_installment_schedule"();

  CREATE CONSTRAINT TRIGGER "purchase_acceptances_validate_schedule"
    AFTER INSERT ON "public"."purchase_acceptances"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION "public"."validate_purchase_installment_schedule"();

  CREATE FUNCTION "public"."validate_payment_proof_replacement"()
  RETURNS trigger AS $function$
  BEGIN
    IF NEW."replaces_proof_id" IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM "public"."payment_proofs"
      WHERE "id" = NEW."replaces_proof_id"
        AND "status" = 'rejected'
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'SKITZA_PAYMENT_PROOF_REPLACEMENT_REQUIRES_REJECTION';
    END IF;
    RETURN NEW;
  END;
  $function$ LANGUAGE plpgsql;

  CREATE TRIGGER "payment_proofs_validate_replacement"
    BEFORE INSERT ON "public"."payment_proofs"
    FOR EACH ROW EXECUTE FUNCTION "public"."validate_payment_proof_replacement"();

  CREATE FUNCTION "public"."protect_payment_proof_evidence"()
  RETURNS trigger AS $function$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'SKITZA_PAYMENT_PROOF_DELETE_FORBIDDEN';
    END IF;
    IF ROW(
      OLD."id", OLD."purchase_id", OLD."installment_id", OLD."producer_id",
      OLD."project_id", OLD."client_contact_id", OLD."replaces_proof_id",
      OLD."amount_cents", OLD."currency", OLD."storage_bucket", OLD."storage_key",
      OLD."object_etag", OLD."original_file_name", OLD."content_type",
      OLD."size_bytes", OLD."note", OLD."created_at"
    ) IS DISTINCT FROM ROW(
      NEW."id", NEW."purchase_id", NEW."installment_id", NEW."producer_id",
      NEW."project_id", NEW."client_contact_id", NEW."replaces_proof_id",
      NEW."amount_cents", NEW."currency", NEW."storage_bucket", NEW."storage_key",
      NEW."object_etag", NEW."original_file_name", NEW."content_type",
      NEW."size_bytes", NEW."note", NEW."created_at"
    ) THEN
      RAISE EXCEPTION 'SKITZA_PAYMENT_PROOF_EVIDENCE_IMMUTABLE';
    END IF;
    IF OLD."status" <> 'pending' THEN
      RAISE EXCEPTION 'SKITZA_PAYMENT_PROOF_TERMINAL_IMMUTABLE';
    END IF;
    IF NEW."status" NOT IN ('pending', 'confirmed', 'rejected') THEN
      RAISE EXCEPTION 'SKITZA_PAYMENT_PROOF_STATUS_TRANSITION_FORBIDDEN';
    END IF;
    RETURN NEW;
  END;
  $function$ LANGUAGE plpgsql;

  CREATE TRIGGER "payment_proofs_protect_evidence"
    BEFORE UPDATE OR DELETE ON "public"."payment_proofs"
    FOR EACH ROW EXECUTE FUNCTION "public"."protect_payment_proof_evidence"();

  CREATE FUNCTION "public"."protect_session_allowance_terms"()
  RETURNS trigger AS $function$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'SKITZA_SESSION_ALLOWANCE_DELETE_FORBIDDEN';
    END IF;
    IF ROW(
      OLD."id", OLD."purchase_id", OLD."producer_id", OLD."kind",
      OLD."session_limit", OLD."duration_min", OLD."location_type",
      OLD."buffer_minutes", OLD."min_lead_hours", OLD."created_at"
    ) IS DISTINCT FROM ROW(
      NEW."id", NEW."purchase_id", NEW."producer_id", NEW."kind",
      NEW."session_limit", NEW."duration_min", NEW."location_type",
      NEW."buffer_minutes", NEW."min_lead_hours", NEW."created_at"
    ) THEN
      RAISE EXCEPTION 'SKITZA_SESSION_ALLOWANCE_TERMS_IMMUTABLE';
    END IF;
    IF OLD."closed_at" IS NOT NULL THEN
      RAISE EXCEPTION 'SKITZA_SESSION_ALLOWANCE_CLOSURE_IMMUTABLE';
    END IF;
    IF NEW."closed_at" IS NULL AND NEW."close_reason" IS NOT NULL THEN
      RAISE EXCEPTION 'SKITZA_SESSION_ALLOWANCE_CLOSE_TRANSITION_INVALID';
    END IF;
    RETURN NEW;
  END;
  $function$ LANGUAGE plpgsql;

  CREATE TRIGGER "purchase_session_allowances_protect_terms"
    BEFORE UPDATE OR DELETE ON "public"."purchase_session_allowances"
    FOR EACH ROW EXECUTE FUNCTION "public"."protect_session_allowance_terms"();

  CREATE FUNCTION "public"."prevent_append_only_mutation"()
  RETURNS trigger AS $function$
  BEGIN
    RAISE EXCEPTION 'SKITZA_APPEND_ONLY_HISTORY_IMMUTABLE';
  END;
  $function$ LANGUAGE plpgsql;

  CREATE TRIGGER "purchase_acceptances_append_only"
    BEFORE UPDATE OR DELETE ON "public"."purchase_acceptances"
    FOR EACH ROW EXECUTE FUNCTION "public"."prevent_append_only_mutation"();
  CREATE TRIGGER "purchase_payments_append_only"
    BEFORE UPDATE OR DELETE ON "public"."purchase_payments"
    FOR EACH ROW EXECUTE FUNCTION "public"."prevent_append_only_mutation"();
  CREATE TRIGGER "purchase_payment_corrections_append_only"
    BEFORE UPDATE OR DELETE ON "public"."purchase_payment_corrections"
    FOR EACH ROW EXECUTE FUNCTION "public"."prevent_append_only_mutation"();
  CREATE TRIGGER "purchase_waivers_append_only"
    BEFORE UPDATE OR DELETE ON "public"."purchase_waivers"
    FOR EACH ROW EXECUTE FUNCTION "public"."prevent_append_only_mutation"();
  CREATE TRIGGER "purchase_cancellations_append_only"
    BEFORE UPDATE OR DELETE ON "public"."purchase_cancellations"
    FOR EACH ROW EXECUTE FUNCTION "public"."prevent_append_only_mutation"();
  CREATE TRIGGER "purchase_download_overrides_append_only"
    BEFORE UPDATE OR DELETE ON "public"."purchase_download_override_events"
    FOR EACH ROW EXECUTE FUNCTION "public"."prevent_append_only_mutation"();
  CREATE TRIGGER "version_approval_events_append_only"
    BEFORE UPDATE OR DELETE ON "public"."version_approval_events"
    FOR EACH ROW EXECUTE FUNCTION "public"."prevent_append_only_mutation"();

  CREATE FUNCTION "public"."protect_project_owner"()
  RETURNS trigger AS $function$
  BEGIN
    IF ROW(OLD."id", OLD."producer_id", OLD."client_contact_id", OLD."created_at")
      IS DISTINCT FROM
      ROW(NEW."id", NEW."producer_id", NEW."client_contact_id", NEW."created_at")
    THEN
      RAISE EXCEPTION 'SKITZA_PROJECT_OWNER_IMMUTABLE';
    END IF;
    RETURN NEW;
  END;
  $function$ LANGUAGE plpgsql;

  CREATE TRIGGER "projects_protect_owner"
    BEFORE UPDATE ON "public"."projects"
    FOR EACH ROW EXECUTE FUNCTION "public"."protect_project_owner"();

  CREATE FUNCTION "public"."protect_purchase_request_identity"()
  RETURNS trigger AS $function$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'SKITZA_PURCHASE_REQUEST_DELETE_FORBIDDEN';
    END IF;

    IF OLD."status" IN ('declined', 'canceled', 'converted')
      AND ROW(
        OLD."status", OLD."status_changed_at", OLD."approved_at", OLD."declined_at",
        OLD."canceled_at", OLD."converted_at"
      ) IS DISTINCT FROM ROW(
        NEW."status", NEW."status_changed_at", NEW."approved_at", NEW."declined_at",
        NEW."canceled_at", NEW."converted_at"
    )
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'SKITZA_PURCHASE_REQUEST_TERMINAL_HISTORY_IMMUTABLE';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM "public"."purchases" AS linked_purchase
      WHERE linked_purchase."purchase_request_id" = OLD."id"
    )
      AND ROW(
        OLD."project_id", OLD."status", OLD."status_changed_at", OLD."approved_at",
        OLD."declined_at", OLD."canceled_at", OLD."converted_at"
      ) IS DISTINCT FROM ROW(
        NEW."project_id", NEW."status", NEW."status_changed_at", NEW."approved_at",
        NEW."declined_at", NEW."canceled_at", NEW."converted_at"
      )
      AND NOT (
        OLD."status" IN ('pending', 'approved')
        AND NEW."status" = 'converted'
        AND OLD."converted_at" IS NULL
        AND NEW."converted_at" IS NOT NULL
        AND NEW."project_id" IS NOT DISTINCT FROM OLD."project_id"
        AND ROW(NEW."approved_at", NEW."declined_at", NEW."canceled_at")
          IS NOT DISTINCT FROM
          ROW(OLD."approved_at", OLD."declined_at", OLD."canceled_at")
    )
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'SKITZA_PURCHASE_REQUEST_LINKED_HISTORY_IMMUTABLE';
    END IF;

    IF OLD."project_id" IS DISTINCT FROM NEW."project_id" THEN
      IF OLD."status" NOT IN ('pending', 'approved')
        OR NEW."status" IS DISTINCT FROM OLD."status"
        OR OLD."converted_at" IS NOT NULL
        OR NEW."converted_at" IS NOT NULL
        OR ROW(
          OLD."status_changed_at", OLD."approved_at", OLD."declined_at", OLD."canceled_at"
        ) IS DISTINCT FROM ROW(
          NEW."status_changed_at", NEW."approved_at", NEW."declined_at", NEW."canceled_at"
        )
        OR NEW."project_id" IS NULL
        OR EXISTS (
          SELECT 1
          FROM "public"."purchases" AS linked_purchase
          WHERE linked_purchase."purchase_request_id" = OLD."id"
        )
        OR NOT EXISTS (
          SELECT 1
          FROM "public"."projects" AS target_project
          WHERE target_project."id" = NEW."project_id"
            AND target_project."producer_id" = OLD."producer_id"
            AND target_project."client_contact_id" = OLD."client_contact_id"
        )
      THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          MESSAGE = 'SKITZA_PURCHASE_REQUEST_PROJECT_CORRECTION_FORBIDDEN';
      END IF;
    END IF;

    IF ROW(
      OLD."id", OLD."producer_id", OLD."client_contact_id", OLD."product_id",
      OLD."operation_key", OLD."operation_digest", OLD."ref_number",
      OLD."artist_name", OLD."artist_email", OLD."requested_song_qty",
      OLD."brief", OLD."created_at"
    ) IS DISTINCT FROM ROW(
      NEW."id", NEW."producer_id", NEW."client_contact_id", NEW."product_id",
      NEW."operation_key", NEW."operation_digest", NEW."ref_number",
      NEW."artist_name", NEW."artist_email", NEW."requested_song_qty",
      NEW."brief", NEW."created_at"
    ) THEN
      RAISE EXCEPTION 'SKITZA_PURCHASE_REQUEST_IDENTITY_IMMUTABLE';
    END IF;
    RETURN NEW;
  END;
  $function$ LANGUAGE plpgsql;

  CREATE TRIGGER "purchase_requests_protect_identity"
    BEFORE UPDATE OR DELETE ON "public"."purchase_requests"
    FOR EACH ROW EXECUTE FUNCTION "public"."protect_purchase_request_identity"();

  CREATE FUNCTION "public"."protect_project_track_identity"()
  RETURNS trigger AS $function$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'SKITZA_PROJECT_TRACK_DELETE_FORBIDDEN';
    END IF;
    IF ROW(OLD."id", OLD."project_id", OLD."purchase_id", OLD."created_at")
      IS DISTINCT FROM ROW(NEW."id", NEW."project_id", NEW."purchase_id", NEW."created_at")
    THEN
      RAISE EXCEPTION 'SKITZA_PROJECT_TRACK_IDENTITY_IMMUTABLE';
    END IF;
    RETURN NEW;
  END;
  $function$ LANGUAGE plpgsql;

  CREATE TRIGGER "project_tracks_protect_identity"
    BEFORE UPDATE OR DELETE ON "public"."project_tracks"
    FOR EACH ROW EXECUTE FUNCTION "public"."protect_project_track_identity"();

  CREATE FUNCTION "public"."protect_track_version_identity"()
  RETURNS trigger AS $function$
  DECLARE
    old_is_placeholder boolean;
    new_is_completed boolean;
    identity_changed boolean;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'SKITZA_TRACK_VERSION_DELETE_FORBIDDEN';
    END IF;
    IF ROW(OLD."id", OLD."track_id", OLD."purchase_id", OLD."producer_id", OLD."uploaded_at")
      IS DISTINCT FROM
      ROW(NEW."id", NEW."track_id", NEW."purchase_id", NEW."producer_id", NEW."uploaded_at")
    THEN
      RAISE EXCEPTION 'SKITZA_TRACK_VERSION_IDENTITY_IMMUTABLE';
    END IF;

    old_is_placeholder := OLD."audio_url" IS NULL
      AND OLD."audio_r2_key" IS NULL
      AND OLD."size_bytes" IS NULL
      AND OLD."audio_object_etag" IS NULL
      AND OLD."audio_identity_fingerprint" IS NULL;
    new_is_completed := NEW."audio_url" IS NOT NULL
      AND NEW."audio_r2_key" IS NOT NULL
      AND NEW."size_bytes" IS NOT NULL
      AND NEW."audio_object_etag" IS NOT NULL
      AND NEW."audio_identity_fingerprint" IS NOT NULL;
    identity_changed := ROW(
      OLD."audio_url", OLD."audio_r2_key", OLD."size_bytes",
      OLD."audio_object_etag", OLD."audio_identity_fingerprint"
    ) IS DISTINCT FROM ROW(
      NEW."audio_url", NEW."audio_r2_key", NEW."size_bytes",
      NEW."audio_object_etag", NEW."audio_identity_fingerprint"
    );

    IF OLD."audio_deleted_at" IS NOT NULL
      AND NEW."audio_deleted_at" IS DISTINCT FROM OLD."audio_deleted_at"
    THEN
      RAISE EXCEPTION 'SKITZA_TRACK_VERSION_AUDIO_DELETION_IMMUTABLE';
    END IF;

    IF identity_changed THEN
      IF NOT old_is_placeholder THEN
        RAISE EXCEPTION 'SKITZA_TRACK_VERSION_AUDIO_IDENTITY_IMMUTABLE';
      END IF;
      IF OLD."audio_deleted_at" IS NOT NULL
        OR NEW."audio_deleted_at" IS NOT NULL
        OR NOT new_is_completed
      THEN
        RAISE EXCEPTION 'SKITZA_TRACK_VERSION_AUDIO_IDENTITY_TRANSITION_FORBIDDEN';
      END IF;
    END IF;
    RETURN NEW;
  END;
  $function$ LANGUAGE plpgsql;

  CREATE TRIGGER "track_versions_protect_identity"
    BEFORE UPDATE OR DELETE ON "public"."track_versions"
    FOR EACH ROW EXECUTE FUNCTION "public"."protect_track_version_identity"();

  CREATE FUNCTION "public"."protect_booking_identity"()
  RETURNS trigger AS $function$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'SKITZA_BOOKING_DELETE_FORBIDDEN';
    END IF;
    IF ROW(
      OLD."id", OLD."producer_id", OLD."project_id", OLD."purchase_id",
      OLD."session_allowance_id", OLD."created_at"
    ) IS DISTINCT FROM ROW(
      NEW."id", NEW."producer_id", NEW."project_id", NEW."purchase_id",
      NEW."session_allowance_id", NEW."created_at"
    ) THEN
      RAISE EXCEPTION 'SKITZA_BOOKING_IDENTITY_IMMUTABLE';
    END IF;
    RETURN NEW;
  END;
  $function$ LANGUAGE plpgsql;

  CREATE TRIGGER "bookings_protect_identity"
    BEFORE UPDATE OR DELETE ON "public"."bookings"
    FOR EACH ROW EXECUTE FUNCTION "public"."protect_booking_identity"();
END
$migration$;
