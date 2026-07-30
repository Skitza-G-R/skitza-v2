import {
  and,
  artistNotifications,
  bookings,
  clientContacts,
  desc,
  eq,
  isNull,
  paymentProofs,
  producers,
  purchaseRequests,
  purchases,
  sql,
  trackComments,
  trackVersions,
  type ArtistNotification,
  type Db,
} from "@skitza/db";

import { hasArtistHistoricalGrant } from "./history";

const UUID_SOURCE =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";
const COMMENT_DESTINATION = new RegExp(
  `^/artist/music/song/(${UUID_SOURCE})\\?comment=(${UUID_SOURCE})$`,
);
const PROOF_DESTINATION = new RegExp(`^/artist/payments/(${UUID_SOURCE})/proof/(${UUID_SOURCE})$`);
const PURCHASE_APPROVED_DESTINATION = new RegExp(
  `^/artist/purchase/(${UUID_SOURCE})/pay\\?req=(${UUID_SOURCE})$`,
);
const PURCHASE_DECLINED_DESTINATION = new RegExp(
  `^/artist/purchase/(${UUID_SOURCE})/sent\\?req=(${UUID_SOURCE})$`,
);
const BOOKING_KINDS = new Set<ArtistNotification["kind"]>([
  "booking_confirmed",
  "booking_declined",
  "booking_changed",
  "booking_cancelled",
  "session_reminder_24h",
  "session_reminder_1h",
]);

type NotificationDestinationInput = Pick<
  ArtistNotification,
  "kind" | "subjectType" | "subjectId" | "destinationHref"
>;

type ValidatedDestination = Readonly<{
  href: string;
  commentId: string | null;
  productId?: string;
  purchaseId?: string;
}>;

type ArtistSubjectAccess =
  | Readonly<{ kind: "active"; trackId: null }>
  | Readonly<{ kind: "historical"; trackId: string | null }>;

/**
 * Fail-closed destination validation for artist notification opens.
 *
 * Only routes that resolve one exact artist-owned record are accepted.
 * Every embedded UUID is checked again against the owned subject before
 * navigation is returned.
 */
export function validateArtistNotificationDestination(
  notification: NotificationDestinationInput,
): ValidatedDestination | null {
  if (
    notification.subjectType === "purchase_request" &&
    (notification.kind === "purchase_approved" || notification.kind === "purchase_declined")
  ) {
    const pattern =
      notification.kind === "purchase_approved"
        ? PURCHASE_APPROVED_DESTINATION
        : PURCHASE_DECLINED_DESTINATION;
    const match = pattern.exec(notification.destinationHref);
    if (
      !match?.[1] ||
      !match[2] ||
      match[2].toLowerCase() !== notification.subjectId.toLowerCase()
    ) {
      return null;
    }
    return {
      href: notification.destinationHref,
      commentId: null,
      productId: match[1],
    };
  }

  if (
    notification.subjectType === "payment_proof" &&
    (notification.kind === "proof_verified" || notification.kind === "proof_rejected")
  ) {
    const match = PROOF_DESTINATION.exec(notification.destinationHref);
    if (
      !match?.[1] ||
      !match[2] ||
      match[2].toLowerCase() !== notification.subjectId.toLowerCase()
    ) {
      return null;
    }
    return {
      href: notification.destinationHref,
      commentId: null,
      purchaseId: match[1],
    };
  }

  if (notification.subjectType === "booking" && BOOKING_KINDS.has(notification.kind)) {
    const href = `/artist/sessions/${notification.subjectId}`;
    return notification.destinationHref === href ? { href, commentId: null } : null;
  }

  if (
    notification.subjectType === "track_version" &&
    notification.kind === "track_version_created"
  ) {
    const href = `/artist/music/song/${notification.subjectId}`;
    return notification.destinationHref === href ? { href, commentId: null } : null;
  }

  if (
    notification.subjectType === "track_version" &&
    notification.kind === "producer_comment_created"
  ) {
    const match = COMMENT_DESTINATION.exec(notification.destinationHref);
    if (!match || match[1]?.toLowerCase() !== notification.subjectId.toLowerCase()) {
      return null;
    }
    return {
      href: notification.destinationHref,
      commentId: match[2] ?? null,
    };
  }

  return null;
}

