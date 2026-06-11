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
// The cancel/reschedule TIME-POLICY gates the ACTIONS only, not money. We
// read the live clock once at render and inject it into the pure
// `cancelPolicy` helper (it never reads the clock itself — deterministic in
// tests). Within the window → buttons live; too close → both disabled and a
// calm PolicyNotice appears. A done/past session hides the actions entirely.
//
// Cancel is a STUB (no real mutation yet): confirming opens the inline
// RescheduleConfirmSheet which mirrors the producer cancel-session-modal
// "coming soon" pattern. BE-3 (SK-39) swaps the stub for the real call —
// these screens don't change.

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  Check,
  ClockIcon,
  CloseIcon,
} from "~/components/artist/funnel/funnel-icons";
import { FunnelTopBar } from "~/components/artist/funnel/funnel-ui";

import {
  cancelPolicy,
  formatSessionDate,
  formatSessionTime,
  type Producer,
  type SessionDetail,
  swatchGradient,
} from "./book-data";
import { PolicyNotice } from "./policy-notice";
import { RescheduleConfirmSheet } from "./reschedule-confirm-sheet";
import { StatusPill } from "./status-pill";

export function SessionDetailScreen({
  session,
  producer,
  cancelWindowHours,
}: {
  session: SessionDetail;
  producer: Producer;
  cancelWindowHours: number;
}) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPast = session.status === "done";

  // Read the live clock once at render and inject it — the helper stays pure.
  const nowMs = Date.now();
  const policy = cancelPolicy(
    session.startsAtMs,
    cancelWindowHours,
    nowMs,
    producer.name,
  );

  const durationLabel = formatDuration(session.durationMin);

  function reschedule() {
    if (!policy.withinPolicy) return;
    setError(null);
    // Carry the session id into the slot picker so it can rebind the booking.
    router.push(`/artist/book?session=${session.id}`);
  }

  function openCancel() {
    if (!policy.withinPolicy) return;
    setError(null);
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
          sub={isPast ? "PAST SESSION" : "YOUR BOOKING"}
          onBack={() => {
            router.push("/artist/sessions");
          }}
        />

        <div className="flex-1 px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-4">
          {/* hero summary — a DARK card (proto-s12): date/time large in white
              Syne, status pill, product + producer mini-row */}
          <div
            className="sk-rise overflow-hidden rounded-card px-[20px] pb-5 pt-[18px]"
            style={{
              animationDelay: "40ms",
              background: "rgb(var(--bg-sidebar))",
              boxShadow:
                "0 22px 50px -24px rgb(17 16 9 / 0.55), inset 0 0 0 1px rgb(255 255 255 / 0.04)",
            }}
          >
            <div className="flex items-center justify-between">
              <StatusPill status={session.status} onDark />
              <span className="font-amount text-[10px] uppercase tracking-[0.16em] text-[rgb(255_255_255_/_0.45)]">
                {durationLabel} session
              </span>
            </div>

            {/* date + time — large in white Syne, time in font-amount */}
            <div className="mt-3 font-syne text-[30px] font-extrabold leading-[1.04] tracking-[-0.035em] text-white">
              {formatSessionDate(session.startsAtISO)} at{" "}
              <span className="font-amount font-extrabold">
                {formatSessionTime(session.startsAtISO)}
              </span>
            </div>

            {/* product + producer mini-row */}
            <div
              className="mt-[18px] flex items-center gap-[13px] rounded-[12px] px-3.5 py-3"
              style={{ background: "rgb(255 255 255 / 0.06)" }}
            >
              <span
                className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-[12px] font-syne text-[14px] font-extrabold text-white"
                style={{ background: swatchGradient(producer.hue) }}
              >
                {producer.initials}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14.5px] font-semibold text-white">
                  {session.productName}
                </div>
                <div className="mt-px truncate text-[12px] text-[rgb(255_255_255_/_0.55)]">
                  with {producer.name}
                </div>
              </div>
            </div>
          </div>

          {isPast ? (
            <div
              className="sk-rise mt-5 text-center"
              style={{ animationDelay: "100ms" }}
            >
              <p className="text-[13.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
                This session has passed.
              </p>
            </div>
          ) : null}

          {/* within-policy → a calm GREEN note (you can change this yourself);
              too close → the muted PolicyNotice (message the producer) */}
          {!isPast && policy.withinPolicy ? (
            <div
              className="sk-rise mt-4 flex items-start gap-2.5 rounded-card px-3.5 py-3"
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
                You can change this yourself up to {cancelWindowHours}h before.{" "}
                {producer.name} will be notified.
              </p>
            </div>
          ) : null}
          {!isPast && !policy.withinPolicy ? (
            <div className="sk-rise mt-4" style={{ animationDelay: "100ms" }}>
              <PolicyNotice producerName={producer.name} />
            </div>
          ) : null}

          {/* action stack flows right under the policy note (proto-s12) —
              hidden once the session has passed */}
          {!isPast ? (
            <div
              className="sk-rise mt-5 flex flex-col gap-2.5"
              style={{ animationDelay: "160ms" }}
            >
              {error ? (
                <p
                  className="rounded-[12px] px-3.5 py-2.5 text-center text-[12.5px] font-medium"
                  style={{
                    background: "rgb(var(--fg-danger) / 0.1)",
                    color: "rgb(var(--fg-danger))",
                  }}
                  role="alert"
                >
                  {error}
                </p>
              ) : null}

              {/* amber Reschedule (proto-s12 primary action) */}
              <button
                type="button"
                onClick={reschedule}
                disabled={!policy.withinPolicy}
                className={`relative flex w-full items-center justify-center gap-[9px] overflow-hidden rounded-card px-[22px] py-4 text-[16px] font-semibold ${
                  !policy.withinPolicy ? "cursor-not-allowed" : "sk-cta-press sk-gloss"
                }`}
                style={
                  !policy.withinPolicy
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
                disabled={!policy.withinPolicy}
                className={`flex w-full items-center justify-center gap-[8px] rounded-card px-[22px] py-[15px] text-[15px] font-semibold ${
                  !policy.withinPolicy ? "cursor-not-allowed" : "sk-press"
                }`}
                style={{
                  background: "rgb(var(--bg-elevated))",
                  color: !policy.withinPolicy
                    ? "rgb(var(--fg-muted) / 0.7)"
                    : "rgb(var(--fg-danger))",
                  border: `1px solid ${
                    !policy.withinPolicy
                      ? "rgb(var(--border-strong))"
                      : "rgb(var(--fg-danger) / 0.30)"
                  }`,
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <CloseIcon width={15} height={15} /> Cancel session
              </button>

              <p className="px-1 pt-0.5 text-center text-[11px] leading-snug text-[rgb(var(--fg-muted))]">
                The time policy controls changes only. Refunds and deposits follow
                your signed agreement, off-app.
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {sheetOpen ? (
        <RescheduleConfirmSheet
          producerName={producer.name}
          onClose={() => {
            setSheetOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

// "120" min → "2 hr"; "90" → "1 hr 30 min"; "45" → "45 min".
function formatDuration(min: number): string {
  const hrs = Math.floor(min / 60);
  const rest = min % 60;
  if (hrs === 0) return `${String(rest)} min`;
  if (rest === 0) return `${String(hrs)} hr`;
  return `${String(hrs)} hr ${String(rest)} min`;
}
