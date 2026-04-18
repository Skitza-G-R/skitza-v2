import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { AppShell } from "~/components/shell/app-shell";
import { Button } from "~/components/ui/button";
import { appRouter } from "~/server/trpc/routers/_app";

import { Kanban, type KanbanProject } from "./kanban";
import { STAGES, type Stage } from "./kanban-helpers";
import { detectOnboardingState } from "./onboarding/detect";
import { RevenueTile } from "./revenue-tile";
import { UpcomingStrip, type UpcomingItem } from "./upcoming-strip";

// Phase C.4: the producer's default view is now the pipeline Kanban.
// Phase G.5-7 layered first-run onboarding redirect + calendar strip
// + revenue tile on top. Kanban stays at the bottom; the header
// stats live in their own DashboardHeaderStats block above.
type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DashboardPage({ searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const sp = await searchParams;
  const skipOnboarding = sp.skip === "1" || sp.skip === "true";

  // First-run redirect. `?skip=1` lets the producer bypass the
  // wizard — honored on both the redirect decision and the banner
  // state so power users can get straight in.
  const onboarding = await detectOnboardingState(userId);
  if (onboarding.firstRun && !skipOnboarding) {
    redirect("/dashboard/onboarding");
  }

  const caller = appRouter.createCaller({ userId });
  const [grouped, upcomingRows, me] = await Promise.all([
    caller.project.listByStage(),
    caller.booking.upcoming({ days: 7 }),
    caller.producer.me(),
  ]);

  // Project the tRPC response onto the narrower KanbanProject shape.
  // Two reasons to do this server-side: (1) keep the client bundle
  // free of db-layer types, (2) stability — the client only cares
  // about the six fields below, and insulating it from schema churn
  // is cheap.
  const initial = STAGES.reduce<Record<Stage, KanbanProject[]>>(
    (acc, stage) => {
      acc[stage] = grouped[stage].map((d) => ({
        id: d.id,
        title: d.title,
        stage: d.stage,
        artistName: d.artistName,
        clientName: d.clientName,
        updatedAt: d.updatedAt,
      }));
      return acc;
    },
    {
      lead: [],
      booked: [],
      contract_sent: [],
      in_production: [],
      final_review: [],
      paid: [],
      archived: [],
    },
  );

  const total = STAGES.reduce((acc, s) => acc + initial[s].length, 0);

  const upcomingItems: UpcomingItem[] = upcomingRows.map((b) => ({
    id: b.id,
    artistName: b.artistName,
    artistEmail: b.artistEmail,
    startsAtIso: b.startsAt.toISOString(),
    durationMin: b.durationMin,
    packageName: b.packageName ?? null,
  }));

  const hdrs = await headers();
  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? "skitza.app";
  const proto = hdrs.get("x-forwarded-proto") ?? "https";
  const bookingUrl = me.slug ? `${proto}://${host}/p/${me.slug}/book` : null;

  // "Finish setup" nudge for producers who skipped the wizard but
  // still have core gaps. Hidden once every core step is complete.
  const setupIncomplete =
    !onboarding.hasPackages || !onboarding.hasAvailability || !onboarding.hasDisplayName;

  return (
    <AppShell active="pipeline">
      <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 sm:py-10">
        <header className="reveal-up flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
              Pipeline
            </p>
            <h1
              className="mt-2 font-display text-3xl leading-tight tracking-tight sm:text-4xl"
              style={{ fontVariationSettings: '"opsz" 96' }}
            >
              {total === 0
                ? "Your projects, start to finish."
                : `${total.toString()} ${total === 1 ? "project" : "projects"} in flight.`}
            </h1>
            <p className="mt-2 max-w-xl text-sm text-[rgb(var(--fg-secondary))]">
              Drag a card across columns to move the project through its stage. Each card
              drills into its own room — tracks, versions, feedback, contract, invoices.
            </p>
          </div>
          <Link href="/dashboard/projects/new">
            <Button>+ New project</Button>
          </Link>
        </header>

        {setupIncomplete && skipOnboarding ? (
          <section className="reveal-up-delay-1 mt-6 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-[rgb(var(--fg-primary))]">
                <span className="font-semibold">Finish setup in 2 min.</span>{" "}
                <span className="text-[rgb(var(--fg-secondary))]">
                  A package, your hours, your link — that&apos;s the whole show.
                </span>
              </p>
              <Link
                href="/dashboard/onboarding"
                className="text-sm font-medium text-[rgb(var(--brand-primary))] underline decoration-dotted underline-offset-2 hover:brightness-110"
              >
                Continue setup →
              </Link>
            </div>
          </section>
        ) : null}

        <DashboardHeaderStats
          upcoming={upcomingItems}
          bookingUrl={bookingUrl}
          userId={userId}
        />

        <section className="mt-8 reveal-up-delay-1">
          <Kanban initial={initial} />
        </section>
      </div>
    </AppShell>
  );
}

// DashboardHeaderStats — wraps the Upcoming strip + Revenue tile so
// they share a grid layout. Mobile: stack. Desktop: side-by-side
// 3:2 split with upcoming larger because that's the "what's today"
// glance.
function DashboardHeaderStats({
  upcoming,
  bookingUrl,
  userId,
}: {
  upcoming: UpcomingItem[];
  bookingUrl: string | null;
  userId: string;
}) {
  return (
    <section className="mt-6 grid gap-4 lg:grid-cols-[3fr_2fr]">
      <UpcomingStrip items={upcoming} bookingUrl={bookingUrl} />
      <RevenueTile userId={userId} />
    </section>
  );
}
