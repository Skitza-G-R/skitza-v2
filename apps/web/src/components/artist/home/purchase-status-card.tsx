import { Fragment } from "react";
import Link from "next/link";

import { ArrowRight, Check, ClockIcon, LockIcon } from "~/components/artist/funnel/funnel-icons";
import { formatShekels } from "~/components/artist/purchase/purchase-data";

import { ProducerArt } from "./producer-art";

// Purchase-status "heartbeat" card — the centerpiece of the artist home
// (S6, SK-50). Sits between the greeting and the Last Upload hero while
// the artist has an open purchase request: avatar + product + price,
// a breathing status pill, the 4-node REQUEST → PAY → SESSIONS →
// DELIVERED stepper, and a "what's next" line. Server component, plain
// props — the page does the fetching.
//
// `stage` is typed across all 5 handoff states, but only
// "pending_review" is reachable from /artist today (Gate 1 / BE-1).
// The rest are extension points for later backend slices.

export type PurchaseStage =
  | "pending_review" // Gate 1 — BE-1
  | "awaiting_payment" // BE-2 — status 'approved'
  | "verifying" // BE-2 — proof under Gate-2 review
  | "paid" // BE-2 — first payment confirmed, sessions unlocked
  | "declined" // Gate 1 declined — generic copy, never the reason
  | "delivered"; // BE-4

export type PurchaseStatusCardProps = {
  stage: PurchaseStage;
  productName: string;
  /** Price-locked snapshot, in agorot (₪1 = 100). */
  priceCents: number;
  producerName: string;
  /** Context CTA target (handoff S6): awaiting_payment → S7 plan chooser,
      paid → S10 booking. Omitted for stages without an action. */
  actionHref?: string | undefined;
  actionLabel?: string | undefined;
};

export type StepState = "done" | "active" | "upcoming";

export const STEP_LABELS = ["Request", "Pay", "Sessions", "Delivered"] as const;

// stage → the four stepper node states, in STEP_LABELS order.
export function stepStatesForStage(
  stage: PurchaseStage,
): [StepState, StepState, StepState, StepState] {
  switch (stage) {
    case "pending_review":
      return ["active", "upcoming", "upcoming", "upcoming"];
    case "awaiting_payment":
    case "verifying":
      return ["done", "active", "upcoming", "upcoming"];
    case "paid":
      return ["done", "done", "active", "upcoming"];
    case "declined":
      // journey never started — the first node renders the red "!" via
      // the declined flag in the component.
      return ["active", "upcoming", "upcoming", "upcoming"];
    case "delivered":
      return ["done", "done", "done", "done"];
  }
}

// stage → status pill copy + tone (amber while waiting, green once settled).
export function pillForStage(stage: PurchaseStage): {
  label: string;
  tone: "amber" | "success" | "neutral";
} {
  switch (stage) {
    case "pending_review":
      return { label: "Pending review", tone: "amber" };
    case "awaiting_payment":
      return { label: "Awaiting payment", tone: "amber" };
    case "verifying":
      return { label: "Verifying payment", tone: "amber" };
    case "paid":
      return { label: "Paid · sessions unlocked", tone: "success" };
    case "declined":
      return { label: "Couldn't be confirmed", tone: "neutral" };
    case "delivered":
      return { label: "Delivered", tone: "success" };
  }
}

// stage → the "What's next" line + mono sub-line.
export function whatsNextForStage(
  stage: PurchaseStage,
  producerName: string,
): { line: string; sub: string } {
  switch (stage) {
    case "pending_review":
      return {
        line: `Waiting for ${producerName} to review your request.`,
        sub: "Usually within 24 hours",
      };
    case "awaiting_payment":
      return {
        line: `${producerName} approved — payment details are ready.`,
        sub: "Pay to lock your sessions",
      };
    case "verifying":
      return {
        line: `${producerName} is confirming your payment.`,
        sub: "Usually within 24 hours",
      };
    case "paid":
      return {
        line: "You're booked — time to schedule your sessions.",
        sub: "Pick times that work for you",
      };
    case "declined":
      return {
        line: "This request couldn't be confirmed. You're free to explore other offers.",
        sub: "Browse the store any time",
      };
    case "delivered":
      return {
        line: "All wrapped — your songs are delivered.",
        sub: "Find them in your library",
      };
  }
}

