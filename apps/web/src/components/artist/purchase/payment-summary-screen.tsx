import Link from "next/link";

import { PaymentHistoryPurchaseDetails } from "~/components/payments/payment-history";
import type {
  PaymentHistoryPurchase,
  PaymentHistoryRecordStatus,
} from "~/components/payments/payment-history-view";
import { withArtistStudio } from "~/lib/artist-studio-context";
import type { ArtistProofUploadAvailability as DomainArtistProofUploadAvailability } from "~/server/domain/payment-proofs/artist-upload-availability";

import { formatPurchaseMoney } from "./pay-data";

export type ArtistProofUploadAvailability = DomainArtistProofUploadAvailability;

export type ArtistPaymentSummaryProof = Readonly<{
  proofId: string;
  installmentId: string;
  installmentPosition: number;
  amountCents: number;
  status: "pending" | "confirmed" | "rejected";
  createdAt: Date;
}>;

export function PaymentSummaryScreen({
  purchaseId,
  studioId,
  productName,
  producerName,
  currency,
  totalCents,
  verifiedCents,
  remainingCents,
  currentInstallmentPosition,
  recordStatus,
  proofUploadAvailability,
  proofs,
  purchaseRecord,
}: {
  purchaseId: string;
  studioId: string;
  productName: string;
  producerName: string;
  currency: string;
  totalCents: number;
  verifiedCents: number;
  remainingCents: number;
  currentInstallmentPosition: number | null;
  recordStatus: PaymentHistoryRecordStatus;
  proofUploadAvailability: ArtistProofUploadAvailability | null;
  proofs: readonly ArtistPaymentSummaryProof[];
  purchaseRecord?: PaymentHistoryPurchase;
}) {
  const latest = proofs.at(-1) ?? null;
  const latestHref = latest
    ? withArtistStudio(
        `/artist/payments/${encodeURIComponent(purchaseId)}/proof/${encodeURIComponent(latest.proofId)}`,
        studioId,
      )
    : null;
  const instructionsHref = withArtistStudio(
    `/artist/payments/${encodeURIComponent(purchaseId)}/instructions`,
    studioId,
  );

  return (
    <div className="mx-auto w-full max-w-[680px]">
      <Link
        href={withArtistStudio("/artist/payments", studioId)}
        className="inline-flex min-h-11 items-center text-[12px] font-semibold text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
      >
        ← Payments
      </Link>

      <header className="mt-1">
        <p className="text-[11px] font-semibold tracking-[0.04em] text-[rgb(var(--fg-muted))] uppercase">
          {producerName}
        </p>
        <h1 className="font-display mt-1 text-[clamp(1.65rem,6vw,2.35rem)] leading-tight font-bold tracking-[-0.04em] text-[rgb(var(--fg-default))]">
          {productName}
        </h1>
      </header>

      <section
        className="mt-5 overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
        aria-label="Payment progress"
      >
        <div className="p-5 sm:flex sm:items-end sm:justify-between sm:gap-6">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
              Remaining
            </p>
            <p className="mt-1 font-mono text-[32px] leading-none font-bold tracking-[-0.04em] text-[rgb(var(--fg-default))] tabular-nums">
              {formatPurchaseMoney(remainingCents, currency)}
            </p>
          </div>
          <p className="mt-3 text-[11.5px] leading-relaxed text-[rgb(var(--fg-muted))] sm:mt-0 sm:max-w-[240px] sm:text-right">
            Paid directly to {producerName}. Skitza keeps the verification record.
          </p>
        </div>

        <dl className="grid grid-cols-2 border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background)/0.4)]">
          <MoneyDatum label="Verified" amount={formatPurchaseMoney(verifiedCents, currency)} />
          <MoneyDatum label="Agreed total" amount={formatPurchaseMoney(totalCents, currency)} />
        </dl>

        <div className="border-t border-[rgb(var(--border-subtle))] p-5">
          {recordStatus === "canceled" ? (
            <>
              <StatusEyebrow>Closed</StatusEyebrow>
              <StatusTitle>This purchase is closed</StatusTitle>
              <StatusCopy>No new proof can be added to this canceled purchase.</StatusCopy>
            </>
          ) : recordStatus === "settled_by_waiver" ? (
            <>
              <StatusEyebrow>Settled</StatusEyebrow>
              <StatusTitle>Balance settled by waiver</StatusTitle>
              <StatusCopy>
                A waiver is not a verified payment. The exact waiver and payment history remain
                recorded below.
              </StatusCopy>
            </>
          ) : recordStatus === "no_payment_required" ? (
            <>
              <StatusEyebrow>Agreement</StatusEyebrow>
              <StatusTitle>No payment required</StatusTitle>
              <StatusCopy>
                This agreement has no cash total. View the frozen terms below.
              </StatusCopy>
            </>
          ) : recordStatus === "paid_in_full" ? (
            <>
              <StatusEyebrow>Complete</StatusEyebrow>
              <StatusTitle>Payment fully verified</StatusTitle>
              <StatusCopy>The full agreed amount is verified in your payment history.</StatusCopy>
            </>
          ) : latest?.status === "pending" ? (
            <>
              <StatusEyebrow>Waiting for verification</StatusEyebrow>
              <StatusTitle>Proof sent to {producerName}</StatusTitle>
              <StatusCopy>
                You can safely leave this page. This record updates after the studio reviews it.
              </StatusCopy>
              {latestHref ? <PrimaryLink href={latestHref}>View proof</PrimaryLink> : null}
            </>
          ) : latest?.status === "rejected" ? (
            <>
              <StatusEyebrow>Action needed</StatusEyebrow>
              <StatusTitle>The latest proof needs attention</StatusTitle>
              <StatusCopy>
                Open the record to read the producer’s note and upload a replacement if this
                installment is still due.
              </StatusCopy>
              {latestHref ? <PrimaryLink href={latestHref}>View proof</PrimaryLink> : null}
            </>
          ) : proofUploadAvailability?.status === "available" ? (
            <>
              <StatusEyebrow>
                {verifiedCents > 0
                  ? "Next payment ready"
                  : currentInstallmentPosition === null
                    ? "Payment ready"
                    : `Payment ${String(currentInstallmentPosition)}`}
              </StatusEyebrow>
              <StatusTitle>Pay directly, then upload proof</StatusTitle>
              <StatusCopy>
                View the studio’s instructions. If Bank or Bit is not shown, {producerName} will
                send those details directly. The proof amount stays locked to this installment.
              </StatusCopy>
              <PrimaryLink href={instructionsHref}>Pay &amp; upload proof</PrimaryLink>
            </>
          ) : proofUploadAvailability?.status === "not_due" ? (
            <>
              <StatusEyebrow>Scheduled</StatusEyebrow>
              <StatusTitle>Next payment isn’t due yet</StatusTitle>
              <StatusCopy>{notDueCopy(proofUploadAvailability)}</StatusCopy>
            </>
          ) : proofUploadAvailability?.status === "purchase_canceled" ? (
            <>
              <StatusEyebrow>Closed</StatusEyebrow>
              <StatusTitle>This purchase is closed</StatusTitle>
              <StatusCopy>No new proof can be added to this canceled purchase.</StatusCopy>
            </>
          ) : proofUploadAvailability?.status === "awaiting_review" ? (
            <>
              <StatusEyebrow>Waiting for verification</StatusEyebrow>
              <StatusTitle>A proof is already being reviewed</StatusTitle>
              <StatusCopy>Another proof cannot be added until the studio reviews it.</StatusCopy>
            </>
          ) : (
            <>
              <StatusEyebrow>No action</StatusEyebrow>
              <StatusTitle>No proof is needed right now</StatusTitle>
              <StatusCopy>Your existing payment record remains available below.</StatusCopy>
            </>
          )}
        </div>
      </section>

      {proofs.length > 0 ? (
        <details className="mt-4 overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[13px] font-semibold text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
            <span>Payment history</span>
            <span className="font-mono text-[10px] text-[rgb(var(--fg-muted))]">
              {String(proofs.length)} {proofs.length === 1 ? "record" : "records"}
            </span>
          </summary>
          <ul className="list-none divide-y divide-[rgb(var(--border-subtle))] border-t border-[rgb(var(--border-subtle))] px-4">
            {[...proofs].reverse().map((proof) => (
              <li key={proof.proofId}>
                <Link
                  href={withArtistStudio(
                    `/artist/payments/${encodeURIComponent(purchaseId)}/proof/${encodeURIComponent(proof.proofId)}`,
                    studioId,
                  )}
                  className="flex min-h-14 items-center justify-between gap-3 py-3"
                >
                  <span>
                    <span className="block text-[12.5px] font-semibold text-[rgb(var(--fg-default))]">
                      Payment {String(proof.installmentPosition)}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-[rgb(var(--fg-muted))]">
                      {proof.createdAt.toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block font-mono text-[12px] font-semibold text-[rgb(var(--fg-default))] tabular-nums">
                      {formatPurchaseMoney(proof.amountCents, currency)}
                    </span>
                    <span className="mt-0.5 block text-[10px] font-semibold text-[rgb(var(--fg-muted))]">
                      {proofStatusLabel(proof.status)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {purchaseRecord ? (
        <details className="mt-4 overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
            <span>
              <span className="block text-[13px] font-semibold text-[rgb(var(--fg-default))]">
                Full purchase record
              </span>
              <span className="mt-0.5 block text-[10.5px] font-normal text-[rgb(var(--fg-muted))]">
                Agreement, plan, schedule, and complete history
              </span>
            </span>
            <span className="shrink-0 text-[10px] font-semibold text-[rgb(var(--brand-primary-text))]">
              View
            </span>
          </summary>
          <PaymentHistoryPurchaseDetails
            purchase={purchaseRecord}
            role="artist"
            idPrefix={`artist-payment-${purchaseRecord.id}`}
            showPaymentAction={false}
          />
        </details>
      ) : null}
    </div>
  );
}

function MoneyDatum({ label, amount }: { label: string; amount: string }) {
  return (
    <div className="min-w-0 px-5 py-3.5 first:border-r first:border-[rgb(var(--border-subtle))]">
      <dt className="text-[9.5px] font-semibold tracking-[0.06em] text-[rgb(var(--fg-muted))] uppercase">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-[15px] font-bold text-[rgb(var(--fg-default))] tabular-nums">
        {amount}
      </dd>
    </div>
  );
}

function StatusEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[9px] font-semibold tracking-[0.13em] text-[rgb(var(--brand-primary-text))] uppercase">
      {children}
    </p>
  );
}

function StatusTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-display mt-1.5 text-[19px] font-bold tracking-[-0.025em] text-[rgb(var(--fg-default))]">
      {children}
    </h2>
  );
}

function StatusCopy({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1.5 max-w-[58ch] text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
      {children}
    </p>
  );
}

function PrimaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="sk-press mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sidebar))] px-4 text-[13px] font-bold text-[rgb(var(--fg-onsidebar))] sm:w-auto"
    >
      {children}
    </Link>
  );
}

function notDueCopy(
  availability: Extract<ArtistProofUploadAvailability, { status: "not_due" }>,
): string {
  if (availability.dueTrigger === "artist_approval") {
    return `Payment ${String(availability.installmentPosition)} opens after you approve the required final version.`;
  }
  if (availability.dueAt) {
    const date = availability.dueAt.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    return `Payment ${String(availability.installmentPosition)} opens on ${date}.`;
  }
  if (availability.dueTrigger === "monthly_anniversary") {
    return `Payment ${String(availability.installmentPosition)} opens on its scheduled monthly date.`;
  }
  return `Payment ${String(availability.installmentPosition)} opens when its scheduled trigger is reached.`;
}

function proofStatusLabel(status: ArtistPaymentSummaryProof["status"]): string {
  if (status === "pending") return "Awaiting";
  if (status === "confirmed") return "Verified";
  return "Rejected";
}
