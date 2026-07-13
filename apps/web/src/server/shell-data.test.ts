import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  mergeShellNotificationRows,
  NOTIFICATION_FEED_LIMIT,
  type ShellNotificationCandidate,
} from "./shell-data";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "shell-data.ts"), "utf-8");

function candidate(id: string, createdAt: string, read = false): ShellNotificationCandidate {
  return {
    id,
    kind: "comment_created",
    title: id,
    body: "",
    createdAt: new Date(createdAt),
    projectId: null,
    trackVersionId: null,
    commentId: null,
    bookingId: null,
    purchaseRequestId: null,
    readAt: read ? new Date("2026-07-11T12:00:00.000Z") : null,
  };
}

describe("mergeShellNotificationRows", () => {
  it("reserves feed capacity for every surfaced unread row before read context", () => {
    const unreadRows = [
      candidate("unread-old", "2026-07-11T10:00:00.000Z"),
      candidate("unread-new", "2026-07-11T11:00:00.000Z"),
    ];
    const readRows = [
      candidate("read-new", "2026-07-11T12:00:00.000Z", true),
      candidate("read-middle", "2026-07-11T10:30:00.000Z", true),
      candidate("read-old", "2026-07-11T09:00:00.000Z", true),
    ];

    const merged = mergeShellNotificationRows(unreadRows, readRows, 4);

    expect(merged.map((item) => item.id)).toEqual([
      "read-new",
      "unread-new",
      "read-middle",
      "unread-old",
    ]);
    expect(merged.filter((item) => item.readAtIso === null)).toHaveLength(2);
  });

  it("dedupes ids and uses id order as a deterministic timestamp tie-breaker", () => {
    const tiedAt = "2026-07-11T10:00:00.000Z";
    const unread = candidate("b", tiedAt);
    const duplicateRead = { ...candidate("b", tiedAt, true) };

    const merged = mergeShellNotificationRows(
      [unread, unread, candidate("a", tiedAt)],
      [duplicateRead, candidate("c", tiedAt, true)],
      3,
    );

    expect(merged.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(merged.filter((item) => item.id === "b")).toHaveLength(1);
    expect(merged.find((item) => item.id === "b")?.readAtIso).toBeNull();
  });

  it("enforces the safe default cap even when unread volume is higher", () => {
    const unreadRows = Array.from({ length: NOTIFICATION_FEED_LIMIT + 5 }, (_, index) =>
      candidate(
        `unread-${String(index).padStart(2, "0")}`,
        new Date(Date.UTC(2026, 6, 11, 12, index)).toISOString(),
      ),
    );

    const merged = mergeShellNotificationRows(unreadRows, []);

    expect(merged).toHaveLength(NOTIFICATION_FEED_LIMIT);
    expect(merged.every((item) => item.readAtIso === null)).toBe(true);
  });
});

describe("producer shell notification queries", () => {
  it("counts all unread rows but bounds both surfaced data queries", () => {
    expect(SRC).toContain("sql<number>`count(*)`.mapWith(Number)");
    expect(SRC).toMatch(/unreadRows[\s\S]*?isNull\(notifications\.readAt\)/);
    expect(SRC.match(/\.limit\(NOTIFICATION_FEED_LIMIT\)/g)).toHaveLength(2);
    expect(SRC).toContain("unreadCount: unreadCountRows[0]?.value ?? 0");
  });

  it("queries unread rows and recent read context separately", () => {
    expect(SRC).toContain("recentReadRows");
    expect(SRC).toContain("isNotNull(notifications.readAt)");
    expect(SRC).toContain("mergeShellNotificationRows(");
  });

  it("carries read state and purchase request refs into shell items", () => {
    expect(SRC).toContain("purchaseRequestId: notifications.purchaseRequestId");
    expect(SRC).toContain("readAt: notifications.readAt");
    expect(SRC).toContain("purchaseRequestId: row.purchaseRequestId");
    expect(SRC).toContain("readAtIso: row.readAt?.toISOString() ?? null");
  });

  it("only gives pending proofs an exact review deep link", () => {
    expect(SRC).toContain("status: paymentProofs.status");
    expect(SRC).toMatch(
      /proof\?\.purchaseRequestId === notification\.purchaseRequestId &&[\s\S]*?proof\.status === "pending"/,
    );
  });
});
