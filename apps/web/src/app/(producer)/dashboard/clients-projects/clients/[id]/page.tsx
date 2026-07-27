import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";

import {
  ClientSpaceHero,
  type ClientSpaceHeroData,
} from "~/components/dashboard/clients/client-space-hero";
import type { ClientMoneyLedgerData } from "~/components/dashboard/clients/client-money-ledger";
import { ProjectRow, type ProjectRowData } from "~/components/dashboard/projects/project-row";
import { SetTopBarBreadcrumb } from "~/components/shell/topbar-breadcrumb-context";
import { PrivateOfferManager } from "~/components/dashboard/offers/private-offer-manager";
import { ProducerPaymentWorkspace } from "~/components/payments/producer-payment-workspace";
import { toProducerPaymentWorkspaceBuckets } from "~/components/payments/producer-payment-workspace-data";
import { coerceTaxMode } from "~/lib/tax-mode";
import { CLIENT_ARCHIVE_BLOCKED_MESSAGE } from "~/server/domain/client-management/service";
import type { ClientMoneyHistory } from "~/server/domain/client-money/service";
import { appRouter } from "~/server/trpc/routers/_app";

// /dashboard/clients-projects/clients/[id] — Client Space.
//
// Phase 1 Task 17 — the page is a single-surface composition:
//   • <ClientSpaceHero> — dark gradient band with the avatar, name,
//     LinkPill, meta strip and 4-tile KPIs.
//   • A vertical list of <ProjectRow> components for every project tied
//     to this client.
//
// The old 4-tab structure (Overview / Projects / Payments / Notes) is
// gone per the big-bang redesign. Client editing lives in the hero and
// the purchase-owned money history stays visible below the project list.

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ClientDetailPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { id } = await params;
  const caller = appRouter.createCaller({ userId });

  // Detail is the canonical client+projects payload; producer.me() is
  // consumed for the invite-link slug.
  let detail;
  try {
    detail = await caller.clientContacts.detail({ id });
  } catch {
    notFound();
  }
  let payments;
  try {
    payments = await caller.purchaseLedger.client({ clientContactId: id });
  } catch {
    notFound();
  }

  let producerProfile: Awaited<ReturnType<typeof caller.producer.me>> | null = null;
  try {
    producerProfile = await caller.producer.me();
  } catch (err) {
    console.warn("[clients/detail] producer.me failed", err);
  }
  const producerSlug = producerProfile?.slug ?? "";

  // Pre-compute the next upcoming session across this client's
  // projects — kept here (preserved helper) rather than inside the
  // hero so the date-comparison logic stays presentational-free.
  const nextSession = pickNextSession(detail.projects);
  const workspaceBuckets = toProducerPaymentWorkspaceBuckets(payments.producerBuckets);
  const singleCurrencyTotal = payments.totals.length === 1 ? payments.totals[0] : undefined;

  // Build the hero payload. linkState reads invitedAt / clerkUserId off
  // the detail payload — clerkUserId set ⇒ "active" (signed up),
  // else invitedAt set ⇒ "pending" (amber pill), else "none".
  const heroLinkState: ClientSpaceHeroData["linkState"] = detail.contact.clerkUserId
    ? "active"
    : detail.contact.invitedAt
      ? "pending"
      : "none";

  const heroData: ClientSpaceHeroData = {
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
    linkState: heroLinkState,
    joinedAtIso: toIso(detail.contact.firstSeenAt),
    lifetime: singleCurrencyTotal?.purchaseTotalCents ?? null,
    outstanding: singleCurrencyTotal?.totalRemainingCents ?? null,
    activeProjects: detail.stats.activeProjectCount,
    moneyHasMultipleCurrencies: payments.totals.length > 1,
    moneyHasNoPurchases: payments.projects.length === 0,
  };
  if (singleCurrencyTotal) heroData.currency = singleCurrencyTotal.currency;

  // Map each detail project into the shared row shape. Lifecycle/edit
  // actions remain available here; only drag-to-reorder is a list-view
  // affordance rather than a single-client surface.
  const projectRows: ProjectRowData[] = detail.projects.map((p) => {
    const lifecycle = LIFECYCLE_PRESENTATION[p.lifecycleStatus];
    return {
      id: p.id,
      title: p.title,
      lifecycleStatus: p.lifecycleStatus,
      workflowStage: p.workflowStage,
      client: detail.contact.name,
      clientEmail: detail.contact.email,
      progress: lifecycle.progress,
      balance: p.commercial.outstandingCents,
      deadline: formatDeadlineShort(p.deadlineAt),
      status: lifecycle.label,
      statusTone: lifecycle.tone,
      deadlineAtIso: p.deadlineAt ? toIso(p.deadlineAt) : null,
      canPermanentlyDelete: p.canPermanentlyDelete,
    };
  });

  return (
    <main className="sk-page-enter">
      <div className="mx-auto max-w-[1400px] px-4 pt-4 pb-24 sm:px-6 sm:pt-6 lg:px-8 lg:pt-7">
        <SetTopBarBreadcrumb crumbs={[{ label: detail.contact.name }]} />
        <ClientSpaceHero client={heroData} producerSlug={producerSlug} />

        {producerProfile ? (
          <div className="mt-6">
            <PrivateOfferManager
              recipients={[
                {
                  id: detail.contact.id,
                  name: detail.contact.name,
                  email: detail.contact.email,
                  projects: detail.projects
                    .filter(
                      (project) =>
                        project.lifecycleStatus === "waiting_for_payment" ||
                        project.lifecycleStatus === "active",
                    )
                    .map((project) => ({ id: project.id, title: project.title })),
                },
              ]}
              offers={[]}
              lockedClientId={detail.contact.id}
              showHistory={false}
              defaultCurrency={clientOfferCurrency(producerProfile.defaultCurrency)}
              taxMode={coerceTaxMode(producerProfile.taxMode)}
              taxRatePct={producerProfile.taxRatePct}
            />
          </div>
        ) : null}

        <section className="mt-6" aria-labelledby="client-projects-title">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase">
                Work
              </p>
              <h2
                id="client-projects-title"
                className="font-syne text-xl font-bold text-[rgb(var(--fg-default))]"
              >
                Projects
              </h2>
            </div>
            <span className="font-mono text-[11px] font-bold text-[rgb(var(--fg-muted))]">
              {projectRows.length}
            </span>
          </div>

          {projectRows.length === 0 ? (
            <div
              role="status"
              className="mt-3 rounded-[var(--radius-md)] border border-dashed p-8 text-center text-[13px]"
              style={{
                borderColor: "rgb(var(--border-subtle))",
                background: "rgb(var(--bg-elevated))",
                color: "rgb(var(--fg-muted))",
              }}
            >
              No projects with this client yet.
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {projectRows.map((row) => (
                <ProjectRow key={row.id} row={row} hideClient />
              ))}
            </div>
          )}

          {nextSession ? (
            <p className="mt-4 text-[12px]" style={{ color: "rgb(var(--fg-muted))" }}>
              Next session:{" "}
              <span style={{ color: "rgb(var(--fg-default))" }}>
                {formatSessionAt(nextSession.startsAt)}
              </span>{" "}
              for {nextSession.projectTitle}
            </p>
          ) : null}
        </section>

        <section className="mt-8" aria-labelledby="client-payments-title">
          <header className="mb-4">
            <p className="font-mono text-[10px] font-bold tracking-[0.14em] text-[rgb(var(--brand-primary-text))] uppercase">
              Commercial history
            </p>
            <h2
              id="client-payments-title"
              className="font-display mt-1 text-[22px] font-extrabold tracking-[-0.025em] text-[rgb(var(--fg-default))]"
            >
              Payments
            </h2>
            <p className="mt-1 max-w-[68ch] text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
              Filter this client&apos;s balances and history by project. Every amount remains tied
              to its accepted purchase and currency.
            </p>
          </header>
          <ProducerPaymentWorkspace
            buckets={workspaceBuckets}
            scope="client"
            clientLabel={detail.contact.name}
            defaultView="all"
          />
        </section>
      </div>
    </main>
  );
}

