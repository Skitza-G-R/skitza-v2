import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { appRouter } from "~/server/trpc/routers/_app";
import { OverviewShell } from "./_design-test/overview-shell";
import type {
  OverviewData,
  OverviewProject,
  OverviewTrack,
} from "./_design-test/overview-tab";
import type { Producer } from "./_design-test/shell";

// gili/design-test branch — Overview wired against real data per Gili's brief
// (Option B Medium): real Clerk user, real /join slug, real projects from
// tRPC, real recent uploads from R2-via-producer.today.
//
// The mockup ships its own sidebar + chrome (see ./_design-test/overview-
// shell.tsx), so the layout file is now passthrough. Other dashboard
// children render bare on this branch — that's expected per the brief.

// Project stage → mockup tag/tagType. Derived from the project_stage enum
// in packages/db/src/schema.ts. The mockup's "urgent projects" filter only
// surfaces danger + warning rows, so the heuristic biases toward
// "needs-attention" mappings for paused / final_review / contract_sent /
// cancelled, and treats lead / booked / in_production / paid / archived
// as non-urgent neutral/success/brand.
function tagForStage(stage: string): {
  tag: string;
  tagType: OverviewProject["tagType"];
} {
  switch (stage) {
    case "payment_paused":
      return { tag: "PAYMENT PAUSED", tagType: "danger" };
    case "cancelled":
      return { tag: "CANCELLED", tagType: "danger" };
    case "final_review":
      return { tag: "ACTION NEEDED", tagType: "warning" };
    case "contract_sent":
      return { tag: "AWAITING SIGN", tagType: "warning" };
    case "in_production":
      return { tag: "IN PROGRESS", tagType: "neutral" };
    case "booked":
      return { tag: "BOOKED", tagType: "brand" };
    case "lead":
      return { tag: "LEAD", tagType: "neutral" };
    case "paid":
      return { tag: "PAID", tagType: "success" };
    case "archived":
      return { tag: "COMPLETE", tagType: "success" };
    default:
      return { tag: stage.toUpperCase(), tagType: "neutral" };
  }
}

// Round-robin grad assignment for project badges so each row in the urgent
// list gets a distinct color even when the real DB has no grad column.
// Order matches the mockup's most common SAMPLE_DATA palette.
const GRAD_PALETTE = [
  "grad-rose",
  "grad-amber",
  "grad-slate",
  "grad-violet",
  "grad-indigo",
  "grad-emerald",
  "grad-sky",
] as const;

function gradFor(idx: number): string {
  return GRAD_PALETTE[idx % GRAD_PALETTE.length] ?? "grad-amber";
}

// Relative time formatter: ms-since-upload → "2h ago" / "Yesterday" / "4d ago".
// Matches the mockup's `t.uploaded` strings as closely as possible without
// pulling in date-fns just for this surface.
function relTime(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const min = Math.floor(diffMs / 60_000);
  const hr = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  if (hr < 24) return `${hr}h ago`;
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function fmtDuration(ms: number | null): string {
  if (!ms || ms <= 0) return "--:--";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// First name extracted from displayName for the greeting line. Preserves the
// mockup's casual tone ("Good morning, Gili.") without feeding the full
// "Studio Name LLC" into the H1.
function firstNameOf(displayName: string | null): string {
  if (!displayName) return "there";
  const trimmed = displayName.trim();
  if (!trimmed) return "there";
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

function initialsOf(displayName: string | null): string {
  if (!displayName) return "??";
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

// Strip "https://" / "http://" + trailing slash from the public link so the
// mockup's two-tone "skitza.app/p/" + "gili" rendering reads naturally.
function splitPublicLink(fullUrl: string): {
  prefix: string;
  slug: string;
} {
  const stripped = fullUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  // Find the last "/" — slug is everything after, prefix everything up to and
  // including it. Fallback if there's no slash (shouldn't happen given the
  // join/<slug> URL pattern).
  const idx = stripped.lastIndexOf("/");
  if (idx === -1) return { prefix: "", slug: stripped };
  return {
    prefix: stripped.slice(0, idx + 1),
    slug: stripped.slice(idx + 1),
  };
}

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

  const publicBaseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.SITE_URL ??
    "https://skitza.app";

  const fullPublicLink = me.slug
    ? `${publicBaseUrl.replace(/\/$/, "")}/join/${me.slug}`
    : `${publicBaseUrl.replace(/\/$/, "")}/join/your-slug`;
  const { prefix: publicLinkPrefix, slug: publicLinkSlug } =
    splitPublicLink(fullPublicLink);

  const producer: Producer = {
    name: me.displayName ?? "Your Studio",
    initials: initialsOf(me.displayName),
    plan: "Pro",
    avatarGrad: "grad-amber",
  };

  const projects: OverviewProject[] = projectsList.map((p, i) => {
    const { tag, tagType } = tagForStage(p.stage);
    return {
      id: p.id,
      name: p.title,
      client: p.clientName ?? p.artistName ?? "Client",
      // Human-readable status mirrors the mockup's `p.status` strings.
      // We reuse the tag label so the secondary line and the pill stay
      // semantically aligned without a second mapping table.
      status: tag.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
      tag,
      tagType,
      grad: gradFor(i),
    };
  });

  const tracks: OverviewTrack[] = today.recentUploads.map((u) => ({
    id: u.versionId,
    title: u.title,
    project: u.projectClientName || "Project",
    uploaded: relTime(u.uploadedAt),
    duration: fmtDuration(u.durationMs),
  }));

  // Outstanding $ isn't computed by the today payload — it returns counts.
  // For this sandbox round we surface the count via a placeholder and leave
  // the dollar sum at 0 + "Across 0 clients". Wiring real $ requires a
  // dedicated invoice rollup; out of scope per the brief.
  const earnedMonth = Math.round(today.pulseStats.thisMonthCents / 100);
  const earnedDelta = today.pulseStats.deltaPct ?? 0;

  const data: OverviewData = {
    producer: {
      publicLink: fullPublicLink.replace(/^https?:\/\//, ""),
      publicLinkPrefix,
      publicLinkSlug,
      earnedMonth,
      outstanding: 0,
      earnedDelta,
      outstandingClientCount: 0,
      greetingName: firstNameOf(me.displayName),
      todayDate: TODAY_DATE_FMT.format(new Date()),
    },
    projects,
    tracks,
    overdueClient: null,
  };

  return <OverviewShell producer={producer} data={data} />;
}