export function PurchaseStatusCard({
  stage,
  productName,
  priceCents,
  producerName,
  actionHref,
  actionLabel,
}: PurchaseStatusCardProps) {
  const pill = pillForStage(stage);
  const steps = stepStatesForStage(stage);
  const next = whatsNextForStage(stage, producerName);
  const declined = stage === "declined";
  const pillColors =
    pill.tone === "amber"
      ? {
          background: "rgb(var(--brand-primary) / 0.14)",
          color: "rgb(var(--brand-primary-dark))",
          dot: "rgb(var(--fg-warning))",
        }
      : pill.tone === "success"
        ? {
            background: "rgb(var(--fg-success) / 0.12)",
            color: "rgb(var(--fg-success))",
            dot: "rgb(var(--fg-success))",
          }
        : {
            background: "rgb(var(--bg-sunken))",
            color: "rgb(var(--fg-muted))",
            dot: "rgb(var(--fg-faint))",
          };

  return (
    <section aria-label="Your booking">
      {/* eyebrow — 18×1px rule + mono amber label */}
      <div className="flex items-center gap-[9px] pb-2.5">
        <span
          aria-hidden
          className="h-px w-[18px]"
          style={{ background: "rgb(var(--brand-primary-dark) / 0.55)" }}
        />
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--brand-primary-dark))]">
          Your booking
        </span>
      </div>

      <article
        className="overflow-hidden rounded-card border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
        style={{ boxShadow: "var(--shadow-sm), 0 14px 34px -22px rgb(17 16 9 / 0.25)" }}
      >
        {/* booking row */}
        <div className="flex items-center gap-[13px] px-[18px] pt-[17px]">
          <ProducerArt
            producerName={producerName}
            size={46}
            initialsFontSize={13}
          />
          <div className="min-w-0 flex-1">
            <h3
              className="line-clamp-2 text-[17px] font-extrabold leading-tight text-[rgb(var(--fg-default))]"
              style={{ fontFamily: "var(--font-syne)", letterSpacing: "-0.025em" }}
            >
              {productName}
            </h3>
            <p className="mt-0.5 truncate text-[12.5px] text-[rgb(var(--fg-muted))]">
              with {producerName} ·{" "}
              <span className="font-amount font-semibold text-[rgb(var(--fg-default))]">
                {formatShekels(priceCents)}
              </span>
            </p>
          </div>
        </div>

        {/* status pill — breathing dot while the request is in flight */}
        <div className="px-[18px] pt-3">
          <span
            className="inline-flex items-center gap-[6px] rounded-full px-[11px] py-[4px] text-[11.5px] font-semibold"
            style={{ background: pillColors.background, color: pillColors.color }}
          >
            <span
              aria-hidden
              className={
                pill.tone === "amber"
                  ? "sk-breathe h-[6px] w-[6px] shrink-0 rounded-full"
                  : "h-[6px] w-[6px] shrink-0 rounded-full"
              }
              style={{ background: pillColors.dot }}
            />
            {pill.label}
          </span>
        </div>

        {/* 4-node stepper */}
        <div className="px-[18px] pb-4 pt-4">
          <ol
            aria-label="Booking progress"
            className="flex items-start"
          >
            {STEP_LABELS.map((label, i) => {
              const state = steps[i] ?? "upcoming";
              return (
                <Fragment key={label}>
                  {i > 0 ? (
                    <span
                      aria-hidden
                      className="mt-[10px] h-px min-w-3 flex-1"
                      style={{
                        background:
                          steps[i - 1] === "done"
                            ? "rgb(var(--fg-success) / 0.45)"
                            : "rgb(var(--fg-default) / 0.12)",
                      }}
                    />
                  ) : null}
                  <li className="flex shrink-0 flex-col items-center gap-1.5">
                    <StepNode state={state} declined={declined && i === 0} />
                    <span
                      className="font-mono text-[9px] uppercase tracking-[0.1em]"
                      style={{
                        color:
                          state === "upcoming"
                            ? "rgb(var(--fg-muted))"
                            : "rgb(var(--fg-default))",
                        fontWeight: state === "active" ? 700 : 500,
                      }}
                    >
                      {label}
                    </span>
                  </li>
                </Fragment>
              );
            })}
          </ol>
        </div>

        {/* what's next */}
        <div className="border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-[18px] pb-4 pt-3.5">
          <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
            {"What's next"}
          </div>
          <p className="mt-1.5 text-pretty text-[14.5px] font-semibold leading-snug text-[rgb(var(--fg-default))]">
            {next.line}
          </p>
          <div className="mt-2 flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.02em] text-[rgb(var(--brand-primary-dark))]">
            <ClockIcon />
            <span>{next.sub}</span>
          </div>
          {actionHref && actionLabel ? (
            <Link
              href={actionHref}
              className="sk-cta-press mt-3 flex w-full items-center justify-center gap-2 rounded-[var(--radius-lg)] px-4 py-3 text-[14.5px] font-bold"
              style={{
                background: "rgb(var(--brand-primary))",
                color: "rgb(var(--fg-on-brand))",
                boxShadow:
                  "0 0 0 4px rgb(var(--brand-primary) / 0.16), 0 14px 30px -10px rgb(var(--brand-primary) / 0.7)",
              }}
            >
              {actionLabel} <ArrowRight />
            </Link>
          ) : null}
        </div>
      </article>

      {/* business rule: no second purchase while one is open. Terminal
          states (paid/declined) free the slot — no lock line. */}
      {stage !== "paid" && stage !== "declined" && stage !== "delivered" ? (
        <p className="mt-2.5 flex items-center justify-center gap-1.5 text-[11.5px] text-[rgb(var(--fg-muted))]">
          <LockIcon />
          <span>One booking at a time — yours is in review.</span>
        </p>
      ) : null}
    </section>
  );
}

