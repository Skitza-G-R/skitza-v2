import {
  and,
  clientContacts,
  desc,
  eq,
  inArray,
  paymentProofs,
  purchases,
  purchaseRequests,
  sql,
  type Db,
} from "@skitza/db";

export type ArtistPurchaseGuard =
  | { blocked: false }
  | {
      blocked: true;
      requestId: string | null;
      productId: string | null;
      purchaseId: string | null;
      status: "pending" | "approved" | "converted";
      href: string;
      label: string;
    };

export function isArtistPurchaseGuardBlocking(input: {
  status: "pending" | "approved" | "declined" | "canceled" | "converted";
  purchaseId: string | null;
  totalCents: number | null;
  verifiedCents: number;
  purchaseLifecycleStatus: "waiting_for_payment" | "active" | "canceled" | null;
}): boolean {
  if (input.status === "pending" || input.status === "approved") return true;
  if (input.status !== "converted") return false;
  if (!input.purchaseId || input.totalCents === null) return true;
  if (input.purchaseLifecycleStatus === "canceled") return false;
  return input.verifiedCents < input.totalCents;
}

/**
 * Resolves the active purchase across every contact row owned by one Clerk
 * artist in a studio. Callers that create work should hold their
 * artist+studio transaction lock before using this helper.
 *
 * Archived contacts remain in scope because their unfinished commercial
 * obligations still block a second purchase. New targets are validated
 * separately by the calling flow.
 */
export async function loadArtistPurchaseGuard(
  db: Pick<Db, "select">,
  input: {
    clerkUserId: string;
    producerId: string;
  },
): Promise<ArtistPurchaseGuard> {
  const contacts = await db
    .select({ id: clientContacts.id })
    .from(clientContacts)
    .where(
      and(
        eq(clientContacts.clerkUserId, input.clerkUserId),
        eq(clientContacts.producerId, input.producerId),
      ),
    );
  const contactIds = contacts.map((contact) => contact.id);
  if (contactIds.length === 0) return { blocked: false };

  const candidates = await db
    .select({
      requestId: purchaseRequests.id,
      productId: purchaseRequests.productId,
      status: purchaseRequests.status,
      purchaseId: purchases.id,
      purchaseLifecycleStatus: purchases.lifecycleStatus,
      totalCents: purchases.totalCents,
      verifiedCents: sql<number>`coalesce(sum(case when ${paymentProofs.status} = 'confirmed' then ${paymentProofs.amountCents} else 0 end), 0)`,
      createdAt: purchaseRequests.createdAt,
    })
    .from(purchaseRequests)
    .leftJoin(purchases, eq(purchases.purchaseRequestId, purchaseRequests.id))
    .leftJoin(paymentProofs, eq(paymentProofs.purchaseId, purchases.id))
    .where(
      and(
        eq(purchaseRequests.producerId, input.producerId),
        inArray(purchaseRequests.clientContactId, contactIds),
        inArray(purchaseRequests.status, ["pending", "approved", "converted"]),
      ),
    )
    .groupBy(
      purchaseRequests.id,
      purchaseRequests.productId,
      purchaseRequests.status,
      purchaseRequests.createdAt,
      purchases.id,
      purchases.lifecycleStatus,
      purchases.totalCents,
    )
    .orderBy(desc(purchaseRequests.createdAt), desc(purchaseRequests.id));

  for (const candidate of candidates) {
    if (
      !isArtistPurchaseGuardBlocking({
        status: candidate.status,
        purchaseId: candidate.purchaseId,
        totalCents: candidate.totalCents,
        verifiedCents: candidate.verifiedCents,
        purchaseLifecycleStatus: candidate.purchaseLifecycleStatus,
      })
    ) {
      continue;
    }
    if (
      candidate.status !== "pending" &&
      candidate.status !== "approved" &&
      candidate.status !== "converted"
    ) {
      continue;
    }

    const href =
      candidate.status === "pending"
        ? `/artist/purchase/${candidate.productId}/sent?req=${candidate.requestId}`
        : candidate.status === "approved"
          ? `/artist/purchase/${candidate.productId}/agree?req=${candidate.requestId}`
          : candidate.purchaseId
            ? `/artist/payments/${candidate.purchaseId}`
            : `/artist/purchase/${candidate.productId}/sent?req=${candidate.requestId}`;
    const label =
      candidate.status === "pending"
        ? "Request awaiting review"
        : candidate.status === "approved"
          ? "Review approved request"
          : "Continue current purchase";
    return {
      blocked: true,
      requestId: candidate.requestId,
      productId: candidate.productId,
      purchaseId: candidate.purchaseId,
      status: candidate.status,
      href,
      label,
    };
  }

  const standalonePurchases = await db
    .select({
      purchaseId: purchases.id,
      productId: purchases.productId,
      purchaseLifecycleStatus: purchases.lifecycleStatus,
      totalCents: purchases.totalCents,
      verifiedCents: sql<number>`coalesce(sum(case when ${paymentProofs.status} = 'confirmed' then ${paymentProofs.amountCents} else 0 end), 0)`,
      createdAt: purchases.createdAt,
    })
    .from(purchases)
    .leftJoin(paymentProofs, eq(paymentProofs.purchaseId, purchases.id))
    .where(
      and(
        eq(purchases.producerId, input.producerId),
        inArray(purchases.clientContactId, contactIds),
        sql`${purchases.purchaseRequestId} IS NULL`,
        inArray(purchases.lifecycleStatus, ["waiting_for_payment", "active"]),
      ),
    )
    .groupBy(
      purchases.id,
      purchases.productId,
      purchases.lifecycleStatus,
      purchases.totalCents,
      purchases.createdAt,
    )
    .orderBy(desc(purchases.createdAt), desc(purchases.id));

  for (const purchase of standalonePurchases) {
    if (
      !isArtistPurchaseGuardBlocking({
        status: "converted",
        purchaseId: purchase.purchaseId,
        totalCents: purchase.totalCents,
        verifiedCents: purchase.verifiedCents,
        purchaseLifecycleStatus: purchase.purchaseLifecycleStatus,
      })
    ) {
      continue;
    }
    return {
      blocked: true,
      requestId: null,
      productId: purchase.productId,
      purchaseId: purchase.purchaseId,
      status: "converted",
      href: `/artist/payments/${purchase.purchaseId}`,
      label: "Continue current purchase",
    };
  }

  return { blocked: false };
}
