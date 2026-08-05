import { readFileSync } from "node:fs";

import type { Db } from "@skitza/db";
import { describe, expect, it, vi } from "vitest";

import { archiveAllProducerNotifications, archiveProducerNotification } from "../inbox";

const inboxSource = readFileSync(new URL("../inbox.ts", import.meta.url), "utf8");

function archiveDb(changedIds: readonly string[]) {
  const returning = vi.fn().mockResolvedValue(changedIds.map((id) => ({ id })));
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  return { db: { update } as unknown as Db, spies: { returning, set, update, where } };
}

describe("producer inbox archive mutations", () => {
  it("archives only an exact producer-owned item", async () => {
    const { db, spies } = archiveDb(["notification-1"]);

    await expect(archiveProducerNotification(db, "producer-1", "notification-1")).resolves.toBe(
      true,
    );
    expect(spies.update).toHaveBeenCalledOnce();
  });

  it("fails closed for a missing or other-producer item", async () => {
    const { db } = archiveDb([]);

    await expect(
      archiveProducerNotification(db, "producer-1", "notification-foreign"),
    ).resolves.toBe(false);
  });

  it("returns the exact Clear all count and is retry-safe", async () => {
    const first = archiveDb(["notification-1", "notification-2"]);
    const retry = archiveDb([]);

    await expect(archiveAllProducerNotifications(first.db, "producer-1")).resolves.toBe(2);
    await expect(archiveAllProducerNotifications(retry.db, "producer-1")).resolves.toBe(0);
  });

  it("keeps exact and Clear all writes tenant-scoped", () => {
    const oneStart = inboxSource.indexOf("export async function archiveProducerNotification");
    const allStart = inboxSource.indexOf("export async function archiveAllProducerNotifications");
    const routerStart = inboxSource.indexOf("export const inboxRouter");
    const archiveOne = inboxSource.slice(oneStart, allStart);
    const archiveAll = inboxSource.slice(allStart, routerStart);

    expect(archiveOne).toContain("eq(notifications.id, notificationId)");
    expect(archiveOne).toContain("eq(notifications.producerId, producerId)");
    expect(archiveAll).toContain("eq(notifications.producerId, producerId)");
    expect(archiveAll).toContain("isNull(notifications.archivedAt)");
  });
});
