import {
  and,
  clientContacts,
  eq,
  isNull,
  producers,
  projects,
  projectTracks,
  purchaseRequests,
  trackVersions,
  type Db,
} from "@skitza/db";
import * as webPush from "web-push";

import { isPushCategory, type PushCategory } from "~/lib/push/categories";
import { validatePushDeepLink } from "~/lib/push/deep-link";

import { webPushConfig, type WebPushConfig } from "./config";
import { DrizzlePushSubscriptionStore } from "./store";
import {
  normalizePushEndpoint,
  type PushSubscriptionStore,
  type StoredPushSubscription,
} from "./subscription-service";

export type PushEvent = Readonly<{
  category: PushCategory;
  url: string;
}>;

export type PushDeliveryResult = Readonly<{
  attempted: number;
  delivered: number;
  deleted: number;
}>;

type Sender = (
  subscription: webPush.PushSubscription,
  payload: string,
  options: webPush.RequestOptions,
) => Promise<unknown>;

const SAFE_COPY: Readonly<Record<PushCategory, { title: string; body: string }>> = {
  booking: {
    title: "Booking update",
    body: "Open Skitza to review the session.",
  },
  payment: {
    title: "Payment update",
    body: "Open Skitza to review the payment.",
  },
  comment: {
    title: "New comment",
    body: "Open Skitza to review the feedback.",
  },
  project_status: {
    title: "Project update",
    body: "Open Skitza to review the project.",
  },
  song_status: {
    title: "Song update",
    body: "Open Skitza to review the song.",
  },
  purchase_status: {
    title: "Purchase update",
    body: "Open Skitza to review the purchase.",
  },
};

function upstreamStatus(error: unknown): number | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
  ) {
    return error.statusCode;
  }
  return null;
}

function safePayload(event: PushEvent): string | null {
  if (!isPushCategory(event.category)) return null;
  const url = validatePushDeepLink(event.url);
  if (!url) return null;
  const copy = SAFE_COPY[event.category];
  return JSON.stringify({
    version: 1,
    category: event.category,
    title: copy.title,
    body: copy.body,
    url,
  });
}

function browserSubscription(
  row: StoredPushSubscription,
  endpoint: string,
): webPush.PushSubscription {
  return {
    endpoint,
    keys: {
      p256dh: row.p256dh,
      auth: row.auth,
    },
  };
}

export async function deliverPushToUser(
  store: PushSubscriptionStore,
  clerkUserId: string,
  event: PushEvent,
  options: Readonly<{
    config?: WebPushConfig | null;
    now?: Date;
    sender?: Sender;
  }> = {},
): Promise<PushDeliveryResult> {
  const config = options.config === undefined ? webPushConfig() : options.config;
  const payload = safePayload(event);
  if (!config || !payload) {
    return { attempted: 0, delivered: 0, deleted: 0 };
  }

  const now = options.now ?? new Date();
  let deleted = await store.deleteExpiredForOwner(clerkUserId, now);
  const rows = await store.listByOwner(clerkUserId);
  const eligible = rows.filter(
    (row) =>
      (row.expiresAt === null || row.expiresAt > now) && row.categories.includes(event.category),
  );
  const sender = options.sender ?? webPush.sendNotification;
  let attempted = 0;
  let delivered = 0;

  for (const row of eligible) {
    let endpoint: string;
    try {
      endpoint = normalizePushEndpoint(row.endpoint);
    } catch {
      if (await store.deleteOwnedById(clerkUserId, row.id).catch(() => false)) {
        deleted += 1;
      }
      continue;
    }

    attempted += 1;
    try {
      await sender(browserSubscription(row, endpoint), payload, {
        TTL: 3600,
        urgency: "normal",
        contentEncoding: "aes128gcm",
        topic: event.category,
        vapidDetails: config,
      });
      delivered += 1;
    } catch (error) {
      const status = upstreamStatus(error);
      if (
        (status === 404 || status === 410) &&
        (await store.deleteOwnedById(clerkUserId, row.id))
      ) {
        deleted += 1;
      }
      // Delivery is a best-effort side effect. Endpoint URLs, encryption
      // keys, payloads, and upstream response bodies are never logged.
    }
  }

  return { attempted, delivered, deleted };
}

