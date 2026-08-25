"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ArrowRight, Check, ClockIcon, DocIcon } from "~/components/artist/funnel/funnel-icons";
import { Eyebrow, FunnelTopBar } from "~/components/artist/funnel/funnel-ui";
import { PushMomentBanner } from "~/components/push/push-moment-banner";
import { withArtistStudio } from "~/lib/artist-studio-context";

import { formatPurchaseMoney } from "./pay-data";
import type { ArtistPaymentSummaryProof } from "./payment-summary-screen";

type ArtistProofRecordItem = ArtistPaymentSummaryProof &
  Readonly<{
    originalFileName: string;
    evidenceUrl: string;
  }>;

function statusChip(status: ArtistProofRecordItem["status"]): {
  label: string;
  className: string;
} {
  if (status === "confirmed") {
    return {
      label: "Confirmed",
      className: "bg-[rgb(var(--fg-success)/0.12)] text-[rgb(var(--fg-success-text))]",
    };
  }
  if (status === "rejected") {
    return {
      label: "Rejected",
      className: "bg-[rgb(var(--fg-danger)/0.1)] text-[rgb(var(--fg-danger-text))]",
    };
  }
  return {
    label: "In review",
    className: "bg-[rgb(var(--brand-primary)/0.14)] text-[rgb(var(--brand-primary-text))]",
  };
}

function formatUploadedAt(value: Date): string {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(value);
}

