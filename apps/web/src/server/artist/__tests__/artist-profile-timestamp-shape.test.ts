import type { Db } from "@skitza/db";
import { describe, expect, it, vi } from "vitest";

import {
  statementNowAfter,
  storedStamp,
  type TimestampValue,
} from "~/server/__tests__/default-now-timestamp-shape";

import {
  defaultArtistNotificationPreferences,
  saveArtistNotificationPreferences,
  saveArtistTimezone,
} from "../profile";

// The same clock mix that broke the ✕ on a "Needs you" row, one screen over.
//
// `artist_profiles` carries
//   CHECK ("updated_at" >= "created_at")
// with `created_at` on the column's own DEFAULT now(). Both writes below are
// upserts, so the very first time an artist saves a timezone or a notification
// toggle they insert the row — and an app-side `new Date()` for `updated_at`
// is read before the statement reaches Neon, so Postgres stamps `created_at`
// after it and rejects the row it was sent.
//
// Every timestamp therefore has to come from the database: the defaults stamp
// the insert, `now()` bumps the conflict path.

const CLERK_USER_ID = "user_artist_timestamp_shape";

type Payload = Record<string, TimestampValue>;

function captureWrite() {
  const insertValues = vi.fn<(payload: Payload) => void>();
  const conflictSet = vi.fn<(payload: Payload) => void>();

  const db = {
    insert: () => ({
      values: (payload: Payload) => {
        insertValues(payload);
        return {
          onConflictDoUpdate: (config: { set: Payload }) => {
            conflictSet(config.set);
            return Promise.resolve();
          },
        };
      },
    }),
  } as unknown as Db;

  return { db, insertValues, conflictSet };
}

const writers = [
  {
    name: "saveArtistTimezone",
    run: (db: Db) => saveArtistTimezone(db, CLERK_USER_ID, "Asia/Jerusalem"),
  },
  {
    name: "saveArtistNotificationPreferences",
    run: (db: Db) =>
      saveArtistNotificationPreferences(db, CLERK_USER_ID, defaultArtistNotificationPreferences()),
  },
];

describe.each(writers)("$name — timestamp shape", ({ run }) => {
  it("writes a first row the updated_at >= created_at CHECK accepts", async () => {
    const { db, insertValues } = captureWrite();
    await run(db);

    const payload = insertValues.mock.calls[0]?.[0] ?? {};
    const statementNow = statementNowAfter(payload);
    const updatedAt = storedStamp(payload.updatedAt, statementNow);
    const createdAt = storedStamp(payload.createdAt, statementNow);

    expect(updatedAt.getTime()).toBeGreaterThanOrEqual(createdAt.getTime());
  });

  it("keeps the CHECK satisfied when the artist already has a profile row", async () => {
    const { db, insertValues, conflictSet } = captureWrite();
    await run(db);

    const payload = insertValues.mock.calls[0]?.[0] ?? {};
    const set = conflictSet.mock.calls[0]?.[0] ?? {};

    expect(set.updatedAt, "a save has to bump updated_at").toBeDefined();

    // The row this save collides with was created by an earlier statement,
    // which ran after this process had already read its own clock.
    const createdAt = statementNowAfter(payload, set);
    const updatedAt = storedStamp(set.updatedAt, new Date(createdAt.getTime() + 5));

    expect(updatedAt.getTime()).toBeGreaterThanOrEqual(createdAt.getTime());
  });
});
