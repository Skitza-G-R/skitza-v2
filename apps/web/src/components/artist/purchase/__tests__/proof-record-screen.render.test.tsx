import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn() }),
}));

import { ProofRecordScreen } from "../proof-record-screen";

const baseProps = {
  purchaseId: "purchase-1",
  studioId: "producer-1",
  productName: "Single production",
  producerName: "North Room",
  currency: "ILS",
  totalCents: 120_000,
  verifiedCents: 0,
  remainingCents: 120_000,
  paidInFull: false,
  replacementUploadAvailable: false,
  rejectionNote: null,
  proof: {
    proofId: "proof-1",
    installmentId: "installment-1",
    installmentPosition: 1,
    amountCents: 60_000,
    status: "pending" as const,
    createdAt: new Date("2026-08-03T12:00:00.000Z"),
    originalFileName: "receipt.png",
    evidenceUrl: "/api/payment-proofs/evidence?token=private",
  },
  history: [],
};

describe("artist proof record design", () => {
  it("restores the focused previous design for a pending proof", () => {
    const html = renderToStaticMarkup(<ProofRecordScreen {...baseProps} />);

    expect(html).toContain("Payment proof");
    expect(html).toContain("Proof sent");
    expect(html).toContain("Needs producer review");
    expect(html).toContain("Proof history");
    expect(html).toContain("receipt.png");
    expect(html).toContain("UTC");
    expect(html).toContain("Payment progress");
    expect(html).toContain("Back to payment summary");
  });

  it("keeps replacement upload on the exact canonical route", () => {
    const html = renderToStaticMarkup(
      <ProofRecordScreen
        {...baseProps}
        proof={{ ...baseProps.proof, status: "rejected" }}
        replacementUploadAvailable
        rejectionNote="Please upload a clearer image."
      />,
    );

    expect(html).toContain("Upload a replacement");
    expect(html).toContain("Please upload a clearer image.");
    expect(html).toContain(
      "/artist/payments/purchase-1/proof/new?installment=installment-1&amp;studio=producer-1",
    );
  });

  it("shows the old completion treatment after producer verification", () => {
    const html = renderToStaticMarkup(
      <ProofRecordScreen
        {...baseProps}
        proof={{ ...baseProps.proof, status: "confirmed" }}
        verifiedCents={120_000}
        remainingCents={0}
        paidInFull
      />,
    );

    expect(html).toContain("All paid up");
    expect(html).toContain("Payment complete");
    expect(html).toContain("Back to Home");
  });
});
