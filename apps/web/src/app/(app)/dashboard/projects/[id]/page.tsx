import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { createDb, desc, eq, invoices, producers } from "@skitza/db";

import { PaymentStatusStrip } from "~/components/project/payment-status-strip";
import { ProjectRoomHero } from "~/components/dashboard/project/project-room-hero";
import { ProjectStatStrip } from "~/components/dashboard/project/project-stat-strip";
import { ProjectTimeline } from "~/components/dashboard/project/project-timeline";
import {
  isProjectSubTabId,
  type ProjectSubTabId,
} from "~/components/dashboard/project/project-sub-tab-shared";
import { ProjectSubTabs } from "~/components/dashboard/project/project-sub-tabs";
import { TagEditor } from "~/components/dashboard/project/tag-editor";
import { MoneySubTab } from "~/components/dashboard/project/sub-tabs/money-sub-tab";
import { MusicSubTab } from "~/components/dashboard/project/sub-tabs/music-sub-tab";
import { NotesSubTab } from "~/components/dashboard/project/sub-tabs/notes-sub-tab";
import {
  SessionsSubTab,
  type SessionBooking,
} from "~/components/dashboard/project/sub-tabs/sessions-sub-tab";
import { appRouter } from "~/server/trpc/routers/_app";
import { getStripe } from "~/server/stripe/client";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

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

  const contractSigned = contractsForProject.some(
    (c) => c.status === "signed" || c.signedAt !== null,
  );

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

  // Hero needs a slim shape — strip to what it actually consumes.
  const heroProject = {
    id: data.project.id,
    title: data.project.title,
    stage: data.project.stage,
    artistName: data.project.clientName ?? data.project.artistName,
    artistEmail: data.project.artistEmail,
    trackCount: data.tracks.length,
    sessionCount: sessionBooking ? 1 : 0,
    totalAmountCents: data.project.totalAmountCents,
    currency: projectCurrency,
    paymentPlanKind: data.project.paymentPlanKind,
    installments: data.project.installments,
    chargesCompleted: data.project.chargesCompleted,
    chargesTotal: data.project.chargesTotal,
    finalPaid: data.project.finalPaid,
    cardLast4,
    firstTrackId: data.tracks[0]?.id ?? null,
  };

  const finalDelivered = data.project.finalPaid;

  return (
    <>
      {/* Full-bleed gradient hero — sits flush against the producer
          shell, no max-width clipping. The body below recovers the
          centered max-width treatment. */}
      <ProjectRoomHero project={heroProject} />

      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
        {/* Stat strip — 4 tiles, the at-a-glance summary. */}
        <ProjectStatStrip
          stage={data.project.stage}
          nextSessionAt={sessionBooking?.startsAt ?? null}
          outstandingCents={moneyForProject.outstandingCents}
          currency={projectCurrency}
        />

        {/* Optional tag strip — only shows when we resolved a CRM
            contact for the project's email. */}
        {clientContact ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]">
              Tags
            </span>
            <TagEditor
              contactId={clientContact.id}
              initialTags={clientContact.tags}
              vocabulary={tagVocabulary}
            />
          </div>
        ) : null}

        {/* 5-step funnel rail. */}
        <div className="mt-5">
          <ProjectTimeline
            stage={data.project.stage}
            contractSigned={contractSigned}
            chargesCompleted={data.project.chargesCompleted}
            chargesTotal={data.project.chargesTotal}
            finalDelivered={finalDelivered}
          />
        </div>

        {/* Payment plan strip — only when there's a plan to surface. */}
        {data.project.paymentPlanKind ? (
          <div className="mt-5">
            <PaymentStatusStrip
              paymentPlanKind={
                data.project.paymentPlanKind === "full" ||
                data.project.paymentPlanKind === "split_50_50" ||
                data.project.paymentPlanKind === "monthly"
                  ? data.project.paymentPlanKind
                  : null
              }
              installments={data.project.installments}
              chargesCompleted={data.project.chargesCompleted}
              chargesTotal={data.project.chargesTotal}
              totalAmountCents={data.project.totalAmountCents}
              currency={projectCurrency}
              nextChargeAt={data.project.nextChargeAt}
              stage={data.project.stage}
            />
          </div>
        ) : null}

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
              <MoneySubTab
                projectId={data.project.id}
                money={moneyForProject}
                contracts={contractsForProject}
              />
            ) : null}
            {activeTab === "notes" ? (
              <NotesSubTab
                project={{
                  clientName: data.project.clientName,
                  clientEmail: data.project.clientEmail,
                  artistName: data.project.artistName,
                  artistEmail: data.project.artistEmail,
                  createdAt: data.project.createdAt,
                  updatedAt: data.project.updatedAt,
                }}
                trackCount={data.tracks.length}
                versionCount={data.versions.length}
                contractCount={contractsForProject.length}
                tracks={data.tracks.map((t) => ({ id: t.id, title: t.title }))}
                versions={data.versions.map((v) => ({
                  trackId: v.trackId,
                  label: v.label,
                  uploadedAt: v.uploadedAt,
                }))}
                comments={data.comments.map((c) => ({
                  authorName: c.authorName,
                  body: c.body,
                  timestampMs: c.timestampMs,
                  fromProducer: c.fromProducer,
                  createdAt: c.createdAt,
                }))}
              />
            ) : null}
          </ProjectSubTabs>
        </div>
      </div>
    </>
  );
}
