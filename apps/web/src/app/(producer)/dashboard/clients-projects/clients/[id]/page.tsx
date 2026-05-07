import { auth } from "@clerk/nextjs/server";
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

  // OUTSTANDING card sub-label data: how many of this client's
  // projects have a non-zero unpaid balance. Same rollup the trpc
  // detail() procedure already computed per-project; we just count
  // the rows here rather than re-running the math. Pre-computed so
  // the header stays presentational.
  const unpaidProjectCount = detail.projects.filter(
    (p) => p.outstandingCents > 0,
  ).length;

  // "+ New project" — pre-fills the new-project form with the
  // client's identity. Both fields are URI-encoded; the form reads
  // them as defaults but the producer can edit before submit.
  const newProjectHref =
    `/dashboard/clients-projects/new?clientEmail=${encodeURIComponent(
      detail.contact.email,
    )}&clientName=${encodeURIComponent(detail.contact.name)}`;

  return (
    <main className="sk-page-enter">
      {/* Hero band + KPI strip — both rendered by the header component
          so the breadcrumb, identity slab, and KPI floats stay
          composed as one editorial slab. Hero is full-bleed; KPI
          strip sits in the standard 1400px container and overlaps
          the band's bottom edge. */}
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
          unpaidProjectCount,
        }}
        nextSession={nextSession}
        currency={producerCurrency}
        newProjectHref={newProjectHref}
      />

      <div className="mx-auto max-w-[1400px] px-4 pb-24 pt-8 sm:px-6 sm:pt-10 lg:px-8">
        <ClientDetailTabs
          active={activeTab}
          clientId={detail.contact.id}
          projectCount={detail.projects.length}
        />

        <div
          key={activeTab}
          id={`client-detail-panel-${activeTab}`}
          aria-labelledby={`client-detail-tab-${activeTab}`}
          className="pt-6"
        >
          {activeTab === "overview" ? (
            <ClientOverviewPanel
              clientId={detail.contact.id}
              clientName={detail.contact.name}
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
    </main>
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
