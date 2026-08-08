import {
  and,
  artistNotifications,
  eq,
  isNull,
  trackComments,
  trackVersions,
  type ArtistNotification,
  type ArtistNotificationPreferenceCategory,
  type Db,
  type NewArtistNotification,
} from "@skitza/db";

import { lockProducerAudioStorageQuota } from "~/server/domain/audio-storage/quota";
import { defaultArtistNotificationPreferences, getArtistProfile } from "./profile";

type ArtistEvent = Readonly<
  Pick<
    NewArtistNotification,
    | "producerId"
    | "kind"
    | "subjectType"
    | "subjectId"
    | "destinationHref"
    | "title"
    | "body"
    | "dedupeKey"
  > & {
    category: ArtistNotificationPreferenceCategory;
    switcherDotWorthy: boolean;
  }
>;

export type ArtistNotificationEmitResult = Readonly<{
  inserted: boolean;
  emailEnabled: boolean;
}>;

type LiveMusicTarget = Readonly<{
  trackVersionId: string;
  commentId?: string;
}>;

async function emitArtistNotification(
  db: Db,
  recipientClerkUserId: string | null,
  event: ArtistEvent,
  liveMusicTarget?: LiveMusicTarget,
): Promise<ArtistNotificationEmitResult> {
  const preferences = recipientClerkUserId
    ? (await getArtistProfile(db, recipientClerkUserId)).notificationPreferences
    : defaultArtistNotificationPreferences();
  const preference = preferences[event.category];
  const emailEnabled = preference.transactionalEmail || preference.activityEmail;

  const values = recipientClerkUserId
    ? {
        recipientClerkUserId,
        producerId: event.producerId,
        kind: event.kind,
        subjectType: event.subjectType,
        subjectId: event.subjectId,
        destinationHref: event.destinationHref,
        title: event.title.slice(0, 160),
        body: (event.body ?? "").slice(0, 280),
        dedupeKey: event.dedupeKey,
        inAppVisible: preference.inApp,
        switcherDotWorthy: preference.inApp && event.switcherDotWorthy,
      }
    : null;

  if (liveMusicTarget) {
    return db.transaction(async (tx) => {
      await lockProducerAudioStorageQuota(tx, event.producerId);
      const [version] = await tx
        .select({ id: trackVersions.id })
        .from(trackVersions)
        .where(
          and(
            eq(trackVersions.id, liveMusicTarget.trackVersionId),
            eq(trackVersions.producerId, event.producerId),
            isNull(trackVersions.audioDeletedAt),
          ),
        )
        .limit(1);
      if (!version) return { inserted: false, emailEnabled: false };

      if (liveMusicTarget.commentId) {
        const [comment] = await tx
          .select({ id: trackComments.id })
          .from(trackComments)
          .where(
            and(
              eq(trackComments.id, liveMusicTarget.commentId),
              eq(trackComments.versionId, liveMusicTarget.trackVersionId),
              eq(trackComments.producerId, event.producerId),
            ),
          )
          .limit(1);
        if (!comment) return { inserted: false, emailEnabled: false };
      }

      if (!values) return { inserted: false, emailEnabled };
      const inserted = await tx
        .insert(artistNotifications)
        .values(values)
        .onConflictDoNothing()
        .returning({ id: artistNotifications.id });
      return { inserted: inserted.length === 1, emailEnabled };
    });
  }

  if (!values) return { inserted: false, emailEnabled };
  const inserted = await db
    .insert(artistNotifications)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: artistNotifications.id });

  return { inserted: inserted.length === 1, emailEnabled };
}

export async function emitArtistPurchaseDecisionNotification(
  db: Db,
  input: {
    recipientClerkUserId: string | null;
    producerId: string;
    purchaseRequestId: string;
    productId: string;
    producerName: string;
    productName: string;
    decision: "approved" | "declined";
  },
): Promise<ArtistNotificationEmitResult> {
  const approved = input.decision === "approved";
  return emitArtistNotification(db, input.recipientClerkUserId, {
    category: "purchase",
    producerId: input.producerId,
    kind: approved ? "purchase_approved" : "purchase_declined",
    subjectType: "purchase_request",
    subjectId: input.purchaseRequestId,
    destinationHref: approved
      ? `/artist/purchase/${input.productId}/pay?req=${input.purchaseRequestId}`
      : `/artist/purchase/${input.productId}/sent?req=${input.purchaseRequestId}`,
    title: approved ? "Your request was approved" : "Your request wasn’t approved",
    body: approved
      ? `${input.producerName} approved ${input.productName}.`
      : `${input.producerName} declined ${input.productName}.`,
    dedupeKey: `purchase:${input.purchaseRequestId}:${input.decision}`,
    switcherDotWorthy: approved,
  });
}

