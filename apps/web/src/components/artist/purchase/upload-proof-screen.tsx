"use client";

// S9 — Upload proof of payment (artist purchase funnel · Pay).
//
// v1 payment is OFF-APP: after the producer approves and the artist pays by
// bank transfer / Bit, they upload a screenshot or PDF of the transfer here.
// The producer then verifies it (Gate 2). Installments are allowed, so this
// screen lists every previous proof and a running "Paid so far" total.
//
// The send is a STUB — there is NO real file upload here. BE-2 (SK-38)
// provides the proof-upload + Gate-2 procedures; swap the timed stub in
// `send()` for that mutation and the screen props don't change.
//
// Funnel chrome: full-screen overlay, back arrow top-left, no tab bar, the
// primary action pinned low and thumb-reachable.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  ArrowRight,
  Check,
  ClockIcon,
  DocIcon,
} from "~/components/artist/funnel/funnel-icons";
import {
  Eyebrow,
  FunnelTopBar,
  PrimaryCta,
} from "~/components/artist/funnel/funnel-ui";
import {
  formatShekels,
  paidProgress,
  type Producer,
  type ProofStatus,
  proofStatusCopy,
  type PurchaseProduct,
} from "./pay-data";

type PriorProof = { id: string; amountCents: number; status: ProofStatus };

// Tone → chip colours. Pending = warning amber, success = green, danger =
// red, neutral = sunken. Keeps the status pill consistent with the rest of
// the funnel (design system §components · Status pill).
function chipStyle(tone: "neutral" | "pending" | "danger" | "success") {
  switch (tone) {
    case "success":
      return {
        background: "rgb(var(--fg-success) / 0.14)",
        color: "rgb(var(--fg-success))",
      };
    case "danger":
      return {
        background: "rgb(var(--fg-danger) / 0.12)",
        color: "rgb(var(--fg-danger))",
      };
    case "pending":
      return {
        background: "rgb(var(--brand-primary) / 0.16)",
        color: "rgb(var(--brand-primary-dark))",
      };
    default:
      return {
        background: "rgb(var(--bg-sunken))",
        color: "rgb(var(--fg-muted))",
      };
  }
}

// Inline upload glyph — kept local so the shared icon set stays untouched.
function UploadGlyph() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 16V4m0 0L7 9m5-5l5 5" />
      <path d="M4 16v2.5A1.5 1.5 0 005.5 20h13a1.5 1.5 0 001.5-1.5V16" />
    </svg>
  );
}

