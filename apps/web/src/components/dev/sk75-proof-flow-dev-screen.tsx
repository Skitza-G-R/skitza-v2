"use client";

import { useState } from "react";

import {
  UploadProofScreen,
  type ArtistProofHistoryItem,
  type PreviewProofSubmission,
} from "~/components/artist/purchase/upload-proof-screen";
import {
  PaymentProofReview,
  type PreviewPaymentProofDecision,
} from "~/components/dashboard/payments/payment-proof-review";
import type {
  ProducerPaymentProofHistory,
  ProducerPaymentProofReview,
} from "~/server/domain/payment-proofs/service";

type Stage =
  | "artist-first"
  | "producer-first"
  | "artist-replacement"
  | "producer-replacement"
  | "confirmed";

const PURCHASE_ID = "00000000-0000-4000-8000-000000000075";
const INSTALLMENT_ID = "00000000-0000-4000-8000-000000000751";
const FIRST_PROOF_ID = "00000000-0000-4000-8000-000000000752";
const REPLACEMENT_PROOF_ID = "00000000-0000-4000-8000-000000000753";

function producerProof(
  submission: PreviewProofSubmission,
  input: {
    proofId: string;
    status: "pending" | "confirmed" | "rejected";
    rejectionNote?: string | undefined;
  },
): ProducerPaymentProofHistory {
  return {
    proofId: input.proofId,
    purchaseId: PURCHASE_ID,
    purchaseRequestId: "00000000-0000-4000-8000-000000000754",
    installmentId: INSTALLMENT_ID,
    installmentPosition: 1,
    installmentAmountCents: 120_000,
    refNumber: "SK-75SAFE",
    artistName: "Maya Cohen",
    projectId: "00000000-0000-4000-8000-000000000755",
    projectTitle: "Maya — debut single",
    productNameSnapshot: "Premium Single Production",
    amountCents: submission.amountCents,
    totalCents: 240_000,
    currency: "ILS",
    originalFileName: submission.originalFileName,
    contentType: submission.contentType,
    sizeBytes: submission.sizeBytes,
    proofNote: submission.note,
    status: input.status,
    rejectionNote: input.rejectionNote ?? null,
    confirmedAt: input.status === "confirmed" ? new Date("2026-07-20T10:08:00Z") : null,
    rejectedAt: input.status === "rejected" ? new Date("2026-07-20T10:04:00Z") : null,
    createdAt:
      input.proofId === FIRST_PROOF_ID
        ? new Date("2026-07-20T10:00:00Z")
        : new Date("2026-07-20T10:06:00Z"),
  };
}

function artistProof(proof: ProducerPaymentProofHistory): ArtistProofHistoryItem {
  return {
    id: proof.proofId,
    amountCents: proof.amountCents,
    status:
      proof.status === "pending" ? "awaiting" : proof.status === "confirmed" ? "paid" : "rejected",
    evidenceUrl: "/icon",
    originalFileName: proof.originalFileName,
    createdAt: proof.createdAt,
    rejectionNote: proof.rejectionNote,
  };
}

function review(
  proof: ProducerPaymentProofHistory,
  history: readonly ProducerPaymentProofHistory[],
): ProducerPaymentProofReview {
  return {
    proof,
    history,
    evidenceUrl: "/icon",
    evidenceExpiresInSeconds: 300,
  };
}

export function Sk75ProofFlowDevScreen() {
  const [stage, setStage] = useState<Stage>("artist-first");
  const [firstSubmission, setFirstSubmission] = useState<PreviewProofSubmission | null>(null);
  const [replacementSubmission, setReplacementSubmission] = useState<PreviewProofSubmission | null>(
    null,
  );
  const [rejectionNote, setRejectionNote] = useState("");

  const firstRejected = firstSubmission
    ? producerProof(firstSubmission, {
        proofId: FIRST_PROOF_ID,
        status: "rejected",
        rejectionNote,
      })
    : null;

  function submitFirst(submission: PreviewProofSubmission) {
    setFirstSubmission(submission);
    setStage("producer-first");
  }

  function submitReplacement(submission: PreviewProofSubmission) {
    setReplacementSubmission(submission);
    setStage("producer-replacement");
  }

  function decideFirst(decision: PreviewPaymentProofDecision) {
    if (decision.kind !== "reject") return;
    setRejectionNote(decision.note);
    setStage("artist-replacement");
  }

  function decideReplacement(decision: PreviewPaymentProofDecision) {
    if (decision.kind !== "confirm") return;
    setStage("confirmed");
  }

  if (stage === "artist-first" || stage === "artist-replacement") {
    return (
      <UploadProofScreen
        productName="Premium Single Production"
        producerName="Gili Studio"
        previewOnly
        onPreviewSubmit={stage === "artist-first" ? submitFirst : submitReplacement}
        currency="ILS"
        installmentPosition={1}
        proofs={firstRejected ? [artistProof(firstRejected)] : []}
        paidCents={0}
        totalCents={240_000}
        thisProofCents={120_000}
        status={stage === "artist-replacement" ? "rejected" : "empty"}
        rejectionNote={stage === "artist-replacement" ? rejectionNote : undefined}
      />
    );
  }

  if (!firstSubmission) return null;
  const currentFirst = producerProof(firstSubmission, {
    proofId: FIRST_PROOF_ID,
    status: stage === "producer-first" ? "pending" : "rejected",
    rejectionNote: rejectionNote || undefined,
  });
  const currentReplacement = replacementSubmission
    ? producerProof(replacementSubmission, {
        proofId: REPLACEMENT_PROOF_ID,
        status: stage === "confirmed" ? "confirmed" : "pending",
      })
    : null;
  const current = currentReplacement ?? currentFirst;
  const history = currentReplacement ? [currentFirst, currentReplacement] : [currentFirst];

  return (
    <main className="mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-6 sm:py-9">
      <div
        data-testid="sk75-mocked-browser-flow"
        className="mb-4 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-overlay))] px-4 py-3 text-xs text-[rgb(var(--fg-muted))]"
      >
        Safe browser fixture · no database or R2 writes · stage: {stage}
      </div>
      <PaymentProofReview
        review={review(current, history)}
        onPreviewDecision={currentReplacement ? decideReplacement : decideFirst}
      />
    </main>
  );
}
