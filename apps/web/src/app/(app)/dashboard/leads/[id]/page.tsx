import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "~/components/shell/app-shell";
import { Badge } from "~/components/ui/badge";
import { EmptyState } from "~/components/ui/empty-state";
import { appRouter } from "~/server/trpc/routers/_app";
import { deriveStatus } from "../status";

// Next 15: params arrives as a Promise.
type PageProps = { params: Promise<{ id: string }> };

const dateFmt = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const relFmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function formatRelative(d: Date): string {
  const diffMs = d.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  if (abs < 60_000) return "just now";
  if (abs < 3_600_000) return relFmt.format(Math.round(diffMs / 60_000), "minute");
  if (abs < 86_400_000) return relFmt.format(Math.round(diffMs / 3_600_000), "hour");
  return relFmt.format(Math.round(diffMs / 86_400_000), "day");
}

function formatDwell(ms: number | null): string {
  if (ms === null) return "—";
  return `${(ms / 1000).toFixed(1)}s`;
}

// Extract a human-readable OS/browser from a UA string. Deliberately
// simple — perfect UA parsing is hopeless; we just want "iPhone Safari"
// or "Mac Chrome" to show the producer which kind of device opened.
function summarizeUserAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const parts: string[] = [];
  if (/iPhone/i.test(ua)) parts.push("iPhone");
  else if (/iPad/i.test(ua)) parts.push("iPad");
  else if (/Android/i.test(ua)) parts.push("Android");
  else if (/Macintosh/i.test(ua)) parts.push("Mac");
  else if (/Windows/i.test(ua)) parts.push("Windows");
  else if (/Linux/i.test(ua)) parts.push("Linux");
  if (/Chrome/i.test(ua) && !/Edg/i.test(ua)) parts.push("Chrome");
  else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) parts.push("Safari");
  else if (/Firefox/i.test(ua)) parts.push("Firefox");
  else if (/Edg/i.test(ua)) parts.push("Edge");
  return parts.length > 0 ? parts.join(" · ") : "Unknown device";
}

// Pretty a referer URL → just its hostname (origin), so the producer
// sees "instagram.com" not a long tracking URL.
function summarizeReferer(r: string | null): string {
  if (!r) return "Direct";
  try {
    return new URL(r).hostname.replace(/^www\./, "");
  } catch {
    return r.slice(0, 40);
  }
}

export default async function LinkDetailPage({ params }: PageProps) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  let data;
  try {
    data = await caller.magicLink.detail({ id });
  } catch {
    notFound();
  }
  const { link, views } = data;
  const status = deriveStatus(link);

  const totalDwell = views.reduce<number>((s, v) => s + (v.dwellMs ?? 0), 0);
  const viewsWithDwell = views.filter((v) => v.dwellMs !== null);
  const avgDwell =
    viewsWithDwell.length > 0 ? totalDwell / viewsWithDwell.length : null;

  return (
    <AppShell active="today">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="reveal-up">
          <Link
            href="/dashboard/leads"
            className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-primary))]"
          >
            ← All lead links
          </Link>
          <h1
            className="mt-3 font-display text-4xl leading-tight tracking-tight sm:text-5xl"
            style={{ fontVariationSettings: '"opsz" 96' }}
          >
            <span className="capitalize">{link.target}</span> link
          </h1>
          <p className="mt-3 flex flex-wrap items-center gap-3 text-sm text-[rgb(var(--fg-secondary))]">
            <Badge
              variant={
                status === "active"
                  ? "active"
                  : status === "expired"
                    ? "warning"
                    : "danger"
              }
              dot
            >
              {status}
            </Badge>
            <span className="font-mono text-xs text-[rgb(var(--fg-muted))]">
              id · {link.id.slice(0, 8)}…
            </span>
            <span>Issued {dateFmt.format(link.createdAt)}</span>
            <span>· Expires {dateFmt.format(link.expiresAt)}</span>
          </p>
        </header>

        {/* Stat strip */}
        <section className="mt-10 grid gap-3 reveal-up-delay-1 sm:grid-cols-3">
          <Stat label="Opens" value={String(views.length)} />
          <Stat
            label="Unique devices"
            value={String(
              new Set(views.map((v) => summarizeUserAgent(v.userAgent))).size,
            )}
          />
          <Stat
            label="Avg dwell"
            value={avgDwell !== null ? formatDwell(avgDwell) : "—"}
          />
        </section>

        {/* Timeline */}
        <section className="mt-10">
          <h2 className="mb-4 font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
            Timeline
          </h2>
          {views.length === 0 ? (
            <EmptyState
              title="No opens yet."
              description="When someone clicks this link we'll record IP (hashed), device, referer, and how long they stayed."
            />
          ) : (
            <ol className="flex flex-col gap-px rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-px">
              {views.map((v) => (
                <li
                  key={v.id}
                  className="grid grid-cols-[auto_1fr_auto] items-center gap-4 bg-[rgb(var(--bg-elevated))] px-4 py-3 first:rounded-t-[calc(var(--radius-lg)-1px)] last:rounded-b-[calc(var(--radius-lg)-1px)]"
                >
                  <div className="shrink-0 font-mono text-[0.7rem] text-[rgb(var(--fg-muted))]">
                    {formatRelative(v.viewedAt)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm text-[rgb(var(--fg-primary))]">
                      {summarizeUserAgent(v.userAgent)}
                    </p>
                    <p className="truncate font-mono text-[0.7rem] text-[rgb(var(--fg-muted))]">
                      via {summarizeReferer(v.referer)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right font-mono text-xs text-[rgb(var(--fg-secondary))]">
                    {formatDwell(v.dwellMs)}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
      <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
        {label}
      </p>
      <p
        className="mt-1 font-display text-3xl leading-tight text-[rgb(var(--fg-primary))]"
        style={{ fontVariationSettings: '"opsz" 96' }}
      >
        {value}
      </p>
    </div>
  );
}
