import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";

import {
  ClientSpaceWorkspace,
  type ClientSpaceClientData,
  type ClientSpaceOfferConfig,
  type ClientSpacePaymentTotal,
} from "~/components/dashboard/clients/client-space-workspace";
import type { ClientSpaceProjectData } from "~/components/dashboard/clients/client-space-project-row";
import { SetTopBarBreadcrumb } from "~/components/shell/topbar-breadcrumb-context";
import { toProducerPaymentWorkspaceBuckets } from "~/components/payments/producer-payment-workspace-data";
import { stageLabel, type WorkflowStage } from "~/lib/clients/workflow-stage";
import { coerceTaxMode } from "~/lib/tax-mode";
import { CLIENT_ARCHIVE_BLOCKED_MESSAGE } from "~/server/domain/client-management/service";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = {
  params: Promise<{ id: string }>;
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

export default async function ClientDetailPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { id } = await params;
  const caller = appRouter.createCaller({ userId });

  // Keep SK-145's lean Client Space query and independent reads. Tabs are
  // local after this snapshot, so changing sections never refetches the route.
  const [detailResult, paymentsResult, producerProfileResult] = await Promise.allSettled([
    caller.clientContacts.clientSpaceDetail({ id }),
    caller.purchaseLedger.client({ clientContactId: id }),
    caller.producer.me(),
  ]);
  if (detailResult.status === "rejected" || paymentsResult.status === "rejected") {
    notFound();
  }

  const detail = detailResult.value;
  const payments = paymentsResult.value;
  const producerProfile =
    producerProfileResult.status === "fulfilled" ? producerProfileResult.value : null;
  if (producerProfileResult.status === "rejected") {
    console.warn("[clients/detail] producer.me failed", producerProfileResult.reason);
  }

  const paymentBuckets = toProducerPaymentWorkspaceBuckets(payments.producerBuckets);
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
    linkState: detail.contact.clerkUserId
      ? "active"
      : detail.contact.invitedAt
        ? "pending"
        : "none",
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

  const paymentTotals: ClientSpacePaymentTotal[] = payments.totals.map((total) => ({
    currency: total.currency,
    dueNowCents: total.dueNowCents,
    totalRemainingCents: total.totalRemainingCents,
  }));
  const needsReviewCount =
    paymentBuckets
      .find((bucket) => bucket.id === "needs_review")
      ?.projects.reduce(
        (count, project) =>
          count +
          project.purchases.reduce(
            (projectCount, purchase) =>
              projectCount + purchase.proofs.filter((proof) => proof.status === "pending").length,
            0,
          ),
        0,
      ) ?? 0;
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
          key={detail.contact.id}
          client={client}
          projects={projects}
          paymentBuckets={paymentBuckets}
          paymentTotals={paymentTotals}
          needsReviewCount={needsReviewCount}
          producerSlug={producerProfile?.slug ?? ""}
          offerConfig={offerConfig}
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
