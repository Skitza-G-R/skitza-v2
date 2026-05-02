/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { appRouter } from "~/server/trpc/routers/_app";

import {
  firstNameOf,
  fmtDuration,
  gradFor,
  humanStage,
  relTime,
  splitPublicLink,
  tagForStage,
} from "../_design-test/data-mapping";
import {
  OverviewTab,
  type OverviewData,
  type OverviewProject,
  type OverviewTrack,
} from "../_design-test/overview-tab";

// Overview page — root of the sandbox. Shell + Sidebar live in
// (sandbox)/layout.tsx, so this page only fetches the Overview-
// specific data and returns the tab body directly.

const TODAY_DATE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const [today, me, projectsList] = await Promise.all([
    caller.producer.today(),
    caller.producer.me(),
    caller.project.list(),
  ]);

  const greetingName = firstNameOf(me.displayName);
  const slug = me.slug ?? "your-slug";
  const publicBaseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.SITE_URL ??
    "https://skitza.app";
  const fullPublicLink = `${publicBaseUrl.replace(/\/$/, "")}/join/${slug}`;
  const { prefix: publicLinkPrefix, slug: publicLinkSlug } =
    splitPublicLink(fullPublicLink);
  const earnedMonth = Math.round(today.pulseStats.thisMonthCents / 100);
  const earnedDelta = today.pulseStats.deltaPct ?? 0;

  const projects: OverviewProject[] = projectsList.map((p, i) => {
    const stageTag = tagForStage(p.stage);
    return {
      id: p.id,
      name: p.title,
      client: p.clientName ?? p.artistName ?? "Client",
      status: humanStage(p.stage),
      tag: stageTag.label,
      tagType: stageTag.type,
      grad: gradFor(i),
    };
  });

  const tracks: OverviewTrack[] = today.recentUploads.map((u, i) => ({
    id: u.versionId,
    title: u.title,
    project: u.projectClientName || "Project",
    uploaded: relTime(u.uploadedAt),
    duration: fmtDuration(u.durationMs),
    durationSec: Math.round((u.durationMs ?? 0) / 1000) || 240,
    grad: gradFor(i),
  }));

  const data: OverviewData = {
    producer: {
      publicLink: fullPublicLink.replace(/^https?:\/\//, ""),
      publicLinkPrefix,
      publicLinkSlug,
      earnedMonth,
      outstanding: 0,
      earnedDelta,
      outstandingClientCount: 0,
      greetingName,
      todayDate: TODAY_DATE_FMT.format(new Date()),
    },
    projects,
    tracks,
    overdueClient: null,
  };

  return <OverviewTab data={data} />;
}
