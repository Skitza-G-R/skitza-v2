-- SK-302 lets an upsert job carry the producer's IANA studio zone so Google
-- shows each synced session in the studio's local time. SK-300 started
-- sending the field but the payload allow-list still rejected it, which
-- failed every booking that syncs to Google. The zone is optional, so jobs
-- queued before it existed still pass, and it must be a non-empty string
-- when present. Nothing else about the payload contract changes.

ALTER TABLE "calendar_sync_jobs"
  DROP CONSTRAINT "calendar_sync_jobs_payload_shape";

ALTER TABLE "calendar_sync_jobs"
  ADD CONSTRAINT "calendar_sync_jobs_payload_shape" CHECK ((
    jsonb_typeof("payload_snapshot") = 'object'
    AND (
      (
        "operation" = 'send_ics'
        AND "payload_snapshot"->>'schemaVersion' = '1'
        AND "payload_snapshot"->>'method' IN ('REQUEST', 'CANCEL')
        AND ("payload_snapshot"->>'sequence') ~ '^[0-9]+$'
        AND ("payload_snapshot"->>'sequence')::integer = "desired_revision"
        AND NULLIF(btrim("payload_snapshot"->>'uid'), '') IS NOT NULL
        AND char_length("payload_snapshot"->>'uid') <= 255
        AND NULLIF(btrim("payload_snapshot"->>'dtstampUtc'), '') IS NOT NULL
        AND right("payload_snapshot"->>'dtstampUtc', 1) = 'Z'
        AND NULLIF(btrim("payload_snapshot"->>'startsAtUtc'), '') IS NOT NULL
        AND right("payload_snapshot"->>'startsAtUtc', 1) = 'Z'
        AND NULLIF(btrim("payload_snapshot"->>'endsAtUtc'), '') IS NOT NULL
        AND right("payload_snapshot"->>'endsAtUtc', 1) = 'Z'
        AND NULLIF(btrim("payload_snapshot"->>'summary'), '') IS NOT NULL
        AND jsonb_typeof("payload_snapshot"->'description') = 'string'
        AND jsonb_typeof("payload_snapshot"->'organizer') = 'object'
        AND NULLIF(btrim("payload_snapshot"->'organizer'->>'name'), '') IS NOT NULL
        AND NULLIF(btrim("payload_snapshot"->'organizer'->>'email'), '') IS NOT NULL
        AND jsonb_typeof("payload_snapshot"->'attendee') = 'object'
        AND NULLIF(btrim("payload_snapshot"->'attendee'->>'name'), '') IS NOT NULL
        AND NULLIF(btrim("payload_snapshot"->'attendee'->>'email'), '') IS NOT NULL
      )
      OR (
        "operation" IN ('upsert_google_event', 'delete_google_event')
        AND "payload_snapshot"->>'schemaVersion' = '2'
        AND ("payload_snapshot"->>'sequence') ~ '^[0-9]+$'
        AND ("payload_snapshot"->>'sequence')::integer = "desired_revision"
        AND jsonb_typeof("payload_snapshot"->'privateProperties') = 'object'
        AND (("payload_snapshot"->'privateProperties') - ARRAY[
          'skitzaLink', 'skitzaRevision', 'skitzaSchema'
        ]::text[]) = '{}'::jsonb
        AND "payload_snapshot"->'privateProperties'->>'skitzaLink'
          = "booking_calendar_link_id"::text
        AND "payload_snapshot"->'privateProperties'->>'skitzaRevision'
          = "desired_revision"::text
        AND "payload_snapshot"->'privateProperties'->>'skitzaSchema' = '1'
        AND (
          (
            "operation" = 'upsert_google_event'
            AND "payload_snapshot"->>'action' = 'upsert'
            AND ("payload_snapshot" - ARRAY[
              'schemaVersion', 'action', 'eventKind', 'notificationMode', 'sequence',
              'startsAtUtc', 'endsAtUtc', 'timeZone', 'summary', 'artistSafeUrl',
              'attendee', 'privateProperties'
            ]::text[]) = '{}'::jsonb
            AND "payload_snapshot"->>'eventKind' IN ('opaque_hold', 'confirmed')
            AND (
              jsonb_typeof("payload_snapshot"->'timeZone') IS NULL
              OR (
                jsonb_typeof("payload_snapshot"->'timeZone') = 'string'
                AND NULLIF(btrim("payload_snapshot"->>'timeZone'), '') IS NOT NULL
                AND char_length("payload_snapshot"->>'timeZone') <= 255
              )
            )
            AND "payload_snapshot"->>'notificationMode' IN ('none', 'all')
            AND NULLIF(btrim("payload_snapshot"->>'startsAtUtc'), '') IS NOT NULL
            AND right("payload_snapshot"->>'startsAtUtc', 1) = 'Z'
            AND char_length("payload_snapshot"->>'startsAtUtc') <= 64
            AND NULLIF(btrim("payload_snapshot"->>'endsAtUtc'), '') IS NOT NULL
            AND right("payload_snapshot"->>'endsAtUtc', 1) = 'Z'
            AND char_length("payload_snapshot"->>'endsAtUtc') <= 64
            AND "payload_snapshot"->>'endsAtUtc' <> "payload_snapshot"->>'startsAtUtc'
            AND NULLIF(btrim("payload_snapshot"->>'summary'), '') IS NOT NULL
            AND char_length("payload_snapshot"->>'summary') <= 1024
            AND (
              (
                "payload_snapshot"->>'eventKind' = 'opaque_hold'
                AND "payload_snapshot"->>'summary' = 'Reserved'
                AND "payload_snapshot"->>'notificationMode' = 'none'
                AND jsonb_typeof("payload_snapshot"->'artistSafeUrl') = 'null'
                AND jsonb_typeof("payload_snapshot"->'attendee') = 'null'
              )
              OR (
                "payload_snapshot"->>'eventKind' = 'confirmed'
                AND jsonb_typeof("payload_snapshot"->'artistSafeUrl') = 'string'
                AND "payload_snapshot"->>'artistSafeUrl' ~ '^https://[^[:space:]]+$'
                AND char_length("payload_snapshot"->>'artistSafeUrl') <= 2048
                AND jsonb_typeof("payload_snapshot"->'attendee') = 'object'
                AND (("payload_snapshot"->'attendee') - ARRAY['name', 'email']::text[])
                  = '{}'::jsonb
                AND NULLIF(btrim("payload_snapshot"->'attendee'->>'name'), '') IS NOT NULL
                AND char_length("payload_snapshot"->'attendee'->>'name') <= 320
                AND NULLIF(btrim("payload_snapshot"->'attendee'->>'email'), '') IS NOT NULL
                AND char_length("payload_snapshot"->'attendee'->>'email') <= 320
              )
            )
          )
          OR (
            "operation" = 'delete_google_event'
            AND "payload_snapshot"->>'action' = 'delete'
            AND ("payload_snapshot" - ARRAY[
              'schemaVersion', 'action', 'notificationMode', 'sequence', 'privateProperties'
            ]::text[]) = '{}'::jsonb
            AND "payload_snapshot"->>'notificationMode' IN ('none', 'all')
          )
        )
      )
      OR (
        "operation" = 'reconcile_google_event'
        AND "payload_snapshot"->>'schemaVersion' = '3'
        AND "payload_snapshot"->>'action' = 'reconcile'
        AND ("payload_snapshot" - ARRAY[
          'schemaVersion', 'action', 'source', 'watchId', 'messageNumber'
        ]::text[]) = '{}'::jsonb
        AND "payload_snapshot"->>'source' IN ('webhook', 'recovery')
        AND (
          (
            "payload_snapshot"->>'source' = 'webhook'
            AND "google_calendar_watch_id" IS NOT NULL
            AND "webhook_message_number" ~ '^[1-9][0-9]{0,38}$'
            AND "payload_snapshot"->>'watchId' = "google_calendar_watch_id"::text
            AND "payload_snapshot"->>'messageNumber' = "webhook_message_number"
          )
          OR (
            "payload_snapshot"->>'source' = 'recovery'
            AND "google_calendar_watch_id" IS NULL
            AND "webhook_message_number" IS NULL
            AND jsonb_typeof("payload_snapshot"->'watchId') = 'null'
            AND jsonb_typeof("payload_snapshot"->'messageNumber') = 'null'
          )
        )
      )
    )
  ) IS TRUE);
