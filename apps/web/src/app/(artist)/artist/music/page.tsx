import { auth } from "@clerk/nextjs/server";
import Link from "next/link";

import { ProjectCard } from "~/components/artist/music/project-card";
import { appRouter } from "~/server/trpc/routers/_app";

// Music library — locked design system (Phase 5).
//
// Mobile: Syne hero + producer-count subtitle + a vertical project
// stack. Each row is a rich Link with gradient avatar + title +
// producer + track count.
//
// Desktop: same content, wider rhythm. Phase 5 keeps this single-pane
// list; the side-by-side song detail (380px rail + waveform/comments
// pane from `screens.artist-desktop-1.jsx`) needs the Sheet primitive
// for the comment composer and lands post-Sheet (per Strategic Lead
// coordination, Phase 4 ships Sheet first).
//
// Producer avatar carousel is intentionally NOT wired in v1: the
// `artist.music.projects` shape doesn't carry a producer id (only
// name), so a filter UI couldn't round-trip selections. When the
// schema gains a producerId, the carousel hooks in here.
export default async function MusicPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const caller = appRouter.createCaller({ userId });
  const { projects } = await caller.artist.music.projects();

  const uniqueProducers = new Set(projects.map((p) => p.producerName)).size;

  if (projects.length === 0) {
    return (
      <div className="space-y-6">
        <header className="reveal-up">
          <h1 className="font-display text-[30px] font-extrabold tracking-tight">
            Music<span className="text-[rgb(var(--brand-primary))]">.</span>
          </h1>
          <p className="mt-1 text-sm text-[rgb(var(--fg-muted))]">
            Your library is empty for now.
          </p>
        </header>

        <div className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-5 py-12 text-center">
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
            No tracks yet
          </p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-[rgb(var(--fg-muted))]">
            Once your producer uploads a mix, it lands here. You&rsquo;ll see
            timestamped notes, version history, and a play button on every
            track.
          </p>
          <Link
            href="/artist/book"
            className="sk-press mt-4 inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[rgb(var(--bg-sidebar))] px-4 py-2.5 text-sm font-semibold text-[rgb(var(--fg-inverse))]"
          >
            Book a session
            <span aria-hidden className="opacity-60">
              →
            </span>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 lg:space-y-8">
      <header className="reveal-up">
        <h1 className="font-display text-[30px] font-extrabold tracking-tight lg:text-[44px] lg:leading-none">
          Music<span className="text-[rgb(var(--brand-primary))]">.</span>
        </h1>
        <p className="mt-1.5 text-sm text-[rgb(var(--fg-muted))] lg:mt-2">
          {String(projects.length)}{" "}
          {projects.length === 1 ? "project" : "projects"} across{" "}
          {String(uniqueProducers)}{" "}
          {uniqueProducers === 1 ? "producer" : "producers"}
        </p>
      </header>

      <ul className="flex flex-col gap-2.5 lg:gap-3">
        {projects.map((p) => (
          <li key={p.projectId}>
            <ProjectCard project={p} />
          </li>
        ))}
      </ul>
    </div>
  );
}
