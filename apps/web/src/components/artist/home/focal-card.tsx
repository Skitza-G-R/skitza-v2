"use client";

import Link from "next/link";

import { formatDuration } from "~/lib/format/duration";

import { useArtistAudio } from "../artist-audio-context";

// Client component — the single most-important thing waiting for the
// artist. Auto-picked by the page from the priority list:
//   mix → payment → session → quiet
//
// All four variants share the same hero-card shell (white surface,
// `--radius-2xl`, soft elevated shadow). Inside, each variant owns
// its own copy + CTA pattern. Whole card is the primary target; the
// inline play / pay / view button is a faster second-tap.

type Mix = {
  id: string;
  trackTitle: string;
  label: string;
  producerName: string;
  projectId: string;
  audioUrl: string | null;
  // Milliseconds. Nullable: populated by audio.completeMultipart once
  // the upload finalises; legacy rows / mid-upload state leave it null
  // and the row renders "—".
  durationMs: number | null;
};

type Payment = {
  bookingId: string;
  producerName: string;
  packageName: string;
  amountFormatted: string;
};

type Session = {
  id: string;
  startsAt: Date;
  durationMin: number;
  producerName: string;
  productName: string | null;
};

export type FocalItem =
  | { kind: "mix"; mix: Mix }
  | { kind: "payment"; payment: Payment }
  | { kind: "session"; session: Session }
  | { kind: "quiet" };

export function FocalCard({ item }: { item: FocalItem }) {
  switch (item.kind) {
    case "mix":
      return <MixFocal mix={item.mix} />;
    case "payment":
      return <PaymentFocal payment={item.payment} />;
    case "session":
      return <SessionFocal session={item.session} />;
    case "quiet":
      return <QuietFocal />;
  }
}

// ─── Shell ──────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="reveal-up-delay-1 rounded-[var(--radius-2xl)] bg-[rgb(var(--bg-elevated))] p-6 lg:p-7"
      style={{
        boxShadow:
          "0 1px 0 rgb(17 16 9 / 0.03), 0 24px 60px -28px rgb(17 16 9 / 0.18)",
      }}
    >
      {children}
    </div>
  );
}

// ─── Variant: mix ───────────────────────────────────────────────────

// Decorative track stripe — a single line of soft amber peaks across
// the row. Not a real waveform (real peaks live on the project
// page); just enough visual character to read as audio. 40 bars fit
// comfortably between the title and duration on a 600px column and
// shrink down gracefully on narrow viewports.
const TRACK_STRIPE = [
  62, 70, 58, 78, 66, 72, 60, 80, 68, 64, 76, 72, 58, 70, 82, 64, 72, 60, 76,
  68, 72, 66, 80, 62, 70, 58, 66, 74, 62, 70, 60, 68, 56, 64, 70, 58, 72, 66,
  60, 64,
];

function MixFocal({ mix }: { mix: Mix }) {
  const { state, playTrack, togglePlay } = useArtistAudio();
  const ready = !!mix.audioUrl;
  const isCurrent = state.currentTrack?.id === mix.id;
  const isPlaying = isCurrent && state.isPlaying;

  const onPlay = () => {
    if (!mix.audioUrl) return;
    if (isCurrent) {
      togglePlay();
      return;
    }
    playTrack({
      id: mix.id,
      url: mix.audioUrl,
      title: `${mix.trackTitle} — ${mix.label}`,
      producerName: mix.producerName,
      artworkUrl: null,
    });
  };

  // ONE-ROW layout, inside the unified elevated Shell.
  // Order: ▶ play | name | waveform | duration. The Shell (radius-2xl
  // + soft shadow) gives the focal slot its visual weight — the row
  // itself stays tight (p-4, ~64px tall) because this is one item,
  // not a hero section. Mirrors what payment/session variants do
  // density-wise: same shell, different content density.
  return (
    <Link
      href={`/artist/music/${mix.projectId}`}
      className="sk-press reveal-up-delay-1 block rounded-[var(--radius-2xl)] bg-[rgb(var(--bg-elevated))] p-4"
      style={{
        boxShadow:
          "0 1px 0 rgb(17 16 9 / 0.03), 0 24px 60px -28px rgb(17 16 9 / 0.18)",
      }}
      aria-label={`Open ${mix.trackTitle} project`}
    >
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onPlay();
          }}
          disabled={!ready}
          aria-label={
            ready
              ? isPlaying
                ? `Pause ${mix.trackTitle}`
                : `Listen to ${mix.trackTitle}`
              : "Audio still uploading"
          }
          className="sk-press flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            background: "rgb(var(--fg-default))",
            color: "rgb(var(--brand-primary))",
          }}
        >
          <span aria-hidden>{isPlaying ? "❚❚" : "▶"}</span>
        </button>

        <p className="min-w-0 truncate font-display text-[22px] font-bold leading-none tracking-[-0.02em] text-[rgb(var(--fg-default))]">
          {mix.trackTitle}
        </p>

        {/* Decorative track stripe — fixed-width peaks, NOT
            flex-stretched. R1 bug fix: previously each peak had its
            own `flex-1`, which let the parent flex divide its width
            equally across all 40 children — turning every peak into
            a ~10px-wide pill and erasing the height variance. Now
            each peak is a strict 2.5px wide with a 2px gap; the
            container's flex-1 still claims the leftover row width,
            and `overflow-hidden` clips any peaks that don't fit on
            narrow viewports. */}
        <div
          aria-hidden
          className="flex h-5 min-w-0 flex-1 items-end gap-[2px] overflow-hidden"
        >
          {TRACK_STRIPE.map((h, i) => (
            <span
              key={i}
              className="block w-[2.5px] shrink-0 rounded-full"
              style={{
                height: `${String(h)}%`,
                background: "rgb(var(--brand-primary))",
                opacity: 0.42,
              }}
            />
          ))}
        </div>

        <span className="shrink-0 font-mono text-[12px] tabular-nums text-[rgb(var(--fg-muted))]">
          {formatDuration(mix.durationMs)}
        </span>
      </div>
    </Link>
  );
}

