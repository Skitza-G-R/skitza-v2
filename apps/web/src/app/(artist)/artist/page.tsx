import { auth, currentUser } from "@clerk/nextjs/server";

import { ActiveProjectsCard } from "~/components/artist/home/active-projects-card";
import { ActivityFeed } from "~/components/artist/home/activity-feed";
import { BalanceCard } from "~/components/artist/home/balance-card";
import { LatestMixCard } from "~/components/artist/home/latest-mix-card";
import { NextSessionCard } from "~/components/artist/home/next-session-card";
import { PageHero } from "~/components/artist/home/page-hero";
import { RecentUploadsCard } from "~/components/artist/home/recent-uploads-card";
import { StatCard } from "~/components/artist/home/stat-card";
import { UpcomingSessionsCard } from "~/components/artist/home/upcoming-sessions-card";
import { appRouter } from "~/server/trpc/routers/_app";

import { WelcomeModal } from "./welcome-modal";

// Artist home — locked design system (Phase 5).
//
// Server component. Two parallel tRPC calls (`artist.home` + the
// existing `artist.music.projects`) plus Clerk's `currentUser()` for
// the greeting. Renders a mobile and a desktop tree gated by `lg:`
// utility classes; both consume the same data.

export default async function ArtistHomePage() {
  const { userId } = await auth();
  if (!userId) return null;

  const caller = appRouter.createCaller({ userId });
  const [homeData, projectsData, user] = await Promise.all([
    caller.artist.home(),
    caller.artist.music.projects(),
    currentUser(),
  ]);

  const firstName = user?.firstName ?? null;
  const statusLine = composeStatusLine(homeData);

  // Desktop stats — derive what we can from existing data without
  // touching tRPC. "Recent mixes" counts upload events from the
  // activity feed (proxy for "open notes" until comments land).
  const recentUploadCount = homeData.activity.filter(
    (a) => a.kind === "track_uploaded",
  ).length;
  const balanceTotalCents = homeData.outstandingBalance?.totalCents ?? 0;
  const balanceCurrency = homeData.outstandingBalance?.currency ?? "USD";
  const nextSessionLabel = homeData.nextSession
    ? formatRelativeDay(homeData.nextSession.startsAt)
    : "—";

  return (
    <div className="space-y-6 lg:space-y-8">
      <WelcomeModal />
      <PageHero firstName={firstName} statusLine={statusLine} />

      {/* MOBILE — single column, focused hierarchy. */}
      <div className="space-y-4 lg:hidden">
        <NextSessionCard session={homeData.nextSession} />
        <LatestMixCard mix={homeData.latestMix} />
        <BalanceCard balance={homeData.outstandingBalance} />
        <ActivityFeed events={homeData.activity} variant="raw" limit={4} />
      </div>

      {/* DESKTOP — 4-stat row + 1.4fr/1fr two-column grid. */}
      <div className="hidden lg:block lg:space-y-8">
        <div className="grid grid-cols-4 gap-4">
          <StatCard
            label="Active projects"
            value={String(projectsData.projects.length)}
            sub="across your studios"
          />
          <StatCard
            label="Recent mixes"
            value={String(recentUploadCount)}
            sub="last 7 days"
          />
          <StatCard
            label="Balance due"
            value={formatMoney(balanceTotalCents, balanceCurrency)}
            sub={balanceTotalCents > 0 ? "open invoices" : "all paid"}
            accent={balanceTotalCents > 0 ? "copper" : "default"}
          />
          <StatCard
            label="Next session"
            value={nextSessionLabel}
            sub={
              homeData.nextSession?.productName ??
              homeData.nextSession?.producerName ??
              "—"
            }
          />
        </div>

        <div className="grid grid-cols-[1.4fr_1fr] gap-6">
          <div className="space-y-8">
            <ActiveProjectsCard rows={projectsData.projects} />
            <RecentUploadsCard events={homeData.activity} />
          </div>
          <div className="space-y-8">
            <UpcomingSessionsCard
              sessions={homeData.upcomingSessions}
              variant="raw"
            />
            <ActivityFeed events={homeData.activity} variant="card" limit={6} />
          </div>
        </div>
      </div>
    </div>
  );
}

// One-line "what's going on right now" copy for the hero. Pulls from
// the same data shape rendered below — single source of truth.
function composeStatusLine(home: {
  nextSession: { startsAt: Date } | null;
  latestMix: { uploadedAt: Date } | null;
  activity: { kind: string }[];
}): string {
  const bits: string[] = [];
  const recentUploads = home.activity.filter(
    (a) => a.kind === "track_uploaded",
  ).length;
  if (recentUploads > 0) {
    bits.push(
      `${String(recentUploads)} new ${recentUploads === 1 ? "mix" : "mixes"}`,
    );
  }
  if (home.nextSession) {
    bits.push(`session ${formatRelativeDay(home.nextSession.startsAt)}`);
  }
  return bits.length > 0 ? bits.join(" · ") : "All quiet.";
}

function formatRelativeDay(d: Date): string {
  const now = new Date();
  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round(
    (startOfDay(d) - startOfDay(now)) / (24 * 60 * 60 * 1000),
  );
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  if (diffDays > 1 && diffDays < 7) {
    return d.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatMoney(cents: number, currency: string): string {
  if (cents <= 0) return formatZero(currency);
  const major = (cents / 100).toFixed(0);
  return `${currencySymbol(currency)}${major}`;
}

function formatZero(currency: string): string {
  return `${currencySymbol(currency)}0`;
}

function currencySymbol(currency: string): string {
  switch (currency.toUpperCase()) {
    case "USD":
      return "$";
    case "EUR":
      return "€";
    case "GBP":
      return "£";
    case "ILS":
      return "₪";
    default:
      return `${currency} `;
  }
}
