import { readFileSync } from "node:fs";

import type { Db } from "@skitza/db";
import { describe, expect, it, vi } from "vitest";

import { archiveAllArtistNotifications, archiveArtistNotification } from "./notifications";

const notificationsSource = readFileSync(new URL("./notifications.ts", import.meta.url), "utf8");
const artistHomeSource = readFileSync(
  new URL("../trpc/routers/artist.ts", import.meta.url),
  "utf8",
);

function functionSource(name: string, nextName: string): string {
  const start = notificationsSource.indexOf(`export async function ${name}`);
  const end = notificationsSource.indexOf(`export async function ${nextName}`, start + 1);
  if (start < 0 || end < 0) throw new Error(`Missing function boundary: ${name}`);
  return notificationsSource.slice(start, end);
}

function archiveDb({
  changedIds,
  ownedIds = [],
}: {
  changedIds: readonly string[];
  ownedIds?: readonly string[];
}) {
  const returning = vi.fn().mockResolvedValue(changedIds.map((id) => ({ id })));
  const updateWhere = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set }));
  const limit = vi.fn().mockResolvedValue(ownedIds.map((id) => ({ id })));
  const selectWhere = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from }));

  return {
    db: { select, update } as unknown as Db,
    spies: { from, limit, returning, select, selectWhere, set, update, updateWhere },
  };
}

describe("artist notification archive mutations", () => {
  it("archives the exact owned item", async () => {
    const { db, spies } = archiveDb({ changedIds: ["notification-1"] });

    await expect(archiveArtistNotification(db, "user_artist_1", "notification-1")).resolves.toBe(
      true,
    );
    expect(spies.update).toHaveBeenCalledOnce();
    expect(spies.select).not.toHaveBeenCalled();
  });

  it("is idempotent for an already archived owned item", async () => {
    const { db, spies } = archiveDb({
      changedIds: [],
      ownedIds: ["notification-1"],
    });

    await expect(archiveArtistNotification(db, "user_artist_1", "notification-1")).resolves.toBe(
      true,
    );
    expect(spies.select).toHaveBeenCalledOnce();
  });

  it("fails closed for a missing or other-user item", async () => {
    const { db } = archiveDb({ changedIds: [], ownedIds: [] });

    await expect(
      archiveArtistNotification(db, "user_artist_1", "notification-foreign"),
    ).resolves.toBe(false);
  });

  it("returns the exact number archived by Clear all and is retry-safe", async () => {
    const first = archiveDb({ changedIds: ["notification-1", "notification-2"] });
    const retry = archiveDb({ changedIds: [] });

    await expect(archiveAllArtistNotifications(first.db, "user_artist_1")).resolves.toBe(2);
    await expect(archiveAllArtistNotifications(retry.db, "user_artist_1")).resolves.toBe(0);
  });

  it("scopes exact and Clear all updates to the signed-in artist", () => {
    const archiveOne = functionSource("archiveArtistNotification", "archiveAllArtistNotifications");
    const archiveAll = functionSource(
      "archiveAllArtistNotifications",
      "acknowledgeArtistTrackVersionNotification",
    );

    expect(archiveOne).toContain("eq(artistNotifications.recipientClerkUserId, clerkUserId)");
    expect(archiveOne).toContain("eq(artistNotifications.id, notificationId)");
    expect(archiveOne).toContain("isNull(artistNotifications.archivedAt)");
    expect(archiveAll).toContain("eq(artistNotifications.recipientClerkUserId, clerkUserId)");
    expect(archiveAll).toContain("isNull(artistNotifications.archivedAt)");
  });

  it("excludes archived rows from feeds, badges, dots, and exact opens", () => {
    for (const [name, nextName] of [
      ["listArtistNotifications", "artistNotificationUnreadCount"],
      ["artistNotificationUnreadCount", "artistNotificationStudioDotProducerIds"],
      ["artistNotificationStudioDotProducerIds", "markArtistNotificationRead"],
      ["openArtistNotification", ""],
    ] as const) {
      const source =
        nextName === ""
          ? notificationsSource.slice(notificationsSource.indexOf(`export async function ${name}`))
          : functionSource(name, nextName);
      expect(source).toContain("isNull(artistNotifications.archivedAt)");
    }
    expect(artistHomeSource).toContain("${artistNotifications.archivedAt} is null");
  });
});
