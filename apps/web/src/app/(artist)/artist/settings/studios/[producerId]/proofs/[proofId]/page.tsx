import { auth } from "~/server/auth/clerk-identity";
import { TRPCError } from "@trpc/server";
import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PastStudioRecordShell } from "~/components/artist/settings/past-studio-record-shell";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = { params: Promise<{ producerId: string; proofId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata: Metadata = { title: "Past studio proof record" };

function moneyLabel(amountCents: number, currency: string): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
  }).format(amountCents / 100);
}

function dateLabel(value: Date): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

function proofStatus(status: "pending" | "confirmed" | "rejected"): string {
  if (status === "confirmed") return "Verified by producer";
  if (status === "rejected") return "Not verified";
  return "Awaiting review";
}

export default async function ArtistPastStudioProofPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const { producerId, proofId } = await params;
  if (!UUID.test(producerId) || !UUID.test(proofId)) notFound();

  let proof;
  try {
    proof = await appRouter
      .createCaller({ userId })
      .artistPlatform.history.proof({ producerId, proofId });
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const backHref = `/artist/settings/studios/${encodeURIComponent(producerId)}`;
  return (
    <PastStudioRecordShell
      backHref={backHref}
      studioName={proof.producerName}
      eyebrow="Proof record"
      title={proofStatus(proof.status)}
      subtitle={`${proof.productName} · ${proof.projectTitle}`}
    >
      <section className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 shadow-[var(--shadow-sm)]">
        <p className="font-mono text-[9px] font-semibold tracking-[0.13em] text-[rgb(var(--fg-muted))] uppercase">
          Payment {String(proof.installmentPosition)}
        </p>
        <p className="mt-2 font-mono text-[32px] font-bold tracking-[-0.04em] text-[rgb(var(--fg-default))]">
          {moneyLabel(proof.amountCents, proof.currency)}
        </p>
        <dl className="mt-5 grid gap-4 border-t border-[rgb(var(--border-subtle))] pt-4 sm:grid-cols-2">
          <RecordField label="Studio" value={proof.producerName} />
          <RecordField label="Recorded" value={dateLabel(proof.createdAt)} />
          <RecordField label="Purchase reference" value={proof.refNumber} />
          <RecordField label="File" value={proof.originalFileName ?? "Payment proof"} />
        </dl>

        {proof.rejectionNote?.trim() ? (
          <div className="mt-5 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-danger)/0.08)] p-4">
            <p className="text-[11px] font-bold text-[rgb(var(--fg-danger-text))]">Producer note</p>
            <p className="mt-1 text-[13px] leading-relaxed text-[rgb(var(--fg-secondary))]">
              {proof.rejectionNote}
            </p>
          </div>
        ) : null}

        <a
          href={proof.evidenceUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-4 text-[12.5px] font-bold text-[rgb(var(--fg-default))] hover:bg-[rgb(var(--bg-overlay))]"
        >
          Open private proof
          <ExternalLink size={14} aria-hidden />
        </a>
      </section>

      <p className="mt-4 text-[11.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
        This record shows the producer’s review. Skitza did not process or verify the transfer.
      </p>
    </PastStudioRecordShell>
  );
}

function RecordField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[9px] font-semibold tracking-[0.1em] text-[rgb(var(--fg-muted))] uppercase">
        {label}
      </dt>
      <dd className="mt-1 text-[13px] font-semibold text-[rgb(var(--fg-default))]">{value}</dd>
    </div>
  );
}
