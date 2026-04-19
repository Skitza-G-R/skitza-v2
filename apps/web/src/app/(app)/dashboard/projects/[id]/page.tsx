import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { createDb, desc, eq, invoices, producers } from "@skitza/db";

import { ProjectHeader } from "~/components/dashboard/project/project-header";
import {
  isProjectSubTabId,
  ProjectSubTabs,
  type ProjectSubTabId,
} from "~/components/dashboard/project/project-sub-tabs";
import { MoneySubTab } from "~/components/dashboard/project/sub-tabs/money-sub-tab";
import { MusicSubTab } from "~/components/dashboard/project/sub-tabs/music-sub-tab";
import {
  SessionsSubTab,
  type SessionBooking,
} from "~/components/dashboard/project/sub-tabs/sessions-sub-tab";
import { AppShell } from "~/components/shell/app-shell";
import { appRouter } from "~/server/trpc/routers/_app";
import { getStripe } from "~/server/stripe/client";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Narrow a raw `?tab=` value (single string / array / undefined) into a
// valid ProjectSubTabId. Anything unrecognised falls back to "music",
// the default sub-tab for the Project Room.
function resolveSubTab(raw: string | string[] | undefined): ProjectSubTabId {
  if (Array.isArray(raw)) raw = raw[0];
  return isProjectSubTabId(raw) ? raw : "music";
}

