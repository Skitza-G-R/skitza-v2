import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { createDb, desc, eq, invoices, producers } from "@skitza/db";

import { ProjectHeader } from "~/components/dashboard/project/project-header";
// Server-safe imports (pure types + type-guard) come from the
// shared module; the UI-only `ProjectSubTabs` component stays in
// the `"use client"` file. Importing the guard from the client
// module crashes RSC — that was the 2026-04-23 "Something buzzed"
// bug on every project page. Story 03 of the project-room redesign
// added `resolveSubTab` to the shared module so the page consumes
// it directly instead of duplicating the fallback ladder.
import {
  resolveSubTab,
} from "~/components/dashboard/project/project-sub-tab-shared";
import { ProjectSubTabs } from "~/components/dashboard/project/project-sub-tabs";
import {
  DashboardSubTab,
  type DashboardData,
} from "~/components/dashboard/project/sub-tabs/dashboard-sub-tab";
import { MoneySubTab } from "~/components/dashboard/project/sub-tabs/money-sub-tab";
import { MusicSubTab } from "~/components/dashboard/project/sub-tabs/music-sub-tab";
import {
  SessionsSubTab,
  type SessionBooking,
} from "~/components/dashboard/project/sub-tabs/sessions-sub-tab";
import { Breadcrumbs } from "~/components/ui/breadcrumbs";
import { appRouter } from "~/server/trpc/routers/_app";
import { getStripe } from "~/server/stripe/client";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ProjectDetail({ params, searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const { id } = await params;
  const sp = await searchParams;
  const activeTab = resolveSubTab(sp.tab);

  const caller = appRouter.createCaller({ userId });
  let data;
  try {
    // Project Room redesign 2026-04-26 — Story 03.
    //
    // The page still consumes the fat `project.detail` aggregation
    // because the ProjectHeader + the legacy MusicSubTab both read
    // dozens of fields from it (clientName, paymentPlanKind,
    // installments, chargesCompleted, tracks/versions/comments, etc.)
    // that the new `projectRoom.shell` payload doesn't carry yet. S04
    // (Dashboard tab) will reskin the header off `projectRoom.shell`
    // + `projectRoom.dashboard`; S05 (Music redesign) flips the Music
    // tab to the new `projectRoom.music` query. Until those land, S03
    // ships the perf win (no remount + shallow tab routing) without
    // the larger UI rewrites — keeping `project.detail` in place
    // means S03 is a clean, independently-mergeable refactor.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    data = await caller.project.detail({ id });
  } catch {
    notFound();
  }

  // Story 04 — Dashboard tab fetches its payload from the new
  // `projectRoom.dashboard` aggregation. Falls back to a minimal
  // empty payload if the procedure errors so the rest of the page
  // (header + other tabs) still renders. The Dashboard tab itself
  // surfaces the right empty states from the empty payload.
  const dashboardEmpty: DashboardData = {
    projectId: data.project.id,
    projectTitle: data.project.title,
    artistName: data.project.artistName,
    artistAvatarUrl: null,
    stage: data.project.stage,
    latestVersion: null,
    whatsNext: null,
    recentActivity: [],
    openComments: [],
    sidebar: {
      stage: data.project.stage,
      agreedAmount: null,
      paidAmount: null,
      outstandingAmount: null,
      nextSession: null,
      fileCount: 0,
      fileTotalBytes: 0,
      artist: {
        name: data.project.artistName,
        avatarUrl: null,
        email: data.project.artistEmail,
      },
    },
  };
  let dashboardData: DashboardData = dashboardEmpty;
  try {
    const payload = await caller.projectRoom.dashboard({ projectId: id });
    dashboardData = {
      projectId: data.project.id,
      projectTitle: data.project.title,
      artistName: data.project.artistName,
      artistAvatarUrl: payload.sidebar.artist.avatarUrl,
      stage: payload.sidebar.stage,
      latestVersion: payload.latestVersion,
      whatsNext: payload.whatsNext,
      recentActivity: payload.recentActivity,
      openComments: payload.openComments,
      sidebar: payload.sidebar,
    };
  } catch (err) {
    console.warn("[projects] projectRoom.dashboard failed", err);
  }

  // Batch G Task 4 — money summary for the Money sub-tab's 3-metric
  // strip (Paid / Outstanding / Next charge). Degrade gracefully:
  // zero everywhere if the router errors, matching the "no invoices"
  // render path.
  let moneyForProject: {
    paidCents: number;
    outstandingCents: number;
    currency: string;
    nextChargeAt: Date | null;
  } = {
    paidCents: 0,
    outstandingCents: 0,
    currency: "USD",
    nextChargeAt: null,
  };
  try {
    moneyForProject = await caller.project.money({ projectId: id });
  } catch (err) {
    console.warn("[projects] project.money failed", err);
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

  // Batch D — look up the client contact linked to this project so
  // the header can render per-client tags + the inline tag editor.
  // Matches on project.artistEmail; for legacy rows with clientEmail
  // but no artistEmail the clientContacts.listWithProjects fallback
  // would catch them, but this path is simpler and covers 99% of
  // projects. Failure degrades to `null` (header omits the tag strip).
  let clientContact: {
    id: string;
    tags: string[];
  } | null = null;
  let tagVocabulary: string[] = [];
  try {
    const [contact, vocab] = await Promise.all([
      caller.clientContacts.list({ q: data.project.artistEmail }),
      caller.clientContacts.listTags(),
    ]);
    const match = contact.find(
      (c) => c.email.toLowerCase() === data.project.artistEmail.toLowerCase(),
    );
    if (match) {
      // The list query projects a slim row; fetch the full record for
      // tags since autocomplete values aren't exposed on the list shape.
      const detail = await caller.clientContacts.detail({ id: match.id });
      clientContact = {
        id: detail.contact.id,
        tags: detail.contact.tags,
      };
    }
    tagVocabulary = vocab;
  } catch (err) {
    console.warn("[projects] client contact lookup failed", err);
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
    <>
      {/* The Project Room has the richest content surface in the
          dashboard — ProjectHeader + 5-step timeline + payment strip
          + sub-tabs that can render a waveform player, a comment
          thread, and a money ledger simultaneously. 1600px (vs the
          1400px default on Today/Projects/Music) reclaims roughly
          one waveform-worth of horizontal breathing room on
          ultra-wide 2560px+ displays without feeling stretched on
          a 1280px MacBook Air. */}
      <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
        <Breadcrumbs
          className="mb-3"
          items={[
            { label: "Projects", href: "/dashboard/projects" },
            { label: data.project.title },
          ]}
        />
        <ProjectHeader
          project={headerProject}
          clientContact={clientContact}
          tagVocabulary={tagVocabulary}
        />
        <div className="mt-6">
          {/* Story 03 — panels prop replaces the legacy children +
              activeTab-conditional render. All 4 panels render
              concurrently (mounted at all times); ProjectSubTabs
              hides inactive ones via CSS. The Notes tab was retired
              in this story (PRD §4.2 — Dashboard takes its slot AND
              becomes the default). */}
          <ProjectSubTabs
            activeTab={activeTab}
            panels={{
              dashboard: (
                <DashboardSubTab
                  projectId={data.project.id}
                  dashboard={dashboardData}
                />
              ),
              music: (
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
              ),
              sessions: (
                <SessionsSubTab projectId={data.project.id} booking={sessionBooking} />
              ),
              money: (
                <MoneySubTab
                  projectId={data.project.id}
                  money={moneyForProject}
                  contracts={contractsForProject}
                />
              ),
            }}
          />
        </div>
      </div>
    </>
  );
}
