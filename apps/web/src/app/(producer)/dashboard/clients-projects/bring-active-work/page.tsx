import { TRPCError } from "@trpc/server";
import { redirect } from "next/navigation";

import { ActiveWorkImportWorkspace } from "~/components/dashboard/active-work-import/active-work-import-workspace";
import type {
  ImportAssessmentView,
  InitialImportBatch,
  SetupOptionsView,
  StoreTemplateOption,
} from "~/components/dashboard/active-work-import/model";
import { mapPublicImportAssessment } from "~/components/dashboard/active-work-import/model";
import { coerceTaxMode } from "~/lib/tax-mode";
import { auth } from "~/server/auth/clerk-identity";
import { appRouter } from "~/server/trpc/routers/_app";

import { buildPrivateOfferTemplateProduct } from "../../store/private-offer-template";

type PageProps = { searchParams?: Promise<{ batch?: string }> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Caller = ReturnType<typeof appRouter.createCaller>;
type LoadedBatch = Awaited<ReturnType<Caller["activeWorkImport"]["latestOpenBatch"]>>;

// A bookmarked or foreign ?batch= id is not an error page: fall back to the
// producer's latest open setup and say so quietly. Any other failure still
// surfaces, so a real outage is never hidden behind the fallback.
async function loadRequestedBatch(
  caller: Caller,
  requestedBatchId: string | undefined,
): Promise<Readonly<{ batch: LoadedBatch; notice: string | null }>> {
  if (!requestedBatchId || !UUID_PATTERN.test(requestedBatchId)) {
    return { batch: await caller.activeWorkImport.latestOpenBatch(), notice: null };
  }
  try {
    return {
      batch: await caller.activeWorkImport.loadBatch({ batchId: requestedBatchId }),
      notice: null,
    };
  } catch (error) {
    if (!(error instanceof TRPCError) || error.code !== "NOT_FOUND") throw error;
    console.warn("[active-work-import] requested batch not found, showing latest", {
      batchId: requestedBatchId,
    });
    return {
      batch: await caller.activeWorkImport.latestOpenBatch(),
      notice: "This saved setup could not be found — showing your latest one",
    };
  }
}

export default async function BringActiveWorkPage({ searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const profile = await caller.producer.me();
  const taxMode = coerceTaxMode(profile.taxMode);
  const taxRatePct =
    typeof profile.taxRatePct === "number" && Number.isFinite(profile.taxRatePct)
      ? Math.max(0, Math.min(100, Math.round(profile.taxRatePct)))
      : 0;
  const requestedBatchId = (await searchParams)?.batch;

  const [clientResult, packages, { batch: batchResult, notice: batchNotice }] = await Promise.all([
    caller.clientContacts.listWithProjects({ view: "by-client" }),
    caller.booking.packages.list(),
    loadRequestedBatch(caller, requestedBatchId),
  ]);
  if (clientResult.view !== "by-client") {
    throw new Error("Could not load the client list for active work import");
  }

  const templates: StoreTemplateOption[] = packages
    .filter((product) => product.active)
    .map((product) => {
      const template = buildPrivateOfferTemplateProduct(product, { taxMode, taxRatePct });
      return {
        id: template.source.productId,
        name: template.source.productName,
        kind: template.source.productKind,
        service: template.terms.service,
        deliverables: template.terms.deliverables,
        subtotalCents: template.terms.cashPriceCents,
        currency: template.terms.currency,
        taxMode: template.terms.taxMode,
        taxRatePct: template.terms.taxRatePct,
        includedSongSpaces: Math.max(1, template.terms.includedSongSpaces),
        revisionRule: template.terms.revisionRule,
        royaltyTerms: template.terms.royaltyTerms,
        rights: template.terms.rights,
        plans: template.terms.enabledPaymentPlans,
        agreementText: template.terms.agreementMode === "text" ? template.terms.agreementText : "",
        session: template.terms.session,
      };
    });

  let initialBatch: InitialImportBatch | null = null;
  let initialSetupOptions: SetupOptionsView | null = null;
  let assessmentNotice: string | null = null;
  if (batchResult) {
    const assessed = await Promise.all(
      batchResult.rows.map(async (row) => {
        let assessment: ImportAssessmentView | null = null;
        if (!row.materializedAt) {
          // One row whose check fails stays Needs info (assessment null) with a
          // notice; it must not take the whole saved setup down with it.
          try {
            const result = await caller.activeWorkImport.assessRow({
              batchId: batchResult.batch.id,
              rowId: row.id,
            });
            assessment = mapPublicImportAssessment(result);
          } catch (error) {
            console.error("[active-work-import] initial row check failed", {
              batchId: batchResult.batch.id,
              rowId: row.id,
              error: error instanceof Error ? `${error.name}: ${error.message}` : "unknown",
            });
            assessmentNotice =
              "Some items could not be checked yet. Open each item to check it again.";
          }
        }
        return {
          row: {
            id: row.id,
            operationKey: row.operationKey,
            draftRevision: row.draftRevision,
            draftPayload: row.draftPayload,
            materializedAtIso: row.materializedAt?.toISOString() ?? null,
            createdClientContactId: row.createdClientContactId,
            createdProjectId: row.createdProjectId,
            createdPurchaseId: row.createdPurchaseId,
            lastErrorCode: row.lastErrorCode,
          },
          assessment,
        };
      }),
    );
    initialBatch = {
      id: batchResult.batch.id,
      status: batchResult.batch.status,
      rows: assessed,
    };

    if (batchResult.rows.some((row) => row.materializedAt !== null)) {
      const options = await caller.activeWorkImport.setupOptions({ batchId: batchResult.batch.id });
      initialSetupOptions = {
        setupDigest: options.setupDigest,
        distinctClientCount: options.distinctClientCount,
        projectPurchaseCount: options.projectPurchaseCount,
        clients: options.clients.map((client) => ({
          ...client,
          providerAcceptedAtIso: client.providerAcceptedAt?.toISOString() ?? null,
        })),
        installments: options.installments.map((installment) => ({
          ...installment,
          dueAtIso: installment.dueAt?.toISOString() ?? null,
          triggeredAtIso: installment.triggeredAt?.toISOString() ?? null,
        })),
      };
    }
  }

  return (
    <main className="min-w-0" data-gate1-meaningful-screen="bring-active-work">
      <ActiveWorkImportWorkspace
        initialBatch={initialBatch}
        initialNotice={batchNotice ?? assessmentNotice}
        initialSetupOptions={initialSetupOptions}
        existingClients={clientResult.clients
          .filter((client) => client.producerArchivedAt === null)
          .map((client) => ({ id: client.id, name: client.name, email: client.email }))}
        archivedClients={clientResult.clients
          .filter((client) => client.producerArchivedAt !== null)
          .map((client) => ({ id: client.id, name: client.name, email: client.email }))}
        templates={templates}
        producerSlug={profile.slug}
        producerName={profile.displayName ?? ""}
        defaultCurrency={profile.defaultCurrency}
        defaultTaxMode={taxMode}
        defaultTaxRatePct={taxRatePct}
      />
    </main>
  );
}