export type ArtistNotificationFeedFilter = "all" | "unread";

export async function listArtistNotifications(
  db: Db,
  input: {
    clerkUserId: string;
    filter: ArtistNotificationFeedFilter;
    limit?: number;
  },
) {
  const limit = Math.min(50, Math.max(1, input.limit ?? 30));
  const conditions = [
    eq(artistNotifications.recipientClerkUserId, input.clerkUserId),
    eq(artistNotifications.inAppVisible, true),
  ];
  if (input.filter === "unread") {
    conditions.push(isNull(artistNotifications.readAt));
  }

  const rows = await db
    .select({
      id: artistNotifications.id,
      producerId: artistNotifications.producerId,
      producerName: producers.displayName,
      producerBrand: producers.brand,
      kind: artistNotifications.kind,
      title: artistNotifications.title,
      body: artistNotifications.body,
      readAt: artistNotifications.readAt,
      openedAt: artistNotifications.openedAt,
      createdAt: artistNotifications.createdAt,
    })
    .from(artistNotifications)
    .innerJoin(producers, eq(producers.id, artistNotifications.producerId))
    .where(and(...conditions))
    .orderBy(desc(artistNotifications.createdAt), desc(artistNotifications.id))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    producerId: row.producerId,
    producerName: row.producerName?.trim() || "Studio",
    producerLogoUrl: row.producerBrand?.logoUrl ?? null,
    kind: row.kind,
    title: row.title,
    body: row.body,
    readAt: row.readAt,
    openedAt: row.openedAt,
    createdAt: row.createdAt,
  }));
}

export async function artistNotificationUnreadCount(db: Db, clerkUserId: string): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(artistNotifications)
    .where(
      and(
        eq(artistNotifications.recipientClerkUserId, clerkUserId),
        eq(artistNotifications.inAppVisible, true),
        isNull(artistNotifications.readAt),
      ),
    );
  return row?.value ?? 0;
}

export async function artistNotificationStudioDotProducerIds(
  db: Db,
  clerkUserId: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ producerId: artistNotifications.producerId })
    .from(artistNotifications)
    .where(
      and(
        eq(artistNotifications.recipientClerkUserId, clerkUserId),
        eq(artistNotifications.switcherDotWorthy, true),
        isNull(artistNotifications.openedAt),
      ),
    );
  return rows.map((row) => row.producerId);
}

export async function markArtistNotificationRead(
  db: Db,
  clerkUserId: string,
  notificationId: string,
): Promise<boolean> {
  const changed = await db
    .update(artistNotifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(artistNotifications.id, notificationId),
        eq(artistNotifications.recipientClerkUserId, clerkUserId),
        isNull(artistNotifications.readAt),
      ),
    )
    .returning({ id: artistNotifications.id });

  if (changed.length > 0) return true;

  const [owned] = await db
    .select({ id: artistNotifications.id })
    .from(artistNotifications)
    .where(
      and(
        eq(artistNotifications.id, notificationId),
        eq(artistNotifications.recipientClerkUserId, clerkUserId),
      ),
    )
    .limit(1);
  return owned !== undefined;
}

export async function markAllArtistNotificationsRead(db: Db, clerkUserId: string): Promise<number> {
  const changed = await db
    .update(artistNotifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(artistNotifications.recipientClerkUserId, clerkUserId),
        eq(artistNotifications.inAppVisible, true),
        isNull(artistNotifications.readAt),
      ),
    )
    .returning({ id: artistNotifications.id });
  return changed.length;
}

export async function acknowledgeArtistTrackVersionNotification(
  db: Db,
  clerkUserId: string,
  trackVersionId: string,
): Promise<number> {
  const now = new Date();
  const changed = await db
    .update(artistNotifications)
    .set({
      readAt: sql`coalesce(${artistNotifications.readAt}, ${now})`,
      openedAt: sql`coalesce(${artistNotifications.openedAt}, ${now})`,
    })
    .where(
      and(
        eq(artistNotifications.recipientClerkUserId, clerkUserId),
        eq(artistNotifications.kind, "track_version_created"),
        eq(artistNotifications.subjectType, "track_version"),
        eq(artistNotifications.subjectId, trackVersionId),
        eq(artistNotifications.inAppVisible, true),
        isNull(artistNotifications.openedAt),
      ),
    )
    .returning({ id: artistNotifications.id });
  return changed.length;
}

