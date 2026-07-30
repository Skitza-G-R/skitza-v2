import {
  and,
  artistHistoricalAccessGrants,
  bookings,
  clientContacts,
  desc,
  eq,
  inArray,
  isNull,
  paymentProofs,
  producers,
  projectTracks,
  projects,
  purchaseDownloadOverrideEvents,
  purchaseRequests,
  purchases,
  purchaseSessionAllowances,
  sql,
  trackComments,
  trackVersions,
  type Db,
  type NewArtistHistoricalAccessGrant,
} from "@skitza/db";

import { purchaseLedgerRepositoryForTransaction } from "~/server/domain/purchase-ledger/db";
import { readPurchaseLedger } from "~/server/domain/purchase-ledger/service";

type TransactionDb = Parameters<Parameters<Db["transaction"]>[0]>[0];
type DisconnectQueryDb = Db | TransactionDb;

export type ArtistDisconnectBlockerKind =
  | "open_purchase_request"
  | "active_purchase"
  | "pending_payment_proof"
  | "pending_booking_decision"
  | "unused_session_allowance"
  | "future_session";

export type ArtistDisconnectBlocker = Readonly<{
  kind: ArtistDisconnectBlockerKind;
  count: number;
  label: string;
}>;

type DisconnectSnapshot = Readonly<{
  purchaseRequests: readonly Readonly<{
    id: string;
    status: "pending" | "approved" | "declined" | "canceled" | "converted";
  }>[];
  purchases: readonly Readonly<{
    id: string;
    lifecycleStatus: "waiting_for_payment" | "active" | "canceled";
    projectLifecycleStatus: "waiting_for_payment" | "active" | "paused" | "completed" | "canceled";
  }>[];
  paymentProofs: readonly Readonly<{
    id: string;
    status: "pending" | "confirmed" | "rejected";
  }>[];
  bookings: readonly Readonly<{
    id: string;
    sessionAllowanceId: string;
    startsAt: Date;
    status:
      | "pending_approval"
      | "confirmed"
      | "rejected"
      | "cancelled"
      | "completed"
      | "no_show";
    outcome:
      | "reserved"
      | "completed"
      | "cancelled_on_time"
      | "cancelled_by_producer"
      | "cancelled_late"
      | "no_show";
  }>[];
  allowances: readonly Readonly<{
    id: string;
    kind: "fixed" | "unlimited";
    sessionLimit: number | null;
    purchaseLifecycleStatus: "waiting_for_payment" | "active" | "canceled";
    projectLifecycleStatus: "waiting_for_payment" | "active" | "paused" | "completed" | "canceled";
  }>[];
}>;

function pluralLabel(count: number, singular: string, plural: string): string {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}

function consumesSessionAllowance(
  outcome: DisconnectSnapshot["bookings"][number]["outcome"],
): boolean {
  return (
    outcome === "reserved" ||
    outcome === "completed" ||
    outcome === "cancelled_late" ||
    outcome === "no_show"
  );
}

/**
 * Pure blocker policy shared by preview and commit. Commit reloads the rows
 * after taking the disconnect lock, so the confirmation can never bypass a
 * blocker that appeared after preview.
 */
