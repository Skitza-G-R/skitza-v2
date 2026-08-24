import {
  and,
  clientContacts,
  desc,
  eq,
  inArray,
  purchaseInstallments,
  purchasePaymentCorrections,
  purchasePayments,
  purchaseRequests,
  purchases,
  purchaseWaivers,
  sql,
  type Db,
} from "@skitza/db";

import { projectPurchaseLedger } from "../purchase-ledger/policy";

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

/**
 * A converted purchase blocks while money is still owed on it. Debt is the
 * canonical ledger's remaining cents — payments (with corrections applied)
 * plus waivers against the installment schedule — the same math every
 * payment surface renders. Proof-only accounting is wrong here: imported
 * agreements and SK-260 manual payments record money straight into the
 * ledger without a proof file, and waivers settle debt with no payment at
 * all. `remainingCents === null` means the purchase row or its ledger could
 * not be loaded; that fails closed.
 */
export function isArtistPurchaseGuardBlocking(input: {
  status: "pending" | "approved" | "declined" | "canceled" | "converted";
  purchaseId: string | null;
  remainingCents: number | null;
  purchaseLifecycleStatus: "waiting_for_payment" | "active" | "canceled" | null;
}): boolean {
  if (input.status === "pending" || input.status === "approved") return true;
  if (input.status !== "converted") return false;
  if (!input.purchaseId) return true;
  if (input.purchaseLifecycleStatus === "canceled") return false;
  return input.remainingCents === null || input.remainingCents > 0;
}

type GuardPurchaseRow = Readonly<{
  id: string;
  producerId: string;
  currency: string;
  lifecycleStatus: "waiting_for_payment" | "active" | "canceled";
  activatedAt: Date | null;
}>;

/**
 * Remaining debt per purchase from the canonical ledger relations. A
 * purchase whose money history fails the ledger's integrity checks maps to
 * null — corrupt history must never unblock a second purchase.
 */
