import {
  artistHistoricalAccessGrants,
  artistNotifications,
  bookings,
  paymentProofs,
  trackComments,
  trackVersions,
  type ArtistNotification,
  type Db,
} from "@skitza/db";
import { describe, expect, it, vi } from "vitest";

import {
  acknowledgeArtistTrackVersionNotification,
  openArtistNotification,
  validateArtistNotificationDestination,
} from "./notifications";

const bookingId = "11111111-1111-4111-8111-111111111111";
const versionId = "22222222-2222-4222-8222-222222222222";
const commentId = "33333333-3333-4333-8333-333333333333";
const purchaseId = "44444444-4444-4444-8444-444444444444";
const proofId = "55555555-5555-4555-8555-555555555555";
const productId = "66666666-6666-4666-8666-666666666666";
const requestId = "77777777-7777-4777-8777-777777777777";
const producerId = "88888888-8888-4888-8888-888888888888";
const notificationId = "99999999-9999-4999-8999-999999999999";
const trackId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type NotificationOverrides = Pick<
  ArtistNotification,
  "kind" | "subjectType" | "subjectId" | "destinationHref"
>;

function notification(overrides: NotificationOverrides): ArtistNotification {
  return {
    id: notificationId,
    recipientClerkUserId: "user_artist_1",
    producerId,
    title: "Update",
    body: "",
    dedupeKey: `test:${overrides.subjectId}`,
    inAppVisible: true,
    switcherDotWorthy: true,
    readAt: null,
    openedAt: null,
    createdAt: new Date("2026-07-30T12:00:00.000Z"),
    ...overrides,
  };
}

class NotificationSelectQuery {
  private rows: readonly unknown[] = [];

  constructor(private readonly db: NotificationTestDb) {}

  from(table: unknown): this {
    this.rows = this.db.takeRows(table);
    return this;
  }

  innerJoin(): this {
    return this;
  }

  where(): this {
    return this;
  }

  limit(): Promise<readonly unknown[]> {
    return Promise.resolve(this.rows);
  }
}

class NotificationTestDb {
  updateCount = 0;
  private readonly rows = new Map<unknown, (readonly unknown[])[]>();

  constructor(
    notificationRow: ArtistNotification,
    entries: readonly (readonly [unknown, readonly (readonly unknown[])[]])[],
  ) {
    this.rows.set(artistNotifications, [[notificationRow]]);
    for (const [table, queuedRows] of entries) {
      this.rows.set(table, queuedRows.map((rows) => [...rows]));
    }
  }

  select(): NotificationSelectQuery {
    return new NotificationSelectQuery(this);
  }

  takeRows(table: unknown): readonly unknown[] {
    const queue = this.rows.get(table);
    const rows = queue?.shift();
    if (!rows) throw new Error("Unexpected notification test query");
    return rows;
  }

  update(table: unknown) {
    if (table !== artistNotifications) {
      throw new Error("Notification open may update only its notification row");
    }
    this.updateCount += 1;
    return {
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([{ id: notificationId }]),
        }),
      }),
    };
  }

  asDb(): Db {
    return this as unknown as Db;
  }
}

async function openWithRows(
  row: ArtistNotification,
  entries: readonly (readonly [unknown, readonly (readonly unknown[])[]])[],
) {
  const db = new NotificationTestDb(row, entries);
  const href = await openArtistNotification(
    db.asDb(),
    row.recipientClerkUserId,
    row.id,
  );
  return { db, href };
}

