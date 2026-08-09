import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./webhook-repository.ts", import.meta.url)),
  "utf8",
);

describe("Google Calendar webhook repository contract", () => {
  it("atomically verifies every trust field and advances only newer messages", () => {
    expect(source).toContain("db.transaction");
    expect(source).toContain("googleCalendarWatches.providerChannelId");
    expect(source).toContain("googleCalendarWatches.providerResourceId");
    expect(source).toContain("googleCalendarWatches.channelTokenDigest");
    expect(source).toContain('.for("update")');
    expect(source).toContain("lastMessageNumber}::numeric <");
  });

  it("enqueues only bounded known active links using the minimal schema-v3 payload", () => {
    expect(source).toContain("bookingCalendarLinks.providerState");
    expect(source).toContain('eq(bookings.status, "confirmed")');
    expect(source).toContain("MAX_LINKS_PER_NOTIFICATION");
    expect(source).toContain('operation: "reconcile_google_event"');
    expect(source).toContain("schemaVersion: 3");
    expect(source).not.toContain("events.list");
    expect(source).not.toContain("syncToken");
  });

  it("records the initial sync notification without reading or listing events", () => {
    expect(source).toContain('notification.resourceState === "sync"');
    expect(source).not.toContain("request.body");
  });
});