export default async function ProjectDetail({ params, searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const { id } = await params;
  const sp = await searchParams;
  const activeTab = resolveSubTab(sp.tab);

  const caller = appRouter.createCaller({ userId });
  let data;
  try {
    data = await caller.project.detail({ id });
  } catch {
    notFound();
  }

  // Contracts: list all producer contracts and client-filter by
  // contract.projectId. Degrade gracefully if the router errors
  // (cross-branch schema skew).
  let contractsForProject: {
    id: string;
    title: string;
    status: string;
    createdAt: Date;
    signedAt: Date | null;
  }[] = [];
  try {
    const all = await caller.contract.list();
    contractsForProject = all
      .filter((c) => c.projectId === id)
      .map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        createdAt: c.createdAt,
        signedAt: c.signedAt,
      }));
  } catch {
    contractsForProject = [];
  }

  // Task 5 — timeline's Contract step needs to know whether at least
  // one contract for this project has been signed. `signedAt` on any
  // recipient (status === "signed") is the authoritative signal.
  const contractSigned = contractsForProject.some(
    (c) => c.status === "signed" || c.signedAt !== null,
  );

  // Task 7 — Sessions sub-tab needs the single booking linked to this
  // project (projects.bookingId is a 1:1 FK). Reuse the producer-scoped
  // booking.list and filter in JS: producers typically have a small
  // number of bookings and list is already cached by this render tree.
  // Degrade silently if the router errors — the sub-tab will render its
  // empty state, which is the right UX for "we can't resolve a booking".
  let sessionBooking: SessionBooking | null = null;
  if (data.project.bookingId) {
    try {
      const all = await caller.booking.list();
      const match = all.find((b) => b.id === data.project.bookingId);
      if (match) {
        sessionBooking = {
          id: match.id,
          status: match.status,
          startsAt: match.startsAt,
          durationMin: match.durationMin,
          packageName: match.packageNameSnapshot,
          artistName: match.artistName,
          artistEmail: match.artistEmail,
        };
      }
    } catch (err) {
      console.warn("[projects] booking.list failed for sessions tab", err);
    }
  }

  // For split_50_50 projects with a saved PM, fetch the card's last-4
  // from Stripe so the confirm-charge modal can show "card ending 4242"
  // before the producer fires the off-session charge. Degrade silently
  // on Stripe outage — the modal just omits the tail, no functional
  // loss. Only fetched when actually relevant (plan + PM present).
  let cardLast4: string | null = null;
  if (
    data.project.paymentPlanKind === "split_50_50" &&
    data.project.stripePaymentMethodId
  ) {
    try {
      const stripe = getStripe();
      const pm = await stripe.paymentMethods.retrieve(
        data.project.stripePaymentMethodId,
      );
      cardLast4 = pm.card?.last4 ?? null;
    } catch (err) {
      console.warn("[projects] paymentMethods.retrieve failed", err);
    }
  }

  // Important 3: currency is now snapshotted on the project row at
  // booking time, so the modal + chargeFinal both read from the same
  // source. For legacy projects without a persisted currency, fall back
  // to the most recent invoice; failing that, the producer's default.
  // The fallback chain protects pre-migration-0023 rows; new rows hit
  // the project field directly.
  let projectCurrency = data.project.currency ?? "USD";
  if (!data.project.currency) {
    const dbUrl = process.env.DATABASE_URL;
    if (dbUrl) {
      try {
        const db = createDb(dbUrl);
        const [inv] = await db
          .select({ currency: invoices.currency })
          .from(invoices)
          .where(eq(invoices.projectId, id))
          .orderBy(desc(invoices.createdAt))
          .limit(1);
        if (inv?.currency) {
          projectCurrency = inv.currency;
        } else {
          const [producer] = await db
            .select({ defaultCurrency: producers.defaultCurrency })
            .from(producers)
            .where(eq(producers.id, data.project.producerId))
            .limit(1);
          if (producer?.defaultCurrency) {
            projectCurrency = producer.defaultCurrency;
          }
        }
      } catch (err) {
        console.warn("[projects] currency lookup failed", err);
      }
    }
  }

  // Shared header props — consumed by ProjectHeader's top row, payment
  // strip, timeline, and 3-dot action handlers. finalDelivered mirrors
  // finalPaid for now (pre-Task-6 there's no dedicated "delivered"
  // column).
  const headerProject = {
    id: data.project.id,
    title: data.project.title,
    stage: data.project.stage,
    artistName: data.project.artistName,
    artistEmail: data.project.artistEmail,
    clientName: data.project.clientName,
    depositPaid: data.project.depositPaid,
    finalPaid: data.project.finalPaid,
    paymentPlanKind: data.project.paymentPlanKind,
    installments: data.project.installments,
    nextChargeAt: data.project.nextChargeAt,
    chargesCompleted: data.project.chargesCompleted,
    chargesTotal: data.project.chargesTotal,
    totalAmountCents: data.project.totalAmountCents,
    cardLast4,
    currency: projectCurrency,
    contractSigned,
    finalDelivered: data.project.finalPaid,
  };

  return (
    <AppShell active="projects">
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <ProjectHeader project={headerProject} />
        <div className="mt-6">
          <ProjectSubTabs activeTab={activeTab}>
            {activeTab === "music" ? (
              <MusicSubTab
                project={{ id: data.project.id }}
                tracks={data.tracks.map((t) => ({
                  id: t.id,
                  title: t.title,
                  artist: t.artist,
                  position: t.position,
                }))}
                versions={data.versions.map((v) => ({
                  id: v.id,
                  trackId: v.trackId,
                  label: v.label,
                  audioUrl: v.audioUrl,
                  uploadedAt: v.uploadedAt,
                  approvedAt: v.approvedAt,
                }))}
                comments={data.comments.map((c) => ({
                  id: c.id,
                  versionId: c.versionId,
                  authorName: c.authorName,
                  body: c.body,
                  timestampMs: c.timestampMs,
                  resolvedAt: c.resolvedAt,
                  fromProducer: c.fromProducer,
                  createdAt: c.createdAt,
                }))}
              />
            ) : null}
            {activeTab === "sessions" ? (
              <SessionsSubTab projectId={data.project.id} booking={sessionBooking} />
            ) : null}
            {activeTab === "money" ? (
              <MoneySubTab projectId={data.project.id} contracts={contractsForProject} />
            ) : null}
            {activeTab === "notes" ? <NotesPlaceholder /> : null}
          </ProjectSubTabs>
        </div>
      </div>
    </AppShell>
  );
}

// Placeholder for Task 9. The Notes sub-tab will grow its own
// per-tab server component next; for now we render a visible "coming
// soon" card so the sub-tab nav isn't rendering into a void.
function NotesPlaceholder() {
  return (
    <div className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] py-12 text-center text-sm text-[rgb(var(--fg-muted))]">
      Notes view — coming next.
    </div>
  );
}
