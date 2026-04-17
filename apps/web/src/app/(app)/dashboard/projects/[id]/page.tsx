import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { AppShell } from "~/components/shell/app-shell";
import { Badge } from "~/components/ui/badge";
import { appRouter } from "~/server/trpc/routers/_app";
import { PaidToggle } from "./paid-toggle";
import { TrackPanel } from "./track-panel";

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

  return (
    <AppShell active="projects">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="reveal-up">
          <Link
            href="/dashboard/projects"
            className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-primary))]"
          >
            ← All projects
          </Link>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1
                className="font-display text-4xl leading-tight tracking-tight sm:text-5xl"
                style={{ fontWeight: 800 }}
              >
                {data.project.title}
              </h1>
              <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
                {data.project.artistName}
                <span className="ml-2 font-mono text-xs text-[rgb(var(--fg-muted))]">
                  {data.project.artistEmail}
                </span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {data.project.finalPaid ? (
                <Badge variant="active" dot>
                  Final paid
                </Badge>
              ) : data.project.depositPaid ? (
                <Badge variant="warning" dot>
                  Deposit paid
                </Badge>
              ) : (
                <Badge dot>Unpaid</Badge>
              )}
            </div>
          </div>
        </header>

        <section className="mt-6 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5">
          <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
            Payment state (v1 — manual until Stripe)
          </p>
          <div className="mt-3">
            <PaidToggle
              projectId={data.project.id}
              depositPaid={data.project.depositPaid}
              finalPaid={data.project.finalPaid}
            />
          </div>
          <p className="mt-3 font-mono text-xs text-[rgb(var(--fg-muted))]">
            Artist-side downloads unlock once you mark Final paid.
          </p>
        </section>

        <section className="mt-8">
          <h2
            className="mb-4 font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]"
          >
            Tracks + versions
          </h2>
          <TrackPanel
            projectId={data.project.id}
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
          />
        </section>
      </div>
    </AppShell>
  );
}
