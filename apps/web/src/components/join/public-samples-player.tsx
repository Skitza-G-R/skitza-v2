"use client";

import { WaveformPlayer } from "~/components/audio/waveform-player";

// Public samples rail for `/join/<slug>`.
//
// Renders one card per producer-curated public sample (capped at 3 by
// the server query). Each card wraps an existing WaveformPlayer so the
// visual matches the project-room music interaction. Cards have a
// `.sk-lift` hover and live on a CSS vars palette so per-producer
// brand overrides cascade through.
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
  if (samples.length === 0) {
    return (
      <section
        aria-label="Public samples"
        className="mx-auto mt-4 max-w-3xl px-6 sm:px-10"
      >
        <div className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-8 text-center">
          <p className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-[rgb(var(--fg-muted))]">
            Samples
          </p>
          <p className="mt-3 text-[rgb(var(--fg-secondary))]">
            This producer hasn&apos;t shared any samples yet — check back soon.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Public samples"
      className="mx-auto mt-4 max-w-3xl px-6 sm:px-10"
    >
      <div className="mb-6 flex items-baseline justify-between">
        <p className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-[rgb(var(--fg-muted))]">
          Samples
        </p>
        <p className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-[rgb(var(--fg-muted))]">
          {samples.length} track{samples.length === 1 ? "" : "s"}
        </p>
      </div>

      <ul className="flex flex-col gap-3">
        {samples.map((sample) => (
          <li
            key={sample.id}
            className="sk-lift rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 sm:p-5"
          >
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2
                  className="truncate font-display text-lg leading-tight tracking-tight sm:text-xl"
                  style={{ fontVariationSettings: '"opsz" 72' }}
                >
                  {sample.title}
                </h2>
                {sample.artist ? (
                  <p className="mt-0.5 truncate text-sm text-[rgb(var(--fg-secondary))]">
                    {sample.artist}
                  </p>
                ) : null}
              </div>
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
    </section>
  );
}
