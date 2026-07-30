"use client";

import Link from "next/link";
import { useState } from "react";

import { acknowledgeArtistTrackVersionAction } from "~/components/artist/artist-notification-actions";
import { playerPlay } from "~/components/audio/persistent-player";

import type { ArtistHomeAction } from "./home-priority";

export function ProfessionalArtistHome({
  greeting,
  studioName,
  main,
  supporting,
  welcome,
}: {
  greeting: string;
  studioName: string;
  main: ArtistHomeAction;
  supporting: readonly ArtistHomeAction[];
  welcome: boolean;
}) {
  const [acknowledgedNewVersionId, setAcknowledgedNewVersionId] = useState<string | null>(null);
  const showNew = main.isNew === true && acknowledgedNewVersionId !== main.id;

  return (
    <div className="mx-auto w-full max-w-[820px] space-y-5 px-4 py-5 sm:px-6 sm:py-7">
      <header>
        <h1 className="font-display text-[25px] font-bold tracking-[-0.03em] text-[rgb(var(--fg-default))] sm:text-[30px]">
          {greeting}
        </h1>
      </header>

      <article
        className="overflow-hidden rounded-[var(--radius-lg)] border bg-[rgb(var(--bg-elevated))]"
        style={{ borderColor: "rgb(var(--border-control))" }}
      >
        <div className="h-1 bg-[rgb(var(--brand-primary))]" aria-hidden />
        <div className="p-5 sm:p-6">
          {welcome ? (
            <p className="font-mono text-[9px] font-semibold tracking-[0.15em] text-[rgb(var(--fg-muted))] uppercase">
              Welcome
            </p>
          ) : (
            <div className="flex items-center gap-2">
              <p className="font-mono text-[9px] font-semibold tracking-[0.15em] text-[rgb(var(--fg-muted))] uppercase">
                {mainLabel(main.kind)}
              </p>
              {showNew ? (
                <span className="rounded-full bg-[rgb(var(--brand-primary)/0.16)] px-2 py-0.5 font-mono text-[8px] font-bold tracking-[0.1em] text-[rgb(var(--brand-primary-text))] uppercase">
                  New
                </span>
              ) : null}
            </div>
          )}
          <h2 className="font-display mt-2 max-w-[24ch] text-[23px] leading-[1.12] font-bold tracking-[-0.03em] text-[rgb(var(--fg-default))] sm:text-[29px]">
            {welcome
              ? `Welcome to ${studioName}. Everything you make together will appear here.`
              : main.title}
          </h2>
          {!welcome ? (
            <p className="mt-2 max-w-[62ch] text-[13.5px] leading-relaxed text-[rgb(var(--fg-secondary))]">
              {main.detail}
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <Link
              href={main.href}
              className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sidebar))] px-4 py-2.5 text-[13px] font-bold text-[rgb(var(--fg-onsidebar))]"
            >
              {main.actionLabel}
            </Link>
            {main.audio?.url ? (
              <button
                type="button"
                onClick={() => {
                  const audio = main.audio;
                  if (!audio?.url) return;
                  playerPlay({
                    id: main.id,
                    audioUrl: audio.url,
                    title: audio.title,
                    subtitle: audio.subtitle,
                    durationMs: audio.durationMs,
                  });
                  if (main.kind === "new_song" && showNew) {
                    setAcknowledgedNewVersionId(main.id);
                    void acknowledgeArtistTrackVersionAction({
                      trackVersionId: main.id,
                    });
                  }
                }}
                className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border px-4 py-2.5 text-[13px] font-bold text-[rgb(var(--fg-default))]"
                style={{ borderColor: "rgb(var(--border-control))" }}
              >
                Play
              </button>
            ) : null}
          </div>
        </div>
      </article>

      {supporting.length > 0 ? (
        <section aria-label="More from this studio">
          <ul className="divide-y divide-[rgb(var(--border-subtle))] rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
            {supporting.map((item) => (
              <li key={`${item.kind}:${item.id}`}>
                <Link
                  href={item.href}
                  className="sk-press flex min-h-16 items-center justify-between gap-4 px-4 py-3.5"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-semibold text-[rgb(var(--fg-default))]">
                      {item.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[11.5px] text-[rgb(var(--fg-muted))]">
                      {item.detail}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11.5px] font-semibold text-[rgb(var(--brand-primary-text))]">
                    {item.actionLabel}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function mainLabel(kind: ArtistHomeAction["kind"]): string {
  switch (kind) {
    case "today_session":
      return "Today";
    case "payment_action":
      return "Action needed";
    case "ready_to_schedule":
      return "Ready to schedule";
    case "new_song":
      return "New music";
    case "services":
      return "Studio services";
  }
}