export async function deliverPushToClerkUser(
  db: Db,
  clerkUserId: string,
  event: PushEvent,
): Promise<PushDeliveryResult> {
  return deliverPushToUser(new DrizzlePushSubscriptionStore(db), clerkUserId, event);
}

export async function deliverPushToProducer(
  db: Db,
  producerId: string,
  event: PushEvent,
): Promise<PushDeliveryResult> {
  const [producer] = await db
    .select({ clerkUserId: producers.clerkUserId })
    .from(producers)
    .where(eq(producers.id, producerId))
    .limit(1);
  if (!producer) return { attempted: 0, delivered: 0, deleted: 0 };
  return deliverPushToClerkUser(db, producer.clerkUserId, event);
}

export async function deliverPushToProjectArtist(
  db: Db,
  projectId: string,
  event: PushEvent,
): Promise<PushDeliveryResult> {
  const [artist] = await db
    .select({ clerkUserId: clientContacts.clerkUserId })
    .from(projects)
    .innerJoin(
      clientContacts,
      and(
        eq(clientContacts.id, projects.clientContactId),
        eq(clientContacts.producerId, projects.producerId),
      ),
    )
    .where(and(eq(projects.id, projectId), isNull(clientContacts.archivedAt)))
    .limit(1);
  if (!artist?.clerkUserId) {
    return { attempted: 0, delivered: 0, deleted: 0 };
  }
  return deliverPushToClerkUser(db, artist.clerkUserId, event);
}

export async function deliverPushToPurchaseRequestArtist(
  db: Db,
  purchaseRequestId: string,
  event: PushEvent,
): Promise<PushDeliveryResult> {
  const [artist] = await db
    .select({ clerkUserId: clientContacts.clerkUserId })
    .from(purchaseRequests)
    .innerJoin(
      clientContacts,
      and(
        eq(clientContacts.id, purchaseRequests.clientContactId),
        eq(clientContacts.producerId, purchaseRequests.producerId),
      ),
    )
    .where(and(eq(purchaseRequests.id, purchaseRequestId), isNull(clientContacts.archivedAt)))
    .limit(1);
  if (!artist?.clerkUserId) {
    return { attempted: 0, delivered: 0, deleted: 0 };
  }
  return deliverPushToClerkUser(db, artist.clerkUserId, event);
}

export async function deliverPushToVersionArtist(
  db: Db,
  versionId: string,
  event: PushEvent,
): Promise<PushDeliveryResult> {
  const [artist] = await db
    .select({ clerkUserId: clientContacts.clerkUserId })
    .from(trackVersions)
    .innerJoin(projectTracks, eq(projectTracks.id, trackVersions.trackId))
    .innerJoin(projects, eq(projects.id, projectTracks.projectId))
    .innerJoin(
      clientContacts,
      and(
        eq(clientContacts.id, projects.clientContactId),
        eq(clientContacts.producerId, projects.producerId),
      ),
    )
    .where(and(eq(trackVersions.id, versionId), isNull(clientContacts.archivedAt)))
    .limit(1);
  if (!artist?.clerkUserId) {
    return { attempted: 0, delivered: 0, deleted: 0 };
  }
  return deliverPushToClerkUser(db, artist.clerkUserId, event);
}

export async function deliverPushToVersionProducer(
  db: Db,
  versionId: string,
  event: PushEvent,
): Promise<PushDeliveryResult> {
  const [project] = await db
    .select({ producerId: projects.producerId })
    .from(trackVersions)
    .innerJoin(projectTracks, eq(projectTracks.id, trackVersions.trackId))
    .innerJoin(projects, eq(projects.id, projectTracks.projectId))
    .where(eq(trackVersions.id, versionId))
    .limit(1);
  if (!project) return { attempted: 0, delivered: 0, deleted: 0 };
  return deliverPushToProducer(db, project.producerId, event);
}
