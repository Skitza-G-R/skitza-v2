import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";

import {
  ClientSpaceHero,
  type ClientSpaceHeroData,
} from "~/components/dashboard/clients/client-space-hero";
import {
  ProjectRow,
  type ProjectRowData,
} from "~/components/dashboard/projects/project-row";
import { deriveGradient } from "~/lib/clients/derive-gradient";
import { appRouter } from "~/server/trpc/routers/_app";

// /dashboard/clients-projects/clients/[id] — Client Space.
//
// Phase 1 Task 17 — the page is a single-surface composition:
//   • <ClientSpaceHero> — dark gradient band with the avatar, name,
//     LinkPill, meta strip and 4-tile KPIs.
//   • A vertical list of <ProjectRow> components for every project tied
//     to this client.
//
// The old 4-tab structure (Overview / Projects / Payments / Notes) is
// gone per the big-bang redesign. The detail tRPC payload still
// surfaces tags / notes / referralSource for downstream consumers, but
// no UI exposes them in Phase 1 (deferred to a future phase).

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ClientDetailPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { id } = await params;
  const caller = appRouter.createCaller({ userId });

  // Parallel fetch — detail is the canonical client+projects payload,
  // me() is consumed for slug (Invite modal URL) + defaultCurrency.
  let detail;
  try {
    detail = await caller.clientContacts.detail({ id });
  } catch {
    notFound();
  }

  let producerSlug = "";
  let producerCurrency = "USD";
  try {
    const me = await caller.producer.me();
    producerSlug = me.slug;
    producerCurrency = me.defaultCurrency;
  } catch (err) {
    console.warn("[clients/detail] producer.me failed", err);
  }

  // Pre-compute the next upcoming session across this client's
  // projects — kept here (preserved helper) rather than inside the
  // hero so the date-comparison logic stays presentational-free.
  const nextSession = pickNextSession(detail.projects);

  // Build the hero payload. Phone is null in v1 (we don't store it on
  // client_contacts yet). linkState reads invitedAt / clerkUserId off
  // the detail payload — clerkUserId set ⇒ "active" (signed up),
  // else invitedAt set ⇒ "pending" (amber pill), else "none".
  const heroLinkState: ClientSpaceHeroData["linkState"] = detail.contact
    .clerkUserId
    ? "active"
    : detail.contact.invitedAt
      ? "pending"
      : "none";

  const heroData: ClientSpaceHeroData = {
    id: detail.contact.id,
    name: detail.contact.name,
    email: detail.contact.email,
    phone: null,
    linkState: heroLinkState,
    joinedAtIso: toIso(detail.contact.firstSeenAt),
    lifetime: detail.stats.lifetimeCents,
    outstanding: detail.stats.outstandingCents,
    activeProjects: detail.stats.activeProjectCount,
    currency: producerCurrency,
    newProjectHref:
      `/dashboard/clients-projects/new?clientEmail=${encodeURIComponent(
        detail.contact.email,
      )}&clientName=${encodeURIComponent(detail.contact.name)}`,
  };

  // The hero needs to align its dark gradient band with the avatar
  // identity — both derive from the contact's name via deriveGradient.
  // Pre-resolving here keeps the page's intent explicit even though
  // ClientSpaceHero also calls deriveGradient internally.
  void deriveGradient(detail.contact.name);

  // Map each detail project into the new ProjectRow shape. The list
  // is intentionally read-only here — drag-to-reorder is a list-view
  // affordance, not a single-client surface.
  const projectRows: ProjectRowData[] = detail.projects.map((p) => {
    const stage = p.stage;
    const tone: ProjectRowData["statusTone"] =
      stage === "archived"
        ? "neutral"
        : stage === "paid"
          ? "ok"
          : p.outstandingCents > 0 && !p.nextSessionAt
            ? "danger"
            : "warn";
    return {
      id: p.id,
      title: p.title,
      client: detail.contact.name,
      meta: detail.contact.email,
      progress: STAGE_PROGRESS[stage],
      balance: p.outstandingCents,
      deadline: formatDeadlineShort(p.nextSessionAt),
      status: STAGE_LABEL[stage],
      statusTone: tone,
      currency: p.currency ?? producerCurrency,
    };
  });

  return (
    <main className="sk-page-enter">
      <div className="mx-auto max-w-[1400px] px-4 pb-24 pt-6 sm:px-6 sm:pt-8 lg:px-8 lg:pt-10">
        <ClientSpaceHero client={heroData} producerSlug={producerSlug} />

        {projectRows.length === 0 ? (
          <div
            role="status"
            className="mt-6 rounded-[var(--radius-md)] border border-dashed p-8 text-center text-[13px]"
            style={{
              borderColor: "rgb(var(--border-subtle))",
              background: "rgb(var(--bg-elevated))",
              color: "rgb(var(--fg-muted))",
            }}
          >
            No projects with this client yet.
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-2">
            {projectRows.map((row) => (
              <ProjectRow key={row.id} row={row} />
            ))}
          </div>
        )}

        {/* Next session preview — surfaced under the project list for
            quick scan rhythm. Kept lightweight; the hero already shows
            the KPI counts, this is a single-line schedule reminder. */}
        {nextSession ? (
          <p
            className="mt-4 text-[12px]"
            style={{ color: "rgb(var(--fg-muted))" }}
          >
            Next session:{" "}
            <span style={{ color: "rgb(var(--fg-default))" }}>
              {formatSessionAt(nextSession.startsAt)}
            </span>{" "}
            for {nextSession.projectTitle}
          </p>
        ) : null}
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────

type DetailProjectStage =
  | "lead"
  | "booked"
  | "in_production"
  | "final_review"
  | "paid"
  | "archived";

const STAGE_PROGRESS: Record<DetailProjectStage, number> = {
  lead: 12,
  booked: 30,
  in_production: 55,
  final_review: 80,
  paid: 100,
  archived: 100,
};

const STAGE_LABEL: Record<DetailProjectStage, string> = {
  lead: "Lead",
  booked: "Booked",
  in_production: "In production",
  final_review: "Review",
  paid: "Done",
  archived: "Archived",
};

function toIso(raw: Date | string): string {
  return raw instanceof Date ? raw.toISOString() : new Date(raw).toISOString();
}

// SQL `min(... case when ...)` returns Date | string | null depending
// on the driver; pickNextSession normalises to a single Date.
export function pickNextSession(
  projects: readonly { title: string; nextSessionAt: Date | string | null }[],
): { startsAt: Date; projectTitle: string } | null {
  let best: { startsAt: Date; projectTitle: string } | null = null;
  for (const p of projects) {
    if (!p.nextSessionAt) continue;
    const at =
      p.nextSessionAt instanceof Date
        ? p.nextSessionAt
        : new Date(p.nextSessionAt);
    if (Number.isNaN(at.getTime())) continue;
    if (!best || at.getTime() < best.startsAt.getTime()) {
      best = { startsAt: at, projectTitle: p.title };
    }
  }
  return best;
}

function formatDeadlineShort(at: Date | string | null): string {
  if (at == null) return "—";
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) return "—";
  const now = Date.now();
  const diffMs = date.getTime() - now;
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
  if (diffDays < 0) return `${String(Math.abs(diffDays))}d ago`;
  if (diffDays <= 14) return `${String(diffDays)}d`;
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    }).format(date);
  } catch {
    return "—";
  }
}

function formatSessionAt(at: Date): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(at);
  } catch {
    return at.toISOString();
  }
}