function clientOfferCurrency(value: string): "USD" | "EUR" | "GBP" | "ILS" {
  return value === "EUR" || value === "GBP" || value === "ILS" ? value : "USD";
}

// ─────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────

type ProjectLifecycleStatus =
  | "waiting_for_payment"
  | "active"
  | "paused"
  | "completed"
  | "canceled";

const LIFECYCLE_PRESENTATION: Record<
  ProjectLifecycleStatus,
  { label: string; progress: number | null; tone: ProjectRowData["statusTone"] }
> = {
  waiting_for_payment: { label: "Waiting for payment", progress: null, tone: "warn" },
  active: { label: "Active", progress: null, tone: "ok" },
  paused: { label: "Paused", progress: null, tone: "warn" },
  completed: { label: "Archived · Completed", progress: 100, tone: "neutral" },
  canceled: { label: "Archived · Canceled", progress: null, tone: "neutral" },
};

function toIso(raw: Date | string): string {
  return raw instanceof Date ? raw.toISOString() : new Date(raw).toISOString();
}

// SQL `min(... case when ...)` returns Date | string | null depending
// on the driver; pickNextSession normalises to a single Date.
export function pickNextSession(
  projects: readonly { title: string; nextSessionAt: Date | string | null }[],
): { startsAt: Date; projectTitle: string } | null {
  let best: { startsAt: Date; projectTitle: string } | null = null;
  for (const p of projects) {
    if (!p.nextSessionAt) continue;
    const at = p.nextSessionAt instanceof Date ? p.nextSessionAt : new Date(p.nextSessionAt);
    if (Number.isNaN(at.getTime())) continue;
    if (!best || at.getTime() < best.startsAt.getTime()) {
      best = { startsAt: at, projectTitle: p.title };
    }
  }
  return best;
}

