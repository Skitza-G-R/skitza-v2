import { auth } from "~/server/auth/clerk-identity";
import { TRPCError } from "@trpc/server";
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  FileMusic,
  LockKeyhole,
  ReceiptText,
} from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = { params: Promise<{ producerId: string }> };

function dateLabel(value: Date): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

function moneyLabel(amountCents: number, currency: string): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
  }).format(amountCents / 100);
}

function statusLabel(value: string): string {
  return value.replaceAll("_", " ");
}

export default async function ArtistPastStudioPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { producerId } = await params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(producerId)
  ) {
    notFound();
  }

  let history;
  try {
    history = await appRouter
      .createCaller({ userId })
      .artistPlatform.history.studio({ producerId });
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <div className="mx-auto w-full max-w-5xl pb-8">
      <Link
        href="/artist/settings"
        className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-lg)] px-2 text-[12px] font-bold text-[rgb(var(--fg-secondary))] hover:bg-[rgb(var(--bg-overlay))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
      >
        <ArrowLeft size={16} aria-hidden />
        Settings
      </Link>

      <header className="flex items-center gap-4">
        {history.studio.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={history.studio.logoUrl}
            alt=""
            className="h-14 w-14 rounded-[var(--radius-sm)] object-cover"
          />
        ) : (
          <div className="font-display flex h-14 w-14 items-center justify-center rounded-[var(--radius-sm)] bg-[rgb(var(--fg-default))] text-lg font-extrabold text-[rgb(var(--bg-elevated))]">
            {history.studio.name.trim().slice(0, 1).toUpperCase() || "S"}
          </div>
        )}
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-semibold tracking-[0.14em] text-[rgb(var(--brand-primary))] uppercase">
            Past studio
          </p>
          <h1 className="font-display truncate text-[28px] leading-tight font-extrabold tracking-[-0.035em] text-[rgb(var(--fg-default))] sm:text-[34px]">
            {history.studio.name}
          </h1>
        </div>
      </header>

      <div className="mt-5 flex items-start gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-overlay))] p-4">
        <LockKeyhole
          size={17}
          aria-hidden
          className="mt-0.5 shrink-0 text-[rgb(var(--fg-muted))]"
        />
        <p className="text-[12px] leading-relaxed text-[rgb(var(--fg-secondary))]">
          This is a read-only record. New messages, purchases, uploads, and session changes are
          unavailable after disconnecting.
        </p>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <HistorySection
          title="Music"
          icon={<FileMusic size={17} aria-hidden />}
          empty={history.projects.length === 0 && history.songs.length === 0}
          emptyLabel="No preserved music records."
        >
          {history.projects.map((project) => (
            <HistoryRow
              key={`project-${project.id}`}
              title={project.title}
              meta={`Project · ${statusLabel(project.lifecycleStatus)}`}
              detail={dateLabel(project.createdAt)}
            />
          ))}
          {history.songs.map((song) => (
            <HistoryRow
              key={`song-${song.id}`}
              title={song.title}
              meta={`${song.artist ? `Song · ${song.artist}` : "Song"} · ${
                song.versions.length === 1
                  ? "1 preserved version"
                  : `${String(song.versions.length)} preserved versions`
              }`}
              detail={dateLabel(song.createdAt)}
              href={
                song.versions[0]
                  ? `/artist/settings/studios/${encodeURIComponent(
                      producerId,
                    )}/music/${encodeURIComponent(song.id)}/versions/${encodeURIComponent(
                      song.versions[0].id,
                    )}`
                  : undefined
              }
            />
          ))}
        </HistorySection>

        <HistorySection
          title="Payment records"
          icon={<ReceiptText size={17} aria-hidden />}
          empty={history.proofs.length === 0}
          emptyLabel="No preserved payment records."
        >
          {history.proofs.map((proof) => (
            <HistoryRow
              key={proof.id}
              title={proof.productName}
              meta={`${moneyLabel(proof.amountCents, proof.currency)} · ${statusLabel(
                proof.status,
              )}`}
              detail={dateLabel(proof.createdAt)}
              href={`/artist/settings/studios/${encodeURIComponent(
                producerId,
              )}/proofs/${encodeURIComponent(proof.id)}`}
            />
          ))}
        </HistorySection>

        <HistorySection
          title="Sessions"
          icon={<CalendarDays size={17} aria-hidden />}
          empty={history.sessions.length === 0}
          emptyLabel="No preserved sessions."
          className="lg:col-span-2"
        >
          {history.sessions.map((session) => (
            <HistoryRow
              key={session.id}
              title={session.productName}
              meta={`${dateLabel(session.startsAt)} · ${String(session.durationMin)} min`}
              detail={statusLabel(session.status)}
              href={`/artist/settings/studios/${encodeURIComponent(
                producerId,
              )}/sessions/${encodeURIComponent(session.id)}`}
            />
          ))}
        </HistorySection>
      </div>
    </div>
  );
}

function HistorySection({
  title,
  icon,
  empty,
  emptyLabel,
  className = "",
  children,
}: {
  title: string;
  icon: React.ReactNode;
  empty: boolean;
  emptyLabel: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`${className} overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[var(--shadow-sm)]`}
    >
      <h2 className="font-display flex items-center gap-2 px-5 py-4 text-base font-bold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
        <span className="text-[rgb(var(--brand-primary))]">{icon}</span>
        {title}
      </h2>
      {empty ? (
        <p className="border-t border-[rgb(var(--border-subtle))] px-5 py-5 text-sm text-[rgb(var(--fg-muted))]">
          {emptyLabel}
        </p>
      ) : (
        <div className="divide-y divide-[rgb(var(--border-subtle))] border-t border-[rgb(var(--border-subtle))]">
          {children}
        </div>
      )}
    </section>
  );
}

function HistoryRow({
  title,
  meta,
  detail,
  href,
}: {
  title: string;
  meta: string;
  detail: string;
  href?: string | undefined;
}) {
  const content = (
    <>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold text-[rgb(var(--fg-default))]">{title}</p>
        <p className="mt-0.5 text-[11px] text-[rgb(var(--fg-muted))] capitalize">{meta}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <p className="font-mono text-[10px] text-[rgb(var(--fg-muted))] capitalize">{detail}</p>
        {href ? (
          <ChevronRight size={14} aria-hidden className="text-[rgb(var(--fg-muted))]" />
        ) : null}
      </div>
    </>
  );
  return href ? (
    <Link
      href={href}
      className="flex min-h-14 items-start justify-between gap-4 px-5 py-3.5 hover:bg-[rgb(var(--bg-overlay))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
    >
      {content}
    </Link>
  ) : (
    <div className="flex min-h-14 items-start justify-between gap-4 px-5 py-3.5">{content}</div>
  );
}
