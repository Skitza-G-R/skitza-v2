import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getArtistProfileMock, insertedValues, selectedRows, dbMock } = vi.hoisted(() => {
  const getArtistProfileMock = vi.fn();
  const insertedValues: Record<string, unknown>[] = [];
  const selectedRows: Record<string, unknown>[][] = [];
  const dbMock: Record<string, unknown> = {
    execute: () => Promise.resolve({ rows: [] }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectedRows.shift() ?? [{ id: "live-target" }]),
        }),
      }),
    }),
    insert: () => ({
      values: (value: Record<string, unknown>) => {
        insertedValues.push(value);
        return {
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve([{ id: "notification-1" }]),
          }),
        };
      },
    }),
  };
  dbMock.transaction = (callback: (tx: unknown) => unknown) => callback(dbMock);
  return { getArtistProfileMock, insertedValues, selectedRows, dbMock };
});

vi.mock("./profile", () => ({
  defaultArtistNotificationPreferences: () => ({
    purchase: { inApp: true, transactionalEmail: true, activityEmail: false },
    proof: { inApp: true, transactionalEmail: true, activityEmail: false },
    booking: { inApp: true, transactionalEmail: true, activityEmail: false },
    session_reminder: { inApp: true, transactionalEmail: true, activityEmail: false },
    new_music: { inApp: true, transactionalEmail: false, activityEmail: false },
    producer_comment: { inApp: true, transactionalEmail: false, activityEmail: false },
  }),
  getArtistProfile: getArtistProfileMock,
}));

import {
  emitArtistNewVersionNotification,
  emitArtistProducerCommentNotification,
  emitArtistProofDecisionNotification,
  emitArtistPurchaseDecisionNotification,
  emitArtistSessionNotification,
} from "./notification-emitters";

const notificationEmitterSource = readFileSync(
  join(process.cwd(), "src/server/artist/notification-emitters.ts"),
  "utf8",
);

const recipient = "user_artist_1";
const producerId = "11111111-1111-4111-8111-111111111111";
const subjectId = "22222222-2222-4222-8222-222222222222";
const relatedId = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  insertedValues.length = 0;
  selectedRows.length = 0;
  getArtistProfileMock.mockReset().mockResolvedValue({
    timezone: null,
    notificationPreferences: {
      purchase: { inApp: true, transactionalEmail: true, activityEmail: false },
      proof: { inApp: true, transactionalEmail: true, activityEmail: false },
      booking: { inApp: true, transactionalEmail: true, activityEmail: false },
      session_reminder: { inApp: true, transactionalEmail: true, activityEmail: false },
      new_music: { inApp: true, transactionalEmail: false, activityEmail: true },
      producer_comment: { inApp: true, transactionalEmail: false, activityEmail: false },
    },
  });
});

