import { auth } from "~/server/auth/clerk-identity";
import { notFound, redirect } from "next/navigation";

import {
  ClientSpaceWorkspace,
  type ClientSpaceClientData,
  type ClientSpaceOfferConfig,
  type ClientSpacePaymentsState,
  type ClientSpacePaymentTotal,
} from "~/components/dashboard/clients/client-space-workspace";
import { toClientPaymentsData } from "~/components/dashboard/clients/client-payments-data";
import { clientInvitationLinkState } from "~/components/dashboard/clients/client-invitation-state";
import type { ClientSpaceProjectData } from "~/components/dashboard/clients/client-space-project-row";
import { resolveClientSpaceInitialTab } from "~/components/dashboard/clients/client-space-tabs";
import { SetTopBarBreadcrumb } from "~/components/shell/topbar-breadcrumb-context";
import { stageLabel, type WorkflowStage } from "~/lib/clients/workflow-stage";
import { coerceTaxMode } from "~/lib/tax-mode";
import { CLIENT_ARCHIVE_BLOCKED_MESSAGE } from "~/server/domain/client-management/service";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] | undefined }>;
};

type ProjectLifecycleStatus =
  | "waiting_for_payment"
  | "active"
  | "paused"
  | "completed"
  | "canceled";

const LIFECYCLE_PRESENTATION: Record<
  ProjectLifecycleStatus,
  Pick<ClientSpaceProjectData, "statusLabel" | "statusTone">
> = {
  waiting_for_payment: { statusLabel: "Waiting for payment", statusTone: "warning" },
  active: { statusLabel: "Active", statusTone: "active" },
  paused: { statusLabel: "Paused", statusTone: "warning" },
  completed: { statusLabel: "Completed", statusTone: "success" },
  canceled: { statusLabel: "Canceled", statusTone: "neutral" },
};

