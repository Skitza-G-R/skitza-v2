import { createHash } from "node:crypto";

import {
  and,
  clientContacts,
  eq,
  isNull,
  paymentProofs,
  producers,
  purchaseRequests,
  type Db,
} from "@skitza/db";

type VersionGroup = readonly [name: string, revisions: readonly string[]];

function opaqueVersion(namespace: string, groups: readonly VersionGroup[]): string {
  const stableGroups = groups.map(([name, revisions]) => [name, [...revisions].sort()] as const);
  const digest = createHash("sha256")
    .update(JSON.stringify([namespace, stableGroups]))
    .digest("base64url");
  return `v1.${digest}`;
}

export function producerDashboardQueueVersion(input: {
  proofIds: readonly string[];
  requestIds: readonly string[];
}): string {
  return opaqueVersion("producer-dashboard", [
    ["payment-proofs", input.proofIds],
    ["purchase-requests", input.requestIds],
  ]);
}

export function producerPaymentProofQueueVersion(
  proofIds: readonly string[],
  scope = "all",
): string {
  return opaqueVersion(`producer-payment-proofs:${scope}`, [["pending", proofIds]]);
}

export function producerPurchaseRequestQueueVersion(requestIds: readonly string[]): string {
  return opaqueVersion("producer-purchase-requests", [["pending", requestIds]]);
}

type ArtistProofRevision = Readonly<{
  proofId: string;
  status: "pending" | "confirmed" | "rejected";
  confirmedAt: Date | null;
  rejectedAt: Date | null;
  createdAt: Date;
}>;

export function artistPaymentProofQueueVersion(input: {
  purchaseId: string;
  installmentId: string;
  proofs: readonly ArtistProofRevision[];
}): string {
  const revisions = input.proofs.map(
    (proof) =>
      `${proof.proofId}:${proof.status}:${proof.createdAt.toISOString()}:${
        proof.confirmedAt?.toISOString() ?? ""
      }:${proof.rejectedAt?.toISOString() ?? ""}`,
  );
  return opaqueVersion(`artist-payment-proof:${input.purchaseId}:${input.installmentId}`, [
    ["proofs", revisions],
  ]);
}

export type QueueVersionInput =
  | Readonly<{ kind: "dashboard" }>
  | Readonly<{ kind: "payment-proofs" }>
  | Readonly<{ kind: "payment-proof"; proofId: string }>
  | Readonly<{ kind: "purchase-requests" }>
  | Readonly<{
      kind: "artist-payment-proof";
      purchaseId: string;
      installmentId: string;
    }>;

async function loadPendingProofIds(
  db: Db,
  clerkUserId: string,
  proofId?: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: paymentProofs.id })
    .from(paymentProofs)
    .innerJoin(producers, eq(producers.id, paymentProofs.producerId))
    .where(
      and(
        eq(producers.clerkUserId, clerkUserId),
        eq(paymentProofs.status, "pending"),
        proofId ? eq(paymentProofs.id, proofId) : undefined,
      ),
    );
  return rows.map((row) => row.id);
}

async function loadPendingRequestIds(db: Db, clerkUserId: string): Promise<string[]> {
  const rows = await db
    .select({ id: purchaseRequests.id })
    .from(purchaseRequests)
    .innerJoin(producers, eq(producers.id, purchaseRequests.producerId))
    .where(and(eq(producers.clerkUserId, clerkUserId), eq(purchaseRequests.status, "pending")));
  return rows.map((row) => row.id);
}

async function loadArtistProofVersion(
  db: Db,
  clerkUserId: string,
  input: Extract<QueueVersionInput, { kind: "artist-payment-proof" }>,
): Promise<string> {
  const proofs = await db
    .select({
      proofId: paymentProofs.id,
      status: paymentProofs.status,
      confirmedAt: paymentProofs.confirmedAt,
      rejectedAt: paymentProofs.rejectedAt,
      createdAt: paymentProofs.createdAt,
    })
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
        eq(paymentProofs.purchaseId, input.purchaseId),
        eq(paymentProofs.installmentId, input.installmentId),
        eq(clientContacts.clerkUserId, clerkUserId),
        isNull(clientContacts.archivedAt),
      ),
    );

  return artistPaymentProofQueueVersion({
    purchaseId: input.purchaseId,
    installmentId: input.installmentId,
    proofs,
  });
}

/**
 * Lightweight revision read for open queue screens. The response is an opaque
 * digest; queue rows, storage identity, and customer data never cross the API.
 */
export async function loadQueueVersion(
  db: Db,
  clerkUserId: string,
  input: QueueVersionInput,
): Promise<string> {
  if (input.kind === "dashboard") {
    const [proofIds, requestIds] = await Promise.all([
      loadPendingProofIds(db, clerkUserId),
      loadPendingRequestIds(db, clerkUserId),
    ]);
    return producerDashboardQueueVersion({ proofIds, requestIds });
  }
  if (input.kind === "payment-proofs") {
    return producerPaymentProofQueueVersion(await loadPendingProofIds(db, clerkUserId));
  }
  if (input.kind === "payment-proof") {
    return producerPaymentProofQueueVersion(
      await loadPendingProofIds(db, clerkUserId, input.proofId),
      input.proofId,
    );
  }
  if (input.kind === "purchase-requests") {
    return producerPurchaseRequestQueueVersion(await loadPendingRequestIds(db, clerkUserId));
  }
  return loadArtistProofVersion(db, clerkUserId, input);
}
