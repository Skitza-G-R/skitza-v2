import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { createDb, desc, eq, invoices, producers } from "@skitza/db";

import { AppShell } from "~/components/shell/app-shell";
import { appRouter } from "~/server/trpc/routers/_app";
import { getStripe } from "~/server/stripe/client";
import { ProjectView } from "./project-view";

type PageProps = { params: Promise<{ id: string }> };

export default async function ProjectDetail({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const { id } = await params;

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

  // Invoice-linked currency for the modal. We query the project's
  // most recent invoice for the authoritative currency snapshot;
  // if none exists yet (producer marking final paid on a legacy
  // project) fall back to the producer's default currency.
  let projectCurrency = "USD";
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

  return (
    <AppShell active="pipeline">
      <ProjectView
        project={{
          id: data.project.id,
          title: data.project.title,
          stage: data.project.stage,
          artistName: data.project.artistName,
          artistEmail: data.project.artistEmail,
          clientName: data.project.clientName,
          clientEmail: data.project.clientEmail,
          depositPaid: data.project.depositPaid,
          finalPaid: data.project.finalPaid,
          paymentPlanKind: data.project.paymentPlanKind,
          chargesCompleted: data.project.chargesCompleted,
          chargesTotal: data.project.chargesTotal,
          totalAmountCents: data.project.totalAmountCents,
          cardLast4,
          currency: projectCurrency,
          createdAt: data.project.createdAt,
          updatedAt: data.project.updatedAt,
        }}
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
        contracts={contractsForProject}
      />
    </AppShell>
  );
}
