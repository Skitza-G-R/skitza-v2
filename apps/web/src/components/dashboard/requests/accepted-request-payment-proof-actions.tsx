import Link from "next/link";

export type AcceptedRequestPendingProof = Readonly<{
  proofId: string;
  installmentPosition: number;
}>;

export function AcceptedRequestPaymentProofActions({
  proofs,
}: {
  proofs: readonly AcceptedRequestPendingProof[];
}) {
  return (
    <section
      aria-labelledby="accepted-request-payment-heading"
      className="border-b border-[rgb(var(--border-subtle))] py-5"
    >
      <h2
        id="accepted-request-payment-heading"
        className="text-sm font-semibold text-[rgb(var(--fg-default))]"
      >
        The artist accepted these terms
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-[rgb(var(--fg-secondary))]">
        This Request is now read-only. Any later payment follow-up belongs in Payments.
      </p>

      {proofs.length > 0 ? (
        <ul className="mt-3 flex list-none flex-col gap-2">
          {proofs.map((proof) => (
            <li key={proof.proofId}>
              <Link
                href={`/dashboard/payments/${encodeURIComponent(proof.proofId)}`}
                className="sk-press flex min-h-11 items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary-text)/0.35)] bg-[rgb(var(--brand-primary)/0.1)] px-3.5 py-2.5 text-sm font-semibold text-[rgb(var(--brand-primary-text))] hover:border-[rgb(var(--brand-primary-text)/0.55)]"
              >
                <span>Review payment proof</span>
                <span className="shrink-0 font-mono text-[10px] font-medium tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                  Installment {String(proof.installmentPosition)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
