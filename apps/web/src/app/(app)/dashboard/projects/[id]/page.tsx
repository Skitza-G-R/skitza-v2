import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { createDb, desc, eq, invoices, producers } from "@skitza/db";

import { ProjectHeader } from "~/components/dashboard/project/project-header";
// Server-safe imports (pure types + type-guard) come from the
// shared module; the UI-only `ProjectSubTabs` component stays in
// the `"use client"` file. Importing the guard from the client
// module crashes RSC — that was the 2026-04-23 "Something buzzed"
// bug on every project page.
import {
  isProjectSubTabId,
  type ProjectSubTabId,
} from "~/components/dashboard/project/project-sub-tab-shared";
import { ProjectSubTabs } from "~/components/dashboard/project/project-sub-tabs";
import { TagEditor } from "~/components/dashboard/project/tag-editor";
import { MoneySubTab } from "~/components/dashboard/project/sub-tabs/money-sub-tab";
import { MusicSubTab } from "~/components/dashboard/project/sub-tabs/music-sub-tab";
import {
  OverviewSubTab,
  type OverviewLatestSong,
} from "~/components/dashboard/project/sub-tabs/overview-sub-tab";
import {
  SessionsSubTab,
  type SessionBooking,
} from "~/components/dashboard/project/sub-tabs/sessions-sub-tab";
import { Breadcrumbs } from "~/components/ui/breadcrumbs";
import { gradientForId } from "~/lib/projects/gradient";
import { appRouter } from "~/server/trpc/routers/_app";
import { getStripe } from "~/server/stripe/client";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Narrow a raw `?tab=` value (single string / array / undefined) into a
// valid ProjectSubTabId. Anything unrecognised — including the retired
// `?tab=notes` URL from pre-2026-05 bookmarks — falls back to
// "overview", the new default landing tab for the Project Room.
function resolveSubTab(raw: string | string[] | undefined): ProjectSubTabId {
  if (Array.isArray(raw)) raw = raw[0];
  return isProjectSubTabId(raw) ? raw : "overview";
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

  // ─── Derived props for the 2026-05 redesign ────────────────────────

  // Per-project hero gradient — deterministic from the project id so
  // each project always opens with the same color across visits, but
  // the producer's roster looks varied across projects (no two adjacent
  // projects pick the same gradient ~5/6 of the time).
  const gradientClass = gradientForId(data.project.id);

  // Sessions count: the project schema is 1:1 with `bookingId`, so the
  // count is 0 or 1. We render "1 session" in the hero meta when a
  // booking exists; future schema work that allows multiple bookings
  // per project will plug in here without touching the hero.
  const sessionsCount = data.project.bookingId ? 1 : 0;
  const songsCount = data.tracks.length;
  const hasVersions = data.versions.length > 0;

  // Latest songs for the Overview tab — top 3 tracks by their newest
  // version's uploadedAt. Tracks with zero versions go last (sorted by
  // position so they keep producer-chosen order). Pre-computed here so
  // the Overview tab stays a server component with no derivation logic.
  const versionsByTrack = new Map<string, Date>();
  for (const v of data.versions) {
    const prev = versionsByTrack.get(v.trackId);
    if (!prev || v.uploadedAt > prev) versionsByTrack.set(v.trackId, v.uploadedAt);
  }
  const latestVersionLabelByTrack = new Map<string, string>();
  for (const v of data.versions) {
    const prev = versionsByTrack.get(v.trackId);
    if (prev && v.uploadedAt.getTime() === prev.getTime()) {
      latestVersionLabelByTrack.set(v.trackId, v.label);
    }
  }
  const latestSongs: OverviewLatestSong[] = data.tracks
    .map((t) => ({
      trackId: t.id,
      title: t.title,
      latestVersionLabel: latestVersionLabelByTrack.get(t.id) ?? null,
      latestUploadedAt: versionsByTrack.get(t.id) ?? null,
      position: t.position,
    }))
    .sort((a, b) => {
      // Most-recently-updated tracks first; tracks without versions
      // fall to the back, ordered by their position so they stay
      // in producer-chosen sequence.
      if (a.latestUploadedAt && b.latestUploadedAt) {
        return b.latestUploadedAt.getTime() - a.latestUploadedAt.getTime();
      }
      if (a.latestUploadedAt) return -1;
      if (b.latestUploadedAt) return 1;
      return a.position - b.position;
    })
    .slice(0, 3)
    .map(({ trackId, title, latestVersionLabel, latestUploadedAt }) => ({
      trackId,
      title,
      latestVersionLabel,
      latestUploadedAt,
    }));

  // Client info for the Overview Client card. The TagEditor (a client
  // component) is pre-rendered here and passed as a slot so the
  // Overview tab can stay a server component — RSC interleaves the
  // client subtree without forcing the parent to flip.
  const overviewClient = {
    name: data.project.clientName ?? data.project.artistName,
    email: data.project.artistEmail,
    tags: clientContact?.tags ?? [],
  };
  const tagEditorSlot = clientContact ? (
    <TagEditor
      contactId={clientContact.id}
      initialTags={clientContact.tags}
      vocabulary={tagVocabulary}
    />
  ) : null;

  // Timeline input — used by both the StatusStrip's progress percent
  // (computed inside ProjectHeader) and the Overview tab's Workflow
  // card. finalDelivered mirrors finalPaid for now.
  const timelineInput = {
    stage: data.project.stage,
    contractSigned,
    chargesCompleted: data.project.chargesCompleted,
    chargesTotal: data.project.chargesTotal,
    finalDelivered: data.project.finalPaid,
  };

  return (
    <>
      {/* The Project Room has the richest content surface in the
          dashboard — gradient hero + status strip + payment strip
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
          gradientClass={gradientClass}
          songsCount={songsCount}
          sessionsCount={sessionsCount}
          hasVersions={hasVersions}
          outstandingCents={moneyForProject.outstandingCents}
        />
        <div className="mt-6">
          <ProjectSubTabs activeTab={activeTab}>
            {activeTab === "overview" ? (
              <OverviewSubTab
                projectId={data.project.id}
                timeline={timelineInput}
                latestSongs={latestSongs}
                trackCount={data.tracks.length}
                client={overviewClient}
                tagEditor={tagEditorSlot}
              />
            ) : null}
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
              <MoneySubTab
                projectId={data.project.id}
                money={moneyForProject}
                contracts={contractsForProject}
              />
            ) : null}
          </ProjectSubTabs>
        </div>
      </div>
    </>
  );
}
