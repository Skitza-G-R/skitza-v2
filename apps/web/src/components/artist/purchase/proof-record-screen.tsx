import Link from "next/link";

import { withArtistStudio } from "~/lib/artist-studio-context";

import { formatPurchaseMoney } from "./pay-data";
import type { ArtistPaymentSummaryProof } from "./payment-summary-screen";

export function ProofRecordScreen({
  purchaseId,
  studioId,
  productName,
  producerName,
  currency,
  proof,
  remainingCents,
  paidInFull,
  replacementUploadAvailable,
  history,
  evidenceUrl,
  rejectionNote,
}: {
  purchaseId: string;
  studioId: string;
  productName: string;
  producerName: string;
  currency: string;
  proof: ArtistPaymentSummaryProof;
  remainingCents: number;
  paidInFull: boolean;
  replacementUploadAvailable: boolean;
  history: readonly ArtistPaymentSummaryProof[];
  evidenceUrl: string;
  rejectionNote: string | null;
}) {
  const summaryHref = withArtistStudio(
    `/artist/payments/${encodeURIComponent(purchaseId)}`,
    studioId,
  );
  const newProofHref = withArtistStudio(
    `/artist/payments/${encodeURIComponent(purchaseId)}/proof/new?installment=${encodeURIComponent(
      proof.installmentId,
    )}`,
    studioId,
  );

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 py-6 sm:px-6 sm:py-9">
      <Link
        href={summaryHref}
        className="inline-flex min-h-11 items-center text-[12px] font-semibold text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
      >
        ← Payment summary
      </Link>

      <header className="mt-2">
        <p className="text-[12px] font-semibold text-[rgb(var(--fg-muted))]">
          {productName} · Payment {String(proof.installmentPosition)}
        </p>
        <h1 className="font-display mt-1 text-[clamp(1.8rem,6vw,2.7rem)] leading-tight font-bold tracking-[-0.04em] text-[rgb(var(--fg-default))]">
          {proof.status === "pending"
            ? "Waiting for verification"
            : proof.status === "confirmed"
              ? "Proof verified"
              : "Proof not verified"}
        </h1>
      </header>

      <section className="mt-5 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5">
        <p className="font-mono text-[9px] font-semibold tracking-[0.13em] text-[rgb(var(--fg-muted))] uppercase">
          {proof.status === "pending"
            ? "Awaiting"
            : proof.status === "confirmed"
              ? "Verified by producer"
              : "Rejected by producer"}
        </p>
        <p className="mt-2 font-mono text-[30px] font-bold tracking-[-0.035em] text-[rgb(var(--fg-default))]">
          {formatPurchaseMoney(proof.amountCents, currency)}
        </p>

        {proof.status === "pending" ? (
          <>
            <p className="mt-3 text-[15px] font-semibold text-[rgb(var(--fg-default))]">
              Proof sent to {producerName}
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-[rgb(var(--fg-muted))]">
              You can safely leave this screen. It will update after the studio reviews the
              record.
            </p>
          </>
        ) : proof.status === "rejected" ? (
          <>
            <p className="mt-3 text-[13px] leading-relaxed text-[rgb(var(--fg-default))]">
              {rejectionNote?.trim() ||
                "The producer could not verify this proof. Upload a clearer copy."}
            </p>
            {replacementUploadAvailable ? (
              <Link
                href={newProofHref}
                className="sk-press mt-4 inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sidebar))] px-4 text-[13px] font-bold text-[rgb(var(--fg-onsidebar))]"
              >
                Upload a clearer proof
              </Link>
            ) : null}
          </>
        ) : (
          <>
            <p className="mt-3 text-[13px] leading-relaxed text-[rgb(var(--fg-muted))]">
              {producerName} verified this proof.{" "}
              {paidInFull
                ? "The agreed total is fully verified."
                : `${formatPurchaseMoney(remainingCents, currency)} remains on the purchase.`}
            </p>
            <Link
              href={summaryHref}
              className="sk-press mt-4 inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sidebar))] px-4 text-[13px] font-bold text-[rgb(var(--fg-onsidebar))]"
            >
              {paidInFull ? "Back to payment summary" : "View next payment"}
            </Link>
          </>
        )}
      </section>

      <a
        href={evidenceUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-flex min-h-11 items-center text-[12.5px] font-semibold text-[rgb(var(--brand-primary-text))]"
      >
        Open private proof
      </a>

      {history.length > 1 ? (
        <details className="mt-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
          <summary className="min-h-12 cursor-pointer px-4 py-3 text-[13px] font-semibold text-[rgb(var(--fg-default))]">
            Payment history · {String(history.length)}
          </summary>
          <ul className="list-none border-t border-[rgb(var(--border-subtle))] px-4">
            {[...history].reverse().map((item) => (
              <li
                key={item.proofId}
                className="border-b border-[rgb(var(--border-subtle))] last:border-b-0"
              >
                <Link
                  aria-current={item.proofId === proof.proofId ? "page" : undefined}
                  href={withArtistStudio(
                    `/artist/payments/${encodeURIComponent(purchaseId)}/proof/${encodeURIComponent(item.proofId)}`,
                    studioId,
                  )}
                  className="flex min-h-14 items-center justify-between gap-3 py-3 text-[12.5px]"
                >
                  <span className="font-semibold text-[rgb(var(--fg-default))]">
                    Payment {String(item.installmentPosition)}
                  </span>
                  <span className="text-[rgb(var(--fg-muted))]">
                    {item.status === "pending"
                      ? "Awaiting"
                      : item.status === "confirmed"
                        ? "Verified"
                        : "Rejected"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <p className="mt-5 text-[11.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
        This status records the producer’s review. Skitza does not confirm or process the
        transfer.
      </p>
    </main>
  );
}
