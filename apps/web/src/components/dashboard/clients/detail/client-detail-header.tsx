import Link from "next/link";

import { formatMoney } from "~/lib/format/money";
import {
  producerGradient,
  producerInitials,
} from "~/lib/_phase4-stubs/producer-color";

// Client detail header — full-bleed gradient hero band derived from
// the client's name (deterministic palette via producerGradient, same
// helper the song-page hero and project tiles use). White text floats
// over the band; the KPI strip drops below on the cream surface and
// overlaps the gradient edge slightly so the two sections read as one
// composed slab rather than two stacked cards.
//
// Per founder direction (2026-05-07): mirror the song-page treatment
// (`/dashboard/music/[versionId]`) so the producer's six "spaces"
// (today, library, song, project room, client, calendar) all share one
// editorial pattern — back chip top-left on glass, primary CTA top-
// right, identity slab below, KPI strip floating on the seam.
//
// "Message" CTA dropped per founder direction; the email address is
// still a click target via the inline mailto link in the subtitle row.
//
// KPI strip rules:
//   • PROJECTS — total count, "N active" sub-label.
//   • OUTSTANDING — danger-tinted card when > 0, neutral "—" when 0.
//   • NEXT DEADLINE — earliest upcoming `nextSessionAt`. Brand-amber
//     when within a week, danger when overdue or within 24h, "—" when
//     nothing scheduled.

export interface ClientDetailHeaderProps {
  contact: {
    id: string;
    name: string;
    email: string;
    firstSeenAt: Date;
  };
  stats: {
    activeProjectCount: number;
    totalProjectCount: number;
    outstandingCents: number;
  };
  nextSession: { startsAt: Date; projectTitle: string } | null;
  currency: string;
  /** Pre-filled "+ New project" target — carries the client's email/name
   *  through to the new-project form. */
  newProjectHref: string;
}

export function ClientDetailHeader({
  contact,
  stats,
  nextSession,
  currency,
  newProjectHref,
}: ClientDetailHeaderProps) {
  const sinceLabel = formatSince(contact.firstSeenAt);
  const heroBg = producerGradient(contact.name);
  const initials = producerInitials(contact.name);
  const nextSessionLabel = formatNextSession(nextSession);

  return (
    <>
      {/* HERO BAND — full-bleed, hue-derived gradient. */}
      <header
        className="relative isolate overflow-hidden text-white"
        style={{ background: heroBg }}
      >
        {/* Subtle grain + radial highlight to keep the band from
            looking flat. The radial sits behind everything via
            absolute + isolate isolation on the parent. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.18]"
          style={{
            background:
              "radial-gradient(80% 80% at 12% 0%, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0) 60%)",
          }}
        />

        <div className="mx-auto max-w-[1400px] px-4 pt-5 pb-12 sm:px-6 sm:pt-7 sm:pb-14 lg:px-8 lg:pt-8 lg:pb-16">
          {/* Top row — back chip + breadcrumb chip (mirrors song-page). */}
          <nav
            aria-label="Breadcrumb"
            className="mb-7 flex flex-wrap items-center justify-between gap-3"
          >
            <Link
              href="/dashboard/clients-projects?tab=clients"
              className="sk-press inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[11.5px] font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              <ChevronLeftIcon /> All clients
            </Link>
            <p className="hidden items-center gap-1.5 rounded-full border border-white/20 bg-white/5 px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-white/85 backdrop-blur-sm sm:inline-flex">
              <Link
                href="/dashboard/clients-projects"
                className="hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                Clients &amp; Projects
              </Link>
              <span aria-hidden className="opacity-60">
                /
              </span>
              <span className="text-white">{contact.name}</span>
            </p>
          </nav>

          {/* Identity slab — avatar | name+subtitle | CTA. Mobile
              stacks; desktop is a 3-column row that lets the title
              breathe at clamp() scales. */}
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
            <div className="flex min-w-0 items-end gap-4 sm:gap-6">
              <ClientAvatar initials={initials} />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] opacity-85">
                  Client · Active
                </p>
                <h1 className="mt-1 break-words font-display text-[clamp(36px,6vw,64px)] font-extrabold leading-[1.02] tracking-[-0.035em] [text-shadow:0_2px_18px_rgba(0,0,0,0.22)]">
                  {contact.name}
                </h1>
                <p className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] opacity-90">
                  <a
                    href={`mailto:${contact.email}`}
                    className="truncate rounded-[var(--radius-sm)] underline decoration-dotted underline-offset-[3px] hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                  >
                    {contact.email}
                  </a>
                  {sinceLabel ? (
                    <>
                      <span aria-hidden className="opacity-60">
                        ·
                      </span>
                      <span>Client since {sinceLabel}</span>
                    </>
                  ) : null}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center sm:self-end">
              <Link
                href={newProjectHref}
                className="sk-press inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-[rgb(var(--brand-primary))] px-5 text-sm font-bold text-[rgb(var(--bg-base))] shadow-[0_8px_24px_rgba(0,0,0,0.18)] transition-transform hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
              >
                <PlusIcon /> New project
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* KPI STRIP — floats over the hero/cream seam (-mt overlap with
          shadow) so the page reads as a composed slab rather than two
          stacked sections. White cards on cream background; danger
          tint when there's outstanding money or an overdue session. */}
      <div className="mx-auto -mt-9 max-w-[1400px] px-4 sm:-mt-10 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          <KpiCard
            label="Projects"
            value={stats.totalProjectCount.toString()}
            sub={
              stats.activeProjectCount > 0
                ? `${stats.activeProjectCount.toString()} active`
                : "—"
            }
          />
          <KpiCard
            label="Outstanding"
            tone={stats.outstandingCents > 0 ? "danger" : "default"}
            value={
              stats.outstandingCents > 0
                ? formatMoney(stats.outstandingCents, currency)
                : "—"
            }
          />
          <KpiCard
            label="Next deadline"
            tone={nextSessionLabel.tone}
            value={nextSessionLabel.value}
            {...(nextSessionLabel.sub ? { sub: nextSessionLabel.sub } : {})}
          />
        </div>
      </div>
    </>
  );
}

