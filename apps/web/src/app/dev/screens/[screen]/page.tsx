import { notFound } from "next/navigation";

import {
  PurchaseStatusCard,
  type PurchaseStage,
} from "~/components/artist/home/purchase-status-card";

import { ProductDetailScreen } from "~/components/artist/purchase/product-detail-screen";
import { ChoosePlanScreen } from "~/components/artist/purchase/choose-plan-screen";
import { PaymentInstructionsScreen } from "~/components/artist/purchase/payment-instructions-screen";
import { RequestSentScreen } from "~/components/artist/purchase/request-sent-screen";
import { ReviewAgreeScreen } from "~/components/artist/purchase/review-agree-screen";
import { UploadProofScreen } from "~/components/artist/purchase/upload-proof-screen";
import { buildAgreementTerms } from "~/components/artist/purchase/purchase-data";
import { PaymentProofReview } from "~/components/dashboard/requests/payment-proof-review";
import {
  PendingPaymentProofs,
  type PendingPaymentProof,
} from "~/components/dashboard/requests/pending-payment-proofs";
import {
  livePlanOptions,
  MOCK_PRODUCER,
  MOCK_PRODUCT,
} from "~/components/artist/purchase/pay-data";

const DEV_REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const DEV_PROOF_ID = "00000000-0000-4000-8000-000000000002";
const DEV_PENDING_PROOF: PendingPaymentProof = {
  proofId: DEV_PROOF_ID,
  purchaseRequestId: DEV_REQUEST_ID,
  refNumber: "SK-7F3QK2",
  artistName: "Maya Cohen",
  productNameSnapshot: "Premium Single Production",
  amountCents: 120_000,
  totalCents: 240_000,
  currency: "ILS",
  originalFileName: "bit-receipt-full.png",
  contentType: "image/png",
  sizeBytes: 248_320,
  proofNote: "Deposit sent by Bit. The transfer reference is visible at the bottom.",
  createdAt: new Date("2026-07-11T16:30:00.000Z"),
};
const DEV_PLAN_OPTIONS = livePlanOptions([
  {
    kind: "full",
    charges: [240000],
    dueNowCents: 240000,
    labels: ["Due today"],
  },
  {
    kind: "split_50_50",
    charges: [120000, 120000],
    dueNowCents: 120000,
    labels: ["Due today", "On delivery"],
  },
  {
    kind: "monthly",
    installments: 3,
    charges: [80000, 80000, 80000],
    dueNowCents: 80000,
    labels: ["Due today", "Month 2", "Month 3"],
  },
]);

// Dev-only screen gallery for the handoff-4 wave (2026-07-05). Renders the
// funnel screens with mock props at /dev/screens/<name> so visual QA can
// screenshot every state at 390×844 WITHOUT a Clerk session. Hard 404 in
// production — this never ships to users. Extend the map as waves land.
type Params = { params: Promise<{ screen: string }> };

