import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { PaymentInstructionsScreen, type PaymentDetails } from "../payment-instructions-screen";

function renderInstructions(
  paymentDetails: PaymentDetails | null,
  proofUploadsAvailable = true,
): string {
  return renderToStaticMarkup(
    <PaymentInstructionsScreen
      studioId="producer-1"
      purchaseId="purchase-1"
      installmentId="installment-1"
      producerName="North Room"
      amountDueNowCents={120_000}
      currency="ILS"
      paymentDetails={paymentDetails}
      productName="Single production"
      planLabel="Full payment"
      proofUploadsAvailable={proofUploadsAvailable}
      proofHref="/artist/payments/purchase-1/proof/new?installment=installment-1"
      summaryHref="/artist/payments/purchase-1"
    />,
  );
}

describe("payment instruction method states", () => {
  it("renders Bank details and the upload action", () => {
    const html = renderInstructions({ bankTransfer: "Bank 10 · Branch 123 · 456789" });

    expect(html).toContain("Bank transfer");
    expect(html).toContain("Bank 10 · Branch 123 · 456789");
    expect(html).toContain("<ol");
    expect(html).toContain('role="list"');
    expect(html).toContain("Two steps");
    expect(html).toContain("Pay exactly ₪1,200 now");
    expect(html).toContain("Use one payment method below.");
    expect(html).toContain("Return here and upload proof");
    expect(html).toContain("I’ve paid — upload proof");
  });

  it("renders Bit details and the upload action", () => {
    const html = renderInstructions({ bitPhone: "050-123-4567" });

    expect(html).toContain("Bit");
    expect(html).toContain("050-123-4567");
    expect(html).toContain("I’ve paid — upload proof");
  });

  it("renders the direct-details fallback, note, and upload action without Bank or Bit", () => {
    const html = renderInstructions({ note: "Use your surname as the transfer reference." });

    expect(html).toContain("North Room will send payment details directly");
    expect(html).toContain("Get the details, then pay exactly ₪1,200");
    expect(html).toContain("North Room will send Bank or Bit details directly.");
    expect(html).toContain("Use the details they send for Step 1.");
    expect(html).toContain("Return here and upload proof");
    expect(html).toContain("Use your surname as the transfer reference.");
    expect(html).toContain("I’ve paid — upload proof");
  });

  it("keeps proof upload unavailable when the backend disables it", () => {
    const html = renderInstructions(null, false);

    expect(html).toContain("Proof upload temporarily unavailable");
    expect(html).toContain("Get the details, then pay exactly ₪1,200");
    expect(html).toContain("Keep your receipt and return here later");
    expect(html).toContain("Proof upload is temporarily unavailable.");
    expect(html).toContain(
      "Use the details they send, then keep your receipt until proof upload is available again.",
    );
    expect(html).not.toContain("Return here and upload proof");
    expect(html).not.toContain("come back here and upload your proof");
    expect(html).toContain("disabled");
    expect(html).not.toContain("I’ve paid — upload proof");
  });
});
