import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ClientDetailHeader } from "~/components/dashboard/clients/detail/client-detail-header";
import { ClientDetailTabs } from "~/components/dashboard/clients/detail/client-detail-tabs";
import { ClientNotesPanel } from "~/components/dashboard/clients/detail/client-notes-panel";
import { ClientOverviewPanel } from "~/components/dashboard/clients/detail/client-overview-panel";
import { ClientPaymentsPanel } from "~/components/dashboard/clients/detail/client-payments-panel";
import { ClientProjectsPanel } from "~/components/dashboard/clients/detail/client-projects-panel";
import { resolveClientDetailTab } from "~/lib/dashboard/client-detail-tab-key";
import { appRouter } from "~/server/trpc/routers/_app";

// /dashboard/clients-projects/clients/[id] — Client Space.
//
// The Clients tab on the parent /dashboard/clients-projects page links
// rows here (see ClientsListScreen line 123). Before this page existed
// the link landed on a 404, which was the bug the founder hit. The
// route is server-rendered with two parallel queries:
//
//   • clientContacts.detail({ id }) — full payload (contact + stats +
//     projects + comments). Producer-scoped via the procedure
//     middleware, so a foreign UUID throws NOT_FOUND and the page
//     calls notFound().
//   • producer.me() — only consumed for `defaultCurrency` so the
//     money strings honour ILS / EUR / GBP / USD per the producer's
//     setting (per founder direction 2026-05-06).
//
// Tabs are URL-driven via `?tab=` so a refresh keeps the producer's
// place. The pure resolver (~/lib/dashboard/client-detail-tab-key)
// degrades to "overview" on anything unrecognised.
//
// Currency: the contact-level outstandingCents/lifetimeCents are
// summed without per-project normalization. v1 displays in the
// producer's defaultCurrency. Per-project currency mismatches will
// look weird here — flagged on the PRD followups.

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ClientDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { id } = await params;
  const sp = await searchParams;
  const activeTab = resolveClientDetailTab(sp.tab);

  const caller = appRouter.createCaller({ userId });

  // Two parallel calls — detail is the canonical data, me() is just
  // for currency. If me() errors (e.g. a producer row hiccup), fall
  // back to USD; the detail call's NOT_FOUND on a foreign id still
  // funnels to the 404 page below.
  let detail;
  try {
    detail = await caller.clientContacts.detail({ id });
  } catch {
    notFound();
  }

  let producerCurrency = "USD";
  try {
    const me = await caller.producer.me();
    producerCurrency = me.defaultCurrency;
  } catch (err) {
    console.warn("[clients] producer.me failed for currency lookup", err);
  }

  // Pre-compute the next upcoming session across this client's
  // projects. Header consumes a single { startsAt, projectTitle } so
  // all the date-comparison logic stays here in the page rather than
  // bloating the header component.
  const nextSession = pickNextSession(detail.projects);

  // "+ New project" — pre-fills the new-project form with the
  // client's identity. Both fields are URI-encoded; the form reads
  // them as defaults but the producer can edit before submit.
  const newProjectHref =
    `/dashboard/clients-projects/new?clientEmail=${encodeURIComponent(
      detail.contact.email,
    )}&clientName=${encodeURIComponent(detail.contact.name)}`;

  return (
    <>
      {/* Top row — "All clients" back link (left) + breadcrumb (right).
          Anchored above the gradient band so the slim chrome reads as
          page navigation rather than part of the editorial header. */}
      <div className="mx-auto max-w-[1400px] px-4 pt-4 sm:px-6 lg:px-8 lg:pt-6">
        <nav
          aria-label="Breadcrumb"
          className="flex flex-wrap items-center justify-between gap-3 text-[11.5px] font-mono uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]"
        >
          <Link
            href="/dashboard/clients-projects?tab=clients"
            className="rounded-[var(--radius-sm)] hover:text-[rgb(var(--fg-default))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
          >
            ← All clients
          </Link>
          <p className="truncate">
            <Link
              href="/dashboard/clients-projects"
              className="hover:text-[rgb(var(--fg-default))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
            >
              Clients &amp; Projects
            </Link>
            <span aria-hidden> / </span>
            <span className="text-[rgb(var(--fg-default))]">
              {detail.contact.name}
            </span>
          </p>
        </nav>
      </div>

      <div className="relative isolate">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[280px] bg-gradient-to-b from-[rgb(var(--brand-primary)/0.08)] via-[rgb(var(--bg-base))] to-[rgb(var(--bg-base))]"
        />
        <div className="sk-page-enter mx-auto max-w-[1400px] px-4 pt-6 pb-24 sm:px-6 sm:pt-8 lg:px-8 lg:pt-10">
          <ClientDetailHeader
            contact={{
              id: detail.contact.id,
              name: detail.contact.name,
              email: detail.contact.email,
              firstSeenAt: toDate(detail.contact.firstSeenAt),
            }}
            stats={{
              activeProjectCount: detail.stats.activeProjectCount,
              totalProjectCount: detail.stats.totalProjectCount,
              outstandingCents: detail.stats.outstandingCents,
            }}
            nextSession={nextSession}
            currency={producerCurrency}
            newProjectHref={newProjectHref}
          />

          <div className="mt-7">
            <ClientDetailTabs
              active={activeTab}
              clientId={detail.contact.id}
              projectCount={detail.projects.length}
            />
          </div>

          <div
            key={activeTab}
            id={`client-detail-panel-${activeTab}`}
            aria-labelledby={`client-detail-tab-${activeTab}`}
            className="pt-5"
          >
            {activeTab === "overview" ? (
              <ClientOverviewPanel
                clientId={detail.contact.id}
                projects={detail.projects}
                comments={detail.comments}
                stats={{
                  lifetimeCents: detail.stats.lifetimeCents,
                  outstandingCents: detail.stats.outstandingCents,
                }}
                currency={producerCurrency}
              />
            ) : null}
            {activeTab === "projects" ? (
              <ClientProjectsPanel
                projects={detail.projects}
                currency={producerCurrency}
              />
            ) : null}
            {activeTab === "payments" ? (
              <ClientPaymentsPanel
                projects={detail.projects}
                stats={{
                  lifetimeCents: detail.stats.lifetimeCents,
                  outstandingCents: detail.stats.outstandingCents,
                }}
                currency={producerCurrency}
              />
            ) : null}
            {activeTab === "notes" ? (
              <ClientNotesPanel
                contact={{
                  notes: detail.contact.notes,
                  tags: detail.contact.tags,
                  referralSource: detail.contact.referralSource,
                }}
                projectCount={detail.projects.length}
              />
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

// SQL `min(... case when ...)` returns Date | string | null depending
// on the driver's adapter; coerce to Date for the header / panels.
function toDate(raw: Date | string): Date {
  return raw instanceof Date ? raw : new Date(raw);
}

function pickNextSession(
  projects: readonly { title: string; nextSessionAt: Date | string | null }[],
): { startsAt: Date; projectTitle: string } | null {
  let best: { startsAt: Date; projectTitle: string } | null = null;
  for (const p of projects) {
    if (!p.nextSessionAt) continue;
    const at =
      p.nextSessionAt instanceof Date
        ? p.nextSessionAt
        : new Date(p.nextSessionAt);
    if (Number.isNaN(at.getTime())) continue;
    if (!best || at.getTime() < best.startsAt.getTime()) {
      best = { startsAt: at, projectTitle: p.title };
    }
  }
  return best;
}
