// Spotify-style hero header for the Project Room.
//
// Sits above the existing `<ProjectHeader />` (which keeps the stage
// select + 3-dot menu + tag editor + payment strip + timeline). The
// hero itself is purely cosmetic — gradient swatch + display title +
// counts + a "Play latest" link. All the mutating actions live in
// ProjectHeader and they stay there to avoid duplicating their state
// + modals.
//
// The gradient color is hashed from the project id so the same
// project always lands on the same swatch, giving every project a
// recognizable identity without a new schema column.

import Link from "next/link";

import { gradientCss, gradientFor } from "~/lib/project-gradient";
import { STAGE_LABEL, type Stage } from "~/lib/projects/stages";

export type ProjectRoomHeroProject = {
  id: string;
  title: string;
  stage: Stage;
  artistName: string;
  trackCount: number;
  sessionCount: number;
  totalAmountCents: number | null;
  currency: string;
  firstTrackId: string | null;
};

export function ProjectRoomHero({
  project,
}: {
  project: ProjectRoomHeroProject;
}) {
  const grad = gradientFor(project.id);
  return (
    <div
      // White text reads cleanly across all 8 gradient buckets without
      // per-grad luminance branching.
      className="reveal-up relative isolate text-white"
      style={{ background: gradientCss(grad) }}
    >
      {/* Subtle dark overlay for legibility on the lighter (amber/lime)
          gradients */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[rgb(0_0_0/0.10)]"
      />

      <div className="relative mx-auto max-w-[1600px] px-4 pb-7 pt-6 sm:px-6 sm:pt-8">
        {/* Top row — back link + light breadcrumb */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/dashboard/clients-projects"
            className="sk-press inline-flex items-center gap-1.5 rounded-full bg-[rgb(255_255_255/0.16)] px-3 py-1.5 text-[0.7rem] font-bold uppercase tracking-[0.08em] text-white backdrop-blur-sm transition-colors hover:bg-[rgb(255_255_255/0.24)]"
          >
            <ArrowLeftIcon /> All projects
          </Link>
          <ol className="flex flex-wrap items-center gap-1 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-[rgb(255_255_255/0.78)]">
            <li>
              <Link
                href="/dashboard/clients-projects"
                className="hover:text-white"
              >
                Clients &amp; Projects
              </Link>
            </li>
            <li aria-hidden>›</li>
            <li className="truncate text-white">{project.title}</li>
          </ol>
        </div>

        {/* Main row — folder badge + title + Play latest */}
        <div className="flex flex-wrap items-end gap-5">
          <div
            aria-hidden
            className="grid h-20 w-20 shrink-0 place-items-center rounded-[var(--radius-lg)] bg-[rgb(0_0_0/0.18)] shadow-[0_12px_32px_rgb(0_0_0/0.28)] sm:h-24 sm:w-24"
          >
            <FolderIcon />
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[rgb(255_255_255/0.82)]">
              Project · {STAGE_LABEL[project.stage]}
            </p>
            <h1
              className="mt-1 truncate font-display text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl"
              style={{
                textShadow: "0 2px 14px rgb(0 0 0 / 0.18)",
                lineHeight: 1.05,
              }}
            >
              {project.title}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.78rem] text-[rgb(255_255_255/0.92)]">
              <span className="inline-flex items-center gap-1.5">
                <UserIcon /> {project.artistName}
              </span>
              <Dot />
              <span>
                <span className="font-mono tabular-nums">
                  {project.trackCount.toString()}
                </span>{" "}
                song{project.trackCount === 1 ? "" : "s"}
              </span>
              <Dot />
              <span>
                <span className="font-mono tabular-nums">
                  {project.sessionCount.toString()}
                </span>{" "}
                session{project.sessionCount === 1 ? "" : "s"}
              </span>
              {project.totalAmountCents !== null ? (
                <>
                  <Dot />
                  <span className="font-mono font-semibold tabular-nums">
                    {formatMoney(project.totalAmountCents, project.currency)}
                  </span>
                </>
              ) : null}
            </div>
          </div>

          {project.firstTrackId ? (
            <Link
              href={`/dashboard/clients-projects/${project.id}?tab=music&track=${project.firstTrackId}`}
              className="sk-press inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-white px-5 text-[0.85rem] font-bold text-[rgb(var(--fg-default))] shadow-[0_6px_18px_rgb(0_0_0/0.24)] transition-transform hover:brightness-105"
            >
              <PlayIcon /> Play latest
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Dot() {
  return <span aria-hidden className="text-[rgb(255_255_255/0.5)]">·</span>;
}

function ArrowLeftIcon() {
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
      <path d="m15 6-6 6 6 6" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg
      aria-hidden
      width="34"
      height="34"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg
      aria-hidden
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg
      aria-hidden
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M5 3l14 9-14 9V3z" />
    </svg>
  );
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
