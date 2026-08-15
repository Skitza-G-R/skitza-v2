import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("Google Calendar warning dismissal migration", () => {
  it("adds a nullable timestamp without changing sync-state truth", () => {
    const migration = readFileSync(
      join(process.cwd(), "drizzle", "0053_google_calendar_warning_dismissal.sql"),
      "utf8",
    );

    expect(migration).toContain('ADD COLUMN "attention_dismissed_at" timestamp with time zone');
    expect(migration).toContain('"booking_calendar_links_attention_dismissed_timestamp_shape"');
    expect(migration).not.toContain('UPDATE "booking_calendar_links"');
    expect(migration).not.toContain('"sync_state" =');
  });
});