export default async function ClientDetailPage({ params, searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { id } = await params;
  const query = await searchParams;
  const initialTab = resolveClientSpaceInitialTab(query.tab);
  const caller = appRouter.createCaller({ userId });
  const paymentReadStartedAt = new Date();

  // Keep SK-145's lean Client Space query and independent reads. Tabs are
  // local after this snapshot, so changing sections never refetches the route.
  const [detailResult, paymentsResult, producerProfileResult] = await Promise.allSettled([
    caller.clientContacts.clientSpaceDetail({ id }),
    caller.purchaseLedger.client({ clientContactId: id }),
    caller.producer.me(),
  ]);
  if (detailResult.status === "rejected") notFound();

  const detail = detailResult.value;
  const paymentModel = paymentsResult.status === "fulfilled" ? paymentsResult.value : null;
  const producerProfile =
    producerProfileResult.status === "fulfilled" ? producerProfileResult.value : null;
  if (producerProfileResult.status === "rejected") {
    console.warn("[clients/detail] producer.me failed", producerProfileResult.reason);
  }

  const client: ClientSpaceClientData = {
    id: detail.contact.id,
    name: detail.contact.name,
    email: detail.contact.email,
    phone: detail.contact.phone,
    notes: detail.contact.notes,
    tags: detail.contact.tags,
    archived: detail.contact.producerArchivedAt !== null,
    archiveBlockedReason:
      detail.contact.producerArchivedAt === null && detail.stats.archiveBlockingProjectCount > 0
        ? CLIENT_ARCHIVE_BLOCKED_MESSAGE
        : null,
    canPermanentlyDelete: detail.contact.canPermanentlyDelete,
    linkState: clientInvitationLinkState(detail.contact.invitationState),
    joinedAtIso: toIso(detail.contact.firstSeenAt),
  };

  const projects: ClientSpaceProjectData[] = detail.projects.map((project) => ({
    id: project.id,
    title: project.title,
    clientName: detail.contact.name,
    lifecycleStatus: project.lifecycleStatus,
    workflowStage: project.workflowStage,
    deadlineAtIso: project.deadlineAt ? toIso(project.deadlineAt) : null,
    canDeleteEmptyDraft: project.canPermanentlyDelete,
    ...LIFECYCLE_PRESENTATION[project.lifecycleStatus],
    nextAction: projectNextAction(project),
  }));

  const paymentTotals: ClientSpacePaymentTotal[] =
    paymentModel?.totals.map((total) => ({
      currency: total.currency,
      dueNowCents: total.dueNowCents,
      totalRemainingCents: total.totalRemainingCents,
    })) ?? [];
  const needsReviewCount =
    paymentModel?.producerBuckets.needs_review.projects.reduce(
      (count, project) =>
        count +
        project.purchases.reduce(
          (projectCount, purchase) =>
            projectCount + purchase.proofs.filter((proof) => proof.status === "pending").length,
          0,
        ),
      0,
    ) ?? 0;
  const payments: ClientSpacePaymentsState =
    paymentModel && producerProfile
      ? {
          status: "ready",
          data: toClientPaymentsData(paymentModel, {
            asOf: paymentReadStartedAt,
            producerTimeZone: producerProfile.timezone,
          }),
          totals: paymentTotals,
          needsReviewCount,
        }
      : {
          status: "error",
          message: "Balances and payment history are unavailable. Refresh this page to try again.",
        };
  const offerConfig: ClientSpaceOfferConfig | null = producerProfile
    ? {
        defaultCurrency: clientOfferCurrency(producerProfile.defaultCurrency),
        taxMode: coerceTaxMode(producerProfile.taxMode),
        taxRatePct: normalizedTaxRate(producerProfile.taxRatePct),
      }
    : null;

  return (
    <main className="sk-page-enter" style={{ animationFillMode: "backwards" }}>
      <div className="mx-auto w-full max-w-[1180px] px-4 pt-4 pb-28 sm:px-6 sm:pt-6 lg:px-8 lg:pt-7 lg:pb-10">
        <SetTopBarBreadcrumb crumbs={[{ label: detail.contact.name }]} />
        <ClientSpaceWorkspace
          key={`${detail.contact.id}:${initialTab}`}
          client={client}
          projects={projects}
          payments={payments}
          producerSlug={producerProfile?.slug ?? ""}
          offerConfig={offerConfig}
          initialTab={initialTab}
        />
      </div>
    </main>
  );
}

function projectNextAction(project: {
  lifecycleStatus: ProjectLifecycleStatus;
  workflowStage: WorkflowStage;
  deadlineAt: Date | string | null;
  nextSessionAt: Date | string | null;
}): string {
  if (project.lifecycleStatus === "waiting_for_payment") {
    return "Payment is the next step";
  }
  if (project.lifecycleStatus === "paused") {
    return "Resume work when ready";
  }
  if (project.lifecycleStatus === "completed") {
    return "Review completed project";
  }
  if (project.lifecycleStatus === "canceled") {
    return "Review canceled project";
  }
  if (project.nextSessionAt) {
    return `Next session ${formatDateTime(project.nextSessionAt)}`;
  }
  if (project.deadlineAt) {
    return `Deadline ${formatDate(project.deadlineAt)}`;
  }
  return `Continue ${stageLabel(project.workflowStage).toLocaleLowerCase("en-US")}`;
}

function clientOfferCurrency(value: string): "USD" | "EUR" | "GBP" | "ILS" {
  return value === "EUR" || value === "GBP" || value === "ILS" ? value : "USD";
}

function normalizedTaxRate(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 18;
}

function toIso(raw: Date | string): string {
  return raw instanceof Date ? raw.toISOString() : new Date(raw).toISOString();
}

function formatDate(raw: Date | string): string {
  const date = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(date.getTime())) return "not scheduled";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatDateTime(raw: Date | string): string {
  const date = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(date.getTime())) return "not scheduled";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}
