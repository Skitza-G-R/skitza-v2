"use client";

// S12 — Session detail + cancel / reschedule (artist Book section).
//
// A standing artist screen whose in-flow back link returns to
// /artist/sessions. The shared artist shell remains mounted around the
// booking detail.
//
// The hero card states the booking plainly (date + time large in Syne,
// duration, the product + producer mini-row, a StatusPill). The action stack
// (Reschedule + Cancel + the policy footnote) flows directly under the policy
// note (proto-s12) — no dead band, no viewport pinning.
//
// The server-authored policy gates the actions. Within the window the artist
// can change the booking; too close means the unavailable actions stay hidden
// and the artist is directed to the producer. Terminal sessions hide actions.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Check, ClockIcon, CloseIcon } from "~/components/artist/funnel/funnel-icons";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { withArtistStudio } from "~/lib/artist-studio-context";

import {
  artistSessionDisplay,
  formatSessionDate,
  formatSessionTime,
  formatSessionTimeZoneLabel,
  formatStudioTimeLine,
  locationLabel,
  type SessionDetail,
} from "./book-data";
import { PolicyNotice } from "./policy-notice";
import { StatusPill } from "./status-pill";

export function SessionDetailScreen({ session }: { session: SessionDetail }) {
  const router = useRouter();
  const online = useOnlineStatus();
  const [liveError, setLiveError] = useState<string | null>(null);

  const isActive = session.status === "pending_approval" || session.status === "confirmed";
  const canChange = session.policy.canCancel || session.policy.canReschedule;

  const durationLabel = formatDuration(session.durationMin);
  const display = artistSessionDisplay({
    status: session.status,
    outcome: session.outcome,
    heldExpiryReason: session.heldExpiryReason,
  });
  const studioTime = formatStudioTimeLine(
    session.startsAtISO,
    session.artistTimezone,
    session.producerTimezone,
  );

  function reschedule() {
    if (!online) {
      setLiveError("Reconnect before rescheduling. Your current booking is unchanged.");
      return;
    }
    if (!session.policy.canReschedule) return;
    router.push(`/artist/sessions/${session.id}/reschedule`);
  }

  function openCancel() {
    if (!online) {
      setLiveError("Reconnect before canceling. Your session is still booked.");
      return;
    }
    if (!session.policy.canCancel) return;
    router.push(`/artist/sessions/${session.id}/cancel`);
  }

  return (
    <div
      className="mx-auto w-full max-w-[440px]"
      style={{ background: "rgb(var(--bg-background))" }}
    >
      <div className="relative flex w-full flex-col">
        <Link
          href={withArtistStudio("/artist/sessions", session.producerId)}
          className="sk-press mb-3 inline-flex min-h-11 w-fit items-center rounded-[var(--radius-lg)] px-2 text-sm font-semibold text-[rgb(var(--fg-secondary))]"
        >
          <span aria-hidden className="me-2">
            ←
          </span>
          Back to Sessions
        </Link>

        <div className="flex-1 px-5 pb-[max(env(safe-area-inset-bottom),20px)]">
          {/* hero summary — a DARK card (proto-s12): date/time large in white
              Syne, status pill, product + producer mini-row */}
          <div
            className="sk-rise rounded-card overflow-hidden px-[20px] pt-[18px] pb-5"
            style={{
              animationDelay: "40ms",
              background: "rgb(var(--bg-sidebar))",
              boxShadow:
                "0 22px 50px -24px rgb(17 16 9 / 0.55), inset 0 0 0 1px rgb(255 255 255 / 0.04)",
            }}
          >
            <div className="flex items-center justify-between">
              <StatusPill status={session.status} outcome={session.outcome} onDark />
              <span className="font-amount text-[10px] tracking-[0.16em] text-[rgb(255_255_255_/_0.45)] uppercase">
                {durationLabel} session
              </span>
            </div>

            {/* date + time — large in white Syne, time in font-amount */}
            <div className="font-syne mt-3 text-[30px] leading-[1.04] font-extrabold tracking-[-0.035em] text-white">
              {formatSessionDate(session.startsAtISO, session.artistTimezone)} at{" "}
              <span className="font-amount font-extrabold">
                {formatSessionTime(session.startsAtISO, session.artistTimezone)}
              </span>
            </div>
            <p className="mt-2 text-[11.5px] text-[rgb(255_255_255_/_0.55)]">
              {formatSessionTimeZoneLabel(session.startsAtISO, session.artistTimezone)}
            </p>
            {studioTime ? (
              <p className="mt-1 text-[11px] leading-snug text-[rgb(255_255_255_/_0.55)]">
                {studioTime}
              </p>
            ) : null}
            {display.secondary ? (
              <p className="mt-2 text-[11.5px] text-[rgb(255_255_255_/_0.55)]">
                {display.secondary}
              </p>
            ) : null}

            {/* product + producer mini-row */}
            <div
              className="mt-[18px] flex items-center gap-[13px] rounded-[12px] px-3.5 py-3"
              style={{ background: "rgb(255 255 255 / 0.06)" }}
            >
              <span
                className="font-syne flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-[12px] text-[14px] font-extrabold text-white"
                style={{
                  background:
                    "linear-gradient(140deg, rgb(var(--brand-primary)), rgb(var(--brand-copper)))",
                }}
              >
                {producerInitials(session.producerName)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14.5px] font-semibold text-white">
                  {session.packageName}
                </div>
                <div className="mt-px truncate text-[12px] text-[rgb(255_255_255_/_0.55)]">
                  with {session.producerName} · {locationLabel(session.locationType)}
                </div>
              </div>
            </div>
          </div>

          {!isActive ? (
            <div className="sk-rise mt-5 text-center" style={{ animationDelay: "100ms" }}>
              <p className="text-[13.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
                This booking is closed. Its outcome stays in your session history.
              </p>
            </div>
          ) : null}

          {/* within-policy → a calm GREEN note (you can change this yourself);
              too close → the muted PolicyNotice (message the producer) */}
          {isActive && canChange ? (
            <div
              className="sk-rise rounded-card mt-4 flex items-start gap-2.5 px-3.5 py-3"
              style={{
                animationDelay: "100ms",
                background: "rgb(var(--fg-success) / 0.08)",
                border: "1px solid rgb(var(--fg-success) / 0.22)",
              }}
            >
              <span
                className="mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full"
                style={{
                  background: "rgb(var(--fg-success) / 0.18)",
                  color: "rgb(var(--fg-success))",
                }}
              >
                <Check width={11} height={11} />
              </span>
              <p className="text-[12.5px] leading-snug text-[rgb(var(--fg-secondary))]">
                {session.status === "pending_approval"
                  ? `You can withdraw this held request until it begins. ${session.producerName} will be notified.`
                  : `You can change this yourself until the ${String(session.policy.cancellationPolicyHours)}h cutoff. ${session.producerName} will be notified.`}
              </p>
            </div>
          ) : null}
          {isActive && !canChange ? (
            <div className="sk-rise mt-4" style={{ animationDelay: "100ms" }}>
              <PolicyNotice producerName={session.producerName} />
            </div>
          ) : null}

          {liveError ? (
            <p
              role="alert"
              className="mt-4 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-danger)/0.08)] px-4 py-3 text-sm text-[rgb(var(--fg-danger-text))]"
            >
              {liveError}
            </p>
          ) : null}
          {!online ? (
            <p
              role="status"
              className="mt-4 rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sunken))] px-4 py-3 text-sm text-[rgb(var(--fg-secondary))]"
            >
              Reconnect to reschedule or cancel. Your current booking is unchanged.
            </p>
          ) : null}

          {/* action stack flows right under the policy note (proto-s12) —
              hidden once the session has passed */}
          {isActive && canChange ? (
            <div className="sk-rise mt-5 flex flex-col gap-2.5" style={{ animationDelay: "160ms" }}>
              {session.policy.canReschedule ? (
                <button
                  type="button"
                  onClick={reschedule}
                  disabled={!online}
                  className="sk-cta-press relative flex w-full items-center justify-center gap-[9px] overflow-hidden rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-[22px] py-4 text-[16px] font-semibold text-[rgb(var(--bg-sidebar))] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="relative z-[2] inline-flex items-center gap-[9px]">
                    <ClockIcon width={16} height={16} /> Reschedule
                  </span>
                </button>
              ) : null}

              {session.policy.canCancel ? (
                <button
                  type="button"
                  onClick={openCancel}
                  disabled={!online}
                  className="sk-press flex w-full items-center justify-center gap-[8px] rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.3)] bg-[rgb(var(--bg-elevated))] px-[22px] py-[15px] text-[15px] font-semibold text-[rgb(var(--fg-danger-text))] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <CloseIcon width={15} height={15} />{" "}
                  {session.status === "pending_approval" ? "Withdraw request" : "Cancel session"}
                </button>
              ) : null}

              <p className="px-1 pt-0.5 text-center text-[11px] leading-snug text-[rgb(var(--fg-muted))]">
                The time policy controls changes only. Refunds and deposits follow your signed
                agreement, off-app.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function producerInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

// "120" min → "2 hr"; "90" → "1 hr 30 min"; "45" → "45 min".
function formatDuration(min: number): string {
  const hrs = Math.floor(min / 60);
  const rest = min % 60;
  if (hrs === 0) return `${String(rest)} min`;
  if (rest === 0) return `${String(hrs)} hr`;
  return `${String(hrs)} hr ${String(rest)} min`;
}
