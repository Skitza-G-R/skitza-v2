import Link from "next/link";

import { withArtistStudio } from "~/lib/artist-studio-context";

import { formatPurchaseMoney } from "./pay-data";

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
  proofUploadsAvailable,
  proofs,
}: {
  purchaseId: string;
  studioId: string;
  productName: string;
  producerName: string;
  currency: string;
  totalCents: number;
  verifiedCents: number;
  remainingCents: number;
  currentInstallmentPosition: number;
  proofUploadsAvailable: boolean;
  proofs: readonly ArtistPaymentSummaryProof[];
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
  const paidInFull = remainingCents <= 0;

  return (
    <main className="mx-auto w-full max-w-[760px] px-4 py-6 sm:px-6 sm:py-9">
      <Link
        href={withArtistStudio("/artist", studioId)}
        className="inline-flex min-h-11 items-center text-[12px] font-semibold text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
      >
        ← Home
      </Link>

      <header className="mt-2">
        <p className="text-[12px] font-semibold text-[rgb(var(--fg-muted))]">{producerName}</p>
        <h1 className="font-display mt-1 text-[clamp(1.8rem,6vw,2.7rem)] leading-tight font-bold tracking-[-0.04em] text-[rgb(var(--fg-default))]">
          {productName}
        </h1>
        <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-[rgb(var(--fg-muted))]">
          Payment record · paid directly to the studio
        </p>
      </header>

      <section className="mt-5 grid gap-3 sm:grid-cols-3" aria-label="Payment progress">
        <SummaryAmount
          label="Producer verified"
          amount={formatPurchaseMoney(verifiedCents, currency)}
        />
        <SummaryAmount label="Remaining" amount={formatPurchaseMoney(remainingCents, currency)} />
        <SummaryAmount label="Agreed total" amount={formatPurchaseMoney(totalCents, currency)} />
      </section>

      <section className="mt-4 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5">
        {latest?.status === "pending" ? (
          <>
            <StatusEyebrow>Waiting for verification</StatusEyebrow>
            <h2 className="font-display mt-2 text-[21px] font-bold tracking-[-0.025em] text-[rgb(var(--fg-default))]">
              Proof sent to {producerName}
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-[rgb(var(--fg-muted))]">
              You can safely leave this screen. The record will update after the studio reviews it.
            </p>
            {latestHref ? <PrimaryLink href={latestHref}>View proof</PrimaryLink> : null}
          </>
        ) : latest?.status === "rejected" ? (
          <>
            <StatusEyebrow>Action needed</StatusEyebrow>
            <h2 className="font-display mt-2 text-[21px] font-bold tracking-[-0.025em] text-[rgb(var(--fg-default))]">
              The studio could not verify the latest proof
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-[rgb(var(--fg-muted))]">
              Open the proof record to read the producer’s note and upload a clearer copy.
            </p>
            {latestHref ? <PrimaryLink href={latestHref}>View proof</PrimaryLink> : null}
          </>
        ) : paidInFull ? (
          <>
            <StatusEyebrow>Complete</StatusEyebrow>
            <h2 className="font-display mt-2 text-[21px] font-bold tracking-[-0.025em] text-[rgb(var(--fg-default))]">
              Payment fully verified
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-[rgb(var(--fg-muted))]">
              The amount above reflects proof records verified by {producerName}.
            </p>
            <PrimaryLink href={withArtistStudio("/artist", studioId)}>Back to Home</PrimaryLink>
          </>
        ) : proofUploadsAvailable ? (
          <>
            <StatusEyebrow>
              {verifiedCents > 0
                ? "Partially verified"
                : `Payment ${String(currentInstallmentPosition)}`}
            </StatusEyebrow>
            <h2 className="font-display mt-2 text-[21px] font-bold tracking-[-0.025em] text-[rgb(var(--fg-default))]">
              {verifiedCents > 0 ? "The next payment is ready" : "Payment is ready"}
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-[rgb(var(--fg-muted))]">
              View the studio’s payment instructions. If Bank or Bit is not shown, {producerName}
              will send those details directly. You can still upload proof for the locked
              installment amount.
            </p>
            <PrimaryLink href={instructionsHref}>View payment instructions</PrimaryLink>
          </>
        ) : (
          <>
            <StatusEyebrow>Not ready</StatusEyebrow>
            <h2 className="font-display mt-2 text-[21px] font-bold tracking-[-0.025em] text-[rgb(var(--fg-default))]">
              Proof upload is not available yet
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-[rgb(var(--fg-muted))]">
              Return later or contact {producerName}. Bank or Bit details are not required once the
              secure proof uploader is available.
            </p>
          </>
        )}
      </section>

      {proofs.length > 0 ? (
        <details className="mt-4 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
          <summary className="min-h-12 cursor-pointer px-4 py-3 text-[13px] font-semibold text-[rgb(var(--fg-default))]">
            Payment history · {String(proofs.length)}
          </summary>
          <ul className="list-none border-t border-[rgb(var(--border-subtle))] px-4">
            {[...proofs].reverse().map((proof) => (
              <li
                key={proof.proofId}
                className="border-b border-[rgb(var(--border-subtle))] last:border-b-0"
              >
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
                      {proof.createdAt.toLocaleDateString()}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block font-mono text-[12px] font-semibold text-[rgb(var(--fg-default))]">
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

      <p className="mt-5 text-[11.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
        Skitza records proof and the producer’s verification. It does not process, hold, or move
        money.
      </p>
    </main>
  );
}

function SummaryAmount({ label, amount }: { label: string; amount: string }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
      <p className="text-[10px] font-semibold text-[rgb(var(--fg-muted))]">{label}</p>
      <p className="mt-1 font-mono text-[18px] font-bold tracking-[-0.025em] text-[rgb(var(--fg-default))]">
        {amount}
      </p>
    </div>
  );
}

function StatusEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[9px] font-semibold tracking-[0.13em] text-[rgb(var(--fg-muted))] uppercase">
      {children}
    </p>
  );
}

function PrimaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="sk-press mt-4 inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sidebar))] px-4 text-[13px] font-bold text-[rgb(var(--fg-onsidebar))]"
    >
      {children}
    </Link>
  );
}

function proofStatusLabel(status: ArtistPaymentSummaryProof["status"]): string {
  if (status === "pending") return "Awaiting";
  if (status === "confirmed") return "Verified";
  return "Rejected";
}