export function UploadProofScreen({
  product,
  producer,
  proofs,
  paidCents,
  totalCents,
  thisProofCents,
  status: initialStatus = "empty",
  rejectionNote,
}: {
  product: PurchaseProduct;
  producer: Producer;
  /** Previously sent proofs (installments) — newest last. */
  proofs: PriorProof[];
  /** Sum of all verified proofs so far, in agorot. */
  paidCents: number;
  /** Full price for this booking, in agorot. */
  totalCents: number;
  /** What THIS proof is expected to cover (the amount due now). */
  thisProofCents: number;
  /** Server-side starting state — drives the rejected / paid banners. */
  status?: ProofStatus;
  /** Producer's optional note shown when a prior proof was rejected. */
  rejectionNote?: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<ProofStatus>(initialStatus);

  const progress = paidProgress(paidCents, totalCents);
  const isUploading = status === "uploading";
  const isAwaiting = status === "awaiting";
  const isRejected = status === "rejected";
  const isPaidInFull = status === "paid" || progress.isPaidInFull;
  // Send is locked until a file is attached (and never while a send is in
  // flight or the booking is already paid in full).
  const canSend = !!file && !isUploading && !isAwaiting && !isPaidInFull;

  function pickFile() {
    fileRef.current?.click();
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    setFile(picked);
    if (picked) setStatus("attached");
  }

  function send() {
    if (!canSend) return;
    setStatus("uploading");
    // STUB: BE-2's proof upload + Gate-2 submit lands here. We fake the
    // round-trip with a timer, then settle on "awaiting verification".
    setTimeout(() => {
      setStatus("awaiting");
    }, 1100);
  }

  function reUpload() {
    setFile(null);
    setStatus("empty");
    // open the picker so re-uploading is one tap from the rejected banner
    fileRef.current?.click();
  }

  const headline = proofStatusCopy(status, producer.name);

  return (
    <div
      className="fixed inset-0 z-[60] overflow-y-auto"
      style={{ background: "rgb(var(--bg-background))" }}
    >
      <div className="relative mx-auto flex min-h-dvh w-full max-w-[440px] flex-col">
        <FunnelTopBar
          title="Upload proof"
          sub={isPaidInFull ? "PROOF OF PAYMENT" : `OF ${formatShekels(thisProofCents)}`}
          onBack={() => {
            router.back();
          }}
        />

        <div className="flex-1 px-5 pb-[184px] pt-3.5">
          {/* heading — sized to hold one line at 390px */}
          <h1 className="reveal-up font-syne text-[23px] font-extrabold leading-[1.1] tracking-[-0.035em] text-[rgb(var(--fg-default))]">
            {isPaidInFull ? "All paid up" : "Upload your proof"}
          </h1>
          <p className="reveal-up reveal-up-delay-1 mt-2 text-pretty text-[14px] leading-relaxed text-[rgb(var(--fg-muted))]">
            {isPaidInFull
              ? `${producer.name} confirmed every payment — your sessions are unlocked.`
              : `Add a screenshot or PDF of your transfer. ${producer.name} checks it and unlocks your sessions.`}
          </p>

          {/* paid-in-full banner (green) — the happy end of the Pay step */}
          {isPaidInFull ? (
            <div
              className="reveal-up reveal-up-delay-1 rounded-card mt-4 flex items-center gap-3 px-4 py-3.5"
              style={{
                background: "rgb(var(--fg-success) / 0.12)",
                border: "1px solid rgb(var(--fg-success) / 0.3)",
              }}
            >
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                style={{
                  background: "rgb(var(--fg-success))",
                  color: "rgb(var(--bg-elevated))",
                }}
              >
                <Check width={16} height={16} />
              </span>
              <span className="text-[14px] font-semibold text-[rgb(var(--fg-success))]">
                Payment complete — sessions unlocked
              </span>
            </div>
          ) : null}

          {/* rejected banner (red) — producer note + re-upload affordance */}
          {isRejected && !isPaidInFull ? (
            <div
              role="alert"
              className="reveal-up reveal-up-delay-1 rounded-card mt-4 px-4 py-3.5"
              style={{
                background: "rgb(var(--fg-danger) / 0.08)",
                border: "1px solid rgb(var(--fg-danger) / 0.28)",
              }}
            >
              <div className="text-[14px] font-semibold text-[rgb(var(--fg-danger))]">
                Proof needs re-uploading
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-[rgb(var(--fg-secondary))]">
                {rejectionNote
                  ? `${producer.name}: “${rejectionNote}”`
                  : `${producer.name} couldn't confirm the last screenshot. Send a clearer one — there's no limit on tries.`}
              </p>
              <button
                type="button"
                onClick={reUpload}
                className="sk-press mt-3 inline-flex items-center gap-2 rounded-[12px] px-3.5 py-2 text-[13px] font-semibold"
                style={{
                  background: "rgb(var(--fg-danger))",
                  color: "rgb(var(--bg-elevated))",
                }}
              >
                Re-upload proof <ArrowRight width={15} height={15} />
              </button>
            </div>
          ) : null}

          {/* the amount THIS proof covers */}
          {!isPaidInFull ? (
            <div
              className="reveal-up reveal-up-delay-2 rounded-card mt-4 flex items-center justify-between px-4 py-3.5"
              style={{ background: "rgb(var(--bg-sidebar))", color: "rgb(var(--fg-inverse))" }}
            >
              <div className="min-w-0">
                <div className="text-[12.5px] text-white/70">{product.name}</div>
                <div className="mt-px font-mono text-[9px] uppercase tracking-[0.12em] text-white/50">
                  This proof covers
                </div>
              </div>
              <div className="font-amount text-[22px] font-bold tracking-[-0.03em] text-[rgb(var(--brand-primary))]">
                {formatShekels(thisProofCents)}
              </div>
            </div>
          ) : null}

          {/* upload tile — a real <input> styled as a big tap target */}
          {!isPaidInFull ? (
            <div className="reveal-up reveal-up-delay-2 mt-4">
              <input
                ref={fileRef}
                type="file"
                accept="image/*,.heic,.pdf"
                capture="environment"
                onChange={onFileChange}
                className="sr-only"
                aria-label="Choose a screenshot or PDF of your transfer"
              />
              <button
                type="button"
                onClick={pickFile}
                disabled={isUploading || isAwaiting}
                className="sk-press rounded-card flex w-full flex-col items-center justify-center gap-2 px-5 py-7 text-center"
                style={{
                  background: "rgb(var(--bg-elevated))",
                  border: file
                    ? "1.5px solid rgb(var(--brand-primary))"
                    : "1.5px dashed rgb(var(--border-strong))",
                  color: "rgb(var(--fg-default))",
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                {file ? (
                  <>
                    <span
                      className="flex h-11 w-11 items-center justify-center rounded-[12px]"
                      style={{
                        background: "rgb(var(--brand-primary) / 0.14)",
                        color: "rgb(var(--brand-primary-dark))",
                      }}
                    >
                      <DocIcon width={22} height={22} />
                    </span>
                    <span className="max-w-[260px] truncate text-[14px] font-semibold">
                      {file.name}
                    </span>
                    <span className="font-mono text-[10.5px] tracking-[0.04em] text-[rgb(var(--fg-muted))]">
                      Tap to choose a different file
                    </span>
                  </>
                ) : (
                  <>
                    <span
                      className="flex h-12 w-12 items-center justify-center rounded-full"
                      style={{
                        background: "rgb(var(--brand-primary) / 0.14)",
                        color: "rgb(var(--brand-primary-dark))",
                      }}
                    >
                      <UploadGlyph />
                    </span>
                    <span className="text-[15px] font-semibold">
                      Take a photo or choose a file
                    </span>
                    <span className="font-mono text-[10.5px] tracking-[0.04em] text-[rgb(var(--fg-muted))]">
                      JPG · PNG · HEIC · PDF
                    </span>
                  </>
                )}
              </button>

              {/* live status line under the tile */}
              <div
                className="mt-2.5 flex items-center justify-center gap-1.5 text-[12px] font-medium"
                style={{ color: `rgb(var(--${
                  headline.tone === "danger"
                    ? "fg-danger"
                    : headline.tone === "success"
                      ? "fg-success"
                      : headline.tone === "pending"
                        ? "brand-primary-dark"
                        : "fg-muted"
                }))` }}
              >
                {isUploading ? (
                  <span
                    className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2"
                    style={{
                      borderColor: "rgb(var(--brand-primary-dark) / 0.3)",
                      borderTopColor: "rgb(var(--brand-primary-dark))",
                    }}
                  />
                ) : isAwaiting ? (
                  <ClockIcon />
                ) : null}
                <span>{headline.headline}</span>
              </div>

              {/* installments hint (proto-s9) */}
              <p className="mt-1.5 text-center text-[11.5px] leading-snug text-[rgb(var(--fg-muted))]">
                Paying in installments? Upload one each time.
              </p>
            </div>
          ) : null}

          {/* previous proofs (installments) */}
          {proofs.length > 0 ? (
            <div className="reveal-up reveal-up-delay-3 mt-[18px]">
              <Eyebrow className="mb-[9px]">
                <DocIcon />
                Proofs you&apos;ve sent
              </Eyebrow>
              <div className="flex flex-col gap-2">
                {proofs.map((proof, i) => {
                  const copy = proofStatusCopy(proof.status, producer.name);
                  return (
                    <div
                      key={proof.id}
                      className="sk-rise rounded-card flex items-center gap-3 px-4 py-3"
                      style={{
                        animationDelay: `${String(60 + i * 60)}ms`,
                        background: "rgb(var(--bg-elevated))",
                        border: "1px solid rgb(var(--border-subtle))",
                        boxShadow: "var(--shadow-sm)",
                      }}
                    >
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
                        style={{
                          background: "rgb(var(--bg-sunken))",
                          color: "rgb(var(--fg-muted))",
                        }}
                      >
                        <DocIcon width={16} height={16} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-amount text-[14.5px] font-bold tracking-[-0.01em] text-[rgb(var(--fg-default))]">
                          {formatShekels(proof.amountCents)}
                        </div>
                        <div className="mt-px text-[11.5px] leading-snug text-[rgb(var(--fg-muted))]">
                          {copy.headline}
                        </div>
                      </div>
                      <span
                        className="shrink-0 rounded-full px-2.5 py-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.08em]"
                        style={chipStyle(copy.tone)}
                      >
                        {proof.status === "awaiting"
                          ? "In review"
                          : proof.status === "paid"
                            ? "Verified"
                            : proof.status === "rejected"
                              ? "Rejected"
                              : proof.status}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* running total — thin progress bar driven by paidProgress */}
          <div
            className="reveal-up reveal-up-delay-4 rounded-card mt-[18px] px-4 py-3.5"
            style={{
              background: "rgb(var(--bg-elevated))",
              border: "1px solid rgb(var(--border-subtle))",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]">
                Paid so far
              </span>
              <span className="font-amount text-[14px] font-bold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
                {progress.paidLabel}{" "}
                <span className="text-[rgb(var(--fg-muted))]">of {progress.totalLabel}</span>
              </span>
            </div>
            <div
              className="mt-2.5 h-2 w-full overflow-hidden rounded-full"
              style={{ background: "rgb(var(--bg-sunken))" }}
              role="progressbar"
              aria-valuenow={progress.pct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{
                  width: `${String(progress.pct)}%`,
                  background: progress.isPaidInFull
                    ? "rgb(var(--fg-success))"
                    : "linear-gradient(90deg, rgb(var(--brand-primary)), rgb(var(--brand-copper)))",
                }}
              />
            </div>
            {!progress.isPaidInFull ? (
              <div className="mt-2 font-amount text-[10.5px] tracking-[0.02em] text-[rgb(var(--fg-muted))]">
                {formatShekels(progress.remainingCents)} left · downloads unlock at 100%
              </div>
            ) : null}
          </div>
        </div>

        {/* pinned action */}
        {!isPaidInFull ? (
          <div
            className="sk-safe-bottom sticky bottom-0 z-10 px-[18px] pb-3.5 pt-3.5"
            style={{
              background:
                "linear-gradient(180deg, rgb(var(--bg-background) / 0) 0%, rgb(var(--bg-background) / 0.96) 22%)",
            }}
          >
            <PrimaryCta
              onClick={send}
              disabled={!file || !canSend}
              glow={canSend}
              sub={
                isAwaiting
                  ? "We'll ping you when " + producer.name + " confirms"
                  : file
                    ? "Sends to " + producer.name + " to verify"
                    : "Attach a file to continue"
              }
            >
              {isUploading ? (
                <>
                  <span
                    className="inline-block h-4 w-4 animate-spin rounded-full border-2"
                    style={{
                      borderColor: "rgb(var(--bg-sidebar) / 0.3)",
                      borderTopColor: "rgb(var(--bg-sidebar))",
                    }}
                  />
                  Uploading…
                </>
              ) : isAwaiting ? (
                <>
                  <ClockIcon /> Awaiting verification
                </>
              ) : (
                <>
                  Send proof <ArrowRight />
                </>
              )}
            </PrimaryCta>
          </div>
        ) : (
          <div className="sk-safe-bottom sticky bottom-0 z-10 px-[18px] pb-3.5 pt-3.5">
            <PrimaryCta
              glow={false}
              onClick={() => {
                router.push("/artist/book");
              }}
            >
              Book a session <ArrowRight />
            </PrimaryCta>
          </div>
        )}
      </div>
    </div>
  );
}