describe("artist notification event emitters", () => {
  it("builds exact purchase and proof destinations with stable dedupe keys", async () => {
    await emitArtistPurchaseDecisionNotification(dbMock as never, {
      recipientClerkUserId: recipient,
      producerId,
      purchaseRequestId: subjectId,
      productId: relatedId,
      producerName: "North Studio",
      productName: "Mix",
      decision: "approved",
    });
    await emitArtistProofDecisionNotification(dbMock as never, {
      recipientClerkUserId: recipient,
      producerId,
      purchaseId: relatedId,
      proofId: subjectId,
      producerName: "North Studio",
      productName: "Mix",
      decision: "verified",
    });

    expect(insertedValues[0]).toMatchObject({
      kind: "purchase_approved",
      destinationHref: `/artist/purchase/${relatedId}/pay?req=${subjectId}`,
      dedupeKey: `purchase:${subjectId}:approved`,
    });
    expect(insertedValues[1]).toMatchObject({
      kind: "proof_verified",
      destinationHref: `/artist/payments/${relatedId}/proof/${subjectId}`,
      dedupeKey: `proof:${subjectId}:verified`,
    });
  });

  it("builds exact session and new-version destinations", async () => {
    await emitArtistSessionNotification(dbMock as never, {
      recipientClerkUserId: recipient,
      producerId,
      bookingId: subjectId,
      producerName: "North Studio",
      sessionName: "Mix review",
      kind: "booking_changed",
      sourceEventId: relatedId,
    });
    const result = await emitArtistNewVersionNotification(dbMock as never, {
      recipientClerkUserId: recipient,
      producerId,
      trackVersionId: subjectId,
      producerName: "North Studio",
      trackTitle: "Afterglow",
      versionLabel: "V3",
    });

    expect(insertedValues[0]).toMatchObject({
      destinationHref: `/artist/sessions/${subjectId}`,
      dedupeKey: `session:${relatedId}:booking_changed`,
    });
    expect(insertedValues[1]).toMatchObject({
      destinationHref: `/artist/music/song/${subjectId}`,
      switcherDotWorthy: true,
    });
    expect(result).toEqual({ inserted: true, emailEnabled: true });
  });

  it("keeps reminder and declined-session events out of Studio Switcher dots", async () => {
    await emitArtistSessionNotification(dbMock as never, {
      recipientClerkUserId: recipient,
      producerId,
      bookingId: subjectId,
      producerName: "North Studio",
      sessionName: "Mix review",
      kind: "session_reminder_24h",
      sourceEventId: `${subjectId}:24h`,
    });
    await emitArtistSessionNotification(dbMock as never, {
      recipientClerkUserId: recipient,
      producerId,
      bookingId: relatedId,
      producerName: "North Studio",
      sessionName: "Mix review",
      kind: "booking_declined",
      sourceEventId: relatedId,
    });

    expect(insertedValues[0]).toMatchObject({
      kind: "session_reminder_24h",
      switcherDotWorthy: false,
    });
    expect(insertedValues[1]).toMatchObject({
      kind: "booking_declined",
      switcherDotWorthy: false,
    });
  });

  it("builds an exact producer-comment destination", async () => {
    await emitArtistProducerCommentNotification(dbMock as never, {
      recipientClerkUserId: recipient,
      producerId,
      trackVersionId: subjectId,
      commentId: relatedId,
      producerName: "North Studio",
      trackTitle: "Afterglow",
    });

    expect(insertedValues[0]).toMatchObject({
      kind: "producer_comment_created",
      subjectType: "track_version",
      subjectId,
      destinationHref: `/artist/music/song/${subjectId}?comment=${relatedId}`,
      dedupeKey: `track-comment:${relatedId}:created`,
    });
  });

  it("suppresses a late notification and email after its Version disappears", async () => {
    selectedRows.push([]);
    const result = await emitArtistNewVersionNotification(dbMock as never, {
      recipientClerkUserId: recipient,
      producerId,
      trackVersionId: subjectId,
      producerName: "North Studio",
      trackTitle: "Afterglow",
      versionLabel: "V3",
    });

    expect(result).toEqual({ inserted: false, emailEnabled: false });
    expect(insertedValues).toEqual([]);
  });

  it("suppresses a late notification and email after its comment disappears", async () => {
    selectedRows.push([{ id: subjectId }], []);
    const result = await emitArtistProducerCommentNotification(dbMock as never, {
      recipientClerkUserId: recipient,
      producerId,
      trackVersionId: subjectId,
      commentId: relatedId,
      producerName: "North Studio",
      trackTitle: "Afterglow",
    });

    expect(result).toEqual({ inserted: false, emailEnabled: false });
    expect(insertedValues).toEqual([]);
  });

  it("locks and proves a live music target before inserting its notification", () => {
    const emitterStart = notificationEmitterSource.indexOf("async function emitArtistNotification");
    const guardedStart = notificationEmitterSource.indexOf("if (liveMusicTarget)", emitterStart);
    const transaction = notificationEmitterSource.indexOf("return db.transaction", guardedStart);
    const quotaLock = notificationEmitterSource.indexOf(
      "await lockProducerAudioStorageQuota(tx, event.producerId)",
      transaction,
    );
    const versionLookup = notificationEmitterSource.indexOf(
      ".select({ id: trackVersions.id })",
      quotaLock,
    );
    const missingVersion = notificationEmitterSource.indexOf(
      "if (!version) return { inserted: false, emailEnabled: false }",
      versionLookup,
    );
    const commentLookup = notificationEmitterSource.indexOf(
      ".select({ id: trackComments.id })",
      missingVersion,
    );
    const missingComment = notificationEmitterSource.indexOf(
      "if (!comment) return { inserted: false, emailEnabled: false }",
      commentLookup,
    );
    const insert = notificationEmitterSource.indexOf(
      ".insert(artistNotifications)",
      missingComment,
    );
    const guardedEnd = notificationEmitterSource.indexOf(
      "if (!values) return { inserted: false, emailEnabled };",
      insert,
    );

    expect(emitterStart).toBeGreaterThanOrEqual(0);
    expect(guardedStart).toBeGreaterThan(emitterStart);
    expect(transaction).toBeGreaterThan(guardedStart);
    expect(quotaLock).toBeGreaterThan(transaction);
    expect(versionLookup).toBeGreaterThan(quotaLock);
    expect(missingVersion).toBeGreaterThan(versionLookup);
    expect(commentLookup).toBeGreaterThan(missingVersion);
    expect(missingComment).toBeGreaterThan(commentLookup);
    expect(insert).toBeGreaterThan(missingComment);
    expect(guardedEnd).toBeGreaterThan(insert);
    expect(notificationEmitterSource.slice(guardedStart, guardedEnd)).not.toMatch(/catch\s*\(/);
  });

  it("snapshots a disabled in-app preference without creating a studio dot", async () => {
    getArtistProfileMock.mockResolvedValueOnce({
      timezone: null,
      notificationPreferences: {
        purchase: { inApp: true, transactionalEmail: true, activityEmail: false },
        proof: { inApp: true, transactionalEmail: true, activityEmail: false },
        booking: { inApp: true, transactionalEmail: true, activityEmail: false },
        session_reminder: { inApp: true, transactionalEmail: true, activityEmail: false },
        new_music: { inApp: false, transactionalEmail: false, activityEmail: false },
        producer_comment: { inApp: true, transactionalEmail: false, activityEmail: false },
      },
    });

    await emitArtistNewVersionNotification(dbMock as never, {
      recipientClerkUserId: recipient,
      producerId,
      trackVersionId: subjectId,
      producerName: "North Studio",
      trackTitle: "Afterglow",
      versionLabel: "V3",
    });
    expect(insertedValues[0]).toMatchObject({
      inAppVisible: false,
      switcherDotWorthy: false,
    });
  });
});