// ─── Variant: payment ───────────────────────────────────────────────

function PaymentFocal({ payment }: { payment: Payment }) {
  return (
    <Link
      href={`/artist/payment/${payment.bookingId}`}
      className="sk-press block"
    >
      <Shell>
        <p
          className="font-mono text-[0.66rem] font-medium uppercase tracking-[0.16em]"
          style={{ color: "rgb(var(--brand-copper))" }}
        >
          Payment due
        </p>
        <p className="mt-3 font-display text-[32px] font-bold leading-[1] tracking-[-0.025em] text-[rgb(var(--fg-default))] lg:text-[40px]">
          {payment.amountFormatted}
        </p>
        <p className="mt-3 text-[13px] text-[rgb(var(--fg-muted))] lg:text-[13.5px]">
          {payment.packageName} · with {payment.producerName}
        </p>
        <div className="mt-7">
          <span
            className="sk-press inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[14px] font-semibold"
            style={{
              background: "rgb(var(--brand-primary))",
              color: "rgb(var(--bg-sidebar))",
            }}
          >
            Complete payment
            <span aria-hidden style={{ opacity: 0.7 }}>
              →
            </span>
          </span>
        </div>
      </Shell>
    </Link>
  );
}

// ─── Variant: session ───────────────────────────────────────────────

function SessionFocal({ session }: { session: Session }) {
  const monthShort = formatMonthShort(session.startsAt);
  const day = session.startsAt.getDate();
  const time = formatTime(session.startsAt);
  const duration = formatSessionDuration(session.durationMin);

  return (
    <Link href="/artist/book" className="sk-press block">
      <Shell>
        <p className="font-mono text-[0.66rem] font-medium uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
          Next session
        </p>
        <div className="mt-4 flex items-end gap-5">
          <div className="shrink-0">
            <p
              className="font-mono text-[11px] font-bold uppercase tracking-wider"
              style={{ color: "rgb(var(--brand-primary))" }}
            >
              {monthShort}
            </p>
            <p className="my-1 font-display text-[56px] font-extrabold leading-none tracking-[-0.045em] text-[rgb(var(--fg-default))] lg:text-[68px]">
              {day}
            </p>
            <p className="font-mono text-[11px] text-[rgb(var(--fg-muted))]">
              {time}
            </p>
          </div>
          <div className="min-w-0 flex-1 pb-2">
            <p className="font-display text-[20px] font-bold leading-tight text-[rgb(var(--fg-default))] lg:text-[22px]">
              {session.productName ?? "Studio session"}
            </p>
            <p className="mt-1 text-[13px] text-[rgb(var(--fg-muted))]">
              with {session.producerName} · {duration}
            </p>
          </div>
        </div>
        <div className="mt-7">
          <span
            className="sk-press inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[14px] font-semibold"
            style={{
              background: "rgb(var(--bg-sidebar))",
              color: "rgb(var(--fg-inverse))",
            }}
          >
            View details
            <span aria-hidden style={{ opacity: 0.55 }}>
              →
            </span>
          </span>
        </div>
      </Shell>
    </Link>
  );
}

// ─── Variant: quiet (empty) ─────────────────────────────────────────

function QuietFocal() {
  return (
    <div className="reveal-up-delay-1">
      <Link
        href="/artist/book"
        className="sk-press inline-flex items-center gap-2 rounded-full px-5 py-3 text-[14px] font-semibold"
        style={{
          background: "rgb(var(--brand-primary))",
          color: "rgb(var(--bg-sidebar))",
        }}
      >
        + Book a session
      </Link>
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────────

function formatMonthShort(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// Sessions are measured in MINUTES (e.g. a 4-hour mix session =
// 240). The audio track helper from `~/lib/format/duration` takes
// MILLISECONDS — different unit, different output ("3:45" vs
// "2h 30m"). Keep them separate, name them clearly.
function formatSessionDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${String(m)} min`;
  if (m === 0) return `${String(h)}h`;
  return `${String(h)}h ${String(m)}m`;
}
