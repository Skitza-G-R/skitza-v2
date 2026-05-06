"use client";

import { WaveformPlayer } from "~/components/audio/waveform-player";

// Public samples rail for `/join/<slug>` — surfaces as "Recent Work"
// per design context 2026.
//
// Each card renders one producer-curated public sample (capped at 3 by
// the server query). Each card wraps an existing WaveformPlayer so the
// visual matches the project-room music interaction. The card grid
// uses a 1-up stack on mobile and stays single-column on small screens
// so the waveform stays readable; on ≥md screens we widen the rail and
// the waveform breathes more.
//
// Client component: WaveformPlayer constructs a wavesurfer.js instance
// on mount (canvas + audio decoding), which needs the browser.
//
// Empty state ("producer hasn't shared any samples yet") is handled
// inline so the page still reads as intentional even when a freshly
// onboarded producer hasn't flipped any toggles yet.

interface PublicSample {
  id: string;
  title: string;
  artist: string | null;
  audioUrl: string | null;
  durationMs: number | null;
  peaksR2Key: string | null;
}

interface PublicSamplesPlayerProps {
  samples: ReadonlyArray<PublicSample>;
}

export function PublicSamplesPlayer({ samples }: PublicSamplesPlayerProps) {
  return (
    <section
      id="work"
      aria-label="Recent work"
      className="mx-auto mt-14 max-w-6xl px-6 sm:mt-16 sm:px-10"
    >
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-2 sm:mb-8">
        <h2
          className="font-extrabold text-[clamp(1.6rem,3.4vw,2.1rem)] leading-[1.05] tracking-[-0.025em] text-[rgb(var(--fg-primary))]"
          style={{ fontFamily: "var(--font-head), var(--font-display)" }}
        >
          Recent work
        </h2>
        <p className="font-mono text-[0.66rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))] sm:text-xs">
          Press play. The room is open.
        </p>
      </header>

      {samples.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-8 text-center">
          <p className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-[rgb(var(--fg-muted))]">
            Samples
          </p>
          <p className="mt-3 text-[rgb(var(--fg-secondary))]">
            This producer hasn&apos;t shared any samples yet — check back soon.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3 sm:gap-4">
          {samples.map((sample, idx) => (
            <li
              key={sample.id}
              className="sk-lift rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 sm:p-5"
            >
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3
                    className="truncate text-lg font-extrabold leading-tight tracking-[-0.02em] sm:text-xl"
                    style={{ fontFamily: "var(--font-head), var(--font-display)" }}
                  >
                    {sample.title}
                  </h3>
                  {sample.artist ? (
                    <p className="mt-0.5 truncate text-sm text-[rgb(var(--fg-secondary))]">
                      {sample.artist}
                    </p>
                  ) : null}
                </div>
                <span
                  className="shrink-0 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]"
                  aria-hidden
                >
                  {String(idx + 1).padStart(2, "0")}
                </span>
              </div>

              {sample.audioUrl ? (
                <WaveformPlayer
                  src={sample.audioUrl}
                  label={`${sample.title}${sample.artist ? ` by ${sample.artist}` : ""}`}
                />
              ) : (
                // Very rare: a track flagged `is_public_sample` whose
                // audio upload is still pending. Show a soft pending chip
                // rather than a broken player. Producer shouldn't be able
                // to hit this state via the UI (toggle is gated on an
                // existing audioUrl) but defensive code is cheap here.
                <p className="font-mono text-xs uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                  Processing audio…
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
