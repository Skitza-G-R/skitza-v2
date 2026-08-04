import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { artistNotifications } from "../schema";

const migrationPath = fileURLToPath(
  new URL("../../drizzle/0040_artist_notification_archiving.sql", import.meta.url),
);

describe("artist notification archiving", () => {
  it("keeps dismissal separate from delivery, read, and open state", () => {
    expect(artistNotifications.archivedAt.name).toBe("archived_at");
    expect(artistNotifications.inAppVisible.name).toBe("in_app_visible");
    expect(artistNotifications.readAt.name).toBe("read_at");
    expect(artistNotifications.openedAt.name).toBe("opened_at");
  });

  it("adds only the nullable archive timestamp and its integrity constraint", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toMatch(
      /ALTER TABLE "artist_notifications"\s+ADD COLUMN "archived_at" timestamp with time zone/,
    );
    expect(migration).toContain("artist_notifications_archived_timestamp_shape");
    expect(migration).toContain('"archived_at" IS NULL OR "archived_at" >= "created_at"');
    expect(migration).not.toContain("DELETE FROM");
    expect(migration).not.toContain('ALTER COLUMN "in_app_visible"');
  });

  it("rebuilds feed and badge indexes around active notification rows", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain('DROP INDEX "artist_notifications_recipient_feed_idx"');
    expect(migration).toContain('DROP INDEX "artist_notifications_recipient_unread_idx"');
    expect(migration).toContain('DROP INDEX "artist_notifications_recipient_studio_dot_idx"');
    expect(migration).toMatch(
      /artist_notifications_recipient_unread_idx[\s\S]*"archived_at" IS NULL[\s\S]*"read_at" IS NULL/,
    );
    expect(migration).toMatch(
      /artist_notifications_recipient_studio_dot_idx[\s\S]*"archived_at" IS NULL[\s\S]*"opened_at" IS NULL/,
    );
  });
});