async function hasActiveArtistSubjectAccess(
  db: Db,
  input: {
    clerkUserId: string;
    producerId: string;
    subjectType: ArtistNotification["subjectType"];
    subjectId: string;
  },
): Promise<boolean> {
  const contactPredicate = and(
    eq(clientContacts.clerkUserId, input.clerkUserId),
    eq(clientContacts.producerId, input.producerId),
    isNull(clientContacts.archivedAt),
  );

  if (input.subjectType === "purchase_request") {
    const [row] = await db
      .select({ id: purchaseRequests.id })
      .from(purchaseRequests)
      .innerJoin(
        clientContacts,
        and(
          eq(clientContacts.id, purchaseRequests.clientContactId),
          eq(clientContacts.producerId, purchaseRequests.producerId),
        ),
      )
      .where(
        and(
          eq(purchaseRequests.id, input.subjectId),
          eq(purchaseRequests.producerId, input.producerId),
          contactPredicate,
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  if (input.subjectType === "payment_proof") {
    const [row] = await db
      .select({ id: paymentProofs.id })
      .from(paymentProofs)
      .innerJoin(
        clientContacts,
        and(
          eq(clientContacts.id, paymentProofs.clientContactId),
          eq(clientContacts.producerId, paymentProofs.producerId),
        ),
      )
      .where(
        and(
          eq(paymentProofs.id, input.subjectId),
          eq(paymentProofs.producerId, input.producerId),
          contactPredicate,
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  if (input.subjectType === "booking") {
    const [row] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .innerJoin(
        purchases,
        and(eq(purchases.id, bookings.purchaseId), eq(purchases.producerId, bookings.producerId)),
      )
      .innerJoin(
        clientContacts,
        and(
          eq(clientContacts.id, purchases.clientContactId),
          eq(clientContacts.producerId, purchases.producerId),
        ),
      )
      .where(
        and(
          eq(bookings.id, input.subjectId),
          eq(bookings.producerId, input.producerId),
          contactPredicate,
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  const [row] = await db
    .select({ id: trackVersions.id })
    .from(trackVersions)
    .innerJoin(
      purchases,
      and(
        eq(purchases.id, trackVersions.purchaseId),
        eq(purchases.producerId, trackVersions.producerId),
      ),
    )
    .innerJoin(
      clientContacts,
      and(
        eq(clientContacts.id, purchases.clientContactId),
        eq(clientContacts.producerId, purchases.producerId),
      ),
    )
    .where(
      and(
        eq(trackVersions.id, input.subjectId),
        eq(trackVersions.producerId, input.producerId),
        contactPredicate,
      ),
    )
    .limit(1);
  return row !== undefined;
}

async function resolveArtistSubjectAccess(
  db: Db,
  clerkUserId: string,
  notification: ArtistNotification,
  destination: ValidatedDestination,
): Promise<ArtistSubjectAccess | null> {
  const active = await hasActiveArtistSubjectAccess(db, {
    clerkUserId,
    producerId: notification.producerId,
    subjectType: notification.subjectType,
    subjectId: notification.subjectId,
  });

  const historicalType =
    notification.subjectType === "booking"
      ? "booking"
      : notification.subjectType === "payment_proof"
        ? "payment_proof"
        : notification.subjectType === "track_version"
          ? "track_version"
          : null;
  const historical =
    active || historicalType === null
      ? false
      : await hasArtistHistoricalGrant(db, {
          clerkUserId,
          producerId: notification.producerId,
          resourceType: historicalType,
          resourceId: notification.subjectId,
        });

  if (!active && !historical) return null;

  if (!active && destination.commentId !== null) {
    const commentAllowed = await hasArtistHistoricalGrant(db, {
      clerkUserId,
      producerId: notification.producerId,
      resourceType: "track_comment",
      resourceId: destination.commentId,
    });
    if (!commentAllowed) return null;
  }

  if (notification.subjectType === "purchase_request") {
    if (!destination.productId) return null;
    const [request] = await db
      .select({ id: purchaseRequests.id })
      .from(purchaseRequests)
      .where(
        and(
          eq(purchaseRequests.id, notification.subjectId),
          eq(purchaseRequests.producerId, notification.producerId),
          eq(purchaseRequests.productId, destination.productId),
        ),
      )
      .limit(1);
    return request ? { kind: "active", trackId: null } : null;
  }

  if (notification.subjectType === "payment_proof") {
    if (!destination.purchaseId) return null;
    const [proof] = await db
      .select({ id: paymentProofs.id })
      .from(paymentProofs)
      .where(
        and(
          eq(paymentProofs.id, notification.subjectId),
          eq(paymentProofs.producerId, notification.producerId),
          eq(paymentProofs.purchaseId, destination.purchaseId),
        ),
      )
      .limit(1);
    if (!proof) return null;
  }

  if (destination.commentId !== null) {
    const [comment] = await db
      .select({ id: trackComments.id })
      .from(trackComments)
      .where(
        and(
          eq(trackComments.id, destination.commentId),
          eq(trackComments.versionId, notification.subjectId),
          eq(trackComments.producerId, notification.producerId),
        ),
      )
      .limit(1);
    if (!comment) return null;
  }

  if (active) return { kind: "active", trackId: null };
  if (notification.subjectType !== "track_version") {
    return { kind: "historical", trackId: null };
  }

  const [version] = await db
    .select({ trackId: trackVersions.trackId })
    .from(trackVersions)
    .where(
      and(
        eq(trackVersions.id, notification.subjectId),
        eq(trackVersions.producerId, notification.producerId),
      ),
    )
    .limit(1);
  return version ? { kind: "historical", trackId: version.trackId } : null;
}

function artistNotificationHrefForAccess(
  notification: ArtistNotification,
  destination: ValidatedDestination,
  access: ArtistSubjectAccess,
): string | null {
  if (access.kind === "active") return destination.href;

  const studioHref = `/artist/settings/studios/${encodeURIComponent(
    notification.producerId,
  )}`;
  if (notification.subjectType === "payment_proof") {
    return `${studioHref}/proofs/${encodeURIComponent(notification.subjectId)}`;
  }
  if (notification.subjectType === "booking") {
    return `${studioHref}/sessions/${encodeURIComponent(notification.subjectId)}`;
  }
  if (notification.subjectType !== "track_version" || access.trackId === null) {
    return null;
  }

  const versionHref = `${studioHref}/music/${encodeURIComponent(
    access.trackId,
  )}/versions/${encodeURIComponent(notification.subjectId)}`;
  return destination.commentId === null
    ? versionHref
    : `${versionHref}?comment=${encodeURIComponent(destination.commentId)}`;
}

export async function openArtistNotification(
  db: Db,
  clerkUserId: string,
  notificationId: string,
): Promise<string | null> {
  const [notification] = await db
    .select()
    .from(artistNotifications)
    .where(
      and(
        eq(artistNotifications.id, notificationId),
        eq(artistNotifications.recipientClerkUserId, clerkUserId),
        eq(artistNotifications.inAppVisible, true),
      ),
    )
    .limit(1);
  if (!notification) return null;

  const destination = validateArtistNotificationDestination(notification);
  if (!destination) return null;

  const access = await resolveArtistSubjectAccess(
    db,
    clerkUserId,
    notification,
    destination,
  );
  if (!access) return null;
  const href = artistNotificationHrefForAccess(notification, destination, access);
  if (!href) return null;

  const now = new Date();
  const changed = await db
    .update(artistNotifications)
    .set({
      readAt: sql`coalesce(${artistNotifications.readAt}, ${now})`,
      openedAt: sql`coalesce(${artistNotifications.openedAt}, ${now})`,
    })
    .where(
      and(
        eq(artistNotifications.id, notification.id),
        eq(artistNotifications.recipientClerkUserId, clerkUserId),
      ),
    )
    .returning({ id: artistNotifications.id });

  return changed.length === 1 ? href : null;
}
