/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { appRouter } from "~/server/trpc/routers/_app";

import {
  firstNameOf,
  fmtDuration,
  gradFor,
  humanStage,
  initialsOf,
  relTime,
  splitPublicLink,
  tagForStage,
} from "./_design-test/data-mapping";
import { OverviewShell } from "./_design-test/overview-shell";
import type {
  OverviewData,
  OverviewProject,
  OverviewTrack,
} from "./_design-test/overview-tab";
import type { Producer } from "./_design-test/shell";

// gili/design-test branch — Overview page wired against real Skitza
// data using the mockup's exact DOM/CSS structure. Pure data-mapping
// helpers live in ./_design-test/data-mapping.ts (unit-tested).
// Components live in ./_design-test/{primitives,shell,overview-tab,
// overview-shell}.tsx (1:1 ports of the mockup with className/DOM
// preserved verbatim). CSS is scoped under .dt-root so it can't leak
// to other Skitza routes.

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

  // ── Producer derivation ─────────────────────────────────────────
  const realName = me.displayName ?? "Your Studio";
  const greetingName = firstNameOf(me.displayName);
  const initials = initialsOf(me.displayName);
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

  const producer: Producer = {
    name: realName,
    initials,
    plan: "Pro",
    avatarGrad: "grad-amber",
  };

  // ── Projects → mockup OverviewProject shape ─────────────────────
  // Producer.today returns counts; for the list itself we read
  // project.list() and map to the mockup's data contract via the
  // tested data-mapping helpers. Filter happens inside OverviewTab
  // (urgent = tagType ∈ {danger, warning}).
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

  // ── Recent uploads → mockup OverviewTrack shape ─────────────────
  const tracks: OverviewTrack[] = today.recentUploads.map((u, i) => ({
    id: u.versionId,
    title: u.title,
    project: u.projectClientName || "Project",
    uploaded: relTime(u.uploadedAt),
    duration: fmtDuration(u.durationMs),
    durationSec: Math.round((u.durationMs ?? 0) / 1000) || 240,
    grad: gradFor(i),
  }));

  // Outstanding $ isn't computed by today() — would need a dedicated
  // invoice rollup. Out of scope for the medium-data brief. Surface
  // a placeholder + "Across 0 clients" so the design renders cleanly.
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

  return <OverviewShell producer={producer} data={data} />;
}