// One stepper node. done = solid green check, active = amber ring +
// breathing-pulse halo, upcoming = hollow circle with a faint dot,
// declined (first node only) = red "!" badge.
function StepNode({ state, declined = false }: { state: StepState; declined?: boolean }) {
  if (declined) {
    return (
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full text-[12px] font-bold leading-none"
        style={{
          background: "rgb(var(--fg-danger) / 0.12)",
          color: "rgb(var(--fg-danger))",
          border: "1.5px solid rgb(var(--fg-danger) / 0.4)",
        }}
      >
        !
      </span>
    );
  }
  if (state === "done") {
    return (
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full"
        style={{
          background: "rgb(var(--fg-success))",
          color: "rgb(255 255 255)",
        }}
      >
        <Check width={11} height={11} />
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="relative flex h-5 w-5 items-center justify-center">
        <span
          aria-hidden
          className="sk-pulse absolute inset-0 rounded-full"
          style={{ color: "rgb(var(--brand-primary) / 0.45)" }}
        />
        <span
          className="relative flex h-5 w-5 items-center justify-center rounded-full"
          style={{
            background: "rgb(var(--bg-elevated))",
            border: "2px solid rgb(var(--brand-primary))",
          }}
        >
          <span
            className="h-[7px] w-[7px] rounded-full"
            style={{ background: "rgb(var(--brand-primary))" }}
          />
        </span>
      </span>
    );
  }
  return (
    <span
      className="flex h-5 w-5 items-center justify-center rounded-full"
      style={{
        background: "rgb(var(--bg-elevated))",
        border: "1.5px solid rgb(17 16 9 / 0.16)",
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: "rgb(17 16 9 / 0.18)" }}
      />
    </span>
  );
}