// 96px circular avatar — solid hue from the same palette as the band
// so the identity reads as one piece. Initials sit centered with a
// slight letter-spacing so 1- and 2-letter monograms balance.
function ClientAvatar({ initials }: { initials: string }) {
  return (
    <div
      aria-hidden
      className="flex h-[88px] w-[88px] shrink-0 items-center justify-center rounded-full bg-white/95 font-display text-[28px] font-extrabold leading-none tracking-[-0.02em] text-[rgb(20_18_15)] shadow-[0_12px_32px_rgba(0,0,0,0.22)] sm:h-[104px] sm:w-[104px] sm:text-[34px]"
    >
      {initials}
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "danger" | "brand";
}) {
  // Tone-aware palette. The label + sub colors used to be a fixed
  // `--fg-muted` (warm brown) which washed out on the danger-tinted
  // card — both share the same warm-tone family, so the contrast ratio
  // dropped below readable. Tinting the label/sub to match the tone
  // (just darker than the value, with reduced opacity) keeps the eye
  // travelling label → value as one composed unit.
  const palette =
    tone === "danger"
      ? {
          bg: "bg-[rgb(var(--fg-danger)/0.08)]",
          border: "border-[rgb(var(--fg-danger)/0.18)]",
          value: "rgb(var(--fg-danger))",
          label: "text-[rgb(var(--fg-danger)/0.85)]",
          sub: "text-[rgb(var(--fg-danger)/0.75)]",
        }
      : tone === "brand"
        ? {
            bg: "bg-[rgb(var(--brand-primary)/0.08)]",
            border: "border-[rgb(var(--brand-primary)/0.20)]",
            value: "rgb(var(--brand-primary))",
            label: "text-[rgb(var(--brand-primary)/0.85)]",
            sub: "text-[rgb(var(--brand-primary)/0.75)]",
          }
        : {
            bg: "bg-[rgb(var(--bg-elevated))]",
            border: "border-[rgb(var(--border-subtle))]",
            value: "rgb(var(--fg-default))",
            label: "text-[rgb(var(--fg-muted))]",
            sub: "text-[rgb(var(--fg-muted))]",
          };
  return (
    <div
      className={[
        "rounded-[var(--radius-md)] border px-5 py-4 shadow-[0_6px_20px_rgba(0,0,0,0.06)] backdrop-blur-sm",
        palette.bg,
        palette.border,
      ].join(" ")}
    >
      <p
        className={`text-[10px] font-bold uppercase tracking-[0.16em] ${palette.label}`}
      >
        {label}
      </p>
      <p
        className="sk-num mt-2 font-mono text-[28px] font-extrabold leading-none tabular-nums"
        style={{ color: palette.value }}
      >
        {value}
      </p>
      {sub ? (
        <p className={`mt-1 truncate text-[11.5px] ${palette.sub}`}>{sub}</p>
      ) : null}
    </div>
  );
}

// firstSeenAt → "Nov 2025" (matches the design's "Client since Nov 2025").
function formatSince(date: Date): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      year: "numeric",
    }).format(date);
  } catch {
    return "";
  }
}

// Compute the "Next deadline" KPI value + sub-label + tone from the
// earliest upcoming session across the client's projects.
function formatNextSession(
  next: { startsAt: Date; projectTitle: string } | null,
): { value: string; sub?: string; tone: "default" | "danger" | "brand" } {
  if (!next) return { value: "—", tone: "default" };
  const ms = next.startsAt.getTime() - Date.now();
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  if (ms < 0) {
    const overdueDays = Math.max(1, Math.abs(days));
    return {
      value: `${overdueDays.toString()}d late`,
      sub: next.projectTitle,
      tone: "danger",
    };
  }
  const isUrgent = days <= 1;
  const valueWord = days === 0 ? "Today" : days === 1 ? "Tomorrow" : `${days.toString()}d`;
  return {
    value: valueWord,
    sub: next.projectTitle,
    tone: isUrgent ? "danger" : "brand",
  };
}

// — Icons —

function ChevronLeftIcon() {
  return (
    <svg
      aria-hidden
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      aria-hidden
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
