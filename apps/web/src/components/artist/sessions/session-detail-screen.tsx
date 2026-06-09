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
// pins low and thumb-reachable: Reschedule (secondary) + Cancel (primary).
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

import { ArrowRight } from "~/components/artist/funnel/funnel-icons";
import { FunnelTopBar, PrimaryCta } from "~/components/artist/funnel/funnel-ui";

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

        <div className="flex-1 px-5 pb-[176px] pt-4">
          {/* hero summary card */}
          <div
            className="reveal-up overflow-hidden rounded-[var(--radius-xl)]"
            style={{
              background: "rgb(var(--bg-elevated))",
              border: "1px solid rgb(var(--border-subtle))",
              boxShadow: "var(--shadow-sm), 0 18px 44px -24px rgb(17 16 9 / 0.28)",
            }}
          >
            <div
              className="h-1"
              style={{
                background:
                  "linear-gradient(90deg, rgb(var(--brand-primary)), rgb(var(--brand-copper)))",
              }}
            />

            <div className="px-[20px] pb-5 pt-[18px]">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[rgb(var(--brand-primary-dark))]">
                  {formatSessionDate(session.startsAtISO)}
                </span>
                <StatusPill status={session.status} />
              </div>

              {/* date + time — large in Syne */}
              <div className="mt-2.5 font-syne text-[34px] font-extrabold leading-[1.02] tracking-[-0.04em] text-[rgb(var(--fg-default))]">
                {formatSessionTime(session.startsAtISO)}
              </div>
              <div className="mt-1 text-[13px] text-[rgb(var(--fg-muted))]">
                {durationLabel} session
              </div>

              {/* product + producer mini-row */}
              <div
                className="mt-[18px] flex items-center gap-[13px] rounded-[var(--radius-lg)] px-3.5 py-3"
                style={{ background: "rgb(var(--bg-sunken))" }}
              >
                <span
                  className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-[12px] font-syne text-[14px] font-extrabold text-white"
                  style={{ background: swatchGradient(producer.hue) }}
                >
                  {producer.initials}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14.5px] font-semibold text-[rgb(var(--fg-default))]">
                    {session.productName}
                  </div>
                  <div className="mt-px truncate text-[12px] text-[rgb(var(--fg-muted))]">
                    with {producer.name}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {isPast ? (
            <div className="reveal-up reveal-up-delay-1 mt-5 text-center">
              <p className="text-[13.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
                This session has passed.
              </p>
            </div>
          ) : null}

          {/* policy notice — only when too close to change it yourself */}
          {!isPast && !policy.withinPolicy ? (
            <div className="reveal-up reveal-up-delay-1 mt-4">
              <PolicyNotice producerName={producer.name} />
            </div>
          ) : null}
        </div>

        {/* pinned-low action stack — hidden once the session has passed */}
        {!isPast ? (
          <div
            className="sk-safe-bottom sticky bottom-0 z-10 flex flex-col gap-2.5 px-[18px] pb-3.5 pt-3.5"
            style={{
              background:
                "linear-gradient(180deg, rgb(var(--bg-background) / 0) 0%, rgb(var(--bg-background) / 0.96) 22%)",
            }}
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

            <button
              type="button"
              onClick={reschedule}
              disabled={!policy.withinPolicy}
              className={`sk-press flex w-full items-center justify-center gap-[9px] rounded-[var(--radius-lg)] px-[22px] py-[15px] text-[15px] font-semibold ${
                !policy.withinPolicy ? "cursor-not-allowed" : ""
              }`}
              style={{
                background: "rgb(var(--bg-elevated))",
                color: !policy.withinPolicy
                  ? "rgb(var(--fg-muted) / 0.7)"
                  : "rgb(var(--fg-default))",
                border: "1px solid rgb(var(--border-strong))",
                boxShadow: "var(--shadow-sm)",
              }}
            >
              Reschedule <ArrowRight />
            </button>

            <PrimaryCta
              onClick={openCancel}
              disabled={!policy.withinPolicy}
              glow={false}
              sub={
                policy.withinPolicy
                  ? "Frees the slot · notifies " + producer.name
                  : "Too close — message " + producer.name + " instead"
              }
            >
              Cancel session
            </PrimaryCta>
          </div>
        ) : null}
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