export default async function DevScreenPage({ params }: Params) {
  if (process.env.NODE_ENV === "production") notFound();
  const { screen } = await params;

  switch (screen) {
    case "s3":
      return (
        <ProductDetailScreen
          product={MOCK_PRODUCT}
          producer={MOCK_PRODUCER}
          productId="00000000-0000-4000-8000-000000000000"
          previewAgreeHref="/dev/screens/s4"
        />
      );
    case "s3-pending":
      return (
        <ProductDetailScreen
          product={MOCK_PRODUCT}
          producer={MOCK_PRODUCER}
          productId="00000000-0000-4000-8000-000000000000"
          pendingRequest
        />
      );
    case "s4":
      return (
        <ReviewAgreeScreen
          product={MOCK_PRODUCT}
          producer={MOCK_PRODUCER}
          terms={buildAgreementTerms(MOCK_PRODUCER.name, MOCK_PRODUCT.includes)}
          commercialTermsFingerprint="development-preview"
          previewSentHref="/dev/screens/s5"
        />
      );
    case "s5":
      return (
        <RequestSentScreen product={MOCK_PRODUCT} producer={MOCK_PRODUCER} requestRef="SK-7F3QK2" />
      );
    case "s7":
      return (
        <ChoosePlanScreen
          productId={MOCK_PRODUCT.id}
          productName={MOCK_PRODUCT.name}
          producerName={MOCK_PRODUCER.name}
          purchaseRequestId={DEV_REQUEST_ID}
          options={DEV_PLAN_OPTIONS}
          previewNextHref="/dev/screens/s8"
        />
      );
    case "s8":
      return (
        <PaymentInstructionsScreen
          productId={MOCK_PRODUCT.id}
          purchaseRequestId={DEV_REQUEST_ID}
          producerName={MOCK_PRODUCER.name}
          amountDueNowCents={120000}
          paymentDetails={{
            bankTransfer: "Bank Hapoalim\nBranch 613\nAccount 12-345678",
            bitPhone: "052-000-0000",
            note: "Add your SK request number to the transfer note.",
          }}
          productName={MOCK_PRODUCT.name}
          planLabel="Split 50 / 50"
          previewProofHref="/dev/screens/s9"
        />
      );
    case "s9":
    case "s9-awaiting":
    case "s9-rejected":
    case "s9-paid": {
      const state = screen.slice(3);
      const isPaid = state === "paid";
      const isAwaiting = state === "awaiting";
      const isRejected = state === "rejected";
      return (
        <UploadProofScreen
          productName={MOCK_PRODUCT.name}
          producerName={MOCK_PRODUCER.name}
          purchaseRequestId={DEV_REQUEST_ID}
          proofs={
            isAwaiting
              ? [{ id: "proof-1", amountCents: 120000, status: "awaiting" }]
              : isRejected
                ? [{ id: "proof-1", amountCents: 120000, status: "rejected" }]
                : isPaid
                  ? [{ id: "proof-1", amountCents: 240000, status: "paid" }]
                  : []
          }
          paidCents={isPaid ? 240000 : 0}
          totalCents={240000}
          thisProofCents={isPaid ? 0 : 120000}
          status={isPaid ? "paid" : isAwaiting ? "awaiting" : isRejected ? "rejected" : "empty"}
          rejectionNote={isRejected ? "The amount is cut off in the screenshot." : undefined}
        />
      );
    }
    case "gate2-queue":
      return (
        <main className="mx-auto w-full max-w-[1040px] px-4 py-8 sm:px-6 lg:px-8">
          <PendingPaymentProofs proofs={[DEV_PENDING_PROOF]} />
        </main>
      );
    case "gate2-review":
      return (
        <main className="mx-auto w-full max-w-[1040px] px-4 py-8 sm:px-6 lg:px-8">
          <PaymentProofReview
            proof={{
              ...DEV_PENDING_PROOF,
              signedUrl: "/icon",
              expiresInSeconds: 300,
            }}
          />
        </main>
      );
    default: {
      if (screen.startsWith("s6-")) {
        const stage = screen.slice(3) as PurchaseStage;
        const valid: PurchaseStage[] = [
          "pending_review",
          "awaiting_payment",
          "verifying",
          "paid",
          "declined",
        ];
        if (!valid.includes(stage)) notFound();
        return (
          <div className="mx-auto max-w-[440px] px-5 py-16">
            <PurchaseStatusCard
              stage={stage}
              productName={MOCK_PRODUCT.name}
              priceCents={MOCK_PRODUCT.priceCents}
              remainingCents={
                stage === "paid"
                  ? Math.ceil(MOCK_PRODUCT.priceCents / 2)
                  : stage === "declined"
                    ? 0
                    : MOCK_PRODUCT.priceCents
              }
              producerName={MOCK_PRODUCER.name}
              {...(stage === "awaiting_payment"
                ? {
                    actionHref: "/dev/screens/s7",
                    actionLabel: "Choose a payment plan",
                  }
                : stage === "paid"
                  ? { actionHref: "/dev/screens/s8", actionLabel: "Make next payment" }
                  : {})}
            />
          </div>
        );
      }
      notFound();
    }
  }
}