async function remainingCentsByPurchase(
  db: Pick<Db, "select">,
  rows: readonly GuardPurchaseRow[],
  asOf: Date,
): Promise<Map<string, number | null>> {
  const remaining = new Map<string, number | null>();
  if (rows.length === 0) return remaining;
  const purchaseIds = rows.map((row) => row.id);

  const [installments, payments, corrections, waivers] = await Promise.all([
    db
      .select({
        id: purchaseInstallments.id,
        purchaseId: purchaseInstallments.purchaseId,
        producerId: purchaseInstallments.producerId,
        position: purchaseInstallments.position,
        amountCents: purchaseInstallments.amountCents,
        currency: purchaseInstallments.currency,
        dueAt: purchaseInstallments.dueAt,
        requiredForActivation: purchaseInstallments.requiredForActivation,
        status: purchaseInstallments.status,
      })
      .from(purchaseInstallments)
      .where(inArray(purchaseInstallments.purchaseId, purchaseIds)),
    db
      .select({
        id: purchasePayments.id,
        purchaseId: purchasePayments.purchaseId,
        installmentId: purchasePayments.installmentId,
        producerId: purchasePayments.producerId,
        amountCents: purchasePayments.amountCents,
        currency: purchasePayments.currency,
      })
      .from(purchasePayments)
      .where(inArray(purchasePayments.purchaseId, purchaseIds)),
    db
      .select({
        id: purchasePaymentCorrections.id,
        purchaseId: purchasePaymentCorrections.purchaseId,
        paymentId: purchasePaymentCorrections.paymentId,
        producerId: purchasePaymentCorrections.producerId,
        sequence: purchasePaymentCorrections.sequence,
        previousAmountCents: purchasePaymentCorrections.previousAmountCents,
        newAmountCents: purchasePaymentCorrections.newAmountCents,
      })
      .from(purchasePaymentCorrections)
      .where(inArray(purchasePaymentCorrections.purchaseId, purchaseIds)),
    db
      .select({
        id: purchaseWaivers.id,
        purchaseId: purchaseWaivers.purchaseId,
        installmentId: purchaseWaivers.installmentId,
        producerId: purchaseWaivers.producerId,
        amountCents: purchaseWaivers.amountCents,
      })
      .from(purchaseWaivers)
      .where(inArray(purchaseWaivers.purchaseId, purchaseIds)),
  ]);

  for (const row of rows) {
    try {
      const projection = projectPurchaseLedger({
        purchase: {
          id: row.id,
          producerId: row.producerId,
          currency: row.currency,
          lifecycleStatus: row.lifecycleStatus,
          wasActivated: row.activatedAt !== null,
        },
        installments: installments.filter((installment) => installment.purchaseId === row.id),
        payments: payments.filter((payment) => payment.purchaseId === row.id),
        corrections: corrections.filter((correction) => correction.purchaseId === row.id),
        waivers: waivers.filter((waiver) => waiver.purchaseId === row.id),
        asOf,
        // Remaining debt is pure money math; the timezone only shades
        // day-boundary statuses (overdue vs not yet due), which the guard
        // never reads.
        timeZone: "UTC",
      });
      remaining.set(row.id, projection.remainingCents);
    } catch {
      remaining.set(row.id, null);
    }
  }
  return remaining;
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
  const asOf = new Date();

  const candidates = await db
    .select({
      requestId: purchaseRequests.id,
      productId: purchaseRequests.productId,
      status: purchaseRequests.status,
      purchaseId: purchases.id,
      purchaseProducerId: purchases.producerId,
      purchaseLifecycleStatus: purchases.lifecycleStatus,
      purchaseCurrency: purchases.currency,
      purchaseActivatedAt: purchases.activatedAt,
      createdAt: purchaseRequests.createdAt,
    })
    .from(purchaseRequests)
    .leftJoin(purchases, eq(purchases.purchaseRequestId, purchaseRequests.id))
    .where(
      and(
        eq(purchaseRequests.producerId, input.producerId),
        inArray(purchaseRequests.clientContactId, contactIds),
        inArray(purchaseRequests.status, ["pending", "approved", "converted"]),
      ),
    )
    .orderBy(desc(purchaseRequests.createdAt), desc(purchaseRequests.id));

  const candidateRemaining = await remainingCentsByPurchase(
    db,
    candidates.flatMap((candidate) =>
      candidate.purchaseId &&
      candidate.purchaseProducerId &&
      candidate.purchaseLifecycleStatus &&
      candidate.purchaseCurrency
        ? [
            {
              id: candidate.purchaseId,
              producerId: candidate.purchaseProducerId,
              currency: candidate.purchaseCurrency,
              lifecycleStatus: candidate.purchaseLifecycleStatus,
              activatedAt: candidate.purchaseActivatedAt,
            },
          ]
        : [],
    ),
    asOf,
  );

  for (const candidate of candidates) {
    if (
      !isArtistPurchaseGuardBlocking({
        status: candidate.status,
        purchaseId: candidate.purchaseId,
        remainingCents: candidate.purchaseId
          ? (candidateRemaining.get(candidate.purchaseId) ?? null)
          : null,
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
      producerId: purchases.producerId,
      productId: purchases.productId,
      purchaseLifecycleStatus: purchases.lifecycleStatus,
      currency: purchases.currency,
      activatedAt: purchases.activatedAt,
      createdAt: purchases.createdAt,
    })
    .from(purchases)
    .where(
      and(
        eq(purchases.producerId, input.producerId),
        inArray(purchases.clientContactId, contactIds),
        sql`${purchases.purchaseRequestId} IS NULL`,
        inArray(purchases.lifecycleStatus, ["waiting_for_payment", "active"]),
      ),
    )
    .orderBy(desc(purchases.createdAt), desc(purchases.id));

  const standaloneRemaining = await remainingCentsByPurchase(
    db,
    standalonePurchases.map((purchase) => ({
      id: purchase.purchaseId,
      producerId: purchase.producerId,
      currency: purchase.currency,
      lifecycleStatus: purchase.purchaseLifecycleStatus,
      activatedAt: purchase.activatedAt,
    })),
    asOf,
  );

  for (const purchase of standalonePurchases) {
    if (
      !isArtistPurchaseGuardBlocking({
        status: "converted",
        purchaseId: purchase.purchaseId,
        remainingCents: standaloneRemaining.get(purchase.purchaseId) ?? null,
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
