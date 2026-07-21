"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { Check, Pause, Play, Radio } from "lucide-react";

import {
  playerPlay,
  playerToggle,
  useNowPlaying,
} from "~/components/audio/persistent-player";
import { Waveform50 } from "~/components/audio/waveform-50";
import { JoinMiniPlayer } from "~/components/join/join-mini-player";

export type PublicSongVersion = Readonly<{
  id: string;
  label: string;
  audioUrl: string;
  durationMs: number | null;
  uploadedAtIso: string;
  peaks: number[] | null;
}>;

export type PublicSongPlayerProps = Readonly<{
  songTitle: string;
  artist: string | null;
  producerName: string;
  producerLogoUrl: string | null;
  versions: readonly PublicSongVersion[];
}>;

function formatDuration(durationMs: number | null): string {
  if (!durationMs || durationMs <= 0) return "—:——";
  const seconds = Math.round(durationMs / 1_000);
  return `${Math.floor(seconds / 60).toString()}:${(seconds % 60).toString().padStart(2, "0")}`;
}

function formatUploadDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Stored version";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function PublicSongPlayer({
  songTitle,
  artist,
  producerName,
  producerLogoUrl,
  versions,
}: PublicSongPlayerProps) {
  const [selectedId, setSelectedId] = useState(versions[0]?.id ?? "");
  const selected = versions.find((version) => version.id === selectedId) ?? versions[0];
  const nowPlaying = useNowPlaying();
  const selectedIsPlaying = selected
    ? nowPlaying.trackId === selected.id && nowPlaying.playing
    : false;

  const miniPlayerVersions = useMemo(
    () =>
      versions.map((version) => ({
        id: version.id,
        title: songTitle,
        artist: version.label,
        audioUrl: version.audioUrl,
        durationMs: version.durationMs,
      })),
    [songTitle, versions],
  );

  if (!selected) return null;

  function play(version: PublicSongVersion) {
    setSelectedId(version.id);
    if (nowPlaying.trackId === version.id) {
      playerToggle();
      return;
    }
    playerPlay({
      id: version.id,
      audioUrl: version.audioUrl,
      title: songTitle,
      subtitle: `${version.label} · ${artist ?? producerName}`,
      durationMs: version.durationMs,
    });
  }

  return (
    <div className="relative min-h-dvh overflow-x-clip bg-[rgb(var(--bg-base))]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-80"
        style={{
          background:
            "radial-gradient(circle at 14% 8%, rgb(var(--brand-primary) / 0.17), transparent 34%), radial-gradient(circle at 92% 92%, rgb(var(--brand-accent) / 0.08), transparent 32%)",
        }}
      />

      <header className="relative z-10 mx-auto flex w-full max-w-[1180px] items-center justify-between px-5 py-5 sm:px-8 lg:px-10 lg:py-7">
        <a
          href="https://skitza.app"
          className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-lg)] px-1 font-display text-lg font-extrabold tracking-[-0.04em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[rgb(var(--fg-primary)/0.18)] bg-[rgb(var(--fg-primary)/0.06)]">
            <Radio className="h-4 w-4 text-[rgb(var(--brand-primary))]" aria-hidden="true" />
          </span>
          Skitza<span className="text-[rgb(var(--brand-primary))]">.</span>
        </a>

        <div className="flex min-w-0 items-center gap-2.5">
          {producerLogoUrl ? (
            <Image
              src={producerLogoUrl}
              alt=""
              width={36}
              height={36}
              unoptimized
              className="h-9 w-9 rounded-full object-cover ring-1 ring-[rgb(var(--fg-primary)/0.16)]"
            />
          ) : (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] font-display text-sm font-extrabold text-[rgb(var(--fg-primary))]">
              {producerName.slice(0, 1).toUpperCase()}
            </span>
          )}
          <p className="max-w-[160px] truncate text-sm font-semibold text-[rgb(var(--fg-primary)/0.78)] sm:max-w-[260px]">
            {producerName}
          </p>
        </div>
      </header>

      <main className="relative z-10 mx-auto grid w-full max-w-[1180px] gap-8 px-5 pb-32 pt-5 sm:px-8 lg:grid-cols-[minmax(300px,0.82fr)_minmax(0,1.18fr)] lg:items-center lg:gap-16 lg:px-10 lg:pb-28 lg:pt-10">
        <section aria-label="Now selected" className="mx-auto w-full max-w-[460px] lg:max-w-none">
          <div className="relative aspect-square overflow-hidden rounded-[var(--radius-xl)] border border-[rgb(var(--fg-primary)/0.12)] bg-[rgb(var(--surface-raised))] shadow-[0_34px_90px_rgb(0_0_0/0.34)]">
            <div
              aria-hidden="true"
              className="absolute inset-[8%] rounded-full border border-[rgb(var(--fg-primary)/0.12)] shadow-[inset_0_0_0_16px_rgb(var(--fg-primary)/0.018),inset_0_0_0_32px_rgb(var(--fg-primary)/0.016),inset_0_0_0_48px_rgb(var(--fg-primary)/0.014),inset_0_0_0_64px_rgb(var(--fg-primary)/0.012)]"
              style={{
                background:
                  "repeating-radial-gradient(circle, rgb(var(--fg-primary) / 0.08) 0 1px, transparent 1px 7px), radial-gradient(circle at 36% 30%, rgb(var(--brand-primary) / 0.38), rgb(var(--surface-raised)) 58%)",
              }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <button
                type="button"
                onClick={() => {
                  play(selected);
                }}
                aria-label={selectedIsPlaying ? `Pause ${songTitle}` : `Play ${songTitle}`}
                className="flex h-20 w-20 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-primary))] shadow-[0_16px_40px_rgb(var(--brand-primary)/0.34)] transition-transform duration-300 hover:scale-105 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--fg-primary))] focus-visible:ring-offset-4 focus-visible:ring-offset-[rgb(var(--brand-primary))] motion-reduce:transform-none motion-reduce:transition-none"
              >
                {selectedIsPlaying ? (
                  <Pause className="h-7 w-7" fill="currentColor" aria-hidden="true" />
                ) : (
                  <Play className="ml-1 h-7 w-7" fill="currentColor" aria-hidden="true" />
                )}
              </button>
            </div>
            <div className="absolute bottom-5 left-5 right-5 flex items-center justify-between gap-4 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-primary)/0.1)] bg-[rgb(var(--bg-base)/0.72)] px-4 py-3 backdrop-blur-xl">
              <div className="min-w-0">
                <p className="truncate font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--brand-primary))]">
                  Selected version
                </p>
                <p className="mt-1 truncate text-sm font-bold">{selected.label}</p>
              </div>
              <span className="shrink-0 font-mono text-xs text-[rgb(var(--fg-primary)/0.6)]">
                {formatDuration(selected.durationMs)}
              </span>
            </div>
          </div>
        </section>

        <section className="min-w-0" aria-labelledby="public-song-title">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[rgb(var(--brand-primary))]">
            Public listening page
          </p>
          <h1
            id="public-song-title"
            className="mt-4 max-w-[780px] break-words font-display text-[clamp(2.8rem,8vw,6rem)] font-extrabold leading-[0.88] tracking-[-0.055em] text-[rgb(var(--fg-primary))]"
          >
            {songTitle}
            <span className="text-[rgb(var(--brand-primary))]">.</span>
          </h1>
          <p className="mt-4 text-base text-[rgb(var(--fg-primary)/0.62)] sm:text-lg">
            {artist ?? `Produced by ${producerName}`}
          </p>

          <div className="mt-8 rounded-[var(--radius-xl)] border border-[rgb(var(--fg-primary)/0.11)] bg-[rgb(var(--surface-raised)/0.72)] p-4 shadow-[0_20px_60px_rgb(0_0_0/0.16)] backdrop-blur-xl sm:p-6">
            <Waveform50
              durationMs={selected.durationMs ?? 0}
              comments={[]}
              seed={selected.id}
              initialPeaks={selected.peaks}
              height={92}
              className="w-full"
            />
            <button
              type="button"
              onClick={() => {
                play(selected);
              }}
              className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-5 text-sm font-bold text-[rgb(var(--fg-primary))] transition-transform hover:-translate-y-px active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--fg-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--brand-primary))] motion-reduce:transform-none motion-reduce:transition-none sm:w-auto"
            >
              {selectedIsPlaying ? (
                <Pause className="h-4 w-4" fill="currentColor" aria-hidden="true" />
              ) : (
                <Play className="h-4 w-4" fill="currentColor" aria-hidden="true" />
              )}
              {selectedIsPlaying ? "Pause" : "Listen"} to {selected.label}
            </button>
          </div>

          <div className="mt-7">
            <div className="mb-3 flex items-end justify-between gap-4">
              <div>
                <h2 className="font-display text-xl font-bold tracking-[-0.02em]">Versions</h2>
                <p className="mt-1 text-sm text-[rgb(var(--fg-primary)/0.5)]">
                  The newest available version is selected first.
                </p>
              </div>
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[rgb(var(--fg-primary)/0.42)]">
                {versions.length.toString().padStart(2, "0")} stored
              </span>
            </div>
            <ul className="space-y-2">
              {versions.map((version, index) => {
                const active = version.id === selected.id;
                return (
                  <li key={version.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(version.id);
                        if (nowPlaying.trackId && nowPlaying.trackId !== version.id) play(version);
                      }}
                      aria-pressed={active}
                      className={`grid min-h-14 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[var(--radius-lg)] border px-3.5 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] motion-reduce:transition-none ${
                        active
                          ? "border-[rgb(var(--brand-primary)/0.52)] bg-[rgb(var(--brand-primary)/0.1)]"
                          : "border-[rgb(var(--fg-primary)/0.09)] bg-[rgb(var(--fg-primary)/0.025)] hover:bg-[rgb(var(--fg-primary)/0.05)]"
                      }`}
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[rgb(var(--fg-primary)/0.12)] font-mono text-[10px] text-[rgb(var(--fg-primary)/0.55)]">
                        {(index + 1).toString().padStart(2, "0")}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold">{version.label}</span>
                        <span className="mt-0.5 block truncate text-xs text-[rgb(var(--fg-primary)/0.48)]">
                          {formatUploadDate(version.uploadedAtIso)} · {formatDuration(version.durationMs)}
                        </span>
                      </span>
                      {active ? (
                        <Check className="h-4 w-4 text-[rgb(var(--brand-primary))]" aria-hidden="true" />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      </main>

      <JoinMiniPlayer samples={miniPlayerVersions} producerName={producerName} />
    </div>
  );
}
