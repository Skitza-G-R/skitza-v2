"use client";

import type { PurchaseCommercialSnapshot } from "@skitza/db";
import { ArrowLeft, Check, LockKeyhole, Music2 } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { AgreeCheck, Eyebrow, PrimaryCta } from "~/components/artist/funnel/funnel-ui";
import { acceptNoChargeSongProposalAction } from "~/app/(artist)/artist/music/no-charge/[proposalId]/actions";

export type NoChargeSongAgreementPreview = Readonly<{
  proposalToken: string;
  projectId: string;
  projectTitle: string;
  songTitle: string;
  producerName: string;
  sourceProductId: string;
  sourceProductName: string;
  snapshot: PurchaseCommercialSnapshot;
  snapshotDigest: string;
}>;

export function NoChargeSongAgreement({ preview }: { preview: NoChargeSongAgreementPreview }) {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function acceptAgreement() {
    if (!accepted || submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await acceptNoChargeSongProposalAction({
      proposalToken: preview.proposalToken,
      expectedSnapshotDigest: preview.snapshotDigest,
      agreementAccepted: true,
    });
    if (!result.ok) {
      setSubmitting(false);
      setError(result.error);
      return;
    }
    router.push(`/artist/music/${result.data.projectId}`);
    router.refresh();
  }

  return (
    <div className="mx-auto w-full max-w-[640px] pb-24" data-testid="no-charge-song-agreement">
      <header className="mb-4 flex items-center gap-3">
        <button
          type="button"
          aria-label="Back to Music"
          onClick={() => {
            router.push("/artist/music");
          }}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))]"
        >
          <ArrowLeft size={17} aria-hidden />
        </button>
        <div>
          <p className="font-mono text-[9px] tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase">
            Exact agreement
          </p>
          <p className="text-[14px] font-semibold text-[rgb(var(--fg-default))]">
            Review no charge song
          </p>
        </div>
      </header>

      <main>
        <h1 className="font-syne text-[26px] leading-[1.1] font-extrabold tracking-[-0.035em] text-[rgb(var(--fg-default))]">
          Add one song for ₪0
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-[rgb(var(--fg-muted))]">
          {preview.producerName} proposed one no charge song for this exact project. Nothing is
          added until you accept below.
        </p>

        <section className="mt-5 rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sidebar))] px-4 py-4 text-[rgb(var(--fg-onsidebar))]">
          <div className="font-mono text-[9.5px] tracking-[0.14em] text-[rgb(var(--brand-primary))] uppercase">
            No charge add-on
          </div>
          <div className="font-syne mt-2 text-[19px] font-extrabold [overflow-wrap:anywhere] break-words text-white">
            {preview.songTitle}
          </div>
          <div className="font-amount mt-3 text-[36px] font-bold tracking-[-0.04em] text-white">
            ₪0
          </div>
          <div className="mt-2 font-mono text-[9px] text-white/50">
            AGREEMENT REF · {preview.snapshotDigest.slice(0, 16)}
          </div>
        </section>

        <section className="mt-5" aria-labelledby="no-charge-target-heading">
          <h2 id="no-charge-target-heading" className="mb-2.5">
            <Eyebrow>Exact project</Eyebrow>
          </h2>
          <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3.5">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary)/0.14)] text-[rgb(var(--fg-default))]">
                <Music2 size={18} aria-hidden />
              </span>
              <div className="min-w-0">
                <div className="text-[14px] font-bold [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-default))]">
                  {preview.projectTitle}
                </div>
                <p className="mt-1 text-[12px] leading-snug text-[rgb(var(--fg-muted))]">
                  Acceptance creates one new purchased song space only in this project.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-5" aria-labelledby="no-charge-terms-heading">
          <h2 id="no-charge-terms-heading" className="mb-2.5">
            <Eyebrow>Frozen terms</Eyebrow>
          </h2>
          <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-1">
            <div className="border-b border-[rgb(var(--border-subtle))] py-3">
              <div className="flex items-center justify-between gap-3 text-[13px]">
                <span className="font-semibold text-[rgb(var(--fg-default))]">Total</span>
                <span className="font-amount font-bold text-[rgb(var(--fg-default))]">₪0</span>
              </div>
              <p className="mt-1 text-[11.5px] text-[rgb(var(--fg-muted))]">
                No payment plan and no payment is required.
              </p>
            </div>
            <div className="border-b border-[rgb(var(--border-subtle))] py-3">
              <div className="flex items-start gap-2 text-[12.5px] text-[rgb(var(--fg-secondary))]">
                <Check size={14} className="mt-0.5 shrink-0" aria-hidden />
                <span>Exactly one song space, active immediately after acceptance.</span>
              </div>
            </div>
            <div className="py-3">
              <p className="text-[12px] font-semibold text-[rgb(var(--fg-default))]">
                Source product
              </p>
              <p className="mt-1 text-[12.5px] [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-secondary))]">
                {preview.sourceProductName}
              </p>
              <p className="mt-1 font-mono text-[9.5px] text-[rgb(var(--fg-muted))]">
                PRODUCT · {preview.sourceProductId.slice(0, 8)}
              </p>
            </div>
          </div>
        </section>

        <section className="mt-5" aria-labelledby="no-charge-agreement-text-heading">
          <h2 id="no-charge-agreement-text-heading" className="mb-2.5">
            <Eyebrow>Exact agreement text</Eyebrow>
          </h2>
          <p className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-control))] bg-[rgb(var(--bg-elevated))] px-4 py-4 text-[13px] leading-relaxed [overflow-wrap:anywhere] break-words whitespace-pre-wrap text-[rgb(var(--fg-secondary))]">
            {preview.snapshot.agreementText}
          </p>
          <p className="mt-2.5 flex items-start gap-2 text-[11.5px] leading-snug text-[rgb(var(--fg-muted))]">
            <LockKeyhole size={13} className="mt-0.5 shrink-0" aria-hidden />
            <span>The exact project, product source, song title, and ₪0 terms are frozen.</span>
          </p>
        </section>

        <div className="mt-5">
          <AgreeCheck
            checked={accepted}
            onToggle={() => {
              setAccepted((value) => !value);
              setError(null);
            }}
          >
            I accept this exact ₪0 agreement for one song.
          </AgreeCheck>
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-danger)/0.1)] px-3.5 py-3 text-center text-[12.5px] font-medium text-[rgb(var(--fg-danger-text))]"
          >
            {error}
          </p>
        ) : null}
        <div className="mt-4">
          <PrimaryCta
            onClick={() => {
              void acceptAgreement();
            }}
            disabled={!accepted || submitting}
            glow={accepted && !submitting}
            ariaBusy={submitting}
            sub={
              accepted
                ? "Creates one active ₪0 purchase and song space"
                : "Accept the exact agreement to continue"
            }
          >
            {submitting ? "Accepting…" : "Accept and add song"}
          </PrimaryCta>
        </div>
      </main>
    </div>
  );
}