export function evaluateArtistDisconnectBlockers(
  snapshot: DisconnectSnapshot,
  now: Date,
): ArtistDisconnectBlocker[] {
  const blockers: ArtistDisconnectBlocker[] = [];

  const openRequests = snapshot.purchaseRequests.filter(
    (request) => request.status === "pending" || request.status === "approved",
  ).length;
  if (openRequests > 0) {
    blockers.push({
      kind: "open_purchase_request",
      count: openRequests,
      label: pluralLabel(
        openRequests,
        "purchase request still needs to be resolved",
        "purchase requests still need to be resolved",
      ),
    });
  }

  const activePurchases = snapshot.purchases.filter(
    (purchase) =>
      purchase.lifecycleStatus !== "canceled" &&
      purchase.projectLifecycleStatus !== "completed" &&
      purchase.projectLifecycleStatus !== "canceled",
  ).length;
  if (activePurchases > 0) {
    blockers.push({
      kind: "active_purchase",
      count: activePurchases,
      label: pluralLabel(
        activePurchases,
        "purchase is still active",
        "purchases are still active",
      ),
    });
  }

  const pendingProofs = snapshot.paymentProofs.filter(
    (proof) => proof.status === "pending",
  ).length;
  if (pendingProofs > 0) {
    blockers.push({
      kind: "pending_payment_proof",
      count: pendingProofs,
      label: pluralLabel(
        pendingProofs,
        "payment proof is awaiting review",
        "payment proofs are awaiting review",
      ),
    });
  }

  const pendingBookings = snapshot.bookings.filter(
    (booking) => booking.status === "pending_approval",
  ).length;
  if (pendingBookings > 0) {
    blockers.push({
      kind: "pending_booking_decision",
      count: pendingBookings,
      label: pluralLabel(
        pendingBookings,
        "session request is awaiting a decision",
        "session requests are awaiting a decision",
      ),
    });
  }

  const consumedByAllowance = new Map<string, number>();
  for (const booking of snapshot.bookings) {
    if (!consumesSessionAllowance(booking.outcome)) continue;
    consumedByAllowance.set(
      booking.sessionAllowanceId,
      (consumedByAllowance.get(booking.sessionAllowanceId) ?? 0) + 1,
    );
  }
  const unusedAllowances = snapshot.allowances.filter((allowance) => {
    if (
      allowance.purchaseLifecycleStatus === "canceled" ||
      allowance.projectLifecycleStatus === "completed" ||
      allowance.projectLifecycleStatus === "canceled"
    ) {
      return false;
    }
    if (allowance.kind === "unlimited") return allowance.sessionLimit === null;
    if (allowance.sessionLimit === null || allowance.sessionLimit <= 0) return false;
    return (consumedByAllowance.get(allowance.id) ?? 0) < allowance.sessionLimit;
  }).length;
  if (unusedAllowances > 0) {
    blockers.push({
      kind: "unused_session_allowance",
      count: unusedAllowances,
      label: pluralLabel(
        unusedAllowances,
        "purchased session allowance still has time available",
        "purchased session allowances still have time available",
      ),
    });
  }

  const futureSessions = snapshot.bookings.filter(
    (booking) =>
      booking.startsAt.getTime() > now.getTime() &&
      (booking.status === "pending_approval" || booking.status === "confirmed"),
  ).length;
  if (futureSessions > 0) {
    blockers.push({
      kind: "future_session",
      count: futureSessions,
      label: pluralLabel(
        futureSessions,
        "upcoming session must be resolved",
        "upcoming sessions must be resolved",
      ),
    });
  }

  return blockers;
}

async function activeArtistContactIds(
  db: DisconnectQueryDb,
  clerkUserId: string,
  producerId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: clientContacts.id })
    .from(clientContacts)
    .where(
      and(
        eq(clientContacts.clerkUserId, clerkUserId),
        eq(clientContacts.producerId, producerId),
        isNull(clientContacts.archivedAt),
      ),
    );
  return rows.map((row) => row.id);
}

async function loadDisconnectSnapshot(
  db: DisconnectQueryDb,
  producerId: string,
  contactIds: readonly string[],
): Promise<DisconnectSnapshot> {
  if (contactIds.length === 0) {
    return {
      purchaseRequests: [],
      purchases: [],
      paymentProofs: [],
      bookings: [],
      allowances: [],
    };
  }

  const requestRows = await db
    .select({
      id: purchaseRequests.id,
      status: purchaseRequests.status,
    })
    .from(purchaseRequests)
    .where(
      and(
        eq(purchaseRequests.producerId, producerId),
        inArray(purchaseRequests.clientContactId, [...contactIds]),
      ),
    );

  const purchaseRows = await db
    .select({
      id: purchases.id,
      lifecycleStatus: purchases.lifecycleStatus,
      projectLifecycleStatus: projects.lifecycleStatus,
    })
    .from(purchases)
    .innerJoin(
      projects,
      and(
        eq(projects.id, purchases.projectId),
        eq(projects.producerId, purchases.producerId),
        eq(projects.clientContactId, purchases.clientContactId),
      ),
    )
    .where(
      and(
        eq(purchases.producerId, producerId),
        inArray(purchases.clientContactId, [...contactIds]),
      ),
    );

  const proofRows = await db
    .select({
      id: paymentProofs.id,
      status: paymentProofs.status,
    })
    .from(paymentProofs)
    .where(
      and(
        eq(paymentProofs.producerId, producerId),
        inArray(paymentProofs.clientContactId, [...contactIds]),
      ),
    );

  const bookingRows = await db
    .select({
      id: bookings.id,
      sessionAllowanceId: bookings.sessionAllowanceId,
      startsAt: bookings.startsAt,
      status: bookings.status,
      outcome: bookings.outcome,
    })
    .from(bookings)
    .innerJoin(
      purchases,
      and(
        eq(purchases.id, bookings.purchaseId),
        eq(purchases.producerId, bookings.producerId),
      ),
    )
    .where(
      and(
        eq(bookings.producerId, producerId),
        inArray(purchases.clientContactId, [...contactIds]),
      ),
    );

  const allowanceRows = await db
    .select({
      id: purchaseSessionAllowances.id,
      kind: purchaseSessionAllowances.kind,
      sessionLimit: purchaseSessionAllowances.sessionLimit,
      purchaseLifecycleStatus: purchases.lifecycleStatus,
      projectLifecycleStatus: projects.lifecycleStatus,
    })
    .from(purchaseSessionAllowances)
    .innerJoin(
      purchases,
      and(
        eq(purchases.id, purchaseSessionAllowances.purchaseId),
        eq(purchases.producerId, purchaseSessionAllowances.producerId),
      ),
    )
    .innerJoin(
      projects,
      and(
        eq(projects.id, purchases.projectId),
        eq(projects.producerId, purchases.producerId),
        eq(projects.clientContactId, purchases.clientContactId),
      ),
    )
    .where(
      and(
        eq(purchaseSessionAllowances.producerId, producerId),
        inArray(purchases.clientContactId, [...contactIds]),
        isNull(purchaseSessionAllowances.closedAt),
      ),
    );

  return {
    purchaseRequests: requestRows,
    purchases: purchaseRows,
    paymentProofs: proofRows,
    bookings: bookingRows,
    allowances: allowanceRows,
  };
}