export function ProofRecordScreen({
  purchaseId,
  studioId,
  productName,
  producerName,
  currency,
  proof,
  totalCents,
  verifiedCents,
  remainingCents,
  paidInFull,
  replacementUploadAvailable,
  history,
  rejectionNote,
}: {
  purchaseId: string;
  studioId: string;
  productName: string;
  producerName: string;
  currency: string;
  proof: ArtistProofRecordItem;
  totalCents: number;
  verifiedCents: number;
  remainingCents: number;
  paidInFull: boolean;
  replacementUploadAvailable: boolean;
  history: readonly ArtistProofRecordItem[];
  rejectionNote: string | null;
}) {
  const router = useRouter();
  const summaryHref = withArtistStudio(
    `/artist/payments/${encodeURIComponent(purchaseId)}`,
    studioId,
  );
  const homeHref = withArtistStudio("/artist", studioId);
  const newProofHref = withArtistStudio(
    `/artist/payments/${encodeURIComponent(purchaseId)}/proof/new?installment=${encodeURIComponent(
      proof.installmentId,
    )}`,
    studioId,
  );
  const proofHistory = history.some((item) => item.proofId === proof.proofId)
    ? history
    : [...history, proof];
  const paidPct =
    totalCents <= 0 ? 100 : Math.min(100, Math.round((verifiedCents / totalCents) * 100));
  const isPending = proof.status === "pending";
  const isRejected = proof.status === "rejected";
  const primaryHref =
    isRejected && replacementUploadAvailable
      ? newProofHref
      : proof.status === "confirmed" && paidInFull
        ? homeHref
        : summaryHref;
  const primaryLabel =
    isRejected && replacementUploadAvailable
      ? "Upload a replacement"
      : proof.status === "confirmed" && paidInFull
        ? "Back to Home"
        : proof.status === "confirmed"
          ? "View next payment"
          : "Back to payment summary";

  return (
    <div className="sk-native-screen fixed inset-x-0 top-[var(--sk-viewport-offset-top,0px)] z-[60] flex flex-col overflow-hidden overflow-x-clip bg-[rgb(var(--bg-background))]">
      <div className="relative mx-auto flex min-h-0 w-full max-w-[440px] flex-1 flex-col overflow-hidden">
        <FunnelTopBar
          title="Payment proof"
          sub={`INSTALLMENT ${String(proof.installmentPosition)}`}
          onBack={() => {
            router.back();
          }}
        />

        <main className="sk-native-scroll min-h-0 flex-1 px-4 pt-3 pb-6 min-[390px]:px-5">
          <p className="mb-1 truncate text-xs font-semibold text-[rgb(var(--fg-muted))]">
            {productName}
          </p>
          <h1 className="font-syne text-[24px] leading-tight font-extrabold tracking-[-0.035em] text-[rgb(var(--fg-default))]">
            {proof.status === "confirmed"
              ? paidInFull
                ? "All paid up"
                : "Proof verified"
              : isRejected
                ? "Upload a replacement"
                : "Proof sent"}
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-[rgb(var(--fg-muted))]">
            {isPending
              ? `${producerName} will review the exact amount and evidence you sent.`
              : isRejected
                ? `${producerName} could not verify this proof. Read the note and send a clearer copy.`
                : `${producerName} verified this proof. ${
                    paidInFull
                      ? "The agreed total is fully verified."
                      : `${formatPurchaseMoney(remainingCents, currency)} remains.`
                  }`}
          </p>

          {isPending ? (
            <div
              role="status"
              className="mt-4 flex gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.3)] bg-[rgb(var(--brand-primary)/0.09)] p-4"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary)/0.16)] text-[rgb(var(--brand-primary-text))]">
                <ClockIcon width={17} height={17} />
              </span>
              <div>
                <p className="text-sm font-bold text-[rgb(var(--fg-default))]">
                  Needs producer review
                </p>
                <p className="mt-1 text-xs leading-relaxed text-[rgb(var(--fg-muted))]">
                  You can leave this screen. The proof stays private and immutable.
                </p>
              </div>
            </div>
          ) : null}

          {isPending ? (
            <PushMomentBanner message="Get an alert when your payment is confirmed." />
          ) : null}

          {isRejected ? (
            <div
              role="alert"
              className="mt-4 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.28)] bg-[rgb(var(--fg-danger)/0.07)] p-4"
            >
              <p className="text-sm font-bold text-[rgb(var(--fg-danger-text))]">Producer note</p>
              <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-wrap text-[rgb(var(--fg-secondary))]">
                {rejectionNote?.trim() || "Please upload a clearer replacement proof."}
              </p>
            </div>
          ) : null}

          {proof.status === "confirmed" ? (
            <div
              role="status"
              className="mt-4 flex items-center gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-success)/0.3)] bg-[rgb(var(--fg-success)/0.1)] p-4 text-sm font-bold text-[rgb(var(--fg-success-text))]"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[rgb(var(--fg-success-text))] text-[rgb(var(--fg-on-success))]">
                <Check width={16} height={16} />
              </span>
              {paidInFull ? "Payment complete" : "Proof verified"}
            </div>
          ) : null}

          <section aria-labelledby="proof-history" className="mt-6">
            <h2 id="proof-history">
              <Eyebrow>
                <DocIcon aria-hidden /> Proof history
              </Eyebrow>
            </h2>
            <ul className="mt-2 flex list-none flex-col gap-2">
              {[...proofHistory].reverse().map((item) => {
                const chip = statusChip(item.status);
                return (
                  <li
                    key={item.proofId}
                    className={`rounded-[var(--radius-lg)] border bg-[rgb(var(--bg-elevated))] p-3.5 ${
                      item.proofId === proof.proofId
                        ? "border-[rgb(var(--brand-primary)/0.45)]"
                        : "border-[rgb(var(--border-subtle))]"
                    }`}
                  >
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-sm font-bold text-[rgb(var(--fg-default))]">
                          {formatPurchaseMoney(item.amountCents, currency)}
                        </p>
                        <p
                          className="mt-1 truncate text-xs text-[rgb(var(--fg-muted))]"
                          title={item.originalFileName}
                        >
                          {item.originalFileName}
                        </p>
                        <p className="mt-0.5 text-[11px] text-[rgb(var(--fg-muted))]">
                          {formatUploadedAt(item.createdAt)}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-[var(--radius-sm)] px-2 py-1 font-mono text-[9px] font-bold tracking-wider uppercase ${chip.className}`}
                      >
                        {chip.label}
                      </span>
                    </div>
                    <a
                      href={item.evidenceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      referrerPolicy="no-referrer"
                      className="sk-press mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-lg)] text-xs font-bold text-[rgb(var(--brand-primary-text))]"
                    >
                      Open private evidence <ExternalLink size={13} aria-hidden />
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>

          <section
            aria-label="Payment progress"
            className="mt-5 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4"
          >
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="font-mono font-bold tracking-wider text-[rgb(var(--fg-muted))] uppercase">
                Payment progress
              </span>
              <span className="font-mono font-bold text-[rgb(var(--fg-default))]">
                {formatPurchaseMoney(verifiedCents, currency)} of{" "}
                {formatPurchaseMoney(totalCents, currency)}
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={paidPct}
              aria-valuetext={`${formatPurchaseMoney(verifiedCents, currency)} verified of ${formatPurchaseMoney(totalCents, currency)}`}
              className="mt-2 h-2 overflow-hidden rounded-full bg-[rgb(var(--bg-sunken))]"
            >
              <div
                className="h-full rounded-full bg-[rgb(var(--brand-primary))] transition-[width] motion-reduce:transition-none"
                style={{ width: `${String(paidPct)}%` }}
              />
            </div>
          </section>

          <p className="mt-5 text-[11.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
            This status records the producer’s review. Skitza does not confirm or process the
            transfer.
          </p>
        </main>

        <div
          className="z-10 shrink-0 px-4 pt-4 pb-[calc(0.875rem+env(safe-area-inset-bottom,0px))] min-[390px]:px-5"
          style={{
            background:
              "linear-gradient(180deg, rgb(var(--bg-background)/0), rgb(var(--bg-background)) 24%)",
          }}
        >
          <Link
            href={primaryHref}
            className="sk-cta-press sk-gloss flex w-full items-center justify-center gap-[9px] rounded-[var(--radius-card)] px-[22px] py-4 text-center text-[16px] font-semibold text-[rgb(var(--bg-sidebar))]"
            style={{
              background:
                "linear-gradient(180deg, rgb(var(--brand-primary)) 0%, rgb(var(--brand-primary-dark)) 130%)",
              boxShadow: "var(--shadow-glow), 0 10px 28px -8px rgb(var(--brand-primary) / 0.45)",
            }}
          >
            {primaryLabel} <ArrowRight />
          </Link>
        </div>
      </div>
    </div>
  );
}