describe("validateArtistNotificationDestination", () => {
  it("accepts only the exact owned-record route for a booking", () => {
    expect(
      validateArtistNotificationDestination({
        kind: "booking_confirmed",
        subjectType: "booking",
        subjectId: bookingId,
        destinationHref: `/artist/sessions/${bookingId}`,
      }),
    ).toEqual({ href: `/artist/sessions/${bookingId}`, commentId: null });

    expect(
      validateArtistNotificationDestination({
        kind: "booking_confirmed",
        subjectType: "booking",
        subjectId: bookingId,
        destinationHref: "/artist/sessions",
      }),
    ).toBeNull();
    expect(
      validateArtistNotificationDestination({
        kind: "purchase_approved",
        subjectType: "booking",
        subjectId: bookingId,
        destinationHref: `/artist/sessions/${bookingId}`,
      }),
    ).toBeNull();
  });

  it("accepts a track version and verifies the exact comment query target", () => {
    expect(
      validateArtistNotificationDestination({
        kind: "track_version_created",
        subjectType: "track_version",
        subjectId: versionId,
        destinationHref: `/artist/music/song/${versionId}`,
      }),
    ).toEqual({ href: `/artist/music/song/${versionId}`, commentId: null });

    expect(
      validateArtistNotificationDestination({
        kind: "producer_comment_created",
        subjectType: "track_version",
        subjectId: versionId,
        destinationHref: `/artist/music/song/${versionId}?comment=${commentId}`,
      }),
    ).toEqual({
      href: `/artist/music/song/${versionId}?comment=${commentId}`,
      commentId,
    });
  });

  it("accepts exact purchase and proof record destinations", () => {
    expect(
      validateArtistNotificationDestination({
        kind: "purchase_approved",
        subjectType: "purchase_request",
        subjectId: requestId,
        destinationHref: `/artist/purchase/${productId}/pay?req=${requestId}`,
      }),
    ).toEqual({
      href: `/artist/purchase/${productId}/pay?req=${requestId}`,
      commentId: null,
      productId,
    });
    expect(
      validateArtistNotificationDestination({
        kind: "proof_verified",
        subjectType: "payment_proof",
        subjectId: proofId,
        destinationHref: `/artist/payments/${purchaseId}/proof/${proofId}`,
      }),
    ).toEqual({
      href: `/artist/payments/${purchaseId}/proof/${proofId}`,
      commentId: null,
      purchaseId,
    });
  });

  it("fails closed for mismatched and external destinations", () => {
    expect(
      validateArtistNotificationDestination({
        kind: "producer_comment_created",
        subjectType: "track_version",
        subjectId: versionId,
        destinationHref: `/artist/music/song/${bookingId}?comment=${commentId}`,
      }),
    ).toBeNull();
    expect(
      validateArtistNotificationDestination({
        kind: "track_version_created",
        subjectType: "track_version",
        subjectId: versionId,
        destinationHref: "https://example.com/artist/music",
      }),
    ).toBeNull();
    expect(
      validateArtistNotificationDestination({
        kind: "purchase_approved",
        subjectType: "purchase_request",
        subjectId: requestId,
        destinationHref: `/artist/purchase/${productId}/pay?req=${bookingId}`,
      }),
    ).toBeNull();
    expect(
      validateArtistNotificationDestination({
        kind: "proof_verified",
        subjectType: "payment_proof",
        subjectId: proofId,
        destinationHref: `/artist/payments/${purchaseId}/proof/${bookingId}`,
      }),
    ).toBeNull();
  });
});

describe("acknowledgeArtistTrackVersionNotification", () => {
  it("is idempotent when the exact version notification is already opened", async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));

    const count = await acknowledgeArtistTrackVersionNotification(
      { update } as never,
      "user_artist_1",
      versionId,
    );

    expect(count).toBe(0);
    expect(update).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledOnce();
    expect(where).toHaveBeenCalledOnce();
  });
});