export async function emitArtistProofDecisionNotification(
  db: Db,
  input: {
    recipientClerkUserId: string | null;
    producerId: string;
    purchaseId: string;
    proofId: string;
    producerName: string;
    productName: string;
    decision: "verified" | "rejected";
  },
): Promise<ArtistNotificationEmitResult> {
  const verified = input.decision === "verified";
  return emitArtistNotification(db, input.recipientClerkUserId, {
    category: "proof",
    producerId: input.producerId,
    kind: verified ? "proof_verified" : "proof_rejected",
    subjectType: "payment_proof",
    subjectId: input.proofId,
    destinationHref: `/artist/payments/${input.purchaseId}/proof/${input.proofId}`,
    title: verified ? "Payment proof verified" : "Payment proof needs attention",
    body: verified
      ? `${input.producerName} verified your payment for ${input.productName}.`
      : `${input.producerName} rejected your payment proof for ${input.productName}.`,
    dedupeKey: `proof:${input.proofId}:${input.decision}`,
    switcherDotWorthy: !verified,
  });
}

type ArtistSessionNotificationKind = Extract<
  ArtistNotification["kind"],
  | "booking_confirmed"
  | "booking_declined"
  | "booking_changed"
  | "booking_cancelled"
  | "session_reminder_24h"
  | "session_reminder_1h"
>;

const SESSION_TITLES: Readonly<Record<ArtistSessionNotificationKind, string>> = {
  booking_confirmed: "Session confirmed",
  booking_declined: "Session request declined",
  booking_changed: "Session changed",
  booking_cancelled: "Session cancelled",
  session_reminder_24h: "Session tomorrow",
  session_reminder_1h: "Session in one hour",
};

export async function emitArtistSessionNotification(
  db: Db,
  input: {
    recipientClerkUserId: string | null;
    producerId: string;
    bookingId: string;
    producerName: string;
    sessionName: string;
    kind: ArtistSessionNotificationKind;
    sourceEventId: string;
  },
): Promise<ArtistNotificationEmitResult> {
  const category =
    input.kind === "session_reminder_24h" || input.kind === "session_reminder_1h"
      ? "session_reminder"
      : "booking";
  return emitArtistNotification(db, input.recipientClerkUserId, {
    category,
    producerId: input.producerId,
    kind: input.kind,
    subjectType: "booking",
    subjectId: input.bookingId,
    destinationHref: `/artist/sessions/${input.bookingId}`,
    title: SESSION_TITLES[input.kind],
    body: `${input.sessionName} with ${input.producerName}.`,
    dedupeKey: `session:${input.sourceEventId}:${input.kind}`,
    switcherDotWorthy:
      input.kind === "booking_confirmed" ||
      input.kind === "booking_changed" ||
      input.kind === "booking_cancelled",
  });
}

export async function emitArtistNewVersionNotification(
  db: Db,
  input: {
    recipientClerkUserId: string | null;
    producerId: string;
    trackVersionId: string;
    producerName: string;
    trackTitle: string;
    versionLabel: string;
  },
): Promise<ArtistNotificationEmitResult> {
  return emitArtistNotification(
    db,
    input.recipientClerkUserId,
    {
      category: "new_music",
      producerId: input.producerId,
      kind: "track_version_created",
      subjectType: "track_version",
      subjectId: input.trackVersionId,
      destinationHref: `/artist/music/song/${input.trackVersionId}`,
      title: `New version of ${input.trackTitle}`,
      body: `${input.producerName} uploaded ${input.versionLabel}.`,
      dedupeKey: `track-version:${input.trackVersionId}:created`,
      switcherDotWorthy: true,
    },
    { trackVersionId: input.trackVersionId },
  );
}

export async function emitArtistProducerCommentNotification(
  db: Db,
  input: {
    recipientClerkUserId: string | null;
    producerId: string;
    trackVersionId: string;
    commentId: string;
    producerName: string;
    trackTitle: string;
  },
): Promise<ArtistNotificationEmitResult> {
  return emitArtistNotification(
    db,
    input.recipientClerkUserId,
    {
      category: "producer_comment",
      producerId: input.producerId,
      kind: "producer_comment_created",
      subjectType: "track_version",
      subjectId: input.trackVersionId,
      destinationHref: `/artist/music/song/${input.trackVersionId}?comment=${input.commentId}`,
      title: `New comment on ${input.trackTitle}`,
      body: `${input.producerName} commented on ${input.trackTitle}.`,
      dedupeKey: `track-comment:${input.commentId}:created`,
      switcherDotWorthy: true,
    },
    { trackVersionId: input.trackVersionId, commentId: input.commentId },
  );
}
