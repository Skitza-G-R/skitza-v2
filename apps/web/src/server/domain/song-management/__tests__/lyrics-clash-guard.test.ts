import { and, createDb, eq, projectTracks, sql } from "@skitza/db";
import { describe, expect, it } from "vitest";

// SK-305. The clash guard that stops a producer and an artist overwriting each
// other is one SQL predicate. The suite that exercises it against a real
// database (real-db.integration.test.ts) only runs when DATABASE_URL_TEST is
// set, and a skipped suite looks exactly like a passing one in a summary line.
//
// These tests need no database. They compile the same predicate setSongLyrics
// builds and assert what Drizzle actually emits, so a later "simplification"
// of the predicate fails on every ordinary `pnpm test`.
//
// The connection string is never dialled: toSQL() renders, it does not execute.
const renderStampPredicate = (expectedUpdatedAt: Date | null) =>
  createDb("postgresql://render-only@localhost/render-only")
    .update(projectTracks)
    .set({ lyrics: "words" })
    .where(
      and(
        eq(projectTracks.id, "5b2f0a3e-0000-4000-8000-000000000000"),
        sql`${projectTracks.lyricsUpdatedAt} is not distinct from ${expectedUpdatedAt}`,
      ),
    )
    .toSQL();

describe("SK-305 lyrics clash guard predicate", () => {
  it("compares the stamp with IS NOT DISTINCT FROM, never plain equality", () => {
    const { sql: text } = renderStampPredicate(new Date("2026-09-04T10:00:00.000Z"));
    expect(text).toContain('"lyrics_updated_at" is not distinct from');
    // Plain `=` is the bug this whole test exists to prevent: in SQL,
    // `NULL = NULL` is not true, so equality would refuse the very first
    // save of every song — the one where no stamp exists yet.
    expect(text).not.toMatch(/"lyrics_updated_at"\s*=/);
  });

  it("binds an absent stamp as a real null parameter", () => {
    const { params } = renderStampPredicate(null);
    // Position 0 is the new lyrics, 1 is the track id, 2 is the stamp.
    expect(params[2]).toBeNull();
  });

  it("binds a present stamp as the date itself, not a formatted string", () => {
    const stamp = new Date("2026-09-04T10:00:00.000Z");
    const { params } = renderStampPredicate(stamp);
    expect(params[2]).toEqual(stamp);
  });
});