describe("openArtistNotification access-aware navigation", () => {
  it("preserves exact active destinations for every supported historical subject", async () => {
    const proof = notification({
      kind: "proof_verified",
      subjectType: "payment_proof",
      subjectId: proofId,
      destinationHref: `/artist/payments/${purchaseId}/proof/${proofId}`,
    });
    const activeProof = await openWithRows(proof, [
      [paymentProofs, [[{ id: proofId }], [{ id: proofId }]]],
    ]);
    expect(activeProof.href).toBe(proof.destinationHref);

    const session = notification({
      kind: "booking_changed",
      subjectType: "booking",
      subjectId: bookingId,
      destinationHref: `/artist/sessions/${bookingId}`,
    });
    const activeSession = await openWithRows(session, [
      [bookings, [[{ id: bookingId }]]],
    ]);
    expect(activeSession.href).toBe(session.destinationHref);

    const version = notification({
      kind: "track_version_created",
      subjectType: "track_version",
      subjectId: versionId,
      destinationHref: `/artist/music/song/${versionId}`,
    });
    const activeVersion = await openWithRows(version, [
      [trackVersions, [[{ id: versionId }]]],
    ]);
    expect(activeVersion.href).toBe(version.destinationHref);

    const comment = notification({
      kind: "producer_comment_created",
      subjectType: "track_version",
      subjectId: versionId,
      destinationHref: `/artist/music/song/${versionId}?comment=${commentId}`,
    });
    const activeComment = await openWithRows(comment, [
      [trackVersions, [[{ id: versionId }]]],
      [trackComments, [[{ id: commentId }]]],
    ]);
    expect(activeComment.href).toBe(comment.destinationHref);
  });

  it("maps immutable historical grants to exact Past-studio records", async () => {
    const studioHref = `/artist/settings/studios/${producerId}`;

    const proof = notification({
      kind: "proof_rejected",
      subjectType: "payment_proof",
      subjectId: proofId,
      destinationHref: `/artist/payments/${purchaseId}/proof/${proofId}`,
    });
    const historicalProof = await openWithRows(proof, [
      [paymentProofs, [[], [{ id: proofId }]]],
      [artistHistoricalAccessGrants, [[{ resourceId: proofId }]]],
    ]);
    expect(historicalProof.href).toBe(`${studioHref}/proofs/${proofId}`);

    const session = notification({
      kind: "booking_cancelled",
      subjectType: "booking",
      subjectId: bookingId,
      destinationHref: `/artist/sessions/${bookingId}`,
    });
    const historicalSession = await openWithRows(session, [
      [bookings, [[]]],
      [artistHistoricalAccessGrants, [[{ resourceId: bookingId }]]],
    ]);
    expect(historicalSession.href).toBe(`${studioHref}/sessions/${bookingId}`);

    const version = notification({
      kind: "track_version_created",
      subjectType: "track_version",
      subjectId: versionId,
      destinationHref: `/artist/music/song/${versionId}`,
    });
    const historicalVersion = await openWithRows(version, [
      [trackVersions, [[], [{ trackId }]]],
      [artistHistoricalAccessGrants, [[{ resourceId: versionId }]]],
    ]);
    expect(historicalVersion.href).toBe(
      `${studioHref}/music/${trackId}/versions/${versionId}`,
    );

    const comment = notification({
      kind: "producer_comment_created",
      subjectType: "track_version",
      subjectId: versionId,
      destinationHref: `/artist/music/song/${versionId}?comment=${commentId}`,
    });
    const historicalComment = await openWithRows(comment, [
      [trackVersions, [[], [{ trackId }]]],
      [trackComments, [[{ id: commentId }]]],
      [
        artistHistoricalAccessGrants,
        [[{ resourceId: versionId }], [{ resourceId: commentId }]],
      ],
    ]);
    expect(historicalComment.href).toBe(
      `${studioHref}/music/${trackId}/versions/${versionId}?comment=${commentId}`,
    );
  });

  it("fails closed when an exact historical subject or comment grant is absent", async () => {
    const proof = notification({
      kind: "proof_verified",
      subjectType: "payment_proof",
      subjectId: proofId,
      destinationHref: `/artist/payments/${purchaseId}/proof/${proofId}`,
    });
    const deniedProof = await openWithRows(proof, [
      [paymentProofs, [[]]],
      [artistHistoricalAccessGrants, [[]]],
    ]);
    expect(deniedProof.href).toBeNull();
    expect(deniedProof.db.updateCount).toBe(0);

    const comment = notification({
      kind: "producer_comment_created",
      subjectType: "track_version",
      subjectId: versionId,
      destinationHref: `/artist/music/song/${versionId}?comment=${commentId}`,
    });
    const deniedComment = await openWithRows(comment, [
      [trackVersions, [[]]],
      [
        artistHistoricalAccessGrants,
        [[{ resourceId: versionId }], []],
      ],
    ]);
    expect(deniedComment.href).toBeNull();
    expect(deniedComment.db.updateCount).toBe(0);
  });
});
