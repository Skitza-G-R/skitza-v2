import {
  and,
  asc,
  clientContacts,
  eq,
  inArray,
  isNull,
  paymentProofs,
  producers,
  projectPaymentPauseEvents,
  projects,
  purchaseAcceptances,
  purchaseImportAttestations,
  purchaseCancellations,
  purchaseDownloadOverrideEvents,
  purchaseInstallments,
  purchasePaymentCorrections,
  purchasePayments,
  purchases,
  purchaseWaivers,
  trackVersions,
  type Db,
} from "@skitza/db";

import { activeArtistClientOwner } from "~/server/artist/access";

import type {
  PaymentLedgerReadRepository,
  PaymentLedgerReadSnapshot,
  PaymentLedgerReadScope,
} from "./read-model";

/**
 * Read every accepted-purchase row directly on the HTTP client (SK-258: a
 * read-only transaction opened a fresh WebSocket connection per call).
 * Producer queries carry the exact producer boundary. Artist purchase IDs are
 * first resolved through the stable active Clerk/client owner join, then every
 * dependent query is restricted to that immutable authorized ID set.
 */
export function paymentLedgerReadRepository(db: Db): PaymentLedgerReadRepository {
  return {
    loadSnapshot: async (scope): Promise<PaymentLedgerReadSnapshot | null> => {
      if (scope.kind === "producer" && scope.projectId && scope.clientContactId) return null;

      const producerRows =
        scope.kind === "producer"
          ? await db
              .select({
                id: producers.id,
                displayName: producers.displayName,
                timeZone: producers.timezone,
                paymentDetails: producers.paymentDetails,
              })
              .from(producers)
              .where(eq(producers.id, scope.producerId))
              .limit(1)
          : await db
              .selectDistinct({
                id: producers.id,
                displayName: producers.displayName,
                timeZone: producers.timezone,
                paymentDetails: producers.paymentDetails,
              })
              .from(producers)
              .innerJoin(
                clientContacts,
                and(
                  eq(clientContacts.producerId, producers.id),
                  eq(clientContacts.clerkUserId, scope.clerkUserId),
                  isNull(clientContacts.archivedAt),
                ),
              );
      if (scope.kind === "producer" && producerRows.length === 0) return null;

      const clientRows =
        scope.kind === "producer"
          ? await db
              .select({
                id: clientContacts.id,
                producerId: clientContacts.producerId,
                name: clientContacts.name,
                clerkUserId: clientContacts.clerkUserId,
                archivedAt: clientContacts.archivedAt,
              })
              .from(clientContacts)
              .where(
                and(
                  eq(clientContacts.producerId, scope.producerId),
                  ...(scope.clientContactId ? [eq(clientContacts.id, scope.clientContactId)] : []),
                ),
              )
          : await db
              .select({
                id: clientContacts.id,
                producerId: clientContacts.producerId,
                name: clientContacts.name,
                clerkUserId: clientContacts.clerkUserId,
                archivedAt: clientContacts.archivedAt,
              })
              .from(clientContacts)
              .where(
                and(
                  eq(clientContacts.clerkUserId, scope.clerkUserId),
                  isNull(clientContacts.archivedAt),
                ),
              );
      if (scope.kind === "producer" && scope.clientContactId && clientRows.length === 0) {
        return null;
      }

      const projectRows =
        scope.kind === "producer"
          ? await db
              .select({
                id: projects.id,
                producerId: projects.producerId,
                clientContactId: projects.clientContactId,
                title: projects.title,
                lifecycleStatus: projects.lifecycleStatus,
                createdAt: projects.createdAt,
              })
              .from(projects)
              .where(
                and(
                  eq(projects.producerId, scope.producerId),
                  ...(scope.projectId ? [eq(projects.id, scope.projectId)] : []),
                  ...(scope.clientContactId
                    ? [eq(projects.clientContactId, scope.clientContactId)]
                    : []),
                ),
              )
          : await db
              .select({
                id: projects.id,
                producerId: projects.producerId,
                clientContactId: projects.clientContactId,
                title: projects.title,
                lifecycleStatus: projects.lifecycleStatus,
                createdAt: projects.createdAt,
              })
              .from(projects)
              .innerJoin(
                clientContacts,
                activeArtistClientOwner(scope.clerkUserId, {
                  producerId: projects.producerId,
                  clientContactId: projects.clientContactId,
                }),
              );
      if (scope.kind === "producer" && scope.projectId && projectRows.length === 0) return null;

      const purchaseRows =
        scope.kind === "producer"
          ? await db
              .select({
                id: purchases.id,
                producerId: purchases.producerId,
                projectId: purchases.projectId,
                clientContactId: purchases.clientContactId,
                refNumber: purchases.refNumber,
                sourceKind: purchases.sourceKind,
                lifecycleStatus: purchases.lifecycleStatus,
                paymentPlanKind: purchases.paymentPlanKind,
                commercialSnapshot: purchases.commercialSnapshot,
                snapshotDigest: purchases.snapshotDigest,
                subtotalCents: purchases.subtotalCents,
                taxCents: purchases.taxCents,
                totalCents: purchases.totalCents,
                currency: purchases.currency,
                acceptedAt: purchases.acceptedAt,
                commercialEstablishedAt: purchases.commercialEstablishedAt,
                activatedAt: purchases.activatedAt,
                canceledAt: purchases.canceledAt,
                createdAt: purchases.createdAt,
              })
              .from(purchases)
              .where(
                and(
                  eq(purchases.producerId, scope.producerId),
                  ...(scope.projectId ? [eq(purchases.projectId, scope.projectId)] : []),
                  ...(scope.clientContactId
                    ? [eq(purchases.clientContactId, scope.clientContactId)]
                    : []),
                ),
              )
          : await db
              .select({
                id: purchases.id,
                producerId: purchases.producerId,
                projectId: purchases.projectId,
                clientContactId: purchases.clientContactId,
                refNumber: purchases.refNumber,
                sourceKind: purchases.sourceKind,
                lifecycleStatus: purchases.lifecycleStatus,
                paymentPlanKind: purchases.paymentPlanKind,
                commercialSnapshot: purchases.commercialSnapshot,
                snapshotDigest: purchases.snapshotDigest,
                subtotalCents: purchases.subtotalCents,
                taxCents: purchases.taxCents,
                totalCents: purchases.totalCents,
                currency: purchases.currency,
                acceptedAt: purchases.acceptedAt,
                commercialEstablishedAt: purchases.commercialEstablishedAt,
                activatedAt: purchases.activatedAt,
                canceledAt: purchases.canceledAt,
                createdAt: purchases.createdAt,
              })
              .from(purchases)
              .innerJoin(
                clientContacts,
                activeArtistClientOwner(scope.clerkUserId, {
                  producerId: purchases.producerId,
                  clientContactId: purchases.clientContactId,
                }),
              );

      const purchaseIds = purchaseRows.map((purchase) => purchase.id);
      if (purchaseIds.length === 0) {
        return {
          scope,
          producers: producerRows,
          clients: clientRows,
          projects: projectRows,
          purchases: [],
          acceptances: [],
          importAttestations: [],
          installments: [],
          payments: [],
          corrections: [],
          waivers: [],
          proofs: [],
          cancellations: [],
          pauseEvents: [],
          downloadOverrides: [],
        };
      }

      const producerBoundary = (producerColumn: unknown, purchaseColumn: unknown) =>
        scope.kind === "producer"
          ? and(
              eq(producerColumn as Parameters<typeof eq>[0], scope.producerId),
              inArray(purchaseColumn as Parameters<typeof inArray>[0], purchaseIds),
            )
          : inArray(purchaseColumn as Parameters<typeof inArray>[0], purchaseIds);

      const [
        acceptanceRows,
        importAttestationRows,
        installmentRows,
        paymentRows,
        correctionRows,
        waiverRows,
        proofRows,
        cancellationRows,
        pauseRows,
        overrideRows,
      ] = await Promise.all([
        db
          .select({
            id: purchaseAcceptances.id,
            purchaseId: purchaseAcceptances.purchaseId,
            producerId: purchaseAcceptances.producerId,
            clientContactId: purchaseAcceptances.clientContactId,
            acceptedSnapshot: purchaseAcceptances.acceptedSnapshot,
            snapshotDigest: purchaseAcceptances.snapshotDigest,
            acceptedAt: purchaseAcceptances.acceptedAt,
          })
          .from(purchaseAcceptances)
          .where(producerBoundary(purchaseAcceptances.producerId, purchaseAcceptances.purchaseId)),
        db
          .select({
            id: purchaseImportAttestations.id,
            purchaseId: purchaseImportAttestations.purchaseId,
            producerId: purchaseImportAttestations.producerId,
            clientContactId: purchaseImportAttestations.clientContactId,
            importedSnapshot: purchaseImportAttestations.importedSnapshot,
            snapshotDigest: purchaseImportAttestations.snapshotDigest,
            importedAt: purchaseImportAttestations.importedAt,
          })
          .from(purchaseImportAttestations)
          .where(
            producerBoundary(
              purchaseImportAttestations.producerId,
              purchaseImportAttestations.purchaseId,
            ),
          ),
        db
          .select({
            id: purchaseInstallments.id,
            purchaseId: purchaseInstallments.purchaseId,
            producerId: purchaseInstallments.producerId,
            position: purchaseInstallments.position,
            amountCents: purchaseInstallments.amountCents,
            currency: purchaseInstallments.currency,
            dueTrigger: purchaseInstallments.dueTrigger,
            dueAt: purchaseInstallments.dueAt,
            triggeredAt: purchaseInstallments.triggeredAt,
            requiredForActivation: purchaseInstallments.requiredForActivation,
            status: purchaseInstallments.status,
            remindersEnabled: purchaseInstallments.remindersEnabled,
          })
          .from(purchaseInstallments)
          .where(producerBoundary(purchaseInstallments.producerId, purchaseInstallments.purchaseId))
          .orderBy(asc(purchaseInstallments.position)),
        db
          .select({
            id: purchasePayments.id,
            purchaseId: purchasePayments.purchaseId,
            installmentId: purchasePayments.installmentId,
            producerId: purchasePayments.producerId,
            proofId: purchasePayments.proofId,
            source: purchasePayments.source,
            amountCents: purchasePayments.amountCents,
            currency: purchasePayments.currency,
            paidAt: purchasePayments.paidAt,
            note: purchasePayments.note,
            createdAt: purchasePayments.createdAt,
          })
          .from(purchasePayments)
          .where(producerBoundary(purchasePayments.producerId, purchasePayments.purchaseId)),
        db
          .select({
            id: purchasePaymentCorrections.id,
            purchaseId: purchasePaymentCorrections.purchaseId,
            paymentId: purchasePaymentCorrections.paymentId,
            producerId: purchasePaymentCorrections.producerId,
            sequence: purchasePaymentCorrections.sequence,
            previousAmountCents: purchasePaymentCorrections.previousAmountCents,
            newAmountCents: purchasePaymentCorrections.newAmountCents,
            reason: purchasePaymentCorrections.reason,
            createdAt: purchasePaymentCorrections.createdAt,
          })
          .from(purchasePaymentCorrections)
          .where(
            producerBoundary(
              purchasePaymentCorrections.producerId,
              purchasePaymentCorrections.purchaseId,
            ),
          ),
        db
          .select({
            id: purchaseWaivers.id,
            purchaseId: purchaseWaivers.purchaseId,
            installmentId: purchaseWaivers.installmentId,
            producerId: purchaseWaivers.producerId,
            amountCents: purchaseWaivers.amountCents,
            reason: purchaseWaivers.reason,
            createdAt: purchaseWaivers.createdAt,
          })
          .from(purchaseWaivers)
          .where(producerBoundary(purchaseWaivers.producerId, purchaseWaivers.purchaseId)),
        // Intentionally omit storageKey, objectEtag, storageBucket, and review actor IDs.
        db
          .select({
            id: paymentProofs.id,
            purchaseId: paymentProofs.purchaseId,
            installmentId: paymentProofs.installmentId,
            producerId: paymentProofs.producerId,
            projectId: paymentProofs.projectId,
            clientContactId: paymentProofs.clientContactId,
            replacesProofId: paymentProofs.replacesProofId,
            amountCents: paymentProofs.amountCents,
            currency: paymentProofs.currency,
            originalFileName: paymentProofs.originalFileName,
            status: paymentProofs.status,
            note: paymentProofs.note,
            rejectionNote: paymentProofs.rejectionNote,
            confirmedAt: paymentProofs.confirmedAt,
            rejectedAt: paymentProofs.rejectedAt,
            createdAt: paymentProofs.createdAt,
          })
          .from(paymentProofs)
          .where(producerBoundary(paymentProofs.producerId, paymentProofs.purchaseId)),
        db
          .select({
            id: purchaseCancellations.id,
            purchaseId: purchaseCancellations.purchaseId,
            producerId: purchaseCancellations.producerId,
            reason: purchaseCancellations.reason,
            canceledAt: purchaseCancellations.canceledAt,
          })
          .from(purchaseCancellations)
          .where(
            producerBoundary(purchaseCancellations.producerId, purchaseCancellations.purchaseId),
          ),
        db
          .select({
            id: projectPaymentPauseEvents.id,
            purchaseId: projectPaymentPauseEvents.purchaseId,
            projectId: projectPaymentPauseEvents.projectId,
            producerId: projectPaymentPauseEvents.producerId,
            action: projectPaymentPauseEvents.action,
            reason: projectPaymentPauseEvents.reason,
            changedAt: projectPaymentPauseEvents.changedAt,
          })
          .from(projectPaymentPauseEvents)
          .where(
            producerBoundary(
              projectPaymentPauseEvents.producerId,
              projectPaymentPauseEvents.purchaseId,
            ),
          ),
        db
          .select({
            id: purchaseDownloadOverrideEvents.id,
            purchaseId: purchaseDownloadOverrideEvents.purchaseId,
            producerId: purchaseDownloadOverrideEvents.producerId,
            versionId: purchaseDownloadOverrideEvents.versionId,
            versionLabel: trackVersions.label,
            sequence: purchaseDownloadOverrideEvents.sequence,
            enabled: purchaseDownloadOverrideEvents.enabled,
            audioDeletedAt: trackVersions.audioDeletedAt,
            createdAt: purchaseDownloadOverrideEvents.createdAt,
          })
          .from(purchaseDownloadOverrideEvents)
          .innerJoin(
            trackVersions,
            and(
              eq(trackVersions.id, purchaseDownloadOverrideEvents.versionId),
              eq(trackVersions.purchaseId, purchaseDownloadOverrideEvents.purchaseId),
            ),
          )
          .where(
            producerBoundary(
              purchaseDownloadOverrideEvents.producerId,
              purchaseDownloadOverrideEvents.purchaseId,
            ),
          ),
      ]);

      return {
        scope,
        producers: producerRows,
        clients: clientRows,
        projects: projectRows,
        purchases: purchaseRows,
        acceptances: acceptanceRows,
        importAttestations: importAttestationRows,
        installments: installmentRows,
        payments: paymentRows,
        corrections: correctionRows,
        waivers: waiverRows,
        proofs: proofRows,
        cancellations: cancellationRows,
        pauseEvents: pauseRows,
        downloadOverrides: overrideRows,
      };
    },
  };
}

export type { PaymentLedgerReadScope };