function formatDeadlineShort(at: Date | string | null): string {
  if (at == null) return "—";
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) return "—";
  const now = Date.now();
  const diffMs = date.getTime() - now;
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
  if (diffDays < 0) return `${String(Math.abs(diffDays))}d ago`;
  if (diffDays <= 14) return `${String(diffDays)}d`;
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    }).format(date);
  } catch {
    return "—";
  }
}

function formatSessionAt(at: Date): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(at);
  } catch {
    return at.toISOString();
  }
}

export function toClientMoneyLedgerData(history: ClientMoneyHistory): ClientMoneyLedgerData {
  const currencyTotals = history.totals.map((total) => ({
    currency: total.currency,
    purchasedCents: total.purchasedCents,
    paidCents: total.paidCents,
    remainingCents: total.remainingCents,
  }));

  return {
    currencyTotals,
    projects: history.projects
      .filter((project) => project.purchases.length > 0)
      .map((project) => ({
        id: project.id,
        title: project.title,
        lifecycleStatus: project.lifecycleStatus,
        currencyTotals: project.totals.map((total) => ({
          currency: total.currency,
          purchasedCents: total.purchasedCents,
          paidCents: total.paidCents,
          remainingCents: total.remainingCents,
        })),
        purchases: project.purchases.map((purchase) => ({
          id: purchase.id,
          reference: purchase.refNumber,
          title: purchase.productOrOfferName,
          lifecycleStatus: purchase.lifecycleStatus,
          acceptedAtIso: purchase.acceptedAt.toISOString(),
          currency: purchase.currency,
          subtotalCents: purchase.subtotalCents,
          taxCents: purchase.taxCents,
          totalCents: purchase.totalCents,
          paidCents: purchase.ledger.paidCents,
          remainingCents: purchase.ledger.remainingBalanceCents,
          payments: purchase.payments.map((payment) => ({
            id: payment.id,
            amountCents: payment.effectiveAmountCents,
            currency: payment.currency,
            paidAtIso: payment.paidAt.toISOString(),
            source: payment.source,
            note: payment.note,
          })),
          proofs: purchase.proofs.map((proof) => ({
            id: proof.id,
            amountCents: proof.amountCents,
            currency: proof.currency,
            status: proof.status,
            originalFileName: proof.originalFileName,
            createdAtIso: proof.createdAt.toISOString(),
            rejectionNote: proof.rejectionNote,
          })),
        })),
      })),
  };
}