export async function previewArtistStudioDisconnect(
  db: Db,
  input: { clerkUserId: string; producerId: string; now?: Date },
) {
  const contactIds = await activeArtistContactIds(db, input.clerkUserId, input.producerId);
  if (contactIds.length === 0) return null;

  const [[studio], snapshot] = await Promise.all([
    db
      .select({
        name: producers.displayName,
        slug: producers.slug,
      })
      .from(producers)
      .where(eq(producers.id, input.producerId))
      .limit(1),
    loadDisconnectSnapshot(db, input.producerId, contactIds),
  ]);
  if (!studio) return null;

  const blockers = evaluateArtistDisconnectBlockers(snapshot, input.now ?? new Date());
  return {
    producerId: input.producerId,
    producerName: studio.name?.trim() || "Studio",
    producerSlug: studio.slug,
    canDisconnect: blockers.length === 0,
    blockers,
  };
}

async function captureHistoricalGrants(
  tx: TransactionDb,
  input: {
    clerkUserId: string;
    producerId: string;
    contactIds: readonly string[];
    disconnectedAt: Date;
  },
): Promise<number> {
  const purchaseRows = await tx
    .select({ id: purchases.id })
    .from(purchases)
    .where(
      and(
        eq(purchases.producerId, input.producerId),
        inArray(purchases.clientContactId, [...input.contactIds]),
      ),
    );
  const purchaseIds = purchaseRows.map((row) => row.id);

  const projectRows = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.producerId, input.producerId),
        inArray(projects.clientContactId, [...input.contactIds]),
      ),
    );
  const projectIds = projectRows.map((row) => row.id);

  const trackRows =
    projectIds.length === 0
      ? []
      : await tx
          .select({ id: projectTracks.id })
          .from(projectTracks)
          .where(inArray(projectTracks.projectId, projectIds));
  const trackIds = trackRows.map((row) => row.id);

  const versionRows =
    trackIds.length === 0
      ? []
      : await tx
          .select({
            id: trackVersions.id,
            purchaseId: trackVersions.purchaseId,
          })
          .from(trackVersions)
          .where(
            and(
              eq(trackVersions.producerId, input.producerId),
              inArray(trackVersions.trackId, trackIds),
            ),
          );
  const versionIds = versionRows.map((row) => row.id);

  const commentRows =
    versionIds.length === 0
      ? []
      : await tx
          .select({ id: trackComments.id })
          .from(trackComments)
          .where(
            and(
              eq(trackComments.producerId, input.producerId),
              inArray(trackComments.versionId, versionIds),
            ),
          );

  const proofRows = await tx
    .select({ id: paymentProofs.id })
    .from(paymentProofs)
    .where(
      and(
        eq(paymentProofs.producerId, input.producerId),
        inArray(paymentProofs.clientContactId, [...input.contactIds]),
      ),
    );

  const bookingRows =
    purchaseIds.length === 0
      ? []
      : await tx
          .select({ id: bookings.id })
          .from(bookings)
          .where(
            and(
              eq(bookings.producerId, input.producerId),
              inArray(bookings.purchaseId, purchaseIds),
            ),
          );

  const fullyPaidPurchases = new Set<string>();
  for (const purchase of purchaseRows) {
    const ledger = await readPurchaseLedger(
      purchaseLedgerRepositoryForTransaction(tx, {
        producerId: input.producerId,
        purchaseId: purchase.id,
      }),
      {
        producerId: input.producerId,
        purchaseId: purchase.id,
        asOf: input.disconnectedAt,
      },
    );
    if (ledger.projection.fullyPaidForDownloads) {
      fullyPaidPurchases.add(purchase.id);
    }
  }

  const overrideRows =
    versionIds.length === 0
      ? []
      : await tx
          .select({
            versionId: purchaseDownloadOverrideEvents.versionId,
            enabled: purchaseDownloadOverrideEvents.enabled,
          })
          .from(purchaseDownloadOverrideEvents)
          .where(
            and(
              eq(purchaseDownloadOverrideEvents.producerId, input.producerId),
              inArray(purchaseDownloadOverrideEvents.versionId, versionIds),
            ),
          )
          .orderBy(desc(purchaseDownloadOverrideEvents.sequence));
  const latestOverrideByVersion = new Map<string, boolean>();
  for (const override of overrideRows) {
    if (!latestOverrideByVersion.has(override.versionId)) {
      latestOverrideByVersion.set(override.versionId, override.enabled);
    }
  }

  const downloadVersionIds = versionRows
    .filter(
      (version) =>
        fullyPaidPurchases.has(version.purchaseId) ||
        latestOverrideByVersion.get(version.id) === true,
    )
    .map((version) => version.id);

  const grants: NewArtistHistoricalAccessGrant[] = [];
  const add = (
    resourceType: NewArtistHistoricalAccessGrant["resourceType"],
    resourceIds: readonly string[],
  ) => {
    for (const resourceId of new Set(resourceIds)) {
      grants.push({
        artistClerkUserId: input.clerkUserId,
        producerId: input.producerId,
        resourceType,
        resourceId,
        disconnectedAt: input.disconnectedAt,
        createdAt: input.disconnectedAt,
      });
    }
  };

  add("studio", [input.producerId]);
  add("purchase", purchaseIds);
  add("project", projectIds);
  add("track", trackIds);
  add("track_version", versionIds);
  add(
    "track_comment",
    commentRows.map((row) => row.id),
  );
  add(
    "payment_proof",
    proofRows.map((row) => row.id),
  );
  add(
    "booking",
    bookingRows.map((row) => row.id),
  );
  add("track_version_download", downloadVersionIds);

  if (grants.length === 0) return 0;
  const inserted = await tx
    .insert(artistHistoricalAccessGrants)
    .values(grants)
    .onConflictDoNothing()
    .returning({ resourceId: artistHistoricalAccessGrants.resourceId });
  return inserted.length;
}

