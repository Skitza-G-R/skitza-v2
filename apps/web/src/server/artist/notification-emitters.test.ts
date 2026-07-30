import { beforeEach, describe, expect, it, vi } from "vitest";

const { getArtistProfileMock, insertedValues, dbMock } = vi.hoisted(() => {
  const getArtistProfileMock = vi.fn();
  const insertedValues: Record<string, unknown>[] = [];
  const dbMock = {
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
  return { getArtistProfileMock, insertedValues, dbMock };
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

vi.mock("@skitza/db", () => ({
  artistNotifications: { id: "artist_notifications.id" },
}));

import {
  emitArtistNewVersionNotification,
  emitArtistProducerCommentNotification,
  emitArtistProofDecisionNotification,
  emitArtistPurchaseDecisionNotification,
  emitArtistSessionNotification,
} from "./notification-emitters";

const recipient = "user_artist_1";
const producerId = "11111111-1111-4111-8111-111111111111";
const subjectId = "22222222-2222-4222-8222-222222222222";
const relatedId = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  insertedValues.length = 0;
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
