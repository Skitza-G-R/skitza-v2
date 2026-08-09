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
  newSong,
  supporting,
  welcome,
}: {
  greeting: string;
  studioName: string;
  main: ArtistHomeAction;
  newSong: ArtistHomeAction | null;
  supporting: readonly ArtistHomeAction[];
  welcome: boolean;
}) {
  const [acknowledgedNewVersionId, setAcknowledgedNewVersionId] = useState<string | null>(null);
  const showMainNew = main.isNew === true && acknowledgedNewVersionId !== main.id;
  const visibleNewSong =
    newSong !== null && acknowledgedNewVersionId !== newSong.id ? newSong : null;
  const rows: ArtistHomeAction[] = [...(visibleNewSong ? [visibleNewSong] : []), ...supporting];

  return (
    <div className="mx-auto w-full max-w-[820px] space-y-5 px-4 py-5 sm:px-6 sm:py-7">
      <header>
        <h1 className="font-display text-[25px] font-bold tracking-[-0.03em] text-[rgb(var(--fg-default))] sm:text-[30px]">
          {greeting}
        </h1>
      </header>

      <article
        className="relative isolate overflow-hidden rounded-[var(--radius-xl)] border text-[rgb(var(--fg-onsidebar))] shadow-[var(--shadow-lg)]"
        style={{
          background:
            "linear-gradient(145deg, rgb(var(--bg-sidebar)) 0%, rgb(var(--bg-sidebar) / 0.96) 64%, rgb(var(--brand-copper) / 0.44) 145%)",
          borderColor: "rgb(var(--fg-onsidebar) / 0.13)",
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-20 h-64 w-64 rounded-full border border-[rgb(var(--fg-onsidebar)/0.08)]"
          style={{
            boxShadow:
              "inset 0 0 0 24px rgb(var(--fg-onsidebar) / 0.018), inset 0 0 0 48px rgb(var(--fg-onsidebar) / 0.015), inset 0 0 0 72px rgb(var(--fg-onsidebar) / 0.012)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at 84% 14%, rgb(var(--brand-primary) / 0.2), transparent 30%)",
          }}
        />
        <div className="relative h-1 bg-[rgb(var(--brand-primary))]" aria-hidden />
        <div className="relative p-5 sm:p-6">
          {welcome ? (
            <p className="font-mono text-[9px] font-semibold tracking-[0.15em] text-[rgb(var(--brand-primary))] uppercase">
              Welcome
            </p>
          ) : (
            <div className="flex items-center gap-2">
              <p className="font-mono text-[9px] font-semibold tracking-[0.15em] text-[rgb(var(--brand-primary))] uppercase">
                {mainLabel(main.kind)}
              </p>
              {showMainNew ? (
                <span className="rounded-[var(--radius-sm)] border border-[rgb(var(--brand-primary)/0.34)] bg-[rgb(var(--brand-primary)/0.14)] px-2 py-0.5 font-mono text-[8px] font-bold tracking-[0.1em] text-[rgb(var(--brand-primary))] uppercase">
                  New
                </span>
              ) : null}
            </div>
          )}
          <h2 className="font-display mt-2 max-w-[24ch] text-[23px] leading-[1.12] font-bold tracking-[-0.03em] text-[rgb(var(--fg-onsidebar))] sm:text-[29px]">
            {welcome
              ? `Welcome to ${studioName}. Everything you make together will appear here.`
              : main.title}
          </h2>
          {!welcome ? (
            <p className="mt-2 max-w-[62ch] text-[13.5px] leading-relaxed text-[rgb(var(--fg-onsidebar)/0.68)]">
              {main.detail}
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <Link
              href={main.href}
              className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 py-2.5 text-[13px] font-bold text-[rgb(var(--fg-on-brand))] shadow-[0_10px_24px_-14px_rgb(var(--brand-primary)/0.9)]"
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
                  if (main.kind === "new_song" && showMainNew) {
                    setAcknowledgedNewVersionId(main.id);
                    void acknowledgeArtistTrackVersionAction({
                      trackVersionId: main.id,
                    });
                  }
                }}
                className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border bg-[rgb(var(--fg-onsidebar)/0.06)] px-4 py-2.5 text-[13px] font-bold text-[rgb(var(--fg-onsidebar))]"
                style={{ borderColor: "rgb(var(--fg-onsidebar) / 0.18)" }}
              >
                Play
              </button>
            ) : null}
          </div>
        </div>
      </article>

      {rows.length > 0 ? (
        <section aria-label="More from this studio">
          <ul className="divide-y divide-[rgb(var(--border-subtle))] rounded-[var(--radius-xl)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated)/0.84)] shadow-[var(--shadow-sm)] backdrop-blur-xl">
            {rows.map((item) => {
              const isNewSong = newSong?.id === item.id && item.kind === "new_song";
              return (
                <li
                  key={`${item.kind}:${item.id}`}
                  data-artist-home-new-version={isNewSong ? item.id : undefined}
                >
                  {isNewSong ? (
                    <div className="flex min-h-16 items-center gap-2 pr-2">
                      <Link
                        href={item.href}
                        aria-label={item.actionLabel}
                        className="sk-press flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3.5"
                      >
                        <span className="min-w-0">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-[13.5px] font-semibold text-[rgb(var(--fg-default))]">
                              {item.title}
                            </span>
                            {item.isNew === true ? (
                              <span className="shrink-0 rounded-[var(--radius-sm)] border border-[rgb(var(--brand-primary)/0.28)] bg-[rgb(var(--brand-primary)/0.1)] px-1.5 py-0.5 font-mono text-[8px] font-bold tracking-[0.08em] text-[rgb(var(--brand-primary-text))] uppercase">
                                New
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-0.5 block truncate text-[11.5px] text-[rgb(var(--fg-muted))]">
                            {item.detail}
                          </span>
                        </span>
                        <span className="shrink-0 text-[11.5px] font-semibold text-[rgb(var(--brand-primary-text))]">
                          {item.actionLabel}
                        </span>
                      </Link>
                      {item.audio?.url ? (
                        <button
                          type="button"
                          aria-label={`Play ${item.title}`}
                          onClick={() => {
                            const audio = item.audio;
                            if (!audio?.url) return;
                            playerPlay({
                              id: item.id,
                              audioUrl: audio.url,
                              title: audio.title,
                              subtitle: audio.subtitle,
                              durationMs: audio.durationMs,
                            });
                            setAcknowledgedNewVersionId(item.id);
                            void acknowledgeArtistTrackVersionAction({
                              trackVersionId: item.id,
                            });
                          }}
                          className="sk-press inline-flex min-h-11 shrink-0 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-3 text-[11.5px] font-semibold text-[rgb(var(--fg-default))]"
                        >
                          Play
                        </button>
                      ) : null}
                    </div>
                  ) : (
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
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function mainLabel(kind: ArtistHomeAction["kind"]): string {
  switch (kind) {
    case "session_status":
      return "Booking status";
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