export class ArtistDisconnectError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "BLOCKED" | "CONCURRENT_CHANGE",
    message: string,
    readonly blockers: readonly ArtistDisconnectBlocker[] = [],
  ) {
    super(message);
    this.name = "ArtistDisconnectError";
  }
}

export async function commitArtistStudioDisconnect(
  db: Db,
  input: { clerkUserId: string; producerId: string; now?: Date },
) {
  const disconnectedAt = input.now ?? new Date();

  return db.transaction(
    async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`artist-disconnect:${input.clerkUserId}:${input.producerId}`}, 0))`,
      );

      const contacts = await tx
        .select({ id: clientContacts.id })
        .from(clientContacts)
        .where(
          and(
            eq(clientContacts.clerkUserId, input.clerkUserId),
            eq(clientContacts.producerId, input.producerId),
            isNull(clientContacts.archivedAt),
          ),
        )
        .for("update");
      if (contacts.length === 0) {
        throw new ArtistDisconnectError("NOT_FOUND", "Studio connection was not found");
      }
      const contactIds = contacts.map((contact) => contact.id);

      const snapshot = await loadDisconnectSnapshot(tx, input.producerId, contactIds);
      const blockers = evaluateArtistDisconnectBlockers(snapshot, disconnectedAt);
      if (blockers.length > 0) {
        throw new ArtistDisconnectError(
          "BLOCKED",
          "Resolve the active work before disconnecting from this studio.",
          blockers,
        );
      }

      const grantedCount = await captureHistoricalGrants(tx, {
        clerkUserId: input.clerkUserId,
        producerId: input.producerId,
        contactIds,
        disconnectedAt,
      });

      const archived = await tx
        .update(clientContacts)
        .set({ archivedAt: disconnectedAt })
        .where(
          and(
            eq(clientContacts.clerkUserId, input.clerkUserId),
            eq(clientContacts.producerId, input.producerId),
            inArray(clientContacts.id, contactIds),
            isNull(clientContacts.archivedAt),
          ),
        )
        .returning({ id: clientContacts.id });
      if (archived.length !== contactIds.length) {
        throw new ArtistDisconnectError(
          "CONCURRENT_CHANGE",
          "The studio connection changed. Review it and try again.",
        );
      }

      return {
        producerId: input.producerId,
        disconnectedAt,
        archivedContactCount: archived.length,
        historicalGrantCount: grantedCount,
      };
    },
    { isolationLevel: "serializable" },
  );
}
