"use client";

// S12 — Session detail + cancel / reschedule (artist Book section).
//
// A funnel OVERLAY (like review-agree-screen): fixed inset-0, a FunnelTopBar
// titled "Session" whose back arrow returns to /artist/sessions, no bottom
// tab bar. Closes SK-13 (no artist session detail) + SK-14 (reschedule
// missing).
//
// The hero card states the booking plainly (date + time large in Syne,
// duration, the product + producer mini-row, a StatusPill). The action stack
// (Reschedule + Cancel + the policy footnote) flows directly under the policy
// note (proto-s12) — no dead band, no viewport pinning.
//
// The server-authored policy gates the actions. Within the window the artist
// can change the booking; too close means both actions stay disabled and the
// artist is directed to the producer. Terminal sessions hide actions.

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Check, ClockIcon, CloseIcon } from "~/components/artist/funnel/funnel-icons";
import { FunnelTopBar } from "~/components/artist/funnel/funnel-ui";

import {
  formatSessionDate,
  formatSessionTime,
  locationLabel,
  type SessionDetail,
} from "./book-data";
import { PolicyNotice } from "./policy-notice";
import { RescheduleConfirmSheet } from "./reschedule-confirm-sheet";
import { StatusPill } from "./status-pill";

export function SessionDetailScreen({ session }: { session: SessionDetail }) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);

  const isActive = session.status === "pending_approval" || session.status === "confirmed";
  const canChange = session.policy.canCancel || session.policy.canReschedule;

  const durationLabel = formatDuration(session.durationMin);

  function reschedule() {
    if (!session.policy.canReschedule) return;
    const params = new URLSearchParams({
      session: session.id,
      studio: session.producerId,
      project: session.projectId,
      allowance: session.sessionAllowanceId,
    });
    router.push(`/artist/book?${params.toString()}`);
  }

  function openCancel() {
    if (!session.policy.canCancel) return;
    setSheetOpen(true);
  }

  return (
    <div
      className="fixed inset-0 z-[60] overflow-y-auto"
      style={{ background: "rgb(var(--bg-background))" }}
    >
      <div className="relative mx-auto flex min-h-dvh w-full max-w-[440px] flex-col">
        <FunnelTopBar
          title="Session"
          sub={isActive ? "YOUR BOOKING" : "SESSION HISTORY"}
          onBack={() => {
            router.push("/artist/sessions");
          }}
        />

        <div className="flex-1 px-5 pt-4 pb-[max(env(safe-area-inset-bottom),20px)]">
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
              {formatSessionDate(session.startsAtISO, session.producerTimezone)} at{" "}
              <span className="font-amount font-extrabold">
                {formatSessionTime(session.startsAtISO, session.producerTimezone)}
              </span>
            </div>

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
                You can change this yourself up to {session.policy.cancellationPolicyHours}h before.{" "}
                {session.producerName} will be notified.
              </p>
            </div>
          ) : null}
          {isActive && !canChange ? (
            <div className="sk-rise mt-4" style={{ animationDelay: "100ms" }}>
              <PolicyNotice producerName={session.producerName} />
            </div>
          ) : null}

          {/* action stack flows right under the policy note (proto-s12) —
              hidden once the session has passed */}
          {isActive ? (
            <div className="sk-rise mt-5 flex flex-col gap-2.5" style={{ animationDelay: "160ms" }}>
              {/* amber Reschedule (proto-s12 primary action) */}
              <button
                type="button"
                onClick={reschedule}
                disabled={!session.policy.canReschedule}
                className={`relative flex w-full items-center justify-center gap-[9px] overflow-hidden rounded-[var(--radius-lg)] px-[22px] py-4 text-[16px] font-semibold ${
                  !session.policy.canReschedule ? "cursor-not-allowed" : "sk-cta-press sk-gloss"
                }`}
                style={
                  !session.policy.canReschedule
                    ? {
                        background: "rgb(var(--fg-default) / 0.07)",
                        color: "rgb(var(--fg-muted) / 0.8)",
                      }
                    : {
                        background:
                          "linear-gradient(180deg, rgb(var(--brand-primary)) 0%, rgb(var(--brand-primary-dark)) 130%)",
                        color: "rgb(var(--bg-sidebar))",
                        boxShadow: "0 6px 18px -8px rgb(var(--brand-primary) / 0.40)",
                      }
                }
              >
                <span className="relative z-[2] inline-flex items-center gap-[9px]">
                  <ClockIcon width={16} height={16} /> Reschedule
                </span>
              </button>

              {/* outlined Cancel — red text, hairline border (destructive but quiet) */}
              <button
                type="button"
                onClick={openCancel}
                disabled={!session.policy.canCancel}
                className={`flex w-full items-center justify-center gap-[8px] rounded-[var(--radius-lg)] px-[22px] py-[15px] text-[15px] font-semibold ${
                  !session.policy.canCancel ? "cursor-not-allowed" : "sk-press"
                }`}
                style={{
                  background: "rgb(var(--bg-elevated))",
                  color: !session.policy.canCancel
                    ? "rgb(var(--fg-muted) / 0.7)"
                    : "rgb(var(--fg-danger))",
                  border: `1px solid ${
                    !session.policy.canCancel
                      ? "rgb(var(--border-strong))"
                      : "rgb(var(--fg-danger) / 0.30)"
                  }`,
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <CloseIcon width={15} height={15} /> Cancel session
              </button>

              <p className="px-1 pt-0.5 text-center text-[11px] leading-snug text-[rgb(var(--fg-muted))]">
                The time policy controls changes only. Refunds and deposits follow your signed
                agreement, off-app.
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {sheetOpen ? (
        <RescheduleConfirmSheet
          sessionId={session.id}
          producerName={session.producerName}
          onClose={() => {
            setSheetOpen(false);
          }}
          onCancelled={() => {
            router.push("/artist/sessions");
            router.refresh();
          }}
        />
      ) : null}
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
